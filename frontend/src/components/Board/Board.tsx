import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./Board.css";

const MIN_TILE_H = 44;
const MAX_TILE_H = 108;
const DEFAULT_TILE_H = 64;
const BOARD_GAP = 4;
const BOARD_PAD_X = 16;
const BOARD_PAD_Y = 12;
const ENDS_EXTRA = 52;

interface BoardProps {
  tiles: Tile[];
}

export function Board({ tiles }: BoardProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [tileH, setTileH] = useState<number>(DEFAULT_TILE_H);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width <= 0 || height <= 0) return;

      const count = tiles.length;
      if (count === 0) {
        setTileH(MAX_TILE_H);
        return;
      }

      const availW = width - BOARD_PAD_X * 2;
      const availH = Math.max(
        height - BOARD_PAD_Y * 2 - ENDS_EXTRA,
        1
      );

      const doubles = tiles.filter((t) => t.left === t.right).length;
      const widthUnits = (count - doubles) * 2 + doubles;
      const gaps = (count - 1) * BOARD_GAP;

      // En fichas horizontales cada unidad mide 2h; las dobles verticales miden h.
      const fit = Math.min((availW - gaps) / widthUnits, availH / 2);
      const next = Math.min(Math.max(fit, MIN_TILE_H), MAX_TILE_H);
      setTileH(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tiles.length]);

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
    <div
      ref={boardRef}
      className="board"
      style={{ "--board-tile-h": `${tileH}px` } as CSSProperties}
    >
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