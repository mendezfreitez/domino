import type { PointerEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./PlayerHand.css";

interface PlayerHandProps {
  tiles: Tile[];
  draggingTileId: string | null;
  isYourTurn: boolean;
  playableIds: Set<string>;
  onTilePointerDown: (tileId: string, event: PointerEvent<HTMLElement>) => void;
}

export function PlayerHand({
  tiles,
  draggingTileId,
  isYourTurn,
  // playableIds,
  onTilePointerDown,
}: PlayerHandProps) {
  return (
    <div className={`player-hand ${isYourTurn ? "tuTurno" : ""}`}>
      {tiles.map((tile) => {
        // const playable = isYourTurn && playableIds.has(tile.id);
        const playable = isYourTurn;
        const isDragging = tile.id === draggingTileId;
        return (
          <DominoTile
            key={tile.id}
            tile={tile}
            size="hand"
            orientation="vertical"
            playable={playable}
            disabled={!playable && isYourTurn}
            className={isDragging ? "tile-dragging" : undefined}
            onPointerDown={
              playable ? (event) => onTilePointerDown(tile.id, event) : undefined
            }
          />
        );
      })}
    </div>
  );
}