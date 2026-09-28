import { createServer, type Server as HttpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Socket as ClientSocket, io as ioc } from "socket.io-client";
import { Server } from "socket.io";
import type { DominoTile, GameStateForPlayer } from "../game/game.types.js";
import { GameRepository } from "../persistence/GameRepository.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { registerSocketHandlers } from "./socketHandlers.js";

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectClient(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, { transports: ["websocket"], forceNew: true });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function onceEvent<T>(
  client: ClientSocket,
  event: string,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout esperando el evento "${event}"`)),
      timeoutMs
    );
    client.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as T);
    });
  });
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await wait(25);
  }
  return condition();
}

interface RoomCreatedPayload {
  roomId: string;
  playerId: string;
  players: { id: string; name: string; team: number; position: number }[];
  hostId: string;
  gameStarted: boolean;
}

interface TestClient {
  client: ClientSocket;
  playerId: string;
  name: string;
  state: GameStateForPlayer | null;
}

/**
 * Elige una ficha jugable de la mano. Si se pide un extremo y hay ficha para él,
 * se juega en ese lado: así la cadena crece hacia los dos extremos y el ancla no
 * queda siempre pegada al borde izquierdo del tablero, que es el caso donde el
 * tablero se recolocaría al recargar sin el ancla.
 */
function pickPlayable(
  state: GameStateForPlayer,
  preferSide?: "left" | "right"
): { tileId: string; side?: "left" | "right" } | null {
  const hand = state.yourHand;
  if (hand.length === 0) return null;
  if (state.board.length === 0) return { tileId: hand[0].id };

  const left = state.board[0].left;
  const right = state.board[state.board.length - 1].right;
  const matches = (tile: DominoTile, value: number): boolean =>
    tile.left === value || tile.right === value;

  const playable = hand.filter((t) => matches(t, left) || matches(t, right));
  if (playable.length === 0) return null;

  if (preferSide) {
    const preferred = playable.find((t) =>
      matches(t, preferSide === "left" ? left : right)
    );
    if (preferred) return { tileId: preferred.id, side: preferSide };
  }
  return { tileId: playable[0].id };
}

/** Instantánea comparable del estado que ve un jugador. */
function snapshotForPlayer(state: GameStateForPlayer): string {
  return JSON.stringify({
    board: state.board,
    // El ancla forma parte de lo que el cliente necesita para redibujar el
    // tablero igual que antes de recargar: si se pierde, las fichas se recolocan.
    boardAnchorId: state.boardAnchorId,
    currentPlayer: state.currentPlayer,
    status: state.status,
    yourHand: state.yourHand,
    handCounts: state.handCounts,
    teamScores: state.teamScores,
    roundNumber: state.roundNumber,
    players: state.players,
    revealedHands: state.revealedHands,
    readyForNextRound: state.readyForNextRound,
  });
}

interface Harness {
  io: Server;
  http: HttpServer;
  url: string;
  roomManager: RoomManager;
  repository: GameRepository;
}

/**
 * Arranca un backend sobre un fichero SQLite concreto. Volver a crearlo con la
 * misma ruta simulita un reinicio del servidor: la memoria se pierde y solo
 * queda lo que se llegó a persistir.
 */
async function startBackend(
  dbPath: string,
  options: { graceMs?: number; port: number; degraded?: boolean }
): Promise<Harness> {
  const http = createServer();
  const io = new Server(http, { cors: { origin: "*" } });
  const repository = options.degraded
    ? GameRepository.unavailable("sin sqlite")
    : new GameRepository({ path: dbPath });
  const roomManager = new RoomManager(repository);
  registerSocketHandlers(io, roomManager, {
    disconnectGraceMs: options.graceMs ?? 20_000,
  });
  await new Promise<void>((resolve) => http.listen(options.port, resolve));
  return {
    io,
    http,
    url: `http://localhost:${options.port}`,
    roomManager,
    repository,
  };
}

