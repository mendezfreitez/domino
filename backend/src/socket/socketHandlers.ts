import { Server, Socket } from "socket.io";
import { DominoGame } from "../game/DominoGame.js";
import { PersistenceError } from "../persistence/persistence.types.js";
import { getGameStateForPlayer } from "../rooms/gameStatePresenter.js";
import { Room, RoomManager } from "../rooms/RoomManager.js";
import { RoomLocks } from "../rooms/RoomLocks.js";

interface SocketSession {
  playerId: string | null;
  roomId: string | null;
}

export interface SocketHandlerOptions {
  /**
   * Tiempo que un jugador puede estar desconectado sin que se le considere
   * fuera de la partida. Es la ventana de reconexión: recargar la página o
   * perder cobertura no debe terminar el juego. Cumplido el plazo, el abandono
   * se aplica como antes. 0 desactiva la ventana (abandono inmediato).
   */
  disconnectGraceMs?: number;
}

export const DEFAULT_DISCONNECT_GRACE_MS = 45_000;

/**
 * Error de negocio: la jugada se rechaza por las reglas, no por un fallo de
 * persistencia. Sirve para distinguir "no era una jugada válida" de "no se pudo
 * guardar", que exigen mensajes distintos al cliente.
 */
class MoveRejected extends Error {}

function connectedIdsOf(room: Room): string[] {
  return room.players
    .filter((player) => room.connected.has(player.id))
    .map((player) => player.id);
}

