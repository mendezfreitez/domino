import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PersistenceUnavailableError } from "./persistence.types.js";

export interface DatabaseOptions {
  /** Ruta del fichero SQLite. `":memory:"` para una base temporal. */
  path: string;
  /**
   * `FULL` garantiza que la escritura llegó al disco antes de confirmar la
   * jugada. Es lo que permite cumplir "una jugada no está aplicada hasta que el
   * estado está persistido de forma segura", a costa de algo de latencia.
   */
  synchronous?: "FULL" | "NORMAL";
  /** Desactiva WAL (necesario en algunos sistemas de ficheros de red). */
  wal?: boolean;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS games (
    room_id     TEXT    PRIMARY KEY,
    host_id     TEXT    NOT NULL,
    room_status TEXT    NOT NULL,
    state_json  TEXT    NOT NULL,
    revision    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_players (
    room_id   TEXT    NOT NULL,
    player_id TEXT    NOT NULL,
    name      TEXT    NOT NULL,
    position  INTEGER NOT NULL,
    team      INTEGER NOT NULL,
    PRIMARY KEY (room_id, player_id),
    FOREIGN KEY (room_id) REFERENCES games (room_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_game_players_player
    ON game_players (player_id);
`;

/**
 * Conexión a SQLite con el esquema de partidas ya creado.
 *
 * Se mantiene deliberadamente pequeña: solo abre la base, aplica el esquema y
 * expone la conexión. Toda consulta vive en GameRepository, nunca en la lógica
 * del juego.
 */
export class Database {
  private readonly connection: DatabaseSync;
  public readonly path: string;

  constructor(options: DatabaseOptions) {
    this.path = options.path;
    if (options.path !== ":memory:") {
      mkdirSync(dirname(resolve(options.path)), { recursive: true });
    }

    let connection: DatabaseSync;
    try {
      connection = new DatabaseSync(options.path);
      connection.exec("PRAGMA foreign_keys = ON;");
      if (options.wal !== false && options.path !== ":memory:") {
        connection.exec("PRAGMA journal_mode = WAL;");
      }
      connection.exec(
        `PRAGMA synchronous = ${options.synchronous ?? "FULL"};`
      );
      connection.exec(SCHEMA_SQL);
    } catch (error) {
      throw new PersistenceUnavailableError(
        `No se pudo abrir la base de datos en "${options.path}": ${
          (error as Error).message
        }`
      );
    }

    this.connection = connection;
  }

  /** Conexión nativa. Solo debe usarla GameRepository. */
  get raw(): DatabaseSync {
    return this.connection;
  }

  close(): void {
    try {
      this.connection.close();
    } catch {
      // Cerrar dos veces no debe romper el apagado del servidor.
    }
  }
}
