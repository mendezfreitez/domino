import { useEffect, useRef, useState } from "react";
import { Home } from "./pages/Home/Home";
import { Lobby } from "./pages/Lobby/Lobby";
import { Game } from "./pages/Game/Game";
import {
  emitLeaveGame,
  emitPassTurn,
  emitPlayTile,
  emitResumeSession,
  emitStartNextRound,
  socket,
} from "./services/socket";
import {
  clearSession,
  loadPlayerName,
  loadSession,
  savePlayerName,
  saveSession,
} from "./services/session";
import type { StoredSession } from "./services/session";
import type {
  GameFinishedPayload,
  PlayerDisconnectedPayload,
  PlayerReconnectedPayload,
  PublicGameState,
  ResumeFailedPayload,
  RoomCreatedPayload,
  RoomResumedPayload,
} from "./types/Game";
import type { Player } from "./types/Player";

type View = "home" | "lobby" | "game" | "resuming";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [playerName, setPlayerName] = useState(() => loadPlayerName());
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [gameResult, setGameResult] = useState<GameFinishedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => socket.connected);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastPass, setLastPass] = useState<{
    playerId: string;
    name: string;
  } | null>(null);

  /**
   * Identidad local vigente. Es lo único que sobrevive a una recarga y lo único
   * que el cliente necesita para volver a entrar: ni el tablero, ni las manos,
   * ni el turno. Todo eso lo vuelve a mandar el backend, que es quien decide si
   * la partida sigue viva.
   */
  const sessionRef = useRef<StoredSession | null>(null);
  const noticeTimer = useRef<number | null>(null);
  /**
   * Espejo del roster. Los manejadores de socket se registran una sola vez, así
   * que no pueden cerrar sobre el `players` del primer render: sin este espejo,
   * un aviso de conexión llegaría siempre sin el nombre del jugador.
   */
  const playersRef = useRef<Player[]>([]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    // Al abrir la página se intenta volver a la partida anterior en lugar de
    // pedir un nombre otra vez. Si el backend dice que ya no existe, el error se
    // muestra en la portada y se empieza de cero.
    const stored = loadSession();
    if (stored) {
      sessionRef.current = stored;
      setView("resuming");
    }

    const showNotice = (text: string) => {
      setNotice(text);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
    };

    /**
     * Cada reconexión crea un socket nuevo, y el servidor solo asocia la
     * partida a una conexión concreta. Por eso hay que volver a presentarle la
     * identidad: es lo que repone el estado tras recargar la página o recuperar
     * la conexión, y lo que mantiene la ventana de gracia viva.
     */
    const resumeIfPossible = () => {
      const current = sessionRef.current;
      if (!current) return;
      emitResumeSession(current.roomId, current.playerId);
    };

    const onConnect = () => {
      setOnline(true);
      resumeIfPossible();
    };

    const onSocketDisconnect = () => {
      setOnline(false);
    };

    const onRoomCreated = (data: RoomCreatedPayload) => {
      const session = { roomId: data.roomId, playerId: data.playerId };
      sessionRef.current = session;
      saveSession(session);
      setRoomId(data.roomId);
      setPlayerId(data.playerId);
      setPlayers(data.players);
      setGameState(null);
      setGameResult(null);
      setError(null);
      setLastPass(null);
      setView("lobby");
    };

    const onRoomResumed = (data: RoomResumedPayload) => {
      const session = { roomId: data.roomId, playerId: data.playerId };
      sessionRef.current = session;
      saveSession(session);
      setRoomId(data.roomId);
      setPlayerId(data.playerId);
      setPlayers(data.players);
      setError(null);
      setLastPass(null);
      // `gameStarted` distingue los dos recorridos posibles: se vuelve a una
      // mesa ya en juego o a la sala esperando jugadores. El estado completo de
      // la partida llega justo detrás, en `game_updated`.
      setView(data.gameStarted ? "game" : "lobby");
    };

    const onResumeFailed = (data: ResumeFailedPayload) => {
      // La sesión local ya no sirve: se descarta para no reintentar en cada
      // recarga y se vuelve a la portada.
      sessionRef.current = null;
      clearSession();
      setRoomId("");
      setPlayerId("");
      setPlayers([]);
      setGameState(null);
      setGameResult(null);
      setView("home");
      setError(data.message);
    };

    const onRoomUpdated = (data: { players: Player[] }) => {
      setPlayers(data.players);
    };

    const onPlayerJoined = (data: { players: Player[] }) => {
      setPlayers(data.players);
    };

    const onPlayerLeft = (data: { players: Player[] }) => {
      setPlayers(data.players);
    };

    const onPlayerDisconnected = (data: PlayerDisconnectedPayload) => {
      const name =
        playersRef.current.find((p) => p.id === data.playerId)?.name ?? "Alguien";
      showNotice(
        `${name} perdió la conexión. Tiene ${Math.round(data.graceMs / 1000)} s para volver.`
      );
    };

    const onPlayerReconnected = (data: PlayerReconnectedPayload) => {
      setPlayers(data.players);
      showNotice(`${data.name} volvió a la mesa.`);
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

    /**
     * El estado llega entero y con la revisión con la que quedó guardado. Tras
     * una reconexión pueden solaparse mensajes: se descarta el más antiguo,
     * para no pintar un tablero que el servidor ya superó.
     */
    const onGameUpdated = (state: PublicGameState) => {
      setGameState((current) => {
        if (!current || current.roomId !== state.roomId) return state;
        // Una revisión igual solo puede ser el mismo estado reenviado (por
        // ejemplo al reconectar) y se acepta; una menor, no.
        return state.revision < current.revision ? current : state;
      });
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

    socket.on("connect", onConnect);
    socket.on("disconnect", onSocketDisconnect);
    socket.on("room_created", onRoomCreated);
    socket.on("room_resumed", onRoomResumed);
    socket.on("resume_failed", onResumeFailed);
    socket.on("room_updated", onRoomUpdated);
    socket.on("player_joined", onPlayerJoined);
    socket.on("player_left", onPlayerLeft);
    socket.on("player_disconnected", onPlayerDisconnected);
    socket.on("player_reconnected", onPlayerReconnected);
    socket.on("game_started", onGameStarted);
    socket.on("game_updated", onGameUpdated);
    socket.on("game_finished", onGameFinished);
    socket.on("player_passed", onPlayerPassed);
    socket.on("invalid_move", onInvalidMove);
    socket.on("room_error", onRoomError);

    // Si el socket ya estaba conectado antes de montar este efecto, el evento
    // `connect` ya pasó: la reanudación se lanza igualmente.
    if (socket.connected) resumeIfPossible();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onSocketDisconnect);
      socket.off("room_created", onRoomCreated);
      socket.off("room_resumed", onRoomResumed);
      socket.off("resume_failed", onResumeFailed);
      socket.off("room_updated", onRoomUpdated);
      socket.off("player_joined", onPlayerJoined);
      socket.off("player_left", onPlayerLeft);
      socket.off("player_disconnected", onPlayerDisconnected);
      socket.off("player_reconnected", onPlayerReconnected);
      socket.off("game_started", onGameStarted);
      socket.off("game_updated", onGameUpdated);
      socket.off("game_finished", onGameFinished);
      socket.off("player_passed", onPlayerPassed);
      socket.off("invalid_move", onInvalidMove);
      socket.off("room_error", onRoomError);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const handleNameChange = (name: string) => {
    setPlayerName(name);
    savePlayerName(name);
  };

  const handleLeave = () => {
    // Abandono explícito: el servidor aplica la salida de inmediato, sin esperar
    // la ventana de gracia. Si la conexión está caída no hay nada que enviar, y
    // el propio servidor cerrará la plaza al vencer su temporizador.
    emitLeaveGame();
    sessionRef.current = null;
    clearSession();
    setView("home");
    setRoomId("");
    setPlayerId("");
    setPlayers([]);
    setGameState(null);
    setGameResult(null);
    setError(null);
    setLastPass(null);
    setNotice(null);
  };

  const handlePlayTile = (tileId: string, side: "left" | "right") => {
    setError(null);
    emitPlayTile({ tileId, side });
  };

  const handlePass = () => {
    setError(null);
    emitPassTurn();
  };

  if (view === "resuming") {
    return (
      <div className="app">
        <p className="waiting-text">
          {online ? "Recuperando tu partida…" : "Reconectando con el servidor…"}
        </p>
      </div>
    );
  }

  if (view === "lobby") {
    return (
      <>
        <StatusBanner online={online} notice={notice} />
        <Lobby
          roomId={roomId}
          players={players}
          playerId={playerId}
          error={error}
          onLeave={handleLeave}
        />
      </>
    );
  }

  if (view === "game") {
    if (!gameState) {
      return <div className="app"><p className="waiting-text">Preparando la partida…</p></div>;
    }
    return (
      <>
        <StatusBanner online={online} notice={notice} />
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
      </>
    );
  }

  return (
    <>
      <StatusBanner online={online} notice={notice} />
      <Home
        initialName={playerName}
        onNameChange={handleNameChange}
        onClearError={() => setError(null)}
        error={error}
      />
    </>
  );
}

/**
 * Aviso de conexión. La partida se mantiene visible aunque el socket caiga:
 * el backend mantiene la partida en memoria (y en disco) durante la ventana de
 * gracia, así que recargar o perder cobertura no significa perder el juego.
 */
function StatusBanner({
  online,
  notice,
}: {
  online: boolean;
  notice: string | null;
}) {
  if (online && !notice) return null;
  return (
    <div className="error-banner status-banner" role="status">
      {!online ? "Sin conexión con el servidor. Reintentando…" : notice}
    </div>
  );
}
