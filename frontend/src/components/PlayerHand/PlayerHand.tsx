import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./PlayerHand.css";

interface PlayerHandProps {
  tiles: Tile[];
  isYourTurn: boolean;
  playableIds: Set<string>;
  selectedId: string | null;
  onSelectTile: (tileId: string) => void;
}

export function PlayerHand({
  tiles,
  isYourTurn,
  playableIds,
  selectedId,
  onSelectTile,
}: PlayerHandProps) {
  return (
    <div className="player-hand">
      {tiles.map((tile) => {
        const playable = isYourTurn && playableIds.has(tile.id);
        return (
          <DominoTile
            key={tile.id}
            tile={tile}
            size="hand"
            orientation="vertical"
            selected={selectedId === tile.id}
            playable={playable}
            disabled={!playable && isYourTurn}
            onClick={playable ? () => onSelectTile(tile.id) : undefined}
          />
        );
      })}
    </div>
  );
}