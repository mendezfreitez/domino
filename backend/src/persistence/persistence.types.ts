import type { GameState } from "../game/game.types.js";
import type { RoomStatus } from "../rooms/RoomManager.js";

/**
 * Fila lógica de una partida guardada en SQLite.
 *
 * `state` es el GameState completo y es la única fuente de verdad para
 * reconstruir la partida; `revision` es un contador monotónico que permite
 * detectar estados desactualizados (dos acciones simultáneas, broadcasts
 * cruzados) tanto en el cliente como al rehidratar.
 */
export interface PersistedGame {
  roomId: string;
  hostId: string;
  roomStatus: RoomStatus;
  state: GameState;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** Fila lógica del roster de una sala (espejo desnormalizado de `state.players`). */
export interface PersistedPlayer {
  roomId: string;
  playerId: string;
  name: string;
  position: number;
  team: number;
}

/** Error base de la capa de persistencia. */
export class PersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PersistenceError";
  }
}

/** La base de datos no está disponible (no se pudo abrir o se cerró). */
export class PersistenceUnavailableError extends PersistenceError {
  constructor(message = "La base de datos no está disponible.") {
    super(message);
    this.name = "PersistenceUnavailableError";
  }
}

/** El registro existe pero su contenido no se puede interpretar como una partida. */
export class CorruptGameStateError extends PersistenceError {
  public readonly roomId: string;

  constructor(roomId: string, detail: string) {
    super(`El estado guardado de la sala ${roomId} está corrupto: ${detail}`);
    this.name = "CorruptGameStateError";
    this.roomId = roomId;
  }
}

/** La partida solicitada no existe en SQLite. */
export class GameNotFoundError extends PersistenceError {
  constructor(roomId: string) {
    super(`La sala ${roomId} no existe en la base de datos.`);
    this.name = "GameNotFoundError";
  }
}

/** La partida ya existe en SQLite. */
export class GameAlreadyExistsError extends PersistenceError {
  constructor(roomId: string) {
    super(`La sala ${roomId} ya está guardada.`);
    this.name = "GameAlreadyExistsError";
  }
}
