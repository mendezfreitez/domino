import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import {
  buildChainLayout,
  predictNextPlacement,
  DEFAULT_CONFIG,
} from "./dominoLayout";
import "./Board.css";

const MIN_TILE_H = 44;
const MAX_TILE_H = 108;
const DEFAULT_TILE_H = 64;
const BOARD_PAD_X = 16;
const BOARD_PAD_Y = 12;

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

  const layout = useMemo(() => buildChainLayout(tiles, DEFAULT_CONFIG), [tiles]);
  const leftZone = useMemo(
    () => predictNextPlacement("left", layout, DEFAULT_CONFIG),
    [layout]
  );
  const rightZone = useMemo(
    () => predictNextPlacement("right", layout, DEFAULT_CONFIG),
    [layout]
  );

  // Los bounds de render incluyen las zonas de drop (cuadrados de lado = largo
  // de ficha) para que nunca queden fuera del área visible del tablero, p. ej.
  // cuando el cruce derecho va hacia arriba y la zona supera el tope medido.
  const bounds = useMemo(() => {
    let minX = layout.minX;
    let maxX = layout.maxX;
    let minY = layout.minY;
    let maxY = layout.maxY;
    for (const zone of [leftZone, rightZone]) {
      if (!zone) continue;
      minX = Math.min(minX, zone.x - 1);
      maxX = Math.max(maxX, zone.x + 1);
      minY = Math.min(minY, zone.y - 1);
      maxY = Math.max(maxY, zone.y + 1);
    }
    return { minX, maxX, minY, maxY };
  }, [layout, leftZone, rightZone]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width <= 0 || height <= 0) return;

      if (tiles.length === 0) {
        setTileH(DEFAULT_TILE_H);
        return;
      }

      const wU = Math.max(bounds.maxX - bounds.minX, 1);
      const hU = Math.max(bounds.maxY - bounds.minY, 1);
      const availW = width - BOARD_PAD_X * 2;
      const availH = Math.max(height - BOARD_PAD_Y * 2, 1);

      const fit = Math.min(availW / wU, availH / hU);
      const next = Math.min(Math.max(fit, MIN_TILE_H), MAX_TILE_H);
      setTileH(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bounds, tiles.length]);

  const pickingUp = dragTileId !== null;
  const zoneClass = (valid: boolean) =>
    `board-drop${pickingUp ? ` visible ${valid ? "active" : "blocked"}` : ""}`;

  if (tiles.length === 0) {
    return (
      <div
        ref={boardRef}
        className={`board board-empty${dragTileId ? " drop-active" : ""}`}
        style={{ "--board-tile-h": `${tileH}px` } as CSSProperties}
        data-drop-side="left"
        {...dropHandlers("left", onDropTile)}
      >
        <p>El tablero está vacío. Arrastra una ficha aquí.</p>
      </div>
    );
  }

  const toX = (u: number) => (u - bounds.minX) * tileH;
  const toY = (u: number) => (u - bounds.minY) * tileH;
  const layoutW = (bounds.maxX - bounds.minX) * tileH;
  const layoutH = (bounds.maxY - bounds.minY) * tileH;

  const zoneStyle = (zone: { x: number; y: number }) => {
    const side = 2 * tileH;
    return {
      left: toX(zone.x),
      top: toY(zone.y),
      width: side,
      height: side,
    };
  };

  return (
    <div
      ref={boardRef}
      className="board"
      style={{ "--board-tile-h": `${tileH}px` } as CSSProperties}
    >
      <div
        className="board-layer"
        style={{ width: layoutW, height: layoutH }}
      >
        {leftZone ? (
          <div
            className={zoneClass(dropLeftValid)}
            style={zoneStyle(leftZone)}
            aria-label="Colocar ficha a la izquierda"
            data-drop-side="left"
            {...dropHandlers("left", onDropTile)}
          />
        ) : null}
        {layout.placements.map((p) => (
          <div
            key={p.tile.id}
            className="board-cell"
            style={{
              left: toX(p.x),
              top: toY(p.y),
              transform: "translate(-50%, -50%)",
            }}
          >
            <DominoTile
              tile={{
                id: p.tile.id,
                left: p.displayLeft,
                right: p.displayRight,
              }}
              size="board"
              orientation={p.orientation}
            />
          </div>
        ))}
        {rightZone ? (
          <div
            className={zoneClass(dropRightValid)}
            style={zoneStyle(rightZone)}
            aria-label="Colocar ficha a la derecha"
            data-drop-side="right"
            {...dropHandlers("right", onDropTile)}
          />
        ) : null}
      </div>
    </div>
  );
}