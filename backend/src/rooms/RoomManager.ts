import { DominoGame } from "../game/DominoGame.js";
import { PLAYERS_PER_TEAM, Player, TEAM_COUNT } from "../game/game.types.js";
import { GameRepository } from "../persistence/GameRepository.js";
import {
  CorruptGameStateError,
  PersistenceError,
} from "../persistence/persistence.types.js";

const MAX_PLAYERS = 4;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const MAX_NAME_LENGTH = 20;

export type RoomStatus = "waiting" | "playing" | "finished";

export interface Room {
  roomId: string;
  hostId: string;
  players: Player[];
  status: RoomStatus;
  game: DominoGame | null;
  /** Jugadores con una conexión Socket.IO activa en este momento. */
  connected: Set<string>;
}

export type JoinRoomResult =
  | { ok: true; room: Room; player: Player }
  | { ok: false; error: string };

export type LeaveRoomResult = {
  room: Room;
  player: Player;
  roomClosed: boolean;
};

/** Resultado de intentar recuperar una sala que no está en memoria. */
export type LoadRoomResult =
  | { ok: true; room: Room; source: "memory" | "database" }
  | { ok: false; error: string; code: LoadRoomErrorCode };

export type LoadRoomErrorCode =
  | "not-found"
  | "not-a-member"
  | "corrupt"
  | "persistence-unavailable";

/**
 * Estado previo de una sala, necesario para deshacer un cambio cuando el
 * guardado en SQLite falla y dejar el Game Engine coherente con lo persistido.
 */
