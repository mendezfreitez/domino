import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DominoGame } from "../game/DominoGame.js";
import { GameState, MATCH_TARGET_SCORE, Player } from "../game/game.types.js";
import { Database } from "./Database.js";
import { GameRepository } from "./GameRepository.js";
import {
  CorruptGameStateError,
  GameAlreadyExistsError,
  GameNotFoundError,
} from "./persistence.types.js";
import { deserializeGameState, serializeGameState } from "./stateCodec.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertThrows(fn: () => unknown, check: (e: Error) => boolean, message: string): void {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${message} (no lanzó)`);
  } catch (error) {
    if (check(error as Error)) {
      passed++;
      console.log(`  ✓ ${message}`);
    } else {
      failed++;
      console.error(`  ✗ ${message} (error inesperado: ${(error as Error).message})`);
    }
  }
}

function makePlayers(): Player[] {
  return [
    { id: "p0", name: "Ana", position: 0, team: 0 },
    { id: "p1", name: "Bruno", position: 1, team: 1 },
    { id: "p2", name: "Carla", position: 2, team: 0 },
    { id: "p3", name: "Diego", position: 3, team: 1 },
  ];
}

/** Partida en curso con dos jugadas hechas, tal y como quedaría tras persistir. */
function makePlayingState(): GameState {
  const game = new DominoGame("ABCDE", makePlayers(), {
    targetScore: MATCH_TARGET_SCORE,
  });
  game.start();
  let moves = 0;
  while (moves < 2) {
    const current = game.state.currentPlayer;
    if (!current) break;
    const hand = game.state.hands[current] ?? [];
    if (hand.length === 0) break;
    const left = game.boardLeft();
    const right = game.boardRight();
    const tile =
      left === null || right === null
        ? hand[0]
        : hand.find(
            (t) =>
              t.left === left ||
              t.right === left ||
              t.left === right ||
              t.right === right
          );
    if (!tile) break;
    const result = game.playTile(current, tile.id);
    if (!result.valid) break;
    if (game.hasWinner()) {
      game.finishWithWinner();
      break;
    }
    game.advanceTurn();
    moves++;
  }
  game.bumpRevision();
  return game.snapshot();
}

const tempDir = mkdtempSync(join(tmpdir(), "domino-persistence-"));
const dbPath = join(tempDir, "test.db");
/** Repositorios abiertos, para liberarlos antes de borrar el temporal. */
const opened: GameRepository[] = [];

/**
 * Reescribe el estado guardado de una sala por debajo del repositorio, como si
 * alguien manipulase la fila a mano. Sirve para comprobar que lo corrupto se
 * detecta al leer (y no al guardar), que es cuando ya no hay nada que hacer.
 */
function tamperState(
  roomId: string,
  mutate: (raw: Record<string, unknown>) => void
): void {
  const database = new Database({ path: dbPath });
  try {
    const row = database.raw
      .prepare("SELECT state_json FROM games WHERE room_id = ?")
      .get(roomId) as { state_json: string } | undefined;
    if (!row) throw new Error(`la sala ${roomId} no existe`);
    const raw = JSON.parse(row.state_json) as Record<string, unknown>;
    mutate(raw);
    database.raw
      .prepare("UPDATE games SET state_json = ? WHERE room_id = ?")
      .run(JSON.stringify(raw), roomId);
  } finally {
    database.close();
  }
}

