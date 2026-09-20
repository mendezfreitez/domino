import { useEffect, useState } from "react";
import { Home } from "./pages/Home/Home";
import { Lobby } from "./pages/Lobby/Lobby";
import { Game } from "./pages/Game/Game";
import {
  emitPassTurn,
  emitPlayTile,
  emitStartNextRound,
  socket,
} from "./services/socket";
import type { GameFinishedPayload, PublicGameState } from "./types/Game";
import type { Player } from "./types/Player";

type View = "home" | "lobby" | "game";

const NAME_KEY = "domino.playerName";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? ""
  );
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [gameResult, setGameResult] = useState<GameFinishedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPass, setLastPass] = useState<{
    playerId: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    const onRoomCreated = (data: {
      roomId: string;
      playerId: string;
      players: Player[];
    }) => {
      setRoomId(data.roomId);
      setPlayerId(data.playerId);
      setPlayers(data.players);
      setError(null);
      setGameResult(null);
      setView("lobby");
    };

    const onRoomUpdated = (data: {
      roomId: string;
      players: Player[];
    }) => {
      setPlayers(data.players);
    };

    const onPlayerJoined = (data: { players: Player[] }) => {
      setPlayers(data.players);
    };

    const onPlayerLeft = (data: { players: Player[] }) => {
      setPlayers(data.players);
    };

    const onGameStarted = () => {
      setError(null);
      setGameResult(null);
      setLastPass(null);
      setView("game");
    };

    const onPlayerPassed = (data: { playerId: string; name: string }) => {
      setLastPass(data);
      window.setTimeout(() => setLastPass(null), 3000);
    };

    const onGameUpdated = (state: PublicGameState) => {
      setGameState(state);
    };

    const onGameFinished = (data: GameFinishedPayload) => {
      setGameResult(data);
    };

    const onInvalidMove = (data: { message: string }) => {
      setError(data.message);
    };

    const onRoomError = (data: { message: string }) => {
      setError(data.message);
    };

    socket.on("room_created", onRoomCreated);
    socket.on("room_updated", onRoomUpdated);
    socket.on("player_joined", onPlayerJoined);
    socket.on("player_left", onPlayerLeft);
    socket.on("game_started", onGameStarted);
    socket.on("game_updated", onGameUpdated);
    socket.on("game_finished", onGameFinished);
    socket.on("player_passed", onPlayerPassed);
    socket.on("invalid_move", onInvalidMove);
    socket.on("room_error", onRoomError);

    return () => {
      socket.off("room_created", onRoomCreated);
      socket.off("room_updated", onRoomUpdated);
      socket.off("player_joined", onPlayerJoined);
      socket.off("player_left", onPlayerLeft);
      socket.off("game_started", onGameStarted);
      socket.off("game_updated", onGameUpdated);
      socket.off("game_finished", onGameFinished);
      socket.off("player_passed", onPlayerPassed);
      socket.off("invalid_move", onInvalidMove);
      socket.off("room_error", onRoomError);
    };
  }, []);

  const handleNameChange = (name: string) => {
    setPlayerName(name);
    localStorage.setItem(NAME_KEY, name);
  };

  const handleLeave = () => {
    socket.disconnect();
    socket.connect();
    setView("home");
    setRoomId("");
    setPlayerId("");
    setPlayers([]);
    setGameState(null);
    setGameResult(null);
    setError(null);
    setLastPass(null);
  };

  const handlePlayTile = (tileId: string, side: "left" | "right") => {
    setError(null);
    emitPlayTile({ tileId, side });
  };

  const handlePass = () => {
    setError(null);
    emitPassTurn();
  };

  if (view === "lobby") {
    return (
      <Lobby
        roomId={roomId}
        players={players}
        playerId={playerId}
        error={error}
        onLeave={handleLeave}
      />
    );
  }

  if (view === "game") {
    if (!gameState) {
      return <div className="app"><p className="waiting-text">Preparando la partida…</p></div>;
    }
    return (
      <Game
        state={gameState}
        result={gameResult}
        error={error}
        lastPass={lastPass}
        onPlayTile={handlePlayTile}
        onPass={handlePass}
        onLeave={handleLeave}
        onStartNextRound={emitStartNextRound}
      />
    );
  }

  return (
    <Home
      initialName={playerName}
      onNameChange={handleNameChange}
      onClearError={() => setError(null)}
      error={error}
    />
  );
}