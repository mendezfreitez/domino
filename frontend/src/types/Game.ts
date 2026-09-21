import type { DominoTile } from "./Domino";
import type { Player } from "./Player";

export type GameStatus = "waiting" | "playing" | "round-over" | "finished";

export type WinnerReason = "empty-hand" | "blocked" | "player-left";

export interface PublicGameState {
  roomId: string;
  players: Player[];
  board: DominoTile[];
  currentPlayer: string | null;
  status: GameStatus;
  winnerId: string | null;
  winnerTeam: number | null;
  winnerReason: WinnerReason | null;
  yourPlayerId: string;
  yourHand: DominoTile[];
  handCounts: Record<string, number>;
  teamScores: [number, number];
  roundNumber: number;
  targetScore: number;
  matchWinnerTeam: number | null;
  mustPass: boolean;
  revealedHands: Record<string, DominoTile[]>;
}

export interface RoomInfo {
  roomId: string;
  players: Player[];
  status: GameStatus;
  hostId: string;
}

export interface GameFinishedPayload {
  roomId: string;
  winnerId: string | null;
  winnerTeam: number | null;
  winnerReason: WinnerReason | null;
  matchWinnerTeam: number | null;
}