import { useMemo, useState } from "react";
import { Board } from "../../components/Board/Board";
import { Player } from "../../components/Player/Player";
import { PlayerHand } from "../../components/PlayerHand/PlayerHand";
import { teamName, type Player as PlayerType } from "../../types/Player";
import type { GameFinishedPayload, PublicGameState } from "../../types/Game";
import "./Game.css";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const winnerTeam = result?.winnerTeam ?? state.winnerTeam;
  const winnerTeamLabel = winnerTeam !== null ? teamName(winnerTeam) : null;

  const youSeat = state.players.find((p) => p.id === youId) ?? state.players[0];
  const seatAt = (offset: number): PlayerType | undefined =>
    state.players.find(
      (p) => (p.position - youSeat.position + 4) % 4 === offset
    );

  // Asientos en sentido antihorario desde tu posición (abajo):
  // 0 = tú (abajo), 1 = rival (izquierda = siguiente turno),
  // 2 = compañero (enfrente), 3 = rival (derecha).
  const seatCards = [
    { className: "game-seat-top", player: seatAt(2) },
    { className: "game-seat-left", player: seatAt(1) },
    { className: "game-seat-right", player: seatAt(3) },
    { className: "game-seat-bottom", player: seatAt(0) },
  ].filter(
    (seat): seat is { className: string; player: PlayerType } =>
      seat.player !== undefined
  );

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

      <section className="game-table">
        {seatCards.map(({ className, player }) => (
          <div
            key={player.id}
            className={`game-seat ${className} team-${player.team}`}
          >
            <span className={`game-team-badge team-${player.team}`}>
              {teamName(player.team)}
            </span>
            <Player
              player={player}
              isYou={player.id === youId}
              isCurrent={player.id === state.currentPlayer}
              tileCount={state.handCounts[player.id] ?? 0}
            />
          </div>
        ))}
        <main className="game-board-center">
          <Board tiles={state.board} />
        </main>
      </section>

      <div className="game-teams">
        {[0, 1].map((team) => (
          <span key={team} className={`game-team-pill team-${team}`}>
            {teamName(team)} · {state.teamPips?.[String(team)] ?? 0} pts
          </span>
        ))}
      </div>

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
              {winner && <> ({winner.name} se quedó sin fichas)</>}
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
          selectedId={selectedId}
          onSelectTile={handleSelect}
        />
        {mustPass && (
          <div className="game-pass-area">
            <p>No tienes fichas que puedas colocar en el tablero.</p>
            <button className="primary" onClick={onPass}>
              PASO
            </button>
          </div>
        )}
        {selectedId && isYourTurn && (
          <div className="game-side-picker">
            <span>¿Por dónde jugar [<strong>{selectedId.replace("-", "|")}</strong>]?</span>
            <button onClick={() => handlePlay("left")}>Izquierda ◀</button>
            <button onClick={() => handlePlay("right")}>Derecha ▶</button>
          </div>
        )}
      </section>

      {lastPass && (
        <div className="pass-modal-overlay">
          <div className="pass-modal">
            <p>
              Jugador <strong>{lastPass.name}</strong> ha pasado
            </p>
          </div>
        </div>
      )}
    </div>
  );
}