import type { Player as PlayerType } from "../../types/Player";
import "./Player.css";

interface PlayerProps {
  player: PlayerType;
  isYou: boolean;
  isCurrent: boolean;
  tileCount: number;
}

export function Player({ player, isYou, isCurrent, tileCount }: PlayerProps) {
  const classes = [
    "player-card",
    isCurrent ? "current" : "",
    isYou ? "you" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="player-card-top">
        <span className="player-pos">Jugador {player.position + 1}</span>
        {isCurrent && <span className="player-turn">Tu turno</span>}
      </div>
      <div className="player-name">
        {player.name} {isYou && <em>(tú)</em>}
      </div>
      <div className="player-tiles">
        {tileCount} {tileCount === 1 ? "ficha" : "fichas"}
      </div>
    </div>
  );
}