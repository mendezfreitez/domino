import type { GameState } from "../game/game.types.js";
import { Database, type DatabaseOptions } from "./Database.js";
import {
  CorruptGameStateError,
  GameAlreadyExistsError,
  GameNotFoundError,
  PersistedGame,
  PersistedPlayer,
  PersistenceError,
  PersistenceUnavailableError,
} from "./persistence.types.js";
import { deserializeGameState, serializeGameState } from "./stateCodec.js";

export interface CreateGameInput {
  roomId: string;
  hostId: string;
  roomStatus: string;
  state: GameState;
}

export type UpdateGameInput = Partial<
  Pick<PersistedGame, "hostId" | "roomStatus">
> & { state?: GameState };

interface GameRow {
  room_id: string;
  host_id: string;
  room_status: string;
  state_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

interface PlayerRow {
  room_id: string;
  player_id: string;
  name: string;
  position: number;
  team: number;
}

/**
 * Capa de acceso a SQLite para las partidas.
 *
 * Es la única pieza del backend que escribe SQL. Expone operaciones sobre
 * objetos de JavaScript y se encarga de convertirlos al formato de la tabla
 * (y de vuelta, validando el resultado). Si la base no está disponible, todas
 * las operaciones se convierten en no-ops y `available` es false: el juego sigue
 * funcionando en memoria, pero sin recuperación tras reiniciar.
 */
export class GameRepository {
  private readonly database: Database | null;
  private readonly failure: string | null;

  constructor(
    databaseOrOptions: Database | DatabaseOptions | null,
    failureReason: string | null = null
  ) {
    if (databaseOrOptions instanceof Database) {
      this.database = databaseOrOptions;
      this.failure = null;
      return;
    }
    if (databaseOrOptions === null) {
      this.database = null;
      this.failure = failureReason ?? "la persistencia está desactivada";
      return;
    }
    try {
      this.database = new Database(databaseOrOptions);
      this.failure = null;
    } catch (error) {
      this.database = null;
      this.failure = (error as Error).message;
    }
  }

  /** Crea un repositorio ya degradado: la partida seguirá en memoria, sin SQLite. */
  static unavailable(reason: string): GameRepository {
    return new GameRepository(null, reason);
  }

  get available(): boolean {
    return this.database !== null;
  }

  /** Motivo por el que la persistencia está desactivada, o null si funciona. */
  get unavailableReason(): string | null {
    return this.failure;
  }

  close(): void {
    this.database?.close();
  }

  createGame(input: CreateGameInput): PersistedGame {
    const db = this.requireDatabase();
    if (this.gameExists(input.roomId)) {
      throw new GameAlreadyExistsError(input.roomId);
    }
    const now = Date.now();
    const record: PersistedGame = {
      roomId: input.roomId,
      hostId: input.hostId,
      roomStatus: input.roomStatus as PersistedGame["roomStatus"],
      state: input.state,
      revision: input.state.revision,
      createdAt: now,
      updatedAt: now,
    };
    this.writeRecord(record, true);
    return record;
  }

  /** Reemplaza por completo el estado persistido de una partida existente. */
  saveGame(input: CreateGameInput): PersistedGame {
    const db = this.requireDatabase();
    const existing = this.readRecord(db.raw, input.roomId);
    const record: PersistedGame = {
      roomId: input.roomId,
      hostId: input.hostId,
      roomStatus: input.roomStatus as PersistedGame["roomStatus"],
      state: input.state,
      revision: input.state.revision,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    this.writeRecord(record, !existing);
    return record;
  }

  /**
   * Actualiza solo los campos indicados (revisando la fila dentro de la misma
   * transacción) sin obligar a la lógica de juego a reenviar el estado entero.
   */
  updateGame(roomId: string, patch: UpdateGameInput): PersistedGame {
    const db = this.requireDatabase();
    const current = this.readRecord(db.raw, roomId);
    if (!current) throw new GameNotFoundError(roomId);

    const next: PersistedGame = {
      ...current,
      hostId: patch.hostId ?? current.hostId,
      roomStatus: (patch.roomStatus as PersistedGame["roomStatus"]) ?? current.roomStatus,
      state: patch.state ?? current.state,
      updatedAt: Date.now(),
    };
    next.revision = next.state.revision;
    this.writeRecord(next, false);
    return next;
  }

  getGame(roomId: string): PersistedGame | null {
    const db = this.requireDatabase();
    return this.readRecord(db.raw, roomId);
  }

  /** Igual que getGame, pero lanza si la partida no existe. */
  requireGame(roomId: string): PersistedGame {
    const record = this.getGame(roomId);
    if (!record) throw new GameNotFoundError(roomId);
    return record;
  }

  deleteGame(roomId: string): boolean {
    const db = this.requireDatabase();
    const existed = this.gameExists(roomId);
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      db.raw.prepare("DELETE FROM game_players WHERE room_id = ?").run(roomId);
      db.raw.prepare("DELETE FROM games WHERE room_id = ?").run(roomId);
      db.raw.exec("COMMIT");
    } catch (error) {
      db.raw.exec("ROLLBACK");
      throw new PersistenceError(
        `No se pudo eliminar la sala ${roomId}: ${(error as Error).message}`
      );
    }
    return existed;
  }

