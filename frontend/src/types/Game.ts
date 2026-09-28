import type { DominoTile } from "./Domino";
import type { Player } from "./Player";

export type GameStatus = "waiting" | "playing" | "round-over" | "finished";

export type WinnerReason = "empty-hand" | "blocked" | "player-left";

export interface PublicGameState {
  roomId: string;
  players: Player[];
  board: DominoTile[];
  /**
   * Ficha con la que empezó la ronda: el ancla de la cadena del tablero. El
   * servidor la persiste para que, al recargar la página, las fichas vuelvan a
   * la posición que tenían. `null` con el tablero vacío.
   */
  boardAnchorId: string | null;
  currentPlayer: string | null;
  status: GameStatus;
  winnerId: string | null;
  winnerTeam: number | null;
  winnerReason: WinnerReason | null;
  blockedById: string | null;
  yourPlayerId: string;
  yourHand: DominoTile[];
  handCounts: Record<string, number>;
  teamScores: [number, number];
  roundNumber: number;
  targetScore: number;
  matchWinnerTeam: number | null;
  mustPass: boolean;
  revealedHands: Record<string, DominoTile[]>;
  readyForNextRound: string[];
  /**
   * Revisión del estado en el servidor. El backend la incrementa en cada cambio
   * guardado, así que el cliente puede ignorar un `game_updated` que haya
   * llegado tarde (por ejemplo tras reconectar) y quedarse con lo más reciente.
   */
  revision: number;
  /** Quién tiene una conexión activa. El resto sigue en la mesa, esperando. */
  connectedPlayerIds: string[];
  /**
   * `false` cuando el backend no tiene base de datos disponible: la partida
   * sigue siendo jugable en memoria, pero no sobrevive a un reinicio.
   */
  persisted: boolean;
}

export interface RoomInfo {
  roomId: string;
  players: Player[];
  status: GameStatus;
  hostId: string;
  connectedPlayerIds?: string[];
  gameStarted?: boolean;
}

/** Causas por las que el backend puede rechazar una reconexión. */
export type ResumeErrorCode =
  | "not-found"
  | "not-a-member"
  | "corrupt"
  | "persistence-unavailable";

export interface RoomCreatedPayload extends RoomInfo {
  playerId: string;
  position: number;
  gameStarted: boolean;
}

export interface RoomResumedPayload extends RoomInfo {
  playerId: string;
  position: number;
  gameStarted: boolean;
  connectedPlayerIds: string[];
  /** De dónde salió la partida: memoria del proceso o fila de SQLite. */
  recoveredFrom: "memory" | "database";
  persisted: boolean;
}

export interface ResumeFailedPayload {
  message: string;
  code: ResumeErrorCode;
}

export interface PlayerDisconnectedPayload {
  playerId: string;
  graceMs: number;
}

export interface PlayerReconnectedPayload {
  playerId: string;
  name: string;
  players: Player[];
  connectedPlayerIds: string[];
}

export interface PlayerLeftPayload {
  player: Player;
  players: Player[];
  explicit: boolean;
}

export interface RoundStartedPayload {
  roomId: string;
  roundNumber: number;
}

export interface GameFinishedPayload {
  roomId: string;
  winnerId: string | null;
  winnerTeam: number | null;
  winnerReason: WinnerReason | null;
  blockedById: string | null;
  matchWinnerTeam: number | null;
}