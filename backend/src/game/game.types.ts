export interface DominoTile {
  id: string;
  left: number;
  right: number;
}

export interface Player {
  id: string;
  name: string;
  position: number;
  team: number;
}

export type GameStatus = "waiting" | "playing" | "round-over" | "finished";

export type WinnerReason = "empty-hand" | "blocked" | "player-left";

/**
 * Estado completo y persistible de una partida.
 *
 * Cualquier campo que afecte al desarrollo del juego vive aquí: este objeto es
 * lo que se guarda en SQLite y lo que permite reconstruir la partida tras
 * recargar la página o reiniciar el backend.
 */
export interface GameState {
  roomId: string;
  players: Player[];
  hands: Record<string, DominoTile[]>;
  /** Fichas colocadas en el tablero, en orden de izquierda a derecha. */
  board: DominoTile[];
  /** Fichas del pozo. Vacío en esta variante (reparto exacto de 28 fichas). */
  bunk: DominoTile[];
  currentPlayer: string | null;
  status: GameStatus;
  winnerId: string | null;
  winnerTeam: number | null;
  winnerReason: WinnerReason | null;
  blockedById: string | null;
  teamScores: [number, number];
  roundNumber: number;
  currentStarterId: string | null;
  matchWinnerTeam: number | null;
  targetScore: number;
  readyForNextRound: string[];
  /**
   * Contador monotónico que se incrementa en cada cambio de estado. Permite
   * descartar estados atrasados y detectar divergencias al reconectar.
   */
  revision: number;
}

export interface PublicGameState {
  roomId: string;
  players: Player[];
  board: DominoTile[];
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
  /** Estado persistido más reciente; el cliente descarta lo que sea anterior. */
  revision: number;
}

/**
 * Estado público tal y como se envía a un jugador concreto: el estado de juego
 * que puede ver (su mano y la información común) más la información de sesión
 * que solo el servidor conoce (quién está conectado, si está persistido).
 */
export interface GameStateForPlayer extends PublicGameState {
  connectedPlayerIds: string[];
  persisted: boolean;
}

export type MoveResult =
  | { valid: true; played: DominoTile }
  | { valid: false; reason: string };

export const MAX_PLAYERS = 4;

export const TILES_PER_PLAYER = 7;

export const TEAM_COUNT = 2;

export const PLAYERS_PER_TEAM = 2;

export const MATCH_TARGET_SCORE = 100;