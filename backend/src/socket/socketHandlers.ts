import { Server, Socket } from "socket.io";
import { DominoGame } from "../game/DominoGame.js";
import { Room, RoomManager } from "../rooms/RoomManager.js";

interface SocketSession {
  playerId: string | null;
  roomId: string | null;
}

function emitRoomUpdated(io: Server, room: Room): void {
  io.to(room.roomId).emit("room_updated", {
    roomId: room.roomId,
    players: room.players,
    status: room.status,
    hostId: room.hostId,
  });
}

function broadcastGameState(io: Server, room: Room): void {
  if (!room.game) return;
  for (const player of room.players) {
    io.to(player.id).emit("game_updated", room.game.getPublicState(player.id));
  }
}

function startGame(io: Server, roomManager: RoomManager, roomId: string): void {
  const room = roomManager.getRoom(roomId);
  if (!room || room.game || room.status !== "waiting") return;
  if (!roomManager.isBalanced(room)) return;

  room.game = new DominoGame(roomId, room.players);
  room.game.start();
  room.status = "playing";

  io.to(roomId).emit("game_started", { roomId });
  broadcastGameState(io, room);
}

function emitGameFinished(io: Server, room: Room): void {
  broadcastGameState(io, room);
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
function afterRoundEnd(io: Server, room: Room): void {
  if (room.game?.state.status === "finished") {
    emitGameFinished(io, room);
  } else {
    broadcastGameState(io, room);
  }
}

export function registerSocketHandlers(io: Server, roomManager: RoomManager): void {
  io.on("connection", (socket: Socket) => {
    const session: SocketSession = { playerId: null, roomId: null };

    socket.on("create_room", (payload: unknown) => {
      if (session.roomId) return;
      const playerName =
        (payload as { playerName?: string } | null)?.playerName ?? "Jugador";

      const { roomId, room, player } = roomManager.createRoom(playerName);
      session.playerId = player.id;
      session.roomId = roomId;
      socket.join(roomId);
      socket.join(player.id);

      socket.emit("room_created", {
        roomId,
        playerId: player.id,
        position: player.position,
        players: room.players,
      });
      emitRoomUpdated(io, room);
    });

    socket.on("join_room", (payload: unknown) => {
      if (session.roomId) return;
      const data = payload as { roomId?: string; playerName?: string } | null;
      const roomId = data?.roomId ?? "";
      const playerName = data?.playerName ?? "Jugador";

      const result = roomManager.joinRoom(roomId, playerName);
      if (!result.ok) {
        socket.emit("room_error", { message: result.error });
        return;
      }

      session.playerId = result.player.id;
      session.roomId = result.room.roomId;
      socket.join(result.room.roomId);
      socket.join(result.player.id);

      io.to(result.room.roomId).emit("player_joined", {
        player: result.player,
        players: result.room.players,
      });

      socket.emit("room_created", {
        roomId: result.room.roomId,
        playerId: result.player.id,
        position: result.player.position,
        players: result.room.players,
      });

      emitRoomUpdated(io, result.room);
    });

    socket.on("start_game", () => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (room.hostId !== playerId) {
        socket.emit("invalid_move", { message: "Solo el creador puede iniciar la partida." });
        return;
      }
      if (room.players.length !== 4) {
        socket.emit("invalid_move", { message: "Se necesitan 4 jugadores para iniciar." });
        return;
      }
      if (!roomManager.isBalanced(room)) {
        socket.emit("invalid_move", {
          message: "Debe haber 2 jugadores en cada equipo para iniciar.",
        });
        return;
      }

      startGame(io, roomManager, roomId);
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

      emitRoomUpdated(io, result.room);
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

      emitRoomUpdated(io, result.room);
    });

    socket.on("play_tile", (payload: unknown) => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.game) return;

      const data = payload as { tileId?: string; side?: string } | null;
      const tileId = data?.tileId ?? "";
      const side =
        data?.side === "left" || data?.side === "right" ? data.side : undefined;

      const result = room.game.playTile(playerId, tileId, side);
      if (!result.valid) {
        socket.emit("invalid_move", { message: result.reason });
        return;
      }

      if (room.game.hasWinner()) {
        room.game.finishWithWinner();
        afterRoundEnd(io, room);
        return;
      }

      room.game.advanceTurn();
      broadcastGameState(io, room);
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
      io.to(roomId).emit("player_passed", {
        playerId,
        name: passer?.name ?? "Jugador",
      });

      if (!game.canAnyonePlay()) {
        game.finishBlocked();
        afterRoundEnd(io, room);
        return;
      }

      game.advanceTurn();
      broadcastGameState(io, room);
    });

    socket.on("start_next_round", () => {
      const roomId = session.roomId;
      const playerId = session.playerId;
      if (!roomId || !playerId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.game) return;

      if (room.game.state.status !== "round-over") {
        socket.emit("invalid_move", {
          message: "La partida no está en estado de ronda terminada.",
        });
        return;
      }

      // Cualquier jugador puede iniciar la siguiente ronda.
      room.game.startNextRound();
      broadcastGameState(io, room);
    });

    socket.on("disconnect", () => {
      const { roomId, playerId } = session;
      if (!roomId || !playerId) return;

      const result = roomManager.leaveRoom(roomId, playerId);
      if (!result) return;

      io.to(roomId).emit("player_left", {
        player: result.player,
        players: result.room.players,
      });

      if (result.roomClosed) return;

      emitRoomUpdated(io, result.room);

      if (result.room.game && result.room.game.state.status === "playing") {
        result.room.game.finishBecausePlayerLeft();
        emitGameFinished(io, result.room);
      }
    });
  });
}