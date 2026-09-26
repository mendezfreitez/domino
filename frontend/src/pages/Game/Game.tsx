import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { Board } from "../../components/Board/Board";
import { Player } from "../../components/Player/Player";
import { PlayerHand } from "../../components/PlayerHand/PlayerHand";
import { DominoTile } from "../../components/DominoTile/DominoTile";
import { teamName, type Player as PlayerType } from "../../types/Player";
import { sortHandTiles } from "../../types/Domino";
import type { GameFinishedPayload, PublicGameState } from "../../types/Game";
import "./Game.css";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const ZOOM = 1.03;
const MIN_SCALE = 0.25;

// Distancia de un punto (px de viewport) a un rectángulo: 0 si está dentro,
// si no, distancia al borde o esquina más cercana.
function distanceToRect(
  x: number,
  y: number,
  rect: DOMRect
): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

interface GameProps {
  state: PublicGameState;
  result: GameFinishedPayload | null;
  error: string | null;
  lastPass: { playerId: string; name: string } | null;
  onPlayTile: (tileId: string, side: "left" | "right") => void;
  onPass: () => void;
  onLeave: () => void;
  onStartNextRound: () => void;
}

export function Game({
  state,
  result,
  error,
  lastPass,
  onPlayTile,
  onPass,
  onLeave,
  onStartNextRound,
}: GameProps) {
  const [dragTileId, setDragTileId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number } | null>(
    null
  );
  const [showInvalidDrop, setShowInvalidDrop] = useState<boolean>(false);
  const [showResult, setShowResult] = useState<boolean>(true);
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
      let zone =
        el instanceof Element ? el.closest("[data-drop-side]") : null;

      // Si el puntero no está exactamente sobre una zona, se acepta la zona
      // más cercana siempre que esté a menos de cuatro longitudes de ficha (el
      // ancho de la zona ya viene escalado por el zoom del tablero).
      if (!zone) {
        let best: Element | null = null;
        let bestDist = Infinity;
        for (const candidate of document.querySelectorAll(
          "[data-drop-side]"
        )) {
          const rect = candidate.getBoundingClientRect();
          const dist = distanceToRect(
            event.clientX,
            event.clientY,
            rect
          );
          // 4 × rect.width = cuatro fichas de largo en píxeles reales.
          if (dist <= rect.width * 4 && dist < bestDist) {
            bestDist = dist;
            best = candidate;
          }
        }
        zone =
          best instanceof Element
            ? best.closest("[data-drop-side]")
            : null;
      }

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

  // Asientos relativos a cada jugador: tú estás abajo (tu propia mano),
  // tu compañero arriba y los dos rivales a los costados. La mesa es una
  // rotación fija y coherente (posición 0 abajo, 1 izquierda, 2 arriba,
  // 3 derecha), de modo que el sentido de los turnos es siempre antihorario
  // desde cualquier asiento: quien te sigue (posición −1) se sienta a tu
  // derecha, luego el compañero arriba y el anterior a tu izquierda.
  const you = state.players.find((p) => p.id === youId);
  const mod4 = (n: number) => ((n % 4) + 4) % 4;
  const seatAt = (offset: number) =>
    you === undefined
      ? undefined
      : state.players.find((p) => p.position === mod4(you.position + offset));

  const seatCards = [
    { className: "game-seat-top", player: seatAt(2) },
    { className: "game-seat-left", player: seatAt(1) },
    { className: "game-seat-right", player: seatAt(3) },
  ].filter(
    (seat): seat is { className: string; player: PlayerType } =>
      seat.player !== undefined
  );

  // Modal de revelado: la misma vista para todos los jugadores. Muestra una
  // fila por equipo (0 y luego 1) únicamente con los jugadores que quedaron
  // realmente con fichas en mano; dentro de cada mano las fichas se ordenan de
  // menor a mayor (sortHandTiles). Quien se quedó sin fichas no aparece.
  const revealTeams = useMemo(() => {
    const groups = new Map<number, PlayerType[]>();
    for (const player of state.players) {
      const count = (state.revealedHands?.[player.id] ?? []).length;
      if (count === 0) continue;
      const list = groups.get(player.team);
      if (list) list.push(player);
      else groups.set(player.team, [player]);
    }
    const order = [...groups.keys()].sort((a, b) => a - b);
    return order.map((team) => ({
      team,
      members: groups.get(team) ?? [],
    }));
  }, [state.players, state.revealedHands]);

  const finishedReason = result?.winnerReason ?? state.winnerReason;
  const isRoundOver = state.status === "round-over";
  const isFinished = state.status === "finished";
  const blocker = state.players.find(
    (p) => p.id === (result?.blockedById ?? state.blockedById)
  );

  // Al terminar ronda/partida se muestra primero el modal de resultado; el de
  // fichas restantes aparece tras pulsar "Mostrar fichas". Si ya se mostró el
  // resultado de esta ronda (match o ronda), al iniciar la siguiente se reinicia.
  useEffect(() => {
    if (isRoundOver || isFinished) {
      setShowResult(true);
    }
  }, [state.status, state.roundNumber]);


const estadoPartida = (state: any) => {
  return(
    isFinished
                ? state.matchWinnerTeam !== null
                  ? `Partida terminada — gana ${teamName(state.matchWinnerTeam)}`
                  : "Partida terminada"
                : isRoundOver
                  ? `Ronda ${state.roundNumber} terminada`
                  : isYourTurn
                    ? "Es tu turno"
                    : `Turno de ${currentPlayer?.name ?? "…"}`
  )
}



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
              <div className="game-scoreboard" aria-label="Marcador de puntos">
                <span className="game-scoreboard-label">
                  Marcador · Ronda {state.roundNumber || 1}
                </span>
                <div className="game-score team-0">
                  <span className="game-score-dot team-0" aria-hidden="true" />
                  <span className="game-score-name">{teamName(state.players, 0)}</span>
                  <span className="game-score-points">
                    {(state.teamScores?.[0] ?? 0)} pts
                  </span>
                </div>
                <div className="game-score team-1">
                  <span className="game-score-dot team-1" aria-hidden="true" />
                  <span className="game-score-name">{teamName(state.players, 1)}</span>
                  <span className="game-score-points">
                    {(state.teamScores?.[1] ?? 0)} pts
                  </span>
                </div>
              </div>
            </div>
            <div className="game-header-right">
              <div className="game-room">
                <span className="game-room-label">Sala</span>
                <span className="game-room-code">{state.roomId}</span>
              </div>
              <button className="game-leave" onClick={onLeave}>
                Abandonar
              </button>
            </div>
          </header>

          <section className="game-table">
            {seatCards.map(({ className, player }) => (
              <div
                key={player.id}
                className={`game-seat ${className} team-${player.team}`}
              >
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
                estadoPartida={estadoPartida(state)}
              />
            </main>
          </section>

          {(isRoundOver || isFinished) && showResult && (
            <div className="reveal-overlay" role="dialog" aria-modal="true">
              <div className="reveal-modal">
                <h2 className="reveal-title">
                  {finishedReason === "player-left"
                    ? "Partida terminada"
                    : isFinished
                      ? "¡Partida terminada!"
                      : `Ronda ${state.roundNumber} terminada`}
                </h2>
                <p className="reveal-subtitle">
                  {finishedReason === "player-left" ? (
                    <>Un jugador abandonó la partida. Juego terminado.</>
                  ) : finishedReason === "blocked" ? (
                    <>
                      Ganan{" "}
                      <strong>{teamName(state.players, winnerTeam ?? -1)}</strong>,{" "}
                      <br />
                      <strong>{blocker?.name ?? "…"}</strong> trancó la{" "}
                      {isFinished ? "partida" : "ronda"} (
                      {state.teamScores?.[winnerTeam ?? 0] ?? 0} pts vs{" "}
                      {state.teamScores?.[1 - (winnerTeam ?? 0)] ?? 0} pts).
                    </>
                  ) : (
                    <div style={{ fontSize: '22px' }}>
                      Ganan{" "}
                      <strong>{teamName(state.players, winnerTeam ?? -1)}</strong>...{" "}
                      <strong>{winner?.name.toUpperCase() ?? "…"}</strong> se quedó sin fichas.
                    </div>
                  )}
                </p>
                <button className="primary" onClick={() => setShowResult(false)} style={{ marginTop: "12px", marginBottom: "4px" }}>
                  Mostrar fichas restantes
                </button>
              </div>
            </div>
          )}

          {(isRoundOver || isFinished) && !showResult && (
            <div className="reveal-overlay" role="dialog" aria-modal="true">
              <div className="reveal-modal">
                <h2 className="reveal-title">Fichas restantes</h2>
                <p className="reveal-subtitle">
                  {isRoundOver
                    ? `Así quedaron las manos al terminar la ronda ${state.roundNumber}.`
                    : "Así quedaron las manos al terminar la partida."}
                </p>

                <ul className="reveal-list">
                  {revealTeams.map(({ team, members }) => (
                    <li key={team} className={`reveal-team team-${team}`}>
                      <span className="reveal-team-name team-name">
                        {teamName(team)}
                      </span>
                      <div className="reveal-team-players">
                        {members.map((player) => (
                          <div key={player.id} className="reveal-member">
                            <span className="reveal-player">{player.name}</span>
                            <span className="reveal-tiles">
                              {sortHandTiles(
                                state.revealedHands?.[player.id] ?? []
                              ).map((tile) => (
                                <span className="reveal-tile" key={tile.id}>
                                  <DominoTile
                                    tile={tile}
                                    size="hand"
                                    orientation="vertical"
                                  />
                                </span>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>

                {isRoundOver ? (
                  <button className="primary" onClick={onStartNextRound}>
                    Siguiente ronda
                  </button>
                ) : (
                  <button className="primary" onClick={onLeave}>
                    Cerrar
                  </button>
                )}
              </div>
            </div>
          )}

          {error && <div className="error-banner game-error">{error}</div>}

          <section className="game-hand-area">
            <PlayerHand
              tiles={state.yourHand}
              draggingTileId={dragTileId}
              isYourTurn={isYourTurn}
              playableIds={playableIds}
              onTileMouseDown={handleTileMouseDown}
            />
          </section>

          {mustPass && (
            <div className="pass-modal-overlay" role="dialog" aria-modal="true">
              <div className="pass-modal">
                <p>No tienes fichas que puedas colocar en el tablero.</p>
                <button className="primary" onClick={onPass}>
                  PASO
                </button>
              </div>
            </div>
          )}

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
        </div>
      </div>

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