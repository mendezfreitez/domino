import {
  DominoTile,
  GameState,
  GameStatus,
  MATCH_TARGET_SCORE,
  Player,
  TEAM_COUNT,
  WinnerReason,
} from "../game/game.types.js";
import { CorruptGameStateError } from "./persistence.types.js";

/**
 * Conversión GameState <-> JSON para SQLite.
 *
 * La lógica de juego nunca ve SQL ni cadenas: habla con objetos de JavaScript y
 * esta capa se encarga de (de)serializar y de validar que lo que se lee de disco
 * sea realmente una partida reconstruible. Cualquier dato que no supere la
 * validación se rechaza con CorruptGameStateError en lugar de propagar estado
 * medio roto al Game Engine.
 */

const VALID_STATUSES: GameStatus[] = [
  "waiting",
  "playing",
  "round-over",
  "finished",
];

const VALID_WINNER_REASONS: WinnerReason[] = [
  "empty-hand",
  "blocked",
  "player-left",
];

const MAX_NAME_LENGTH = 40;
const MAX_TILES = 64;
const MAX_PLAYERS = 8;

function fail(roomId: string, detail: string): never {
  throw new CorruptGameStateError(roomId, detail);
}

function asRecord(roomId: string, value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(roomId, `${what} no es un objeto.`);
  }
  return value as Record<string, unknown>;
}

function asArray(roomId: string, value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(roomId, `${what} no es una lista.`);
  return value;
}

function asString(roomId: string, value: unknown, what: string): string {
  if (typeof value !== "string") fail(roomId, `${what} no es texto.`);
  return value;
}

function asNullableString(
  roomId: string,
  value: unknown,
  what: string
): string | null {
  if (value === null || value === undefined) return null;
  return asString(roomId, value, what);
}

function asInteger(roomId: string, value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(roomId, `${what} no es un número entero.`);
  }
  return value;
}

function asFiniteNumber(roomId: string, value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(roomId, `${what} no es un número.`);
  }
  return value;
}

function asPip(roomId: string, value: unknown, what: string): number {
  const pip = asInteger(roomId, value, what);
  if (pip < 0 || pip > 6) fail(roomId, `${what} fuera de rango (0-6): ${pip}.`);
  return pip;
}

function parseTile(roomId: string, value: unknown, what: string): DominoTile {
  const raw = asRecord(roomId, value, what);
  const id = asString(roomId, raw.id, `${what}.id`);
  const left = asPip(roomId, raw.left, `${what}.left`);
  const right = asPip(roomId, raw.right, `${what}.right`);
  // El id siempre es la forma canónica (`2-5`, nunca `5-2`), pero una ficha
  // colocada en el tablero se guarda ya girada: [5|2] con id "2-5" es válido.
  const [idLow, idHigh] = splitTileId(roomId, id, what);
  if (idLow !== idHigh && (idLow > idHigh)) {
    fail(roomId, `${what}.id (${id}) no está en forma canónica.`);
  }
  if (
    (left === idLow && right === idHigh) ||
    (left === idHigh && right === idLow)
  ) {
    return { id, left, right };
  }
  fail(
    roomId,
    `${what} tiene id ${id} pero sus caras son ${left}-${right}.`
  );
}

function splitTileId(
  roomId: string,
  id: string,
  what: string
): [number, number] {
  const match = /^(\d)-(\d)$/.exec(id);
  if (!match) fail(roomId, `${what}.id (${id}) no tiene el formato "a-b".`);
  return [
    asPip(roomId, Number(match[1]), `${what}.id izquierdo`),
    asPip(roomId, Number(match[2]), `${what}.id derecho`),
  ];
}

function parseTiles(roomId: string, value: unknown, what: string): DominoTile[] {
  const list = asArray(roomId, value, what);
  if (list.length > MAX_TILES) fail(roomId, `${what} tiene demasiadas fichas.`);
  return list.map((tile, index) => parseTile(roomId, tile, `${what}[${index}]`));
}

