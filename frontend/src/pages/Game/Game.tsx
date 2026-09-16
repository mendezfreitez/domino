import { useMemo, useState } from "react";
import { Board } from "../../components/Board/Board";
import { Player } from "../../components/Player/Player";
import { PlayerHand } from "../../components/PlayerHand/PlayerHand";
import type { GameFinishedPayload, PublicGameState } from "../../types/Game";
import "./Game.css";

interface GameProps {
  state: PublicGameState;
  result: GameFinishedPayload | null;
  error: string | null;
  onPlayTile: (tileId: string, side: "left" | "right") => void;
  onLeave: () => void;
}

export function Game({ state, result, error, onPlayTile, onLeave }: GameProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const youId = state.yourPlayerId;
  const isYourTurn =
    state.status === "playing" && state.currentPlayer === youId;

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

  const handleSelect = (tileId: string) => {
    setSelectedId((current) => (current === tileId ? null : tileId));
  };

  const handlePlay = (side: "left" | "right") => {
    if (!selectedId) return;
    onPlayTile(selectedId, side);
    setSelectedId(null);
  };

  const currentPlayer = state.players.find((p) => p.id === state.currentPlayer);
  const winner = state.players.find((p) => p.id === (result?.winnerId ?? state.winnerId));

  const finishedReason = result?.winnerReason ?? state.winnerReason;
  const isFinished = state.status === "finished";

  return (
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

      <section className="game-players">
        {state.players.map((player) => (
          <Player
            key={player.id}
            player={player}
            isYou={player.id === youId}
            isCurrent={player.id === state.currentPlayer}
            tileCount={state.handCounts[player.id] ?? 0}
          />
        ))}
      </section>

      <main className="game-board-area">
        <Board tiles={state.board} />
      </main>

      {isFinished && (
        <div className="game-result">
          {finishedReason === "player-left" ? (
            <p>Un jugador abandonó la partida. Juego terminado.</p>
          ) : finishedReason === "blocked" ? (
            <p>Partida bloqueada. Gana <strong>{winner?.name ?? "…"}</strong> por tener menos puntos.</p>
          ) : (
            <p>¡<strong>{winner?.name ?? "…"}</strong> ganó la partida!</p>
          )}
        </div>
      )}

      {error && <div className="error-banner game-error">{error}</div>}

      <section className="game-hand-area">
        <PlayerHand
          tiles={state.yourHand}
          isYourTurn={isYourTurn}
          playableIds={playableIds}
          selectedId={selectedId}
          onSelectTile={handleSelect}
        />
        {selectedId && isYourTurn && (
          <div className="game-side-picker">
            <span>¿Por dónde jugar [<strong>{selectedId.replace("-", "|")}</strong>]?</span>
            <button onClick={() => handlePlay("left")}>Izquierda ◀</button>
            <button onClick={() => handlePlay("right")}>Derecha ▶</button>
          </div>
        )}
      </section>
    </div>
  );
}