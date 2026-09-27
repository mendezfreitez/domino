import { createServer } from "node:http";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { GameRepository } from "./persistence/GameRepository.js";
import { RoomManager } from "./rooms/RoomManager.js";
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  registerSocketHandlers,
} from "./socket/socketHandlers.js";

/** Configuración del servidor, toda ella por variables de entorno. */
export interface ServerConfig {
  port: number;
  /** Ruta del fichero SQLite, o null para jugar solo en memoria. */
  databasePath: string | null;
  /** Cuánto se espera a un jugador desconectado antes de darlo por ajeno. */
  disconnectGraceMs: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const port = Number(env.PORT ?? 3001);
  const persistenceEnabled = (env.PERSISTENCE ?? "true") !== "false";
  const rawPath = env.DB_PATH?.trim();
  const grace = Number(env.RECONNECT_GRACE_MS ?? DEFAULT_DISCONNECT_GRACE_MS);

  return {
    port: Number.isFinite(port) ? port : 3001,
    databasePath: persistenceEnabled
      ? resolve(rawPath && rawPath.length > 0 ? rawPath : "data/domino.db")
      : null,
    disconnectGraceMs: Number.isFinite(grace) ? Math.max(0, grace) : DEFAULT_DISCONNECT_GRACE_MS,
  };
}

export function createPersistence(config: ServerConfig): GameRepository {
  if (config.databasePath === null) {
    return GameRepository.unavailable("persistencia desactivada (PERSISTENCE=false)");
  }
  return new GameRepository({ path: config.databasePath });
}

const config = loadConfig();
const repository = createPersistence(config);

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const roomManager = new RoomManager(repository);

registerSocketHandlers(io, roomManager, {
  disconnectGraceMs: config.disconnectGraceMs,
});

httpServer.listen(config.port, () => {
  console.log(`Servidor de dominó escuchando en http://localhost:${config.port}`);
  console.log("Accesible en red local (CORS abierto para LAN)");
  if (repository.available) {
    console.log(`Partidas persistidas en ${config.databasePath}`);
    const recovered = repository.listGames();
    console.log(
      recovered.length === 0
        ? "No hay partidas guardadas: se recovererán solo las nuevas."
        : `Hay ${recovered.length} partida(s) guardada(s); se recuperan al reconectarse los jugadores.`
    );
  } else {
    console.warn(
      `AVISO: persistencia desactivada (${repository.unavailableReason}). ` +
        "Las partidas se pierden al reiniciar el servidor."
    );
  }
  console.log(
    `Ventana de reconexión: ${config.disconnectGraceMs} ms antes de dar por abandonado a un jugador.`
  );
});

function shutdown(): void {
  io.close();
  httpServer.closeAllConnections();
  httpServer.close(() => {
    repository.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
