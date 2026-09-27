import { io, Socket } from "socket.io-client";
import type { PublicGameState } from "../types/Game";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `http://${window.location.hostname}:3001`;

export const socket: Socket = io(SERVER_URL, { autoConnect: true });

export type PlayTilePayload = { tileId: string; side?: "left" | "right" };

export function emitCreateRoom(playerName: string): void {
  socket.emit("create_room", { playerName });
}

export function emitJoinRoom(roomId: string, playerName: string): void {
  socket.emit("join_room", { roomId, playerName });
}

/**
 * Reconexión: el cliente envía solo su identidad local y el backend decide.
 * Responde con `room_resumed` + el estado completo, o con `resume_failed` si la
 * partida ya no existe o el jugador dejó de pertenecer a ella.
 */
export function emitResumeSession(roomId: string, playerId: string): void {
  socket.emit("resume_session", { roomId, playerId });
}

/** Abandono explícito: no espera la ventana de gracia del servidor. */
export function emitLeaveGame(): void {
  socket.emit("leave_game");
}

export function emitStartGame(): void {
  socket.emit("start_game");
}

export function emitStartNextRound(): void {
  socket.emit("start_next_round");
}

export function emitMovePlayer(playerId: string, team: number): void {
  socket.emit("move_player", { playerId, team });
}

export function emitSwapPlayers(playerIdA: string, playerIdB: string): void {
  socket.emit("swap_players", { playerIdA, playerIdB });
}

export function emitPassTurn(): void {
  socket.emit("pass_turn");
}

export function emitPlayTile(payload: PlayTilePayload): void {
  socket.emit("play_tile", payload);
}

export type GameUpdatedHandler = (state: PublicGameState) => void;

export function onGameUpdated(handler: GameUpdatedHandler): void {
  socket.on("game_updated", handler);
}

export function offGameUpdated(handler: GameUpdatedHandler): void {
  socket.off("game_updated", handler);
}