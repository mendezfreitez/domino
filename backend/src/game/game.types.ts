export interface DominoTile {
  id: string;
  left: number;
  right: number;
}

export interface Player {
  id: string;
  name: string;
  position: number;
}

export type GameStatus = "waiting" | "playing" | "finished";

export type WinnerReason = "empty-hand" | "blocked" | "player-left";

export interface GameState {
  roomId: string;
  players: Player[];
  hands: Record<string, DominoTile[]>;
  board: DominoTile[];
  currentPlayer: string | null;
  status: GameStatus;
  winnerId: string | null;
  winnerReason: WinnerReason | null;
}

export interface PublicGameState {
  roomId: string;
  players: Player[];
  board: DominoTile[];
  currentPlayer: string | null;
  status: GameStatus;
  winnerId: string | null;
  winnerReason: WinnerReason | null;
  yourPlayerId: string;
  yourHand: DominoTile[];
  handCounts: Record<string, number>;
}

export type MoveResult =
  | { valid: true; played: DominoTile }
  | { valid: false; reason: string };

export const MAX_PLAYERS = 4;

export const TILES_PER_PLAYER = 7;