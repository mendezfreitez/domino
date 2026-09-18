import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DragEvent } from "react";
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
  dragTileId: string | null;
  dropLeftValid: boolean;
  dropRightValid: boolean;
  onDropTile: (tileId: string, side: "left" | "right") => void;
}

function dropHandlers(
  side: "left" | "right",
  onDropTile: BoardProps["onDropTile"]
) {
  return {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const tileId = event.dataTransfer.getData("text/plain");
      if (tileId) onDropTile(tileId, side);
    },
  };
}

export function Board({
  tiles,
  dragTileId,
  dropLeftValid,
  dropRightValid,
  onDropTile,
}: BoardProps) {
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

      const fit = Math.min((availW - gaps) / widthUnits, availH / 2);
      const next = Math.min(Math.max(fit, MIN_TILE_H), MAX_TILE_H);
      setTileH(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tiles.length]);

  const dragging = dragTileId !== null;
  const zoneClass = (side: "left" | "right", valid: boolean) =>
    `board-drop board-drop-${side}${
      dragging ? ` visible ${valid ? "active" : "blocked"}` : ""
    }`;

  if (tiles.length === 0) {
    return (
      <div
        ref={boardRef}
        className={`board board-empty${dragTileId ? " drop-active" : ""}`}
        style={{ "--board-tile-h": `${tileH}px` } as CSSProperties}
        {...dropHandlers("left", onDropTile)}
      >
        <p>El tablero está vacío. Arrastra una ficha aquí.</p>
      </div>
    );
  }

  return (
    <div
      ref={boardRef}
      className="board"
      style={{ "--board-tile-h": `${tileH}px` } as CSSProperties}
    >
      <div className="board-track">
        <div
          className={zoneClass("left", dropLeftValid)}
          aria-label="Colocar ficha a la izquierda"
          {...dropHandlers("left", onDropTile)}
        />
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
        <div
          className={zoneClass("right", dropRightValid)}
          aria-label="Colocar ficha a la derecha"
          {...dropHandlers("right", onDropTile)}
        />
      </div>
    </div>
  );
}