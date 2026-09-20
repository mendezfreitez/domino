import type { MouseEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./PlayerHand.css";

interface PlayerHandProps {
  tiles: Tile[];
  isYourTurn: boolean;
  playableIds: Set<string>;
  onTileMouseDown: (tileId: string, event: MouseEvent<HTMLElement>) => void;
}

export function PlayerHand({
  tiles,
  isYourTurn,
  // playableIds,
  onTileMouseDown,
}: PlayerHandProps) {
  return (
    <div className={`player-hand ${isYourTurn ? "tuTurno" : ""}`}>
      {tiles.map((tile) => {
        // const playable = isYourTurn && playableIds.has(tile.id);
        const playable = isYourTurn;
        return (
          <DominoTile
            key={tile.id}
            tile={tile}
            size="hand"
            orientation="vertical"
            playable={playable}
            disabled={!playable && isYourTurn}
            onMouseDown={
              playable ? (event) => onTileMouseDown(tile.id, event) : undefined
            }
          />
        );
      })}
    </div>
  );
}