export function registerSocketHandlers(
  io: Server,
  roomManager: RoomManager,
  options: SocketHandlerOptions = {}
): void {
  const graceMs = Math.max(
    0,
    options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS
  );
  const locks = new RoomLocks();
  /** Temporizadores de abandono pendientes, por jugador. */
  const graceTimers = new Map<string, NodeJS.Timeout>();

  const cancelGrace = (playerId: string): void => {
    const timer = graceTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      graceTimers.delete(playerId);
    }
  };

  const roomContext = (room: Room) => ({
    connectedPlayerIds: connectedIdsOf(room),
    persisted: roomManager.persistence.available,
  });

  function emitRoomUpdated(room: Room): void {
    io.to(room.roomId).emit("room_updated", {
      roomId: room.roomId,
      players: room.players,
      status: room.status,
      hostId: room.hostId,
      connectedPlayerIds: connectedIdsOf(room),
      gameStarted: room.game !== null,
    });
  }

  function broadcastGameState(room: Room): void {
    if (!room.game) return;
    // Cada jugador recibe solo su mano: el resto del estado es común.
    for (const player of room.players) {
      io.to(player.id).emit(
        "game_updated",
        getGameStateForPlayer(room.game, player.id, roomContext(room))
      );
    }
  }

  /**
   * Aplica un cambio de estado y solo entonces lo difunde.
   *
   * El orden importa: primero se valida y se aplica en memoria, después se
   * persiste, y únicamente cuando SQLite confirma la escritura se emite el
   * nuevo estado. Si el guardado falla, `commit` deshace el cambio y el cliente
   * recibe un error, nunca una jugada que el servidor no pueda recuperar.
   * `broadcast` se invoca solo si el cambio quedó a salvo.
   */
  function commitRoom(
    room: Room,
    mutation: () => void,
    failure: (error: unknown) => void,
    broadcast: () => void
  ): void {
    try {
      roomManager.commit(room, mutation);
    } catch (error) {
      failure(error);
      // Se reenvía el estado que sí está persistido, para que el cliente
      // abandone cualquier suposición sobre una jugada que no se guardó.
      broadcastGameState(room);
      return;
    }
    broadcast();
  }

  /**
   * Traduce un fallo de `commitRoom` al mensaje que ve el jugador: un rechazo
   * por reglas conserva su texto; un fallo de SQLite se reporta aparte, porque
   * el jugador debe saber que su jugada no se guardó y que el tablero que ve es
   * el último estado seguro.
   */
  function reportFailure(message: string) {
    return (socket: Socket) => (error: unknown): void => {
      if (error instanceof MoveRejected) {
        socket.emit("invalid_move", { message: error.message });
        return;
      }
      const detail =
        error instanceof PersistenceError
          ? ` No se pudo guardar la partida: ${error.message}`
          : "";
      console.error("[persistencia] Cambio de estado descartado:", error);
      socket.emit("invalid_move", { message: `${message}${detail}` });
    };
  }

  function startGame(room: Room): void {
    if (room.game || room.status !== "waiting") return;
    if (!roomManager.isBalanced(room)) return;

    const game = new DominoGame(room.roomId, room.players);
    try {
      roomManager.commit(room, () => {
        room.game = game;
        game.start();
        room.status = "playing";
      });
    } catch (error) {
      console.error("[persistencia] No se pudo iniciar la partida:", error);
      return;
    }

    io.to(room.roomId).emit("game_started", { roomId: room.roomId });
    broadcastGameState(room);
  }

  function emitGameFinished(room: Room): void {
    broadcastGameState(room);
    io.to(room.roomId).emit("game_finished", {
      roomId: room.roomId,
      winnerId: room.game?.state.winnerId ?? null,
      winnerTeam: room.game?.state.winnerTeam ?? null,
      winnerReason: room.game?.state.winnerReason ?? null,
      blockedById: room.game?.state.blockedById ?? null,
      matchWinnerTeam: room.game?.state.matchWinnerTeam ?? null,
    });
  }

  // Después de terminar una ronda: si el match llegó a su fin (puntos objetivo
  // alcanzados o partida abandonada) se emite game_finished; si solo terminó la
  // ronda, se sincroniza el estado round-over para que el frontend ofrezca
  // "Siguiente ronda".
  function afterRoundEnd(room: Room): void {
    if (room.game?.state.status === "finished") {
      emitGameFinished(room);
    } else {
      broadcastGameState(room);
    }
  }

  /** Elimina al jugador de la sala y aplica las consecuencias sobre la partida. */
  function applyLeave(
    roomId: string,
    playerId: string,
    explicit: boolean
  ): void {
    void locks.run(roomId, () => {
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      roomManager.markDisconnected(room, playerId);

      const result = roomManager.leaveRoom(roomId, playerId);
      if (!result) return;

      io.to(roomId).emit("player_left", {
        player: result.player,
        players: result.room.players,
        explicit,
      });

      if (result.roomClosed) {
        locks.forget(roomId);
        return;
      }

      emitRoomUpdated(result.room);
      const game = result.room.game;
      if (!game) return;

      if (game.state.status === "playing") {
        try {
          roomManager.commit(result.room, () => {
            game.finishBecausePlayerLeft();
          });
        } catch (error) {
          console.error("[persistencia] No se pudo registrar el abandono:", error);
        }
        emitGameFinished(result.room);
      }
    });
  }

  io.on("connection", (socket: Socket) => {
    const session: SocketSession = { playerId: null, roomId: null };

    const bindSession = (room: Room, playerId: string): void => {
      session.playerId = playerId;
      session.roomId = room.roomId;
      cancelGrace(playerId);
      roomManager.markConnected(room, playerId);
      socket.join(room.roomId);
      socket.join(playerId);
    };

    const sendRoomInfo = (room: Room, playerId: string): void => {
      const player = room.players.find((p) => p.id === playerId);
      socket.emit("room_created", {
        roomId: room.roomId,
        playerId,
        position: player?.position ?? 0,
        players: room.players,
        hostId: room.hostId,
        gameStarted: room.game !== null,
      });
    };

    socket.on("create_room", (payload: unknown) => {
      if (session.roomId) return;
      const playerName =
        (payload as { playerName?: string } | null)?.playerName ?? "Jugador";

      const { room, player } = roomManager.createRoom(playerName);
      bindSession(room, player.id);

      sendRoomInfo(room, player.id);
      emitRoomUpdated(room);
    });

    socket.on("join_room", (payload: unknown) => {
      if (session.roomId) return;
      const data = payload as { roomId?: string; playerName?: string } | null;
      const roomId = data?.roomId ?? "";
      const playerName = data?.playerName ?? "Jugador";

      const result = roomManager.joinRoom(roomId, playerName);
      if (!result.ok) {
        socket.emit("room_error", { message: result.error, code: "join-failed" });
        return;
      }

      bindSession(result.room, result.player.id);

      io.to(result.room.roomId).emit("player_joined", {
        player: result.player,
        players: result.room.players,
      });

      sendRoomInfo(result.room, result.player.id);
      emitRoomUpdated(result.room);
    });

    /**
     * Reconexión. El cliente conserva roomId + playerId y los envía; el backend
     * usa la sala en memoria si la tiene y, si no, la reconstruye desde SQLite.
     * La respuesta incluye el estado completo de la partida para ese jugador,
     * de modo que la interfaz se repinta exactamente igual que antes de recargar.
     */
    socket.on("resume_session", (payload: unknown) => {
      if (session.roomId) return;
      const data = payload as { roomId?: string; playerId?: string } | null;
      const roomId = data?.roomId ?? "";
      const playerId = data?.playerId ?? "";

      const loaded = roomManager.loadRoomForPlayer(roomId, playerId);
      if (!loaded.ok) {
        socket.emit("resume_failed", { message: loaded.error, code: loaded.code });
        return;
      }

      const { room } = loaded;
      bindSession(room, playerId);

      socket.emit("room_resumed", {
        roomId: room.roomId,
        playerId,
        position: room.players.find((p) => p.id === playerId)?.position ?? 0,
        players: room.players,
        hostId: room.hostId,
        status: room.status,
        gameStarted: room.game !== null,
        connectedPlayerIds: connectedIdsOf(room),
        recoveredFrom: loaded.source,
        persisted: roomManager.persistence.available,
      });

      // Estado completo para este jugador: tablero, turno, marcador, ronda y su
      // mano. Es lo que permite reconstruir la partida tras la recarga.
      if (room.game) {
        socket.emit(
          "game_updated",
          getGameStateForPlayer(room.game, playerId, roomContext(room))
        );
      }

      // Avisar al resto de que el jugador volvió.
      socket.to(room.roomId).emit("player_reconnected", {
        playerId,
        name: room.players.find((p) => p.id === playerId)?.name ?? "Jugador",
        players: room.players,
        connectedPlayerIds: connectedIdsOf(room),
      });
      emitRoomUpdated(room);
      // Refresca en las demás pantallas quién está conectado, para que una
      // recarga no deje a los otros con un "fantasma" en la mesa.
      broadcastGameState(room);
    });

    socket.on("start_game", () => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (room.hostId !== playerId) {
        socket.emit("invalid_move", {
          message: "Solo el creador puede iniciar la partida.",
        });
        return;
      }
      if (room.players.length !== 4) {
        socket.emit("invalid_move", {
          message: "Se necesitan 4 jugadores para iniciar.",
        });
        return;
      }
      if (!roomManager.isBalanced(room)) {
        socket.emit("invalid_move", {
          message: "Debe haber 2 jugadores en cada equipo para iniciar.",
        });
        return;
      }

      startGame(room);
    });

    socket.on("move_player", (payload: unknown) => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const data = payload as { playerId?: string; team?: number } | null;
      const targetPlayerId = data?.playerId ?? "";
      const team = data?.team;

      if (team !== 0 && team !== 1) {
        socket.emit("invalid_move", { message: "Equipo inválido." });
        return;
      }

      const result = roomManager.movePlayerToTeam(
        roomId,
        playerId,
        targetPlayerId,
        team
      );
      if (!result.ok) {
        socket.emit("invalid_move", { message: result.error });
        return;
      }

      emitRoomUpdated(result.room);
    });

    socket.on("swap_players", (payload: unknown) => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const data = payload as
        | { playerIdA?: string; playerIdB?: string }
        | null;
      const playerIdA = data?.playerIdA ?? "";
      const playerIdB = data?.playerIdB ?? "";

      const result = roomManager.swapPlayers(
        roomId,
        playerId,
        playerIdA,
        playerIdB
      );
      if (!result.ok) {
        socket.emit("invalid_move", { message: result.error });
        return;
      }

      emitRoomUpdated(result.room);
    });

    socket.on("play_tile", (payload: unknown) => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.game) return;
      const game = room.game;

      const data = payload as { tileId?: string; side?: string } | null;
      const tileId = data?.tileId ?? "";
      const side =
        data?.side === "left" || data?.side === "right" ? data.side : undefined;

      // Dos jugadas que llegan casi a la vez se serializan: la segunda ve el
      // tablero que dejó la primera, no el anterior, y cada una se persiste
      // antes de confirmarse.
      void locks.run(room.roomId, () => {
        const check = game.canPlayTile(playerId, tileId);
        if (!check.valid) {
          socket.emit("invalid_move", { message: check.reason });
          return;
        }

        commitRoom(
          room,
          () => {
            const result = game.playTile(playerId, tileId, side);
            if (!result.valid) throw new MoveRejected(result.reason);
            if (game.hasWinner()) game.finishWithWinner();
            else game.advanceTurn();
          },
          reportFailure("No se pudo registrar la jugada.")(socket),
          () => afterRoundEnd(room)
        );
      });
    });

    socket.on("pass_turn", () => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.game) return;
      const game = room.game;

      if (game.state.status !== "playing") {
        socket.emit("invalid_move", { message: "La partida no está en curso." });
        return;
      }
      if (game.state.currentPlayer !== playerId) {
        socket.emit("invalid_move", { message: "No es tu turno." });
        return;
      }
      if (game.hasPlayableTiles(playerId)) {
        socket.emit("invalid_move", {
          message: "Tienes fichas jugables, no puedes pasar.",
        });
        return;
      }

      const passer = room.players.find((p) => p.id === playerId);
      io.to(room.roomId).emit("player_passed", {
        playerId,
        name: passer?.name ?? "Jugador",
      });

      void locks.run(room.roomId, () => {
        const blocked = !game.canAnyonePlay();
        commitRoom(
          room,
          () => {
            if (blocked) game.finishBlocked();
            else game.advanceTurn();
          },
          reportFailure("No se pudo registrar el paso.")(socket),
          () => afterRoundEnd(room)
        );
      });
    });

    socket.on("start_next_round", () => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.game) return;
      const game = room.game;

      void locks.run(room.roomId, () => {
        if (game.state.status !== "round-over") {
          socket.emit("invalid_move", {
            message: "La partida no está en estado de ronda terminada.",
          });
          return;
        }
        if (game.state.readyForNextRound.includes(playerId)) return;

        const startsNewRound =
          game.state.readyForNextRound.length + 1 >= room.players.length;
        commitRoom(
          room,
          () => {
            game.markReadyForNextRound(playerId);
          },
          reportFailure("No se pudo registrar la confirmación.")(socket),
          () => {
            if (startsNewRound) {
              io.to(room.roomId).emit("round_started", {
                roomId: room.roomId,
                roundNumber: game.state.roundNumber,
              });
            }
            broadcastGameState(room);
          }
        );
      });
    });

    /** Abandono explícito: no espera la ventana de reconexión. */
    socket.on("leave_game", () => {
      const { roomId, playerId } = session;
      if (!roomId || !playerId) return;
      session.playerId = null;
      session.roomId = null;
      cancelGrace(playerId);
      socket.leave(roomId);
      socket.leave(playerId);
      applyLeave(roomId, playerId, true);
    });

    socket.on("disconnect", () => {
      const { roomId, playerId } = session;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room) return;
      // Deja de contar como conectado de inmediato, aunque siga en la mesa:
      // los demás ven que espera y pueden seguir jugando con él.
      roomManager.markDisconnected(room, playerId);

      // Una recarga de página o un corte de conexión no son un abandono: se
      // abre una ventana de gracia y, si el jugador vuelve, sigue en la partida
      // exactamente donde estaba.
      if (graceMs > 0) {
        socket.to(roomId).emit("player_disconnected", { playerId, graceMs });
        emitRoomUpdated(room);
        broadcastGameState(room);
        graceTimers.set(
          playerId,
          setTimeout(() => {
            graceTimers.delete(playerId);
            const current = roomManager.getRoom(roomId);
            // Si el jugador volvió, `bindSession` ya había cancelado este
            // temporizador y el callback no llega a ejecutarse: que se esté
            // ejecutando significa que sigue sin conexión.
            if (!current || !current.players.some((p) => p.id === playerId)) return;
            applyLeave(roomId, playerId, false);
          }, graceMs)
        );
        return;
      }

      applyLeave(roomId, playerId, false);
    });
  });
}
