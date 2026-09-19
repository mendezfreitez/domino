import type { DragEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./PlayerHand.css";

interface PlayerHandProps {
  tiles: Tile[];
  isYourTurn: boolean;
  playableIds: Set<string>;
  dragTileId: string | null;
  onTileDragStart: (tileId: string, event: DragEvent<HTMLElement>) => void;
  onTileDragEnd: () => void;
}

export function PlayerHand({
  tiles,
  isYourTurn,
  // playableIds,
  dragTileId,
  onTileDragStart,
  onTileDragEnd,
}: PlayerHandProps) {
  return (
    <div className="player-hand">
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
            draggable={playable}
            dimmed={dragTileId === tile.id}
            onDragStart={(event) => onTileDragStart(tile.id, event)}
            onDragEnd={onTileDragEnd}
          />
        );
      })}
    </div>
  );
}