  gameExists(roomId: string): boolean {
    const db = this.requireDatabase();
    const row = db.raw
      .prepare("SELECT 1 AS present FROM games WHERE room_id = ?")
      .get(roomId);
    return row !== undefined;
  }

  listGames(): PersistedGame[] {
    const db = this.requireDatabase();
    const rows = db.raw
      .prepare(
        "SELECT room_id, host_id, room_status, state_json, revision, created_at, updated_at FROM games ORDER BY updated_at DESC"
      )
      .all() as unknown as GameRow[];
    return rows.map((row) => this.toPersistedGame(row));
  }

  getPlayers(roomId: string): PersistedPlayer[] {
    const db = this.requireDatabase();
    const rows = db.raw
      .prepare(
        "SELECT room_id, player_id, name, position, team FROM game_players WHERE room_id = ? ORDER BY position ASC"
      )
      .all(roomId) as unknown as PlayerRow[];
    return rows.map((row) => ({
      roomId: row.room_id,
      playerId: row.player_id,
      name: row.name,
      position: row.position,
      team: row.team,
    }));
  }

  /** Busca la sala de un jugador por su playerId (usado al reconectar). */
  findRoomIdByPlayer(playerId: string): string | null {
    const db = this.requireDatabase();
    const row = db.raw
      .prepare("SELECT room_id FROM game_players WHERE player_id = ? LIMIT 1")
      .get(playerId) as unknown as { room_id: string } | undefined;
    return row?.room_id ?? null;
  }

  private requireDatabase(): Database {
    if (!this.database) {
      throw new PersistenceUnavailableError(
        this.failure
          ? `La base de datos no está disponible: ${this.failure}`
          : "La base de datos no está disponible."
      );
    }
    return this.database;
  }

  private writeRecord(record: PersistedGame, insertOnly: boolean): void {
    const db = this.requireDatabase();
    const stateJson = serializeGameState(record.state);
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      if (insertOnly) {
        db.raw
          .prepare(
            `INSERT INTO games (room_id, host_id, room_status, state_json, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            record.roomId,
            record.hostId,
            record.roomStatus,
            stateJson,
            record.revision,
            record.createdAt,
            record.updatedAt
          );
      } else {
        db.raw
          .prepare(
            `UPDATE games
             SET host_id = ?, room_status = ?, state_json = ?, revision = ?, updated_at = ?
             WHERE room_id = ?`
          )
          .run(
            record.hostId,
            record.roomStatus,
            stateJson,
            record.revision,
            record.updatedAt,
            record.roomId
          );
      }

      db.raw.prepare("DELETE FROM game_players WHERE room_id = ?").run(record.roomId);
      const insertPlayer = db.raw.prepare(
        `INSERT INTO game_players (room_id, player_id, name, position, team)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const player of [...record.state.players].sort(
        (a, b) => a.position - b.position
      )) {
        insertPlayer.run(
          record.roomId,
          player.id,
          player.name,
          player.position,
          player.team
        );
      }
      db.raw.exec("COMMIT");
    } catch (error) {
      try {
        db.raw.exec("ROLLBACK");
      } catch {
        // Si la transacción ya no existe, el error original es el relevante.
      }
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError(
        `No se pudo guardar la sala ${record.roomId}: ${(error as Error).message}`
      );
    }
  }

  private readRecord(
    database: Database["raw"],
    roomId: string
  ): PersistedGame | null {
    const row = database
      .prepare(
        "SELECT room_id, host_id, room_status, state_json, revision, created_at, updated_at FROM games WHERE room_id = ?"
      )
      .get(roomId) as unknown as GameRow | undefined;
    if (!row) return null;
    return this.toPersistedGame(row);
  }

  private toPersistedGame(row: GameRow): PersistedGame {
    return {
      roomId: row.room_id,
      hostId: row.host_id,
      roomStatus: row.room_status as PersistedGame["roomStatus"],
      state: deserializeGameState(row.room_id, row.state_json),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export { CorruptGameStateError, PersistenceUnavailableError };