function parsePlayer(roomId: string, value: unknown, index: number): Player {
  const what = `players[${index}]`;
  const raw = asRecord(roomId, value, what);
  const id = asString(roomId, raw.id, `${what}.id`);
  if (id.length === 0) fail(roomId, `${what}.id está vacío.`);
  const name = asString(roomId, raw.name, `${what}.name`).slice(0, MAX_NAME_LENGTH);
  const position = asInteger(roomId, raw.position, `${what}.position`);
  const team = asInteger(roomId, raw.team, `${what}.team`);
  if (position < 0 || position >= MAX_PLAYERS) {
    fail(roomId, `${what}.position fuera de rango: ${position}.`);
  }
  if (team < 0 || team >= TEAM_COUNT) {
    fail(roomId, `${what}.team fuera de rango: ${team}.`);
  }
  return { id, name, position, team };
}

function parseStringList(
  roomId: string,
  value: unknown,
  what: string
): string[] {
  if (value === null || value === undefined) return [];
  const list = asArray(roomId, value, what);
  return list.map((item, index) => asString(roomId, item, `${what}[${index}]`));
}

function parseStatus(roomId: string, value: unknown): GameStatus {
  const status = asString(roomId, value, "status");
  if (!VALID_STATUSES.includes(status as GameStatus)) {
    fail(roomId, `status desconocido: ${status}.`);
  }
  return status as GameStatus;
}

function parseWinnerReason(
  roomId: string,
  value: unknown
): WinnerReason | null {
  if (value === null || value === undefined) return null;
  const reason = asString(roomId, value, "winnerReason");
  if (!VALID_WINNER_REASONS.includes(reason as WinnerReason)) {
    fail(roomId, `winnerReason desconocido: ${reason}.`);
  }
  return reason as WinnerReason;
}

function parseScorePair(roomId: string, value: unknown): [number, number] {
  const list = asArray(roomId, value, "teamScores");
  if (list.length !== TEAM_COUNT) {
    fail(roomId, `teamScores debe tener ${TEAM_COUNT} elementos.`);
  }
  const scores = list.map((score, index) =>
    asInteger(roomId, score, `teamScores[${index}]`)
  );
  if (scores.some((score) => score < 0)) {
    fail(roomId, "teamScores no puede ser negativo.");
  }
  return [scores[0], scores[1]];
}

/**
 * Serializa el estado completo de la partida. El resultado es un snapshot
 * independiente: el Game Engine puede seguir mutando su estado sin que el JSON
 * guardado cambie.
 */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Reconstruye un GameState a partir de lo guardado en SQLite.
 *
 * Lanza CorruptGameStateError si el documento no representa una partida válida.
 * Los campos añadidos en el futuro se rellenan con valores por omisión
 * coherentes para que un registro antiguo siga siendo recuperable.
 */
