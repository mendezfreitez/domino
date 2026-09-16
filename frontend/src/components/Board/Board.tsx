import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./Board.css";

interface BoardProps {
  tiles: Tile[];
}

export function Board({ tiles }: BoardProps) {
  if (tiles.length === 0) {
    return (
      <div className="board board-empty">
        <p>El tablero está vacío. Coloca la primera ficha.</p>
      </div>
    );
  }

  const leftEnd = tiles[0].left;
  const rightEnd = tiles[tiles.length - 1].right;

  return (
    <div className="board">
      <div className="board-ends">
        <span>
          Extremo izquierdo: <strong>{leftEnd}</strong>
        </span>
        <span>
          Extremo derecho: <strong>{rightEnd}</strong>
        </span>
      </div>
      <div className="board-track">
        {tiles.map((tile) => {
          const isDouble = tile.left === tile.right;
          return (
            <DominoTile
              key={`${tile.id}-${tile.left}-${tile.right}`}
              tile={tile}
              size="board"
              orientation={isDouble ? "vertical" : "horizontal"}
            />
          );
        })}
      </div>
    </div>
  );
}