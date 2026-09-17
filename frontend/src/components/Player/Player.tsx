import type { Player as PlayerType } from "../../types/Player";
import "./Player.css";

interface PlayerProps {
  player: PlayerType;
  isYou: boolean;
  isCurrent: boolean;
  tileCount: number;
}

const MAX_MINI_TILES = 7;

function MiniTilesBack({ count }: { count: number }) {
  return (
    <div className="player-tiles" aria-label="fichas restantes">
      {Array.from({ length: Math.min(count, MAX_MINI_TILES) }, (_, index) => (
        <svg
          key={index}
          className="mini-tile"
          viewBox="0 0 20 32"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            className="mini-tile-face"
            x="1"
            y="1"
            width="18"
            height="30"
            rx="4"
            ry="4"
          />
          <circle className="mini-tile-dot" cx="10" cy="16" r="4" />
        </svg>
      ))}
      {count > MAX_MINI_TILES && (
        <span className="player-tiles-extra">+{count - MAX_MINI_TILES}</span>
      )}
    </div>
  );
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
        {isCurrent && <span className="player-turn">Tu turno</span>}
      </div>
      <div className="player-name">
        {player.name} {isYou && <em>(tú)</em>}
      </div>
      {tileCount > 0 && <MiniTilesBack count={tileCount} />}
    </div>
  );
}