export function deserializeGameState(roomId: string, json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    fail(roomId, `el JSON no se puede interpretar (${(error as Error).message}).`);
  }

  const raw = asRecord(roomId, parsed, "state");

  if (asString(roomId, raw.roomId, "roomId") !== roomId) {
    fail(roomId, "el roomId guardado no coincide con la fila.");
  }

  const players = asArray(roomId, raw.players, "players").map((player, index) =>
    parsePlayer(roomId, player, index)
  );
  if (players.length > MAX_PLAYERS) {
    fail(roomId, "hay demasiados jugadores en la partida.");
  }
  const playerIds = new Set(players.map((player) => player.id));
  if (playerIds.size !== players.length) {
    fail(roomId, "hay jugadores duplicados en la partida.");
  }

  const hands: Record<string, DominoTile[]> = {};
  const rawHands = asRecord(roomId, raw.hands ?? {}, "hands");
  for (const [playerId, tiles] of Object.entries(rawHands)) {
    if (!playerIds.has(playerId)) {
      fail(roomId, `hands contiene a un jugador ajeno: ${playerId}.`);
    }
    hands[playerId] = parseTiles(roomId, tiles, `hands.${playerId}`);
  }

  const board = parseTiles(roomId, raw.board ?? [], "board");
  if (board.length > MAX_TILES) fail(roomId, "el tablero es demasiado grande.");

  // El ancla de la cadena solo sirve si es una ficha que está en el tablero: es
  // la que permite reconstruir la geometría al reconectar. En un registro
  // antiguo, donde el campo aún no existía, se asume la primera ficha, que es lo
  // que se hacía antes de guardarlo (cadena válida, aunque recolocada).
  let boardAnchorId: string | null;
  if (raw.boardAnchorId === undefined || raw.boardAnchorId === null) {
    boardAnchorId = board.length > 0 ? board[0].id : null;
  } else {
    boardAnchorId = asString(roomId, raw.boardAnchorId, "boardAnchorId");
    if (!board.some((tile) => tile.id === boardAnchorId)) {
      fail(
        roomId,
        `boardAnchorId (${boardAnchorId}) no es una ficha del tablero.`
      );
    }
  }
  if (board.length === 0 && boardAnchorId !== null) {
    fail(roomId, "el tablero está vacío pero tiene ancla.");
  }

  const currentPlayer = asNullableString(
    roomId,
    raw.currentPlayer,
    "currentPlayer"
  );
  if (currentPlayer !== null && !playerIds.has(currentPlayer)) {
    fail(roomId, `currentPlayer (${currentPlayer}) no está en la partida.`);
  }

  const status = parseStatus(roomId, raw.status);

  const winnerId = asNullableString(roomId, raw.winnerId, "winnerId");
  if (winnerId !== null && !playerIds.has(winnerId)) {
    fail(roomId, `winnerId (${winnerId}) no está en la partida.`);
  }

  const blockedById = asNullableString(roomId, raw.blockedById, "blockedById");
  if (blockedById !== null && !playerIds.has(blockedById)) {
    fail(roomId, `blockedById (${blockedById}) no está en la partida.`);
  }

  const currentStarterId = asNullableString(
    roomId,
    raw.currentStarterId,
    "currentStarterId"
  );
  if (currentStarterId !== null && !playerIds.has(currentStarterId)) {
    fail(roomId, `currentStarterId (${currentStarterId}) no está en la partida.`);
  }

  const winnerTeam = raw.winnerTeam ?? null;
  if (winnerTeam !== null) {
    const team = asInteger(roomId, winnerTeam, "winnerTeam");
    if (team < 0 || team >= TEAM_COUNT) {
      fail(roomId, `winnerTeam fuera de rango: ${team}.`);
    }
  }

  const matchWinnerTeam = raw.matchWinnerTeam ?? null;
  if (matchWinnerTeam !== null) {
    const team = asInteger(roomId, matchWinnerTeam, "matchWinnerTeam");
    if (team < 0 || team >= TEAM_COUNT) {
      fail(roomId, `matchWinnerTeam fuera de rango: ${team}.`);
    }
  }

  // `bunk` (fichas del pozo) no se usa en esta variante — el reparto es
  // exacto — pero se conserva en el estado para que recuperarlo y jugarlo más
  // adelante no requiera cambiar el esquema.
  const bunk = parseTiles(roomId, raw.bunk ?? [], "bunk");

  const readyForNextRound = parseStringList(
    roomId,
    raw.readyForNextRound,
    "readyForNextRound"
  );
  for (const playerId of readyForNextRound) {
    if (!playerIds.has(playerId)) {
      fail(roomId, `readyForNextRound incluye a un jugador ajeno: ${playerId}.`);
    }
  }

  const revision =
    raw.revision === undefined || raw.revision === null
      ? 0
      : asInteger(roomId, raw.revision, "revision");

  const targetScore =
    raw.targetScore === undefined || raw.targetScore === null
      ? MATCH_TARGET_SCORE
      : asFiniteNumber(roomId, raw.targetScore, "targetScore");
  if (targetScore <= 0) fail(roomId, "targetScore debe ser mayor que cero.");

  const roundNumber = Math.max(
    0,
    asInteger(roomId, raw.roundNumber ?? 0, "roundNumber")
  );

  // Coherencia mínima: una partida "playing" necesita turno y al menos un
  // jugador; una "waiting" no puede tener fichas repartidas.
  if (status === "playing" && currentPlayer === null) {
    fail(roomId, "la partida está en curso pero no tiene turno actual.");
  }
  if (status === "waiting" && (board.length > 0 || readyForNextRound.length > 0)) {
    fail(roomId, "la partida está en espera pero tiene estado de ronda.");
  }

  return {
    roomId,
    players,
    hands,
    board,
    boardAnchorId,
    bunk,
    currentPlayer,
    status,
    winnerId,
    winnerTeam: winnerTeam as number | null,
    winnerReason: parseWinnerReason(roomId, raw.winnerReason),
    blockedById,
    teamScores: parseScorePair(roomId, raw.teamScores ?? [0, 0]),
    roundNumber,
    currentStarterId,
    matchWinnerTeam: matchWinnerTeam as number | null,
    targetScore,
    readyForNextRound,
    revision,
  };
}
