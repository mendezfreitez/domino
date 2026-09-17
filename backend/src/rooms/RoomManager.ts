import { DominoGame } from "../game/DominoGame.js";
import { PLAYERS_PER_TEAM, Player, TEAM_COUNT } from "../game/game.types.js";

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
}

export type JoinRoomResult =
  | { ok: true; room: Room; player: Player }
  | { ok: false; error: string };

export type LeaveRoomResult = {
  room: Room;
  player: Player;
  roomClosed: boolean;
};

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(playerName: string): { roomId: string; room: Room; player: Player } {
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
    };
    this.reassignPositions(room);
    this.rooms.set(roomId, room);
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
    room.players.push(player);
    this.reassignPositions(room);
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
    if (destinationCount < PLAYERS_PER_TEAM) {
      target.team = team;
    } else {
      const swapCandidate = room.players
        .filter((p) => p.team === team)
        .sort((a, b) => b.position - a.position)[0];
      swapCandidate.team = target.team;
      target.team = team;
    }
    this.reassignPositions(room);
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
    playerA.team = playerB.team;
    playerB.team = teamA;
    this.reassignPositions(room);
    return { ok: true, room };
  }

  leaveRoom(roomId: string, playerId: string): LeaveRoomResult | null {
    const normalizedId = this.normalizeRoomId(roomId);
    const room = this.rooms.get(normalizedId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return null;

    room.players = room.players.filter((p) => p.id !== playerId);

    if (room.hostId === playerId) {
      room.hostId = room.players[0]?.id ?? "";
    }

    this.reassignPositions(room);

    let roomClosed = false;
    if (room.players.length === 0) {
      this.rooms.delete(normalizedId);
      roomClosed = true;
    }

    return { room, player, roomClosed };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(this.normalizeRoomId(roomId));
  }

  removeRoom(roomId: string): void {
    this.rooms.delete(this.normalizeRoomId(roomId));
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
    } while (this.rooms.has(code));
    return code;
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