interface RoomSnapshot {
  hostId: string;
  players: Player[];
  status: RoomStatus;
  gameState: ReturnType<DominoGame["snapshot"]> | null;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly repository: GameRepository = GameRepository.unavailable(
      "sin repositorio configurado"
    )
  ) {}

  get persistence(): GameRepository {
    return this.repository;
  }

  createRoom(
    playerName: string
  ): { roomId: string; room: Room; player: Player } {
    const roomId = this.generateRoomId();
    const player: Player = {
      id: this.generatePlayerId(),
      name: this.normalizeName(playerName),
      position: 0,
      team: 0,
    };
    const room: Room = {
      roomId,
      hostId: player.id,
      players: [player],
      status: "waiting",
      game: null,
      connected: new Set([player.id]),
    };
    this.reassignPositions(room);
    this.rooms.set(roomId, room);
    this.persistRoom(room);
    return { roomId, room, player };
  }

  joinRoom(roomId: string, playerName: string): JoinRoomResult {
    const normalizedId = this.normalizeRoomId(roomId);
    const room = this.rooms.get(normalizedId);
    if (!room) {
      return { ok: false, error: "La sala no existe. Verifica el código." };
    }
    if (room.players.length >= MAX_PLAYERS) {
      return { ok: false, error: "La sala está llena (máximo 4 jugadores)." };
    }
    if (room.status !== "waiting") {
      return { ok: false, error: "La partida ya comenzó." };
    }
    const team = this.teamWithFewerPlayers(room);
    const player: Player = {
      id: this.generatePlayerId(),
      name: this.normalizeName(playerName),
      position: 0,
      team,
    };
    this.commit(room, () => {
      room.players.push(player);
      room.connected.add(player.id);
      this.reassignPositions(room);
    });
    return { ok: true, room, player };
  }

  movePlayerToTeam(
    roomId: string,
    requesterId: string,
    targetPlayerId: string,
    team: number
  ): { ok: true; room: Room } | { ok: false; error: string } {
    const normalizedId = this.normalizeRoomId(roomId);
    const room = this.rooms.get(normalizedId);
    if (!room) {
      return { ok: false, error: "La sala no existe." };
    }
    if (room.status !== "waiting") {
      return { ok: false, error: "La partida ya comenzó." };
    }
    if (room.hostId !== requesterId) {
      return { ok: false, error: "Solo el anfitrión puede mover jugadores." };
    }
    if (team < 0 || team >= TEAM_COUNT) {
      return { ok: false, error: "Equipo inválido." };
    }
    const target = room.players.find((p) => p.id === targetPlayerId);
    if (!target) {
      return { ok: false, error: "El jugador no está en la sala." };
    }
    if (target.team === team) {
      return { ok: true, room };
    }

    const destinationCount = room.players.filter((p) => p.team === team).length;
    const swapCandidate =
      destinationCount < PLAYERS_PER_TEAM
        ? null
        : room.players
            .filter((p) => p.team === team)
            .sort((a, b) => b.position - a.position)[0];
    this.commit(room, () => {
      if (swapCandidate) swapCandidate.team = target.team;
      target.team = team;
      this.reassignPositions(room);
    });
    return { ok: true, room };
  }

  swapPlayers(
    roomId: string,
    requesterId: string,
    playerIdA: string,
    playerIdB: string
  ): { ok: true; room: Room } | { ok: false; error: string } {
    const normalizedId = this.normalizeRoomId(roomId);
    const room = this.rooms.get(normalizedId);
    if (!room) {
      return { ok: false, error: "La sala no existe." };
    }
    if (room.status !== "waiting") {
      return { ok: false, error: "La partida ya comenzó." };
    }
    if (room.hostId !== requesterId) {
      return { ok: false, error: "Solo el anfitrión puede mover jugadores." };
    }
    const playerA = room.players.find((p) => p.id === playerIdA);
    const playerB = room.players.find((p) => p.id === playerIdB);
    if (!playerA || !playerB) {
      return { ok: false, error: "El jugador no está en la sala." };
    }
    if (playerA.id === playerB.id) {
      return { ok: true, room };
    }
    const teamA = playerA.team;
    this.commit(room, () => {
      playerA.team = playerB.team;
      playerB.team = teamA;
      this.reassignPositions(room);
    });
    return { ok: true, room };
  }

  leaveRoom(roomId: string, playerId: string): LeaveRoomResult | null {
    const normalizedId = this.normalizeRoomId(roomId);
    const room = this.rooms.get(normalizedId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return null;

    const remaining = room.players.filter((p) => p.id !== playerId);
    const roomClosed = remaining.length === 0;
    const nextHostId =
      room.hostId === playerId ? remaining[0]?.id ?? "" : room.hostId;

    if (roomClosed) {
      this.rooms.delete(normalizedId);
      this.safeDelete(normalizedId);
      room.players = remaining;
      room.connected.delete(playerId);
      room.hostId = "";
      return { room, player, roomClosed: true };
    }

    this.commit(room, () => {
      room.players = remaining;
      room.connected.delete(playerId);
      room.hostId = nextHostId;
      this.reassignPositions(room);
      // La sala y el motor deben quedarse con el mismo roster: si no, al
      // recuperar desde SQLite volvería a aparecer el jugador que se fue.
      room.game?.removePlayer(playerId);
    });
    return { room, player, roomClosed: false };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(this.normalizeRoomId(roomId));
  }

  removeRoom(roomId: string): void {
    const normalizedId = this.normalizeRoomId(roomId);
    this.rooms.delete(normalizedId);
    this.safeDelete(normalizedId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  isBalanced(room: Room): boolean {
    return (
      room.players.length === MAX_PLAYERS &&
      this.teamCount(room, 0) === PLAYERS_PER_TEAM &&
      this.teamCount(room, 1) === PLAYERS_PER_TEAM
    );
  }

  teamCount(room: Room, team: number): number {
    return room.players.filter((p) => p.team === team).length;
  }

  /**
   * Devuelve la sala, cargándola desde SQLite si no está en memoria.
   *
   * Es el punto único de entrada a la reconexión: primero se busca en RAM y, si
   * el backend se reinició o la sala nunca se cargó, se reconstruye desde el
   * estado persistido. La validación de pertenencia del jugador va aquí para que
   * nadie pueda espiar una partida con solo conocer su código.
   */
  loadRoomForPlayer(
    roomId: string,
    playerId: string
  ): LoadRoomResult {
    const normalizedId = this.normalizeRoomId(roomId);
    if (normalizedId.length === 0) {
      return { ok: false, error: "Falta el código de la sala.", code: "not-found" };
    }
    if (!playerId) {
      return {
        ok: false,
        error: "Falta la identidad del jugador.",
        code: "not-a-member",
      };
    }

    const inMemory = this.rooms.get(normalizedId);
    if (inMemory) {
      if (!inMemory.players.some((p) => p.id === playerId)) {
        return {
          ok: false,
          error: "No perteneces a esta partida.",
          code: "not-a-member",
        };
      }
      return { ok: true, room: inMemory, source: "memory" };
    }

    if (!this.repository.available) {
      return {
        ok: false,
        error:
          "Esa partida no está en memoria y la base de datos no está disponible.",
        code: "persistence-unavailable",
      };
    }

    let record;
    try {
      record = this.repository.getGame(normalizedId);
    } catch (error) {
      if (error instanceof CorruptGameStateError) {
        return { ok: false, error: error.message, code: "corrupt" };
      }
      throw error;
    }

    if (!record) {
      return {
        ok: false,
        error: "Esa partida ya no existe. Crea una nueva.",
        code: "not-found",
      };
    }

    const playerExists = record.state.players.some((p) => p.id === playerId);
    if (!playerExists) {
      return {
        ok: false,
        error: "No perteneces a esta partida.",
        code: "not-a-member",
      };
    }

    const game = record.state ? DominoGame.fromState(record.state) : null;
    const room: Room = {
      roomId: record.roomId,
      hostId: record.hostId,
      players: record.state.players.map((p) => ({ ...p })),
      status: record.roomStatus,
      game,
      connected: new Set(),
    };
    this.rooms.set(normalizedId, room);
    return { ok: true, room, source: "database" };
  }

  markConnected(room: Room, playerId: string): void {
    room.connected.add(playerId);
  }

  markDisconnected(room: Room, playerId: string): void {
    room.connected.delete(playerId);
  }

  connectedPlayerIds(room: Room): string[] {
    return room.players
      .filter((player) => room.connected.has(player.id))
      .map((player) => player.id);
  }

  /**
   * Aplica un cambio de estado y lo persiste antes de darlo por bueno.
   *
   * Se toma una copia de la sala, se ejecuta la mutación, se incrementa la
   * revisión y se escribe en SQLite. Si el guardado falla, la sala vuelve a su
   * estado anterior y el error se propaga: una jugada nunca se confirma al
   * cliente si no está a salvo en disco. Nunca se emite nada al cliente antes de
   * que esta función termine.
   */
  commit(room: Room, mutation: () => void): void {
    const snapshot = this.takeSnapshot(room);
    try {
      mutation();
    } catch (error) {
      this.applySnapshot(room, snapshot);
      throw error;
    }
    room.game?.bumpRevision();
    try {
      this.persistRoom(room);
    } catch (error) {
      this.applySnapshot(room, snapshot);
      throw error;
    }
  }

  /** Escribe el estado actual de la sala. No lanza si la persistencia está apagada. */
  persistRoom(room: Room): void {
    if (!this.repository.available) return;
    const players = room.players;
    // La fila `games` guarda el estado de la partida; si la sala aún no tiene
    // Game Engine (fase de lobby) se persiste igualmente un estado vacío para
    // que el roster y el anfitrión sobrevivan a un reinicio del backend.
    const state = room.game
      ? room.game.snapshot()
      : {
          roomId: room.roomId,
          players,
          hands: {},
          board: [],
          bunk: [],
          currentPlayer: null,
          status: "waiting" as const,
          winnerId: null,
          winnerTeam: null,
          winnerReason: null,
          blockedById: null,
          teamScores: [0, 0] as [number, number],
          roundNumber: 0,
          currentStarterId: null,
          matchWinnerTeam: null,
          targetScore: 100,
          readyForNextRound: [],
          revision: 0,
        };
    this.repository.saveGame({
      roomId: room.roomId,
      hostId: room.hostId,
      roomStatus: room.status,
      state,
    });
  }

  private takeSnapshot(room: Room): RoomSnapshot {
    return {
      hostId: room.hostId,
      players: room.players.map((p) => ({ ...p })),
      status: room.status,
      gameState: room.game ? room.game.snapshot() : null,
    };
  }

  private applySnapshot(room: Room, snapshot: RoomSnapshot): void {
    room.hostId = snapshot.hostId;
    room.players = snapshot.players.map((p) => ({ ...p }));
    room.status = snapshot.status;
    if (snapshot.gameState === null) {
      room.game = null;
    } else if (room.game) {
      room.game.restore(snapshot.gameState);
    }
  }

  private teamWithFewerPlayers(room: Room): number {
    const counts = Array.from({ length: TEAM_COUNT }, (_, team) =>
      this.teamCount(room, team)
    );
    let best = 0;
    for (let team = 1; team < TEAM_COUNT; team++) {
      if (counts[team] < counts[best]) best = team;
    }
    return best;
  }

  private reassignPositions(room: Room): void {
    const counters = Array.from({ length: TEAM_COUNT }, () => 0);
    for (const player of room.players) {
      const index = counters[player.team] ?? 0;
      player.position = player.team + index * TEAM_COUNT;
      counters[player.team] = index + 1;
    }
  }

  private generatePlayerId(): string {
    return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  private generateRoomId(): string {
    let code = "";
    do {
      code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
    } while (this.rooms.has(code) || this.roomIdTaken(code));
    return code;
  }

  private roomIdTaken(code: string): boolean {
    if (!this.repository.available) return false;
    try {
      return this.repository.gameExists(code);
    } catch {
      return false;
    }
  }

  private safeDelete(roomId: string): void {
    if (!this.repository.available) return;
    try {
      this.repository.deleteGame(roomId);
    } catch (error) {
      console.warn(
        `[persistencia] No se pudo borrar la sala ${roomId}:`,
        (error as Error).message
      );
    }
  }

  private normalizeRoomId(roomId: string): string {
    return (roomId ?? "").trim().toUpperCase();
  }

  private normalizeName(name: string): string {
    const trimmed = (name ?? "").trim();
    if (trimmed.length === 0) {
      return `Jugador ${Math.floor(Math.random() * 9000) + 1000}`;
    }
    return trimmed.slice(0, MAX_NAME_LENGTH);
  }
}

export { PersistenceError };
