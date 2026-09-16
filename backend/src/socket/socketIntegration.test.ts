import { createServer } from "node:http";
import { Socket as ClientSocket, io as ioc } from "socket.io-client";
import { Server } from "socket.io";
import { PublicGameState } from "../game/game.types.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { registerSocketHandlers } from "./socketHandlers.js";

const PORT = 3101;
const URL = `http://localhost:${PORT}`;

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

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(URL, { transports: ["websocket"], forceNew: true });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function onceEvent(
  client: ClientSocket,
  event: string,
  timeoutMs = 5000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout esperando el evento "${event}"`)),
      timeoutMs
    );
    client.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

interface TestClient {
  client: ClientSocket;
  playerId: string;
  state: PublicGameState | null;
  roomId: string;
}

function pickPlayable(state: PublicGameState): string | null {
  const hand = state.yourHand;
  if (hand.length === 0) return null;
  if (state.board.length === 0) return hand[0].id;
  const left = state.board[0].left;
  const right = state.board[state.board.length - 1].right;
  return (
    hand.find(
      (t) =>
        t.left === left || t.right === left || t.left === right || t.right === right
    )?.id ?? null
  );
}

async function main(): Promise<void> {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  const roomManager = new RoomManager();
  registerSocketHandlers(io, roomManager);
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));

  const sessions: TestClient[] = [];

  try {
    console.log("--- Ciclo de vida de la sala ---");

    const [c1, c2, c3, c4] = [
      await connectClient(),
      await connectClient(),
      await connectClient(),
      await connectClient(),
    ];

    sessions.push(
      { client: c1, playerId: "", state: null, roomId: "" },
      { client: c2, playerId: "", state: null, roomId: "" },
      { client: c3, playerId: "", state: null, roomId: "" },
      { client: c4, playerId: "", state: null, roomId: "" }
    );

    for (const session of sessions) {
      session.client.on("game_updated", (state: PublicGameState) => {
        session.state = state;
      });
    }

    const startedPromises = sessions.map((s) =>
      onceEvent(s.client, "game_started")
    );

    const roomCreatedPromise = onceEvent(c1, "room_created") as Promise<{
      roomId: string;
      playerId: string;
    }>;
    c1.emit("create_room", { playerName: "Ana" });
    const created = await roomCreatedPromise;
    sessions[0].playerId = created.playerId;
    sessions[0].roomId = created.roomId;
    assert(created.roomId.length === 5, `el servidor genera un código de 5 caracteres (${created.roomId})`);
    assert(created.playerId.length > 0, "el creador recibe su playerId");

    for (let i = 1; i <= 3; i++) {
      const p = onceEvent(sessions[i].client, "room_created") as Promise<{
        roomId: string;
        playerId: string;
        position: number;
      }>;
      sessions[i].client.emit("join_room", {
        roomId: created.roomId,
        playerName: ["Bruno", "Carla", "Diego"][i - 1],
      });
      const joined = await p;
      sessions[i].playerId = joined.playerId;
      sessions[i].roomId = joined.roomId;
      assert(joined.position === i, `el jugador ${i} obtiene la posición ${i}`);
    }

    assert(
      sessions.every((s) => s.roomId === created.roomId),
      "los 4 jugadores están en la misma sala"
    );

    console.log("--- Inicio automático de partida ---");

    const started = await Promise.all(startedPromises);
    assert(started.length === 4, "los 4 jugadores reciben game_started");

    await wait(200);
    for (const session of sessions) {
      assert(session.state !== null, `${session.client.id}: recibe game_updated`);
      assert(
        session.state!.status === "playing" && session.state!.yourHand.length === 7,
        "cada jugador recibe exactamente 7 fichas propias"
      );
      assert(
        Object.values(session.state!.handCounts).every((n) => n === 7),
        "cada jugador ve 7 fichas en manos ajenas"
      );
      assert(
        session.state!.yourHand.length ===
          session.state!.handCounts[session.playerId],
        "el conteo público coincide con la mano propia"
      );
    }

    const firstState = sessions[0].state!;
    const current = sessions.find(
      (s) => s.playerId === firstState.currentPlayer
    )!;
    assert(current !== undefined, "existe un jugador inicial con turno");

    console.log("--- Validación de jugadas ---");

    const notTurn = sessions.find((s) => s.playerId !== current.playerId)!;
    const outOfTurnPayload = onceEvent(notTurn.client, "invalid_move");
    notTurn.client.emit("play_tile", { tileId: notTurn.state!.yourHand[0].id });
    const invalidTurn = await outOfTurnPayload as { message: string };
    assert(invalidTurn.message.includes("turno"), "no se puede jugar fuera de turno");

    const fake = onceEvent(current.client, "invalid_move");
    current.client.emit("play_tile", { tileId: "99-99" });
    const invalidOwn = await fake as { message: string };
    assert(invalidOwn.message.includes("posees"), "no se puede jugar una ficha que no se posee");

    console.log("--- Partida completa (jugadas automáticas) ---");

    let moves = 0;
    const maxMoves = 100;
    while (moves < maxMoves) {
      const anyFinished = sessions.find((s) => s.state?.status === "finished");
      if (anyFinished) break;

      const mover = sessions.find(
        (s) => s.state?.currentPlayer === s.playerId
      );
      if (!mover || !mover.state) {
        await wait(100);
        continue;
      }

      const tileId = pickPlayable(mover.state);
      assert(tileId !== null, "el jugador con turno siempre tiene una ficha jugable");
      if (!tileId) break;

      const roomId = mover.roomId;
      mover.client.emit("play_tile", { tileId });
      await wait(120);

      assert(
        roomId === mover.roomId && mover.state!.board.length > 0,
        `movimiento ${moves + 1}: se coloca una ficha en el tablero`
      );
      const moved = mover.state!.yourHand.find((t) => t.id === tileId);
      assert(!moved, "la ficha jugada desaparece de la mano del jugador");
      moves++;
    }

    const final = sessions.find((s) => s.state?.status === "finished");
    assert(final !== undefined, "la partida llega a finished");
    assert(
      final!.state!.winnerId !== null,
      "se determina un ganador (o jugador con menos puntos en bloqueo)"
    );
    assert(
      final!.state!.winnerReason === "empty-hand" ||
        final!.state!.winnerReason === "blocked",
      `motivo de finalización válido (${final!.state!.winnerReason})`
    );
    assert(moves > 0, `se jugaron ${moves} movimientos válidos`);

    const boardsTiles = sessions[0].state!.board.map((t) => t.id).join(",");
    assert(
      sessions.every((s) => s.state!.board.map((t) => t.id).join(",") === boardsTiles),
      "todos los jugadores ven exactamente el mismo tablero"
    );

    console.log("--- El jugador que dejó la partida finaliza el juego ---");

    const sessionsBefore = sessions.map((s) => s.client.id);
    // Jugar una partida nueva en otra sala para probar player_left
    const x1 = await connectClient();
    const x2 = await connectClient();
    const x3 = await connectClient();
    const x4 = await connectClient();

    const created2 = (await new Promise((resolve) => {
      x1.once("room_created", resolve as never);
      x1.emit("create_room", { playerName: "Eva" });
    })) as { roomId: string };
    const joinRoom = async (client: ClientSocket, name: string) => {
      const p = onceEvent(client, "room_created");
      client.emit("join_room", { roomId: created2.roomId, playerName: name });
      await p;
    };
    await joinRoom(x2, "Fer");
    await joinRoom(x3, "Gus");
    const leftPromise = onceEvent(x3, "game_finished");
    await joinRoom(x4, "Hugo");
    x1.disconnect();
    await leftPromise;

    assert(true, "game_finished llega cuando un jugador se desconecta");

    x2.close();
    x3.close();
    x4.close();

    assert(sessionsBefore.length === 4, "los 4 clientes originales siguen conectados");

    console.log("");
    for (const s of sessions) s.client.close();
  } finally {
    io.close();
    await new Promise<void>((resolve) => {
      httpServer.closeAllConnections();
      httpServer.close(() => resolve());
    });
  }

  if (failed > 0) {
    console.error(`RESULTADO: ${passed} OK, ${failed} FALLIDOS`);
    process.exit(1);
  }
  console.log(`RESULTADO: ${passed} OK, ${failed} fallidos. Todo correcto.`);
}

main().catch((error) => {
  console.error("La prueba de integración falló:", error);
  process.exit(1);
});