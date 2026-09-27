import { DominoGame } from "../game/DominoGame.js";
import type { GameStateForPlayer, PublicGameState } from "../game/game.types.js";

/**
 * Contexto de sala que el Game Engine no conoce (presencia y disponibilidad de
 * la persistencia) y que solo tiene sentido a la hora de presentar el estado.
 */
export interface SessionContext {
  connectedPlayerIds: string[];
  persisted: boolean;
}

/**
 * Estado completo que se envía a un jugador.
 *
 * El backend conoce y persiste las manos de todos, pero aquí solo se expone la
 * mano del destinatario: el resto llega únicamente como conteo, y las fichas de
 * todos se revelan únicamente cuando la ronda o el match ya han terminado.
 */
export function getGameStateForPlayer(
  game: DominoGame,
  playerId: string,
  context: SessionContext = { connectedPlayerIds: [], persisted: false }
): GameStateForPlayer {
  return {
    ...getPublicStateForPlayer(game, playerId),
    connectedPlayerIds: [...context.connectedPlayerIds],
    persisted: context.persisted,
  };
}

/** Estado público sin la información de sesión de la sala. */
export function getPublicStateForPlayer(
  game: DominoGame,
  playerId: string
): PublicGameState {
  return game.getPublicState(playerId);
}