async function stopBackend(harness: Harness): Promise<void> {
  harness.io.close();
  harness.repository.close();
  await new Promise<void>((resolve) => {
    harness.http.closeAllConnections();
    harness.http.close(() => resolve());
  });
}

async function joinAs(
  client: ClientSocket,
  session: TestClient,
  roomId: string | null,
  name: string
): Promise<RoomCreatedPayload> {
  const created = onceEvent<RoomCreatedPayload>(client, "room_created");
  if (roomId === null) {
    client.emit("create_room", { playerName: name });
  } else {
    client.emit("join_room", { roomId, playerName: name });
  }
  const payload = await created;
  session.playerId = payload.playerId;
  session.name = name;
  return payload;
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "domino-reconnect-"));
  const dbPath = join(tempDir, "game.db");
  const backends: Harness[] = [];

  try {
    console.log("--- Criterio de aceptación: el jugador 2 recarga la página ---");

    const backend = await startBackend(dbPath, { port: 3201 });
    backends.push(backend);

    const names = ["Ana", "Bruno", "Carla", "Diego"];
    const sessions: TestClient[] = [];
    for (const name of names) {
      const client = await connectClient(backend.url);
      const session: TestClient = { client, playerId: "", name, state: null };
      client.on("game_updated", (state: GameStateForPlayer) => {
        session.state = state;
      });
      sessions.push(session);
    }

    // 1-3. Cuatro jugadores entran, se reparten las fichas.
    const room = await joinAs(sessions[0].client, sessions[0], null, names[0]);
    assert(room.roomId.length === 5, `el servidor genera un código de 5 caracteres (${room.roomId})`);
    for (let i = 1; i < 4; i++) {
      await joinAs(sessions[i].client, sessions[i], room.roomId, names[i]);
    }
    assert(
      sessions.every((s) => s.playerId.length > 0),
      "los 4 jugadores reciben su playerId"
    );

    const startedPromises = sessions.map((s) =>
      onceEvent(s.client, "game_started")
    );
    sessions[0].client.emit("start_game");
    await Promise.all(startedPromises);
    await wait(250);

    for (const session of sessions) {
      assert(
        session.state?.status === "playing" && session.state.yourHand.length === 7,
        `${session.name} recibe 7 fichas propias`
      );
    }

    // 4-6. Varias jugadas, turnos que cambian y marcador.
    // Antes de mover a alguien se espera a que los cuatro clientes coincidan en
    // la revisión: si uno va atrasado, su "turno actual" describe un tablero que
    // el servidor ya cambió y la jugada se rechazaría por regla, no por un fallo.
    const inSync = (clients: TestClient[]): boolean => {
      const revision = clients[0].state?.revision;
      return (
        revision !== undefined &&
        clients.every((s) => s.state?.revision === revision)
      );
    };

    let moves = 0;
    for (let i = 0; i < 8; i++) {
      if (!(await waitFor(() => inSync(sessions), 3000))) break;
      const mover = sessions.find((s) => s.state?.currentPlayer === s.playerId);
      if (!mover?.state) break;
      const boardLen = mover.state.board.length;
      // Alternando el extremo, la ronda deja las fichas repartidas a ambos lados
      // del ancla, que es la situación que un tablero rehidratado debe respectar.
      const jugada = pickPlayable(mover.state, moves % 2 === 0 ? "left" : "right");
      if (!jugada) {
        // Turno sin fichas jugables: pasar también es avanzar la partida.
        const holder = mover.state.currentPlayer;
        mover.client.emit("pass_turn");
        if (!(await waitFor(() => mover.state?.currentPlayer !== holder, 3000))) {
          break;
        }
        await wait(60);
        continue;
      }
      mover.client.emit("play_tile", jugada);
      const ok = await waitFor(
        () => (mover.state?.board.length ?? 0) === boardLen + 1,
        3000
      );
      assert(ok, `jugada ${i + 1}: la ficha se coloca y la mano baja a 6`);
      if (!ok) break;
      moves++;
      await wait(60);
    }
    assert(moves >= 4, `se realizaron varias jugadas seguidas (${moves})`);

    const playersBefore = sessions[1];
    const beforeReload = snapshotForPlayer(playersBefore.state!);
    const boardBefore = playersBefore.state!.board.map((t) => t.id).join(",");
    const turnBefore = playersBefore.state!.currentPlayer;
    const handBefore = playersBefore.state!.yourHand
      .map((t) => t.id)
      .sort()
      .join(",");
    const scoresBefore = playersBefore.state!.teamScores.join("-");
    assert(
      playersBefore.state!.board.length >= 4,
      "el tablero tiene jugadas antes de recargar"
    );
    assert(
      sessions.every(
        (s) => s.state!.board.map((t) => t.id).join(",") === boardBefore
      ),
      "los 4 jugadores ven el mismo tablero"
    );
    assert(
      sessions.every((s) => s.state!.boardAnchorId === playersBefore.state!.boardAnchorId),
      "los 4 jugadores reciben el mismo ancla de la cadena"
    );
    // Si el ancla quedara en el primer sitio del tablero, la cadena solo habría
    // crecido hacia la derecha y esta prueba no comprobaría nada sobre el ancla.
    assert(
      playersBefore.state!.board[0].id !== playersBefore.state!.boardAnchorId,
      "la ronda creció también hacia la izquierda del ancla"
    );

    // 7-8. El jugador 2 "recarga": se corta el socket y se abre uno nuevo.
    const oldSocketId = playersBefore.client.id;
    const goodbye = onceEvent<{ playerId: string }>(
      sessions[0].client,
      "player_disconnected"
    );
    playersBefore.client.disconnect();
    const bye = await goodbye;
    assert(
      bye.playerId === playersBefore.playerId,
      "los demás jugadores se enteran de que se ha ido (aún dentro del plazo)"
    );

    const reloaded = await connectClient(backend.url);
    // El mismo objeto de sesión pasa a apuntar al socket nuevo: así el listener
    // sigue actualizando `state` y las comparaciones posteriores son válidas.
    reloaded.on("game_updated", (state: GameStateForPlayer) => {
      playersBefore.state = state;
    });
    playersBefore.client = reloaded;
    playersBefore.state = null;

    // 9-11. El backend identifica la partida y devuelve el estado del jugador 2.
    const resumeEvent = onceEvent<{
      roomId: string;
      playerId: string;
      gameStarted: boolean;
      recoveredFrom: string;
      persisted: boolean;
      connectedPlayerIds: string[];
    }>(reloaded, "room_resumed");
    reloaded.emit("resume_session", {
      roomId: room.roomId,
      playerId: playersBefore.playerId,
    });
    const resumed = await resumeEvent;
    assert(resumed.roomId === room.roomId, "el backend reconoce la sala del jugador 2");
    assert(resumed.playerId === playersBefore.playerId, "el backend reconoce al jugador 2");
    assert(resumed.gameStarted, "el backend responde que la partida estaba empezada");
    assert(resumed.recoveredFrom === "memory", "la sala se recupera de la memoria del servidor");
    assert(resumed.persisted, "el cliente sabe que la partida está persistida");

    const gotState = await waitFor(() => playersBefore.state !== null, 3000);
    assert(gotState, "el backend envía el estado completo al reconectar");

    // 12-13. La interfaz se reconstruye exactamente igual.
    const after = playersBefore.state!;
    assert(
      snapshotForPlayer(after) === beforeReload,
      "el jugador 2 ve exactamente el mismo tablero, turno, marcador y mano"
    );
    assert(
      after.yourHand.map((t) => t.id).sort().join(",") === handBefore,
      "la mano del jugador 2 es idéntica a la de antes de recargar"
    );
    assert(after.currentPlayer === turnBefore, "el turno actual es el mismo");
    assert(
      after.boardAnchorId === playersBefore.state!.boardAnchorId &&
        after.boardAnchorId !== null,
      `el ancla de la cadena se entrega al reconectar (${after.boardAnchorId})`
    );
    assert(after.teamScores.join("-") === scoresBefore, "el marcador es el mismo");
    assert(after.roundNumber === playersBefore.state!.roundNumber, "la ronda es la misma");
    assert(
      after.players.map((p) => p.id).join(",") ===
        playersBefore.state!.players.map((p) => p.id).join(","),
      "los 4 jugadores siguen en la misma mesa y con el mismo equipo"
    );
    assert(after.revision >= playersBefore.state!.revision, "la revisión no retrocede");
    assert(
      Object.keys(after.revealedHands).length === 0,
      "durante la partida no se filtran las manos ajenas"
    );
    assert(
      Object.values(after.handCounts).reduce((a, b) => a + b, 0) === 28 - moves,
      "el conteo de fichas ajenas sigue cuadrando"
    );

    // El socket viejo ya no manda nada: su sesión está desligada.
    assert(
      oldSocketId !== reloaded.id,
      "la reconexión usa una conexión nueva"
    );

    // 14. La partida continúa normalmente.
    // `playersBefore` es el mismo objeto que `sessions[1]`, así que `all` ya
    // incluye al jugador reconectado con su cliente y su estado ya actualizados.
    const all: TestClient[] = sessions;

    let continued = 0;
    let passed = 0;
    for (let i = 0; i < 8; i++) {
      if (!(await waitFor(() => inSync(all), 3000))) break;
      const mover = all.find((s) => s.state?.currentPlayer === s.playerId);
      if (!mover?.state) break;
      const boardLen = mover.state.board.length;
      const jugada = pickPlayable(mover.state);
      if (!jugada) {
        // Al que le toca puede no tener nada jugable: pasar el turno sigue siendo
        // jugar, así que la comprobación no puede depender de encontrar una
        // ficha placeable.
        const holder = mover.state.currentPlayer;
        mover.client.emit("pass_turn");
        if (!(await waitFor(() => mover.state?.currentPlayer !== holder, 3000))) {
          break;
        }
        passed++;
        await wait(60);
        continue;
      }
      mover.client.emit("play_tile", jugada);
      const ok = await waitFor(
        () => (mover.state?.board.length ?? 0) === boardLen + 1,
        3000
      );
      if (!ok) break;
      continued++;
      await wait(60);
    }
    assert(
      continued + passed > 0,
      `la partida continúa tras la recarga (${continued} jugadas, ${passed} pases más)`
    );
    assert(
      all.every(
        (s) => s.state!.board.map((t) => t.id).join(",") === all[0].state!.board.map((t) => t.id).join(",")
      ),
      "tras reconectar, los 4 vuelven a ver el mismo tablero"
    );

    console.log("--- El backend se reinicia con la partida en curso ---");

    // 1-3. Se para el backend; en memoria la sala desaparece.
    const persistedBefore = backend.repository.getGame(room.roomId);
    assert(persistedBefore !== null, "la partida está guardada en SQLite");
    const revisionBefore = all[0].state!.revision;
    const boardAtRestart = all[0].state!.board.map((t) => t.id).join(",");
    const anchorAtRestart = all[0].state!.boardAnchorId;
    const scoresAtRestart = all[0].state!.teamScores.join("-");
    const roundAtRestart = all[0].state!.roundNumber;
    const handAtRestart = all[1].state!.yourHand.map((t) => t.id).sort().join(",");
    const turnAtRestart = all[0].state!.currentPlayer;

    for (const session of all) session.client.close();
    await stopBackend(backend);

    // 4-6. El backend vuelve y un jugador se reconecta: se lee de SQLite.
    const restarted = await startBackend(dbPath, { port: 3202 });
    backends.push(restarted);
    assert(
      restarted.roomManager.getRoomCount() === 0,
      "el backend reiniciado arranca sin ninguna sala en memoria"
    );

    const backClient = await connectClient(restarted.url);
    const recoveredState = { current: null as GameStateForPlayer | null };
    backClient.on("game_updated", (state: GameStateForPlayer) => {
      recoveredState.current = state;
    });
    const backResume = onceEvent<{ recoveredFrom: string; gameStarted: boolean }>(
      backClient,
      "room_resumed"
    );
    backClient.emit("resume_session", {
      roomId: room.roomId,
      playerId: all[1].playerId,
    });
    const backResumed = await backResume;
    assert(
      backResumed.recoveredFrom === "database",
      "la partida se recupera desde SQLite, no desde memoria"
    );
    assert(backResumed.gameStarted, "la partida recuperada sigue en curso");
    const recovered = await waitFor(() => recoveredState.current !== null, 3000);
    assert(recovered, "el backend devuelve el estado tras reiniciar");

    const afterRestartState = recoveredState.current!;
    assert(
      afterRestartState.board.map((t) => t.id).join(",") === boardAtRestart,
      "el tablero es exactamente el que había antes del reinicio"
    );
    assert(
      afterRestartState.boardAnchorId === anchorAtRestart &&
        anchorAtRestart !== null,
      `el ancla de la cadena sobrevive al reinicio (${anchorAtRestart})`
    );
    assert(
      afterRestartState.board.some((t) => t.id === anchorAtRestart),
      "el ancla sigue siendo una ficha del tablero recuperado"
    );
    assert(afterRestartState.currentPlayer === turnAtRestart, "el turno se conserva");
    assert(afterRestartState.teamScores.join("-") === scoresAtRestart, "el marcador se conserva");
    assert(afterRestartState.roundNumber === roundAtRestart, "la ronda se conserva");
    assert(
      afterRestartState.yourHand.map((t) => t.id).sort().join(",") === handAtRestart,
      "la mano del jugador 2 se conserva íntegra"
    );
    assert(
      afterRestartState.revision === revisionBefore,
      `la revisión persistida es la última confirmada (${revisionBefore})`
    );

    // 6. La partida continúa desde el estado recuperado: se reconnecta el
    // jugador que tiene el turno y juega desde el estado leído de SQLite.
    const turnOwner = all.find((s) => s.playerId === turnAtRestart);
    assert(turnOwner !== undefined, "se sabe a quién le toca tras el reinicio");
    const turnClient = await connectClient(restarted.url);
    const turnState = { current: null as GameStateForPlayer | null };
    turnClient.on("game_updated", (state: GameStateForPlayer) => {
      turnState.current = state;
    });
    const turnResume = onceEvent<{ recoveredFrom: string; gameStarted: boolean }>(
      turnClient,
      "room_resumed"
    );
    turnClient.emit("resume_session", {
      roomId: room.roomId,
      playerId: turnOwner!.playerId,
    });
    const turnResumed = await turnResume;
    assert(turnResumed.gameStarted, "el jugador con el turno vuelve a la partida en curso");
    assert(
      turnResumed.recoveredFrom === "memory",
      "la sala ya está en memoria: la cargó el jugador que reconectó antes"
    );
    await waitFor(() => turnState.current !== null, 3000);
    assert(
      turnState.current?.yourHand.length ===
        (afterRestartState.handCounts[turnOwner!.playerId] ?? 0),
      "el jugador con el turno recibe su mano exacta desde SQLite"
    );
    const playableTile = turnState.current ? pickPlayable(turnState.current) : null;
    if (playableTile) {
      const boardBeforeMove = turnState.current!.board.length;
      turnClient.emit("play_tile", playableTile);
      const applied = await waitFor(
        () => (turnState.current?.board.length ?? 0) === boardBeforeMove + 1,
        3000
      );
      assert(applied, `el motor recuperado acepta la jugada siguiente (${playableTile.tileId})`);
      assert(
        restarted.repository.getGame(room.roomId)!.state.board.length ===
          boardBeforeMove + 1,
        "la jugada se vuelve a guardar tras el reinicio"
      );
      assert(
        await waitFor(
          () => turnState.current!.currentPlayer !== turnAtRestart,
          2000
        ),
        "el turno avanza tras la jugada recuperada"
      );
    } else {
      // Si al jugador de turno no le queda ninguna ficha jugable, la partida
      // recuperada debe pedirle que pase: el motor sigue siendo el de verdad.
      assert(
        turnState.current?.mustPass === true,
        "tras recuperar, el motor sabe que toca pasar"
      );
      turnClient.emit("pass_turn");
      assert(
        await waitFor(
          () => turnState.current!.currentPlayer !== turnAtRestart,
          3000
        ),
        "el paso sobre el estado recuperado hace avanzar el turno"
      );
    }
    turnClient.close();

    console.log("--- Errores de reconexión ---");

    const stranger = await connectClient(restarted.url);
    const strangerResume = onceEvent<{ message: string; code: string }>(
      stranger,
      "resume_failed"
    );
    stranger.emit("resume_session", {
      roomId: room.roomId,
      playerId: "p_inventado",
    });
    const denied = await strangerResume;
    assert(denied.code === "not-a-member", "un jugador ajeno no puede entrar a la partida");
    assert(
      denied.message.includes("No perteneces"),
      `el backend explica el rechazo (${denied.message})`
    );
    stranger.close();

    const ghost = await connectClient(restarted.url);
    const ghostResume = onceEvent<{ message: string; code: string }>(
      ghost,
      "resume_failed"
    );
    ghost.emit("resume_session", { roomId: "ZZZZZ", playerId: all[1].playerId });
    const missing = await ghostResume;
    assert(missing.code === "not-found", "una sala inexistente se rechaza");
    assert(
      missing.message.includes("ya no existe"),
      `el backend explica que la sala no existe (${missing.message})`
    );
    ghost.close();

    const empty = await connectClient(restarted.url);
    const emptyResume = onceEvent<{ code: string }>(empty, "resume_failed");
    empty.emit("resume_session", { roomId: "", playerId: "" });
    assert(
      (await emptyResume).code === "not-found",
      "una reconexión sin identificadores se rechaza"
    );
    empty.close();

    console.log("--- Estado corrupto ---");

    const corruptPath = join(tempDir, "corrupt.db");
    const corruptRepo = new GameRepository({ path: corruptPath });
    const goodState = restarted.repository.getGame(room.roomId)!.state;
    corruptRepo.createGame({
      roomId: room.roomId,
      hostId: all[0].playerId,
      roomStatus: "playing",
      state: goodState,
    });
    corruptRepo.close();
    // Se manipula el JSON de la fila directamente, como si el fichero se
    // hubiera dañado por fuera.
    const raw = new DatabaseSync(corruptPath);
    raw.prepare("UPDATE games SET state_json = ? WHERE room_id = ?").run(
      "{roto",
      room.roomId
    );
    raw.close();

    const corruptServer = await startBackend(corruptPath, { port: 3203 });
    backends.push(corruptServer);
    const corruptClient = await connectClient(corruptServer.url);
    const corruptResume = onceEvent<{ message: string; code: string }>(
      corruptClient,
      "resume_failed"
    );
    corruptClient.emit("resume_session", {
      roomId: room.roomId,
      playerId: all[0].playerId,
    });
    const corrupt = await corruptResume;
    assert(corrupt.code === "corrupt", "un estado guardado corrupto se detecta");
    assert(
      corrupt.message.includes("corrupto"),
      "el backend informa de que el estado guardado está corrupto"
    );
    corruptClient.close();

    console.log("--- Abandono explícito y espera de reconexión ---");

    const gracePath = join(tempDir, "grace.db");
    const graceBackend = await startBackend(gracePath, {
      port: 3204,
      graceMs: 1500,
    });
    backends.push(graceBackend);

    const gClients: TestClient[] = [];
    for (const name of names) {
      const client = await connectClient(graceBackend.url);
      const session: TestClient = { client, playerId: "", name, state: null };
      client.on("game_updated", (state: GameStateForPlayer) => {
        session.state = state;
      });
      gClients.push(session);
    }
    const gRoom = await joinAs(gClients[0].client, gClients[0], null, names[0]);
    for (let i = 1; i < 4; i++) {
      await joinAs(gClients[i].client, gClients[i], gRoom.roomId, names[i]);
    }
    const gStarted = gClients.map((s) => onceEvent(s.client, "game_started"));
    gClients[0].client.emit("start_game");
    await Promise.all(gStarted);
    await wait(200);

    // Desconexión corta: dentro del plazo nadie es expulsado.
    gClients[1].client.disconnect();
    await waitFor(
      () => !gClients[0].state!.connectedPlayerIds.includes(gClients[1].playerId),
      3000
    );
    await wait(500);
    assert(
      gClients[0].state?.status === "playing",
      "dentro del plazo de gracia la partida sigue en curso"
    );
    assert(
      gClients[0].state?.players.length === 4,
      "el jugador desconectado sigue en la mesa mientras espera"
    );
    assert(
      gClients[0].state?.connectedPlayerIds.includes(gClients[1].playerId) === false,
      "los demás ven que ese jugador está sin conexión"
    );

    // Regreso dentro del plazo: vuelve a la partida con su turno intacto.
    const gBack = await connectClient(graceBackend.url);
    const gResumedState = { current: null as GameStateForPlayer | null };
    gBack.on("game_updated", (state: GameStateForPlayer) => {
      gResumedState.current = state;
    });
    const gResume = onceEvent<{ gameStarted: boolean }>(gBack, "room_resumed");
    gBack.emit("resume_session", {
      roomId: gRoom.roomId,
      playerId: gClients[1].playerId,
    });
    assert((await gResume).gameStarted, "el jugador vuelve dentro del plazo");
    await waitFor(() => gResumedState.current !== null, 3000);
    assert(
      gResumedState.current?.yourHand.length === 7,
      "recupera su mano completa tras la desconexión"
    );
    assert(
      await waitFor(
        () =>
          gClients[0].state?.connectedPlayerIds.includes(gClients[1].playerId) === true,
        3000
      ),
      "los demás vuelven a verlo conectado"
    );

    // Ahora sí, desconexión que se agota: se aplica el abandono.
    const gBye = onceEvent<{ player: { id: string }; explicit: boolean }>(
      gClients[0].client,
      "player_left"
    );
    gBack.disconnect();
    const left = await Promise.race([gBye, wait(4000).then(() => null)]);
    assert(
      left !== null && left.player.id === gClients[1].playerId,
      "agotado el plazo, el jugador se considera ausente"
    );
    const finished = await waitFor(
      () => gClients[0].state?.status === "finished",
      4000
    );
    assert(finished, "la partida termina cuando el plazo expira sin regreso");

    // Abandono explícito: no espera el plazo.
    const pClients: TestClient[] = [];
    for (const name of names) {
      const client = await connectClient(graceBackend.url);
      const session: TestClient = { client, playerId: "", name, state: null };
      client.on("game_updated", (state: GameStateForPlayer) => {
        session.state = state;
      });
      pClients.push(session);
    }
    const pRoom = await joinAs(pClients[0].client, pClients[0], null, names[0]);
    for (let i = 1; i < 4; i++) {
      await joinAs(pClients[i].client, pClients[i], pRoom.roomId, names[i]);
    }
    const pStarted = pClients.map((s) => onceEvent(s.client, "game_started"));
    pClients[0].client.emit("start_game");
    await Promise.all(pStarted);
    await wait(200);

    const pBye = onceEvent<{ explicit: boolean }>(pClients[0].client, "player_left");
    pClients[1].client.emit("leave_game");
    const explicit = await pBye;
    assert(explicit.explicit, "el botón de abandonar se aplica al instante");
    assert(
      (await waitFor(() => pClients[0].state?.status === "finished", 3000)),
      "abandonar durante la partida la termina"
    );
    for (const s of pClients) s.client.close();

    console.log("--- Persistencia desactivada ---");

    // Sin SQLite el juego sigue siendo jugable, solo que sin recuperación. La
    // reconexión a una sala que sigue en memoria debe funcionar igual.
    const degradedBackend = await startBackend(join(tempDir, "no.db"), {
      port: 3205,
      graceMs: 20_000,
      degraded: true,
    });
    backends.push(degradedBackend);

    const dClients: TestClient[] = [];
    for (const name of names) {
      const client = await connectClient(degradedBackend.url);
      const session: TestClient = { client, playerId: "", name, state: null };
      client.on("game_updated", (state: GameStateForPlayer) => {
        session.state = state;
      });
      dClients.push(session);
    }
    const dRoom = await joinAs(dClients[0].client, dClients[0], null, names[0]);
    for (let i = 1; i < 4; i++) {
      await joinAs(dClients[i].client, dClients[i], dRoom.roomId, names[i]);
    }
    const dStarted = dClients.map((s) => onceEvent(s.client, "game_started"));
    dClients[0].client.emit("start_game");
    await Promise.all(dStarted);
    await wait(200);
    const dMover = dClients.find((s) => s.state?.currentPlayer === s.playerId);
    const dTile = dMover?.state ? pickPlayable(dMover.state) : null;
    const dBefore = dMover?.state?.board.length ?? 0;
    if (dTile) dMover!.client.emit("play_tile", dTile);
    await wait(200);
    assert(
      (dMover?.state?.board.length ?? 0) === dBefore + 1,
      "sin base de datos el juego sigue funcionando en memoria"
    );
    assert(
      dClients[0].state?.persisted === false,
      "el cliente sabe que esa partida no está persistida"
    );

    // La reconexión necesita una conexión nueva: la sesión del jugador sigue
    // viva en su socket original.
    const dReconnect = await connectClient(degradedBackend.url);
    const dResumeEvent = onceEvent<{ persisted: boolean; recoveredFrom: string }>(
      dReconnect,
      "room_resumed"
    );
    dReconnect.emit("resume_session", {
      roomId: dRoom.roomId,
      playerId: dClients[0].playerId,
    });
    const dResumed = await dResumeEvent;
    assert(dResumed.persisted === false, "sin SQLite se avisa de que no hay persistencia");
    assert(
      dResumed.recoveredFrom === "memory",
      "sin SQLite solo se puede volver a la sala que sigue en memoria"
    );
    dReconnect.close();
    for (const s of dClients) s.client.close();
    await stopBackend(degradedBackend);

    for (const session of sessions) {
      if (session.client.connected) session.client.close();
    }
  } catch (error) {
    // Se registra antes de limpiar: si el borrado del temporal falla (Windows
    // mantiene el fichero bloqueado un instante), no debe tapar el error real.
    console.error("Fallo durante la prueba:", error);
    throw error;
  } finally {
    for (const harness of backends) {
      try {
        await stopBackend(harness);
      } catch {
        // Un backend ya cerrado no debe impedir limpiar el resto.
      }
    }
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      console.warn("No se pudo borrar el directorio temporal de la prueba.");
    }
  }

  console.log("");
  if (failed > 0) {
    console.error(`RESULTADO: ${passed} OK, ${failed} FALLIDOS`);
    process.exit(1);
  }
  console.log(`RESULTADO: ${passed} OK, ${failed} fallidos. Todo correcto.`);
  // Los sockets que quedan abiertos mantenerían el proceso vivo.
  process.exit(0);
}

main().catch((error) => {
  console.error("La prueba de persistencia falló:", error);
  process.exit(1);
});
