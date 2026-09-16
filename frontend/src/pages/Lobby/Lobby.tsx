import { emitStartGame } from "../../services/socket";
import type { Player } from "../../types/Player";
import "./Lobby.css";

interface LobbyProps {
  roomId: string;
  players: Player[];
  playerId: string;
  error: string | null;
  onLeave: () => void;
}

const EMPTY_SLOT = { id: "", name: "Esperando jugador…", position: -1 };

export function Lobby({ roomId, players, playerId, error, onLeave }: LobbyProps) {
  const slots: Player[] = [];
  for (let i = 0; i < 4; i++) {
    slots.push(players.find((p) => p.position === i) ?? { ...EMPTY_SLOT, position: i });
  }

  const isHost = players[0]?.id === playerId;
  const full = players.length === 4;

  const handleStart = () => {
    if (isHost && full) emitStartGame();
  };

  return (
    <div className="lobby">
      <header className="lobby-header">
        <div>
          <h2 className="lobby-title">Sala lista</h2>
          <p className="lobby-hint">
            Comparte el código con 3 amigos para comenzar
          </p>
        </div>
        <button className="lobby-leave" onClick={onLeave}>
          Salir
        </button>
      </header>

      <section className="lobby-code-card">
        <span className="lobby-code-label">Código de sala</span>
        <span className="lobby-code">{roomId}</span>
        <span className="lobby-count">
          {players.length} / 4 jugadores
        </span>
      </section>

      <ul className="lobby-players">
        {slots.map((slot) => {
          const occupied = slot.id !== "";
          const isYou = slot.id === playerId;
          return (
            <li
              key={slot.position}
              className={`lobby-player ${occupied ? "occupied" : ""} ${
                isYou ? "you" : ""
              }`}
            >
              <span className="lobby-player-pos">Jugador {slot.position + 1}</span>
              <span className="lobby-player-name">
                {occupied ? slot.name : "—"}
              </span>
              {isYou && <span className="lobby-player-you">Tú</span>}
            </li>
          );
        })}
      </ul>

      {error && <div className="error-banner">{error}</div>}

      {full ? (
        isHost ? (
          <button className="primary lobby-start" onClick={handleStart}>
            Iniciar partida
          </button>
        ) : (
          <p className="lobby-waiting">
            Sala completa. El creador iniciará la partida…
          </p>
        )
      ) : (
        <p className="lobby-waiting">Esperando jugadores…</p>
      )}
    </div>
  );
}