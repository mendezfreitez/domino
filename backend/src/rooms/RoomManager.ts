import { DominoGame } from "../game/DominoGame.js";
import { Player } from "../game/game.types.js";

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
    };
    const room: Room = {
      roomId,
      hostId: player.id,
      players: [player],
      status: "waiting",
      game: null,
    };
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
    const player: Player = {
      id: this.generatePlayerId(),
      name: this.normalizeName(playerName),
      position: room.players.length,
    };
    room.players.push(player);
    return { ok: true, room, player };
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