import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DragEvent } from "react";
import { Board } from "../../components/Board/Board";
import { Player } from "../../components/Player/Player";
import { PlayerHand } from "../../components/PlayerHand/PlayerHand";
import { teamName, type Player as PlayerType } from "../../types/Player";
import type { GameFinishedPayload, PublicGameState } from "../../types/Game";
import "./Game.css";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const ZOOM = 1.03;
const MIN_SCALE = 0.25;

interface GameProps {
  state: PublicGameState;
  result: GameFinishedPayload | null;
  error: string | null;
  lastPass: { playerId: string; name: string } | null;
  onPlayTile: (tileId: string, side: "left" | "right") => void;
  onPass: () => void;
  onLeave: () => void;
}

export function Game({
  state,
  result,
  error,
  lastPass,
  onPlayTile,
  onPass,
  onLeave,
}: GameProps) {
  const [dragTileId, setDragTileId] = useState<string | null>(null);
  const [showInvalidDrop, setShowInvalidDrop] = useState<boolean>(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(1);

  useLayoutEffect(() => {
    const recompute = () => {
      const next = Math.max(
        Math.min(
          window.innerWidth / DESIGN_WIDTH,
          window.innerHeight / DESIGN_HEIGHT
        ) * ZOOM,
        MIN_SCALE
      );
      setScale(next);
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const youId = state.yourPlayerId;
  const isYourTurn =
    state.status === "playing" && state.currentPlayer === youId;
  const mustPass = isYourTurn && state.mustPass;

  const boardLeft = state.board.length ? state.board[0].left : null;
  const boardRight = state.board.length
    ? state.board[state.board.length - 1].right
    : null;

  const playableIds = useMemo(() => {
    const ids = new Set<string>();
    if (state.status !== "playing") return ids;
    for (const tile of state.yourHand) {
      if (boardLeft === null || boardRight === null) {
        ids.add(tile.id);
      } else if (
        tile.left === boardLeft ||
        tile.right === boardLeft ||
        tile.left === boardRight ||
        tile.right === boardRight
      ) {
        ids.add(tile.id);
      }
    }
    return ids;
  }, [state.yourHand, state.status, boardLeft, boardRight]);

  const handleDrop = (tileId: string, side: "left" | "right") => {
    const tile = state.yourHand.find((t) => t.id === tileId);
    setDragTileId(null);
    if (!tile) {
      setShowInvalidDrop(true);
      return;
    }
    const valid =
      side === "left"
        ? boardLeft === null ||
          tile.left === boardLeft ||
          tile.right === boardLeft
        : boardRight === null ||
          tile.left === boardRight ||
          tile.right === boardRight;
    if (!valid) {
      setShowInvalidDrop(true);
      return;
    }
    setShowInvalidDrop(false);
    onPlayTile(tileId, side);
  };

  const handleTileDragStart = (
    tileId: string,
    event: DragEvent<HTMLElement>
  ) => {
    setShowInvalidDrop(false);
    setDragTileId(tileId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tileId);
  };

  const handleTileDragEnd = () => {
    setDragTileId(null);
  };

  const dragTile = state.yourHand.find((t) => t.id === dragTileId) ?? null;
  const dropLeftValid =
    dragTile !== null &&
    (boardLeft === null ||
      dragTile.left === boardLeft ||
      dragTile.right === boardLeft);
  const dropRightValid =
    dragTile !== null &&
    (boardRight === null ||
      dragTile.left === boardRight ||
      dragTile.right === boardRight);

  const currentPlayer = state.players.find((p) => p.id === state.currentPlayer);
  const winner = state.players.find((p) => p.id === (result?.winnerId ?? state.winnerId));
  const winnerTeam = result?.winnerTeam ?? state.winnerTeam;
  const winnerTeamLabel = winnerTeam !== null ? teamName(winnerTeam) : null;

  // Todos los jugadores ven la misma vista fija según la posición en la mesa:
  // 1 = izquierda, 2 = enfrente, 3 = derecha (abajo = tu propia mano).
  const seatAtPosition = (position: number): PlayerType | undefined =>
    state.players.find((p) => p.position === position);

  const seatCards = [
    { className: "game-seat-top", player: seatAtPosition(2) },
    { className: "game-seat-left", player: seatAtPosition(1) },
    { className: "game-seat-right", player: seatAtPosition(3) },
  ].filter(
    (seat): seat is { className: string; player: PlayerType } =>
      seat.player !== undefined
  );

  const finishedReason = result?.winnerReason ?? state.winnerReason;
  const isFinished = state.status === "finished";

  return (
    <div className="game-viewport">
      <div
        className="game-stage"
        ref={stageRef}
        style={{ "--game-scale": scale } as CSSProperties}
      >
        <div className="game">
          <header className="game-header">
        <div className="game-room">
          <span className="game-room-label">Sala</span>
          <span className="game-room-code">{state.roomId}</span>
        </div>
        <span className="game-turn-status">
          {isFinished
            ? "Partida terminada"
            : isYourTurn
              ? "Es tu turno"
              : `Turno de ${currentPlayer?.name ?? "…"}`}
        </span>
        <button className="game-leave" onClick={onLeave}>
          Abandonar
        </button>
      </header>

      <section className="game-table">
        {seatCards.map(({ className, player }) => (
          <div
            key={player.id}
            className={`game-seat ${className} team-${player.team}`}
          >
            {/* <span className={`game-team-badge team-${player.team}`}>
              {teamName(player.team)}
            </span> */}
            <Player
              player={player}
              isYou={player.id === youId}
              isCurrent={player.id === state.currentPlayer}
              tileCount={state.handCounts[player.id] ?? 0}
            />
          </div>
        ))}
        <main className="game-board-center">
          <Board
            tiles={state.board}
            dragTileId={dragTileId}
            dropLeftValid={dropLeftValid}
            dropRightValid={dropRightValid}
            onDropTile={handleDrop}
          />
        </main>
      </section>

      {isFinished && (
        <div className="game-result">
          {finishedReason === "player-left" ? (
            <p>Un jugador abandonó la partida. Juego terminado.</p>
          ) : finishedReason === "blocked" ? (
            <p>
              Partida bloqueada. Gana <strong>{winnerTeamLabel ?? "…"}</strong> por
              tener menos puntos.
            </p>
          ) : (
            <p>
              ¡Ganó <strong>{winnerTeamLabel ?? "…"}</strong>!
              {winner && <> (<strong>{winner.name}</strong> se quedó sin fichas)</>}
            </p>
          )}
        </div>
      )}

      {error && <div className="error-banner game-error">{error}</div>}

      <section className="game-hand-area">
        <PlayerHand
          tiles={state.yourHand}
          isYourTurn={isYourTurn}
          playableIds={playableIds}
          dragTileId={dragTileId}
          onTileDragStart={handleTileDragStart}
          onTileDragEnd={handleTileDragEnd}
        />
        {mustPass && (
          <div className="game-pass-area">
            <p>No tienes fichas que puedas colocar en el tablero.</p>
            <button className="primary" onClick={onPass}>
              PASO
            </button>
          </div>
        )}
      </section>
        </div>
      </div>

      {lastPass && (
        <div className="pass-modal-overlay">
          <div className="pass-modal">
            <p>
              Jugador <strong>{lastPass.name}</strong> ha pasado
            </p>
          </div>
        </div>
      )}

      {showInvalidDrop && (
        <div className="pass-modal-overlay">
          <div className="pass-modal">
            <p>Esa ficha no va en ese lado del tablero.</p>
            <button
              className="primary"
              style={{padding: '6px 18px'}}
              onClick={() => setShowInvalidDrop(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}