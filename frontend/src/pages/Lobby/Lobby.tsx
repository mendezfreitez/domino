import { useState } from "react";
import type { DragEvent } from "react";
import { Check, Copy } from "lucide-react";
import {
  emitMovePlayer,
  emitStartGame,
  emitSwapPlayers,
} from "../../services/socket";
import type { Player } from "../../types/Player";
import { teamName } from "../../types/Player";
import "./Lobby.css";

interface LobbyProps {
  roomId: string;
  players: Player[];
  playerId: string;
  error: string | null;
  onLeave: () => void;
}

const TEAMS = [0, 1];
const PLAYERS_PER_TEAM = 2;

export function Lobby({ roomId, players, playerId, error, onLeave }: LobbyProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = roomId;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const membersOf = (team: number): (Player | null)[] => {
    const members = players.filter((p) => p.team === team);
    return Array.from(
      { length: PLAYERS_PER_TEAM },
      (_, index) => members[index] ?? null
    );
  };

  const teamCount = (team: number) =>
    players.filter((p) => p.team === team).length;

  const isHost = players[0]?.id === playerId;
  const balanced =
    players.length === PLAYERS_PER_TEAM * TEAMS.length &&
    TEAMS.every((team) => teamCount(team) === PLAYERS_PER_TEAM);

  const handleStart = () => {
    if (isHost && balanced) emitStartGame();
  };

  const handleDragStart = (event: DragEvent<HTMLLIElement>, player: Player) => {
    if (!isHost) return;
    setDraggingId(player.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", player.id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverKey(null);
  };

  const handleDragOver = (event: DragEvent<HTMLLIElement>, key: string) => {
    if (!isHost || !draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverKey !== key) setDragOverKey(key);
  };

  const handleDrop = (
    event: DragEvent<HTMLLIElement>,
    targetTeam: number,
    target: Player | null
  ) => {
    event.preventDefault();
    const draggedId = draggingId ?? event.dataTransfer.getData("text/plain");
    handleDragEnd();
    if (!isHost || !draggedId) return;

    const dragged = players.find((p) => p.id === draggedId);
    if (!dragged) return;

    if (target) {
      if (target.id === dragged.id || target.team === dragged.team) return;
      emitSwapPlayers(dragged.id, target.id);
      return;
    }

    if (dragged.team === targetTeam) return;
    emitMovePlayer(dragged.id, targetTeam);
  };

  return (
    <div className="lobby">
      <header className="lobby-header">
        <div>
          <h2 className="lobby-title">Sala lista</h2>
          <p className="lobby-hint">
            Comparte el código con 3 amigos: 2 vs 2 para comenzar
          </p>
        </div>
        <button className="lobby-leave" onClick={onLeave}>
          Salir
        </button>
      </header>

      <section className="lobby-code-card">
        <span className="lobby-code-label">Código de sala</span>
        <div className="lobby-code-row">
          <span className="lobby-code">{roomId}</span>
          <button
            type="button"
            className="lobby-copy"
            onClick={copyRoomCode}
            aria-label="Copiar código"
            title={copied ? "Código copiado" : "Copiar código"}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>
        </div>
        <span className="lobby-count">
          {players.length} / {PLAYERS_PER_TEAM * TEAMS.length} jugadores
        </span>
      </section>

      <div className="lobby-teams">
        {TEAMS.map((team) => (
          <section key={team} className={`lobby-team team-${team}`}>
            <header className="lobby-team-header">
              <span className="lobby-team-title">{teamName(team)}</span>
              <span className="lobby-team-count">
                {teamCount(team)} / {PLAYERS_PER_TEAM}
              </span>
            </header>
            <ul className="lobby-team-players">
              {membersOf(team).map((slot, index) => {
                const key = `${team}-${index}`;
                const occupied = slot !== null;
                const isYou = slot?.id === playerId;
                const isDragging = slot !== null && slot.id === draggingId;
                const isDropTarget = dragOverKey === key;
                return (
                  <li
                    key={key}
                    className={[
                      "lobby-player",
                      occupied ? "occupied" : "",
                      isYou ? "you" : "",
                      isHost && occupied ? "draggable" : "",
                      isDragging ? "dragging" : "",
                      isDropTarget ? "drop-target" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={isHost && occupied}
                    onDragStart={(event) =>
                      slot && handleDragStart(event, slot)
                    }
                    onDragEnd={handleDragEnd}
                    onDragOver={(event) => handleDragOver(event, key)}
                    onDragLeave={() =>
                      setDragOverKey((current) =>
                        current === key ? null : current
                      )
                    }
                    onDrop={(event) => handleDrop(event, team, slot)}
                  >
                    {slot ? (
                      <span className="lobby-player-name">
                        {slot.name}
                        {isYou && <em> (tú)</em>}
                      </span>
                    ) : (
                      <span className="lobby-player-empty">
                        Esperando jugador…
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {balanced ? (
        isHost ? (
          <button className="primary lobby-start" onClick={handleStart}>
            Iniciar partida
          </button>
        ) : (
          <p className="lobby-waiting">
            Todo listo. El anfitrión iniciará la partida…
          </p>
        )
      ) : (
        <p className="lobby-waiting">
          Se necesitan 2 jugadores en cada equipo para iniciar.
        </p>
      )}

      {isHost && (
        <p className="lobby-tip">
          Arrastra un jugador sobre otro del equipo contrario para
          intercambiarlos.
        </p>
      )}
    </div>
  );
}