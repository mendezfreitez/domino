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

export function emitStartGame(): void {
  socket.emit("start_game");
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