try {
  console.log("--- Serialización del estado ---");

  const state = makePlayingState();
  const json = serializeGameState(state);
  const restored = deserializeGameState("ABCDE", json);

  assert(json.length > 0, "el estado se serializa a JSON");
  assert(
    restored.players.length === state.players.length &&
      restored.players.every((p, i) => p.id === state.players[i].id),
    "se recuperan todos los jugadores con su posición y equipo"
  );
  assert(
    Object.keys(restored.hands).length === 4 &&
      restored.hands.p2.length === state.hands.p2.length,
    "se recuperan las manos completas de todos los jugadores"
  );
  assert(
    restored.board.map((t) => t.id).join(",") ===
      state.board.map((t) => t.id).join(","),
    "se recupera el tablero con el mismo orden"
  );
  assert(
    state.board.length > 0 && state.boardAnchorId !== null,
    "la partida de prueba tiene tablero y ancla"
  );
  assert(
    restored.boardAnchorId === state.boardAnchorId,
    `se recupera el ancla de la cadena (${state.boardAnchorId})`
  );
  assert(
    restored.currentPlayer === state.currentPlayer,
    `se recupera el turno actual (${state.currentPlayer})`
  );
  assert(
    restored.teamScores[0] === state.teamScores[0] &&
      restored.teamScores[1] === state.teamScores[1],
    "se recupera el marcador"
  );
  assert(restored.roundNumber === state.roundNumber, "se recupera la ronda actual");
  assert(restored.status === state.status, "se recupera el estado de la partida");
  assert(restored.targetScore === MATCH_TARGET_SCORE, "se recupera la configuración");
  assert(restored.revision === state.revision, "se recupera la revisión");
  assert(restored.bunk.length === 0, "se recupera el pozo (vacío en esta variante)");

  const rebuilt = DominoGame.fromState(restored);
  assert(
    rebuilt.state.currentPlayer === state.currentPlayer &&
      rebuilt.state.board.length === state.board.length,
    "DominoGame.fromState reconstruye un motor jugable"
  );
  const before = rebuilt.snapshot();
  rebuilt.bumpRevision();
  assert(
    before.revision === state.revision,
    "el snapshot es una copia: mutar el motor no cambia el snapshot"
  );
  assert(
    rebuilt.state.players !== state.players,
    "el estado recuperado no comparte objetos con el original"
  );

  console.log("--- Estado corrupto ---");

  assertThrows(
    () => deserializeGameState("ABCDE", "{esto no es json"),
    (e) => e instanceof CorruptGameStateError,
    "un JSON ilegible se rechaza como corrupto"
  );
  assertThrows(
    () => deserializeGameState("ABCDE", JSON.stringify({ roomId: "ABCDE" })),
    (e) => e instanceof CorruptGameStateError,
    "un documento sin players se rechaza"
  );
  assertThrows(
    () =>
      deserializeGameState(
        "ABCDE",
        JSON.stringify({ ...state, status: "volando" })
      ),
    (e) => e instanceof CorruptGameStateError,
    "un status desconocido se rechaza"
  );
  assertThrows(
    () =>
      deserializeGameState(
        "ABCDE",
        JSON.stringify({ ...state, roomId: "OTRA" })
      ),
    (e) => e instanceof CorruptGameStateError,
    "un roomId que no coincide con la fila se rechaza"
  );
  assertThrows(
    () =>
      deserializeGameState(
        "ABCDE",
        JSON.stringify({
          ...state,
          currentPlayer: "fantasma",
        })
      ),
    (e) => e instanceof CorruptGameStateError,
    "un turno de un jugador inexistente se rechaza"
  );
  assertThrows(
    () =>
      deserializeGameState(
        "ABCDE",
        JSON.stringify({ ...state, players: [...state.players, state.players[0]] })
      ),
    (e) => e instanceof CorruptGameStateError,
    "jugadores duplicados se rechazan"
  );
  assertThrows(
    () =>
      deserializeGameState(
        "ABCDE",
        JSON.stringify({
          ...state,
          board: [{ id: "9-9", left: 9, right: 9 }],
        })
      ),
    (e) => e instanceof CorruptGameStateError,
    "una ficha fuera de rango se rechaza"
  );
  assertThrows(
    () =>
      deserializeGameState(
        "ABCDE",
        JSON.stringify({ ...state, status: "playing", currentPlayer: null })
      ),
    (e) => e instanceof CorruptGameStateError,
    "una partida en curso sin turno se rechaza"
  );

  console.log("--- CRUD sobre SQLite ---");

  const repository = new GameRepository({ path: dbPath });
  opened.push(repository);
  assert(repository.available, "el repositorio abre la base de datos");

  assert(!repository.gameExists("ABCDE"), "una sala nueva no existe todavía");
  assert(repository.getGame("ABCDE") === null, "getGame devuelve null si no existe");
  assertThrows(
    () => repository.requireGame("ABCDE"),
    (e) => e instanceof GameNotFoundError,
    "requireGame lanza si la partida no existe"
  );

  const created = repository.createGame({
    roomId: "ABCDE",
    hostId: "p0",
    roomStatus: "playing",
    state,
  });
  assert(repository.gameExists("ABCDE"), "createGame registra la sala");
  assert(created.revision === state.revision, "createGame guarda la revisión");
  assertThrows(
    () =>
      repository.createGame({
        roomId: "ABCDE",
        hostId: "p0",
        roomStatus: "playing",
        state,
      }),
    (e) => e instanceof GameAlreadyExistsError,
    "crear dos veces la misma sala se rechaza"
  );

  const read = repository.getGame("ABCDE");
  assert(read !== null, "getGame devuelve la sala creada");
  assert(read!.hostId === "p0", "se conserva el anfitrión");
  assert(read!.roomStatus === "playing", "se conserva el estado de la sala");
  assert(
    read!.state.board.map((t) => t.id).join(",") ===
      state.board.map((t) => t.id).join(","),
    "el tablero se recupera idéntico desde SQLite"
  );
  assert(
    read!.state.hands.p3.length === state.hands.p3.length,
    "las manos ocultas también se guardan (el backend es la fuente de verdad)"
  );

  const players = repository.getPlayers("ABCDE");
  assert(players.length === 4, "el roster de la sala se guarda aparte");
  assert(
    players.every((p, i) => p.position === i) &&
      players[0].playerId === "p0",
    "el roster se ordena por posición"
  );
  assert(
    repository.findRoomIdByPlayer("p2") === "ABCDE",
    "se localiza la sala a partir del playerId (reconexión sin código)"
  );
  assert(
    repository.findRoomIdByPlayer("nadie") === null,
    "un playerId desconocido no devuelve sala"
  );

  const advanced = DominoGame.fromState(read!.state);
  advanced.playTile(
    advanced.state.currentPlayer!,
    advanced.state.hands[advanced.state.currentPlayer!][0].id
  );
  advanced.bumpRevision();
  repository.saveGame({
    roomId: "ABCDE",
    hostId: "p0",
    roomStatus: "playing",
    state: advanced.snapshot(),
  });
  assert(
    repository.getGame("ABCDE")!.revision === advanced.state.revision,
    "saveGame sobrescribe el estado y avanza la revisión"
  );
  assert(
    repository.listGames().some((g) => g.roomId === "ABCDE"),
    "listGames incluye la sala"
  );

  const patched = repository.updateGame("ABCDE", { roomStatus: "finished" });
  assert(patched.roomStatus === "finished", "updateGame cambia solo el estado de la sala");
  assert(
    patched.state.revision === advanced.state.revision,
    "updateGame no pierde el estado de la partida"
  );
  assertThrows(
    () => repository.updateGame("NOPE", { roomStatus: "playing" }),
    (e) => e instanceof GameNotFoundError,
    "updateGame lanza si la sala no existe"
  );

  assert(repository.deleteGame("ABCDE"), "deleteGame elimina la sala");
  assert(!repository.gameExists("ABCDE"), "la sala ya no existe tras borrarla");
  assert(
    repository.getPlayers("ABCDE").length === 0,
    "deleteGame limpia también el roster"
  );
  repository.close();

  console.log("--- Recuperación tras 'reiniciar' el backend ---");

  // Segundo arranque sobre el mismo fichero: la partida se recupera desde
  // disco sin que nadie la haya creado en memoria.
  const otherGame = new DominoGame("ZZZZZ", makePlayers());
  otherGame.start();
  otherGame.bumpRevision();
  const otherState = otherGame.snapshot();

  const writer = new GameRepository({ path: dbPath });
  opened.push(writer);
  writer.createGame({
    roomId: "ZZZZZ",
    hostId: "p0",
    roomStatus: "playing",
    state: otherState,
  });
  writer.close();

  const fresh = new GameRepository({ path: dbPath });
  opened.push(fresh);
  const recovered = fresh.getGame("ZZZZZ");
  assert(recovered !== null, "la partida sobrevive al reinicio del backend");
  assert(
    recovered!.state.hands.p1.map((t) => t.id).join(",") ===
      otherState.hands.p1.map((t) => t.id).join(","),
    "las manos se recuperan exactas"
  );
  assert(
    recovered!.state.currentPlayer === otherState.currentPlayer,
    "el turno se recupera tras reiniciar"
  );
  assert(
    recovered!.state.players.every((p) => typeof p.team === "number" && typeof p.position === "number"),
    "posición y equipo de cada jugador se recuperan"
  );

  console.log("--- Una fila manipulada a mano se detecta ---");

  // Si alguien corrompe el JSON de la fila, la lectura falla con un error
  // explícito en vez de dejar pasar un estado medio roto al Game Engine.
  fresh.updateGame("ZZZZZ", {
    state: { ...otherState, roomId: "OTRA" },
  });
  assertThrows(
    () => fresh.getGame("ZZZZZ"),
    (e) => e instanceof CorruptGameStateError,
    "un estado guardado con otro roomId se detecta al leer"
  );

  console.log("--- El ancla de la cadena sobrevive a la persistencia ---");

  // El ancla es lo que permite redibujar el tablero igual al recargar la
  // página: sin ella, las fichas colocadas a la izquierda se recolocan.
  fresh.createGame({
    roomId: "ANCLA",
    hostId: "p0",
    roomStatus: "playing",
    state: { ...state, roomId: "ANCLA" },
  });
  const conAncla = fresh.getGame("ANCLA");
  assert(
    conAncla !== null && conAncla.state.boardAnchorId === state.boardAnchorId,
    `el ancla guardada se recupera íntegra (${state.boardAnchorId})`
  );
  assert(
    conAncla !== null &&
      conAncla.state.board.some((t) => t.id === conAncla.state.boardAnchorId),
    "el ancla es una ficha del tablero: la que fija la cadena al redibujarla"
  );

  console.log("--- El ancla se valida al leer ---");

  // Un ancla que no está en el tablero es estado manipulado, no una partida.
  tamperState("ANCLA", (raw) => {
    raw.boardAnchorId = "no-existe";
  });
  assertThrows(
    () => fresh.getGame("ANCLA"),
    (e) => e instanceof CorruptGameStateError,
    "un ancla que no es una ficha del tablero se detecta al leer"
  );

  tamperState("ANCLA", (raw) => {
    raw.boardAnchorId = 42;
  });
  assertThrows(
    () => fresh.getGame("ANCLA"),
    (e) => e instanceof CorruptGameStateError,
    "un ancla que no es texto se detecta al leer"
  );

  // Y un tablero vacío no puede tener ancla.
  tamperState("ANCLA", (raw) => {
    raw.board = [];
  });
  assertThrows(
    () => fresh.getGame("ANCLA"),
    (e) => e instanceof CorruptGameStateError,
    "un tablero vacío con ancla se detecta al leer"
  );

  console.log("--- Un registro antiguo sin ancla sigue siendo jugable ---");

  // Las partidas guardadas antes de existir el campo deben cargarse: se asume el
  // ancla en la primera ficha, que es lo que se hacía por defecto.
  const legacy = JSON.parse(serializeGameState(state)) as Record<string, unknown>;
  delete legacy.boardAnchorId;
  const desdeRegistroAntiguo = deserializeGameState(
    "ABCDE",
    JSON.stringify(legacy)
  );
  assert(
    state.board.length > 0 &&
      desdeRegistroAntiguo.boardAnchorId === state.board[0].id,
    `sin ancla guardada se asume la primera ficha del tablero (${state.board[0].id})`
  );
  assert(
    desdeRegistroAntiguo.board.map((t) => t.id).join(",") ===
      state.board.map((t) => t.id).join(","),
    "el tablero del registro antiguo se recupera completo"
  );
  assert(
    desdeRegistroAntiguo.hands.p2.map((t) => t.id).join(",") ===
      state.hands.p2.map((t) => t.id).join(","),
    "las manos del registro antiguo se recuperan intactas"
  );

  const sinFichas = deserializeGameState(
    "ABCDE",
    JSON.stringify({ ...legacy, board: [] })
  );
  assert(
    sinFichas.boardAnchorId === null,
    "un registro antiguo sin fichas no inventa ancla"
  );

  console.log("--- Persistencia no disponible ---");

  const offline = GameRepository.unavailable("prueba");
  assert(!offline.available, "un repositorio sin base no está disponible");
  assert(
    offline.unavailableReason === "prueba",
    "el repositorio explica por qué no está disponible"
  );
  assertThrows(
    () => offline.getGame("ABCDE"),
    (e) => e.name === "PersistenceUnavailableError",
    "sin base de datos las operaciones fallan de forma explícita"
  );

  const broken = new GameRepository({ path: "   " });
  assert(!broken.available, "una ruta inválida deja el repositorio degradado");
  assert(
    broken.unavailableReason !== null,
    "el repositorio degradado explica el fallo de apertura"
  );
} finally {
  for (const repo of opened) repo.close();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
}

console.log("");
if (failed > 0) {
  console.error(`RESULTADO: ${passed} OK, ${failed} FALLIDOS`);
  process.exit(1);
}
console.log(`RESULTADO: ${passed} OK, ${failed} fallidos. Todo correcto.`);
