import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { Board } from "../../components/Board/Board";
import { Player } from "../../components/Player/Player";
import { PlayerHand } from "../../components/PlayerHand/PlayerHand";
import { DominoTile } from "../../components/DominoTile/DominoTile";
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
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number } | null>(
    null
  );
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

  // Arrastre manual: mousedown inicia, mousemove mueve el fantasma y
  // mouseup resuelve la ficha con elementFromPoint sobre [data-drop-side].
  const latestDrag = useRef({
    tileId: null as string | null,
    yourHand: state.yourHand,
    boardLeft,
    boardRight,
    onPlayTile,
  });
  latestDrag.current.tileId = dragTileId;
  latestDrag.current.yourHand = state.yourHand;
  latestDrag.current.boardLeft = boardLeft;
  latestDrag.current.boardRight = boardRight;
  latestDrag.current.onPlayTile = onPlayTile;

  useEffect(() => {
    if (!dragTileId) return;
    document.body.classList.add("domino-dragging");

    const onMove = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      setDragGhost({ x: event.clientX, y: event.clientY });
    };

    const onUp = (event: globalThis.MouseEvent) => {
      const current = latestDrag.current;
      const tileId = current.tileId;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const zone =
        el instanceof Element ? el.closest("[data-drop-side]") : null;
      if (zone && tileId) {
        const side = zone.getAttribute("data-drop-side") as
          | "left"
          | "right";
        const tile = current.yourHand.find((t) => t.id === tileId);
        if (tile) {
          const valid =
            side === "left"
              ? current.boardLeft === null ||
                tile.left === current.boardLeft ||
                tile.right === current.boardLeft
              : current.boardRight === null ||
                tile.left === current.boardRight ||
                tile.right === current.boardRight;
          if (valid) {
            current.onPlayTile(tileId, side);
          } else {
            setShowInvalidDrop(true);
          }
        }
      }
      setDragTileId(null);
      setDragGhost(null);
    };

    const onLeave = () => {
      setDragTileId(null);
      setDragGhost(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      document.body.classList.remove("domino-dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [dragTileId]);

  const handleTileMouseDown = (
    tileId: string,
    event: MouseEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    if (state.status !== "playing" || !isYourTurn) return;
    event.preventDefault();
    setShowInvalidDrop(false);
    setDragTileId(tileId);
    setDragGhost({ x: event.clientX, y: event.clientY });
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

  // Asientos relativos a cada jugador: tú estás abajo (tu propia mano),
  // tu compañero arriba y los dos rivales a los costados. Ningún asiento
  // muestra al propio jugador en tercera persona.
  const you = state.players.find((p) => p.id === youId);
  const otherPlayers = state.players.filter((p) => p.id !== youId);
  const partner = otherPlayers.find((p) => p.team === you?.team);
  const rivals = otherPlayers.filter((p) => p.team !== you?.team);

  const seatCards = [
    { className: "game-seat-top", player: partner },
    { className: "game-seat-left", player: rivals[0] },
    { className: "game-seat-right", player: rivals[1] },
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
        <div className="game-header-left">
          <div className="game-room">
            <span className="game-room-label">Sala</span>
            <span className="game-room-code">{state.roomId}</span>
          </div>
          <div className="game-scoreboard" aria-label="Marcador de puntos">
            <span className="game-scoreboard-label">Marcador</span>
            <div className="game-score team-0">
              <span className="game-score-dot team-0" aria-hidden="true" />
              <span className="game-score-name">{teamName(0)}</span>
              <span className="game-score-points">
                {(state.teamScores?.[0] ?? 0)} pts
              </span>
            </div>
            <div className="game-score team-1">
              <span className="game-score-dot team-1" aria-hidden="true" />
              <span className="game-score-name">{teamName(1)}</span>
              <span className="game-score-points">
                {(state.teamScores?.[1] ?? 0)} pts
              </span>
            </div>
          </div>
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
          onTileMouseDown={handleTileMouseDown}
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
              style={{ padding: "6px 18px" }}
              onClick={() => setShowInvalidDrop(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {isFinished && (
        <div className="reveal-overlay" role="dialog" aria-modal="true">
          <div className="reveal-modal">
            <h2 className="reveal-title">Fichas de los demás jugadores</h2>
            <p className="reveal-subtitle">
              Así quedaron las manos al terminar la partida.
            </p>

            <ul className="reveal-list">
              {otherPlayers.map((player) => {
                const tiles = state.revealedHands?.[player.id] ?? [];
                return (
                  <li key={player.id} className={`reveal-item team-${player.team}`}>
                    <span className="reveal-player team-name">
                      {player.name}
                    </span>
                    {tiles.length === 0 ? (
                      <span className="reveal-empty">sin fichas</span>
                    ) : (
                      <span className="reveal-tiles">
                        {tiles.map((tile) => (
                          <span className="reveal-tile" key={tile.id}>
                            <DominoTile
                              tile={tile}
                              size="hand"
                              orientation="vertical"
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            <button className="primary" onClick={onLeave}>
              Cerrar
            </button>
          </div>
        </div>
      )}


      {dragTileId && dragTile && dragGhost && (
        <div
          className="drag-ghost"
          style={
            {
              left: dragGhost.x,
              top: dragGhost.y,
              transform: `translate(-50%, -85%) scale(${scale})`,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <DominoTile tile={dragTile} size="hand" orientation="vertical" />
        </div>
      )}
    </div>
  );
}