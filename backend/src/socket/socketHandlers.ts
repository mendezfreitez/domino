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
  if (room.players.length !== 4) return;

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
    winnerReason: room.game?.state.winnerReason ?? null,
  });
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

      if (result.room.players.length === 4) {
        startGame(io, roomManager, result.room.roomId);
      }
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

      startGame(io, roomManager, roomId);
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
        emitGameFinished(io, room);
        return;
      }

      room.game.advanceTurn();
      if (room.game.state.status === "finished") {
        emitGameFinished(io, room);
        return;
      }

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