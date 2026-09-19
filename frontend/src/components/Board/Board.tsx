import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import "./Board.css";

const MIN_TILE_H = 44;
const MAX_TILE_H = 108;
const DEFAULT_TILE_H = 64;
const BOARD_PAD_X = 16;
const BOARD_PAD_Y = 12;
const ROW_LEN = 8;

type Orientation = "horizontal" | "vertical";

interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: Orientation;
  rotation: 0 | 180;
}

interface Layout {
  placements: Placement[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeLayout(tiles: Tile[], stackSign: 1 | -1): Layout {
  const placements: Placement[] = [];

  if (tiles.length === 0) {
    return { placements, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let dir: 1 | -1 = 1;
  let rowY = 0;
  let inRow = 0;
  let pendingFirstCenter: number | null = null;
  let rowEndX: number | null = null;
  let nextFold = ROW_LEN;
  // Orientación alternada de los cruces: si el cruce derecho va hacia abajo,
  // el izquierdo va hacia arriba, y viceversa (se alterna en cada doblez).
  let foldRotation: 0 | 180 = 0;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    let isFold = false;
    if (i > 0 && i === nextFold) {
      // Nunca se cruza sobre una ficha doble ni inmediatamente después de
      // una: se traslada el cruce a la siguiente ficha.
      const prevTile = tiles[i - 1];
      if (tile.left === tile.right || prevTile.left === prevTile.right) {
        nextFold = i + 1;
      } else {
        isFold = true;
      }
    }

    if (i === 0) {
      const isDouble = tile.left === tile.right;
      placements.push({
        x: 0,
        y: 0,
        w: isDouble ? 1 : 2,
        h: isDouble ? 2 : 1,
        orientation: isDouble ? "vertical" : "horizontal",
        rotation: 0,
      });
      inRow = 1;
      rowEndX = placements[0].w / 2;
      continue;
    }

    if (isFold) {
      // El cruce (cada fin de fila de ROW_LEN fichas) gira 90° conectando
      // la fila actual con la siguiente. Las filas alternan el extremo en que
      // cruzan: primero la derecha, luego la izquierda, y así sucesivamente.
      const endX = rowEndX!;
      const fx = dir === 1 ? endX + 0.5 : endX - 0.5;
      const fy = stackSign === 1 ? rowY + 0.5 : rowY - 0.5;
      const rotation: 0 | 180 = foldRotation;
      placements.push({
        x: fx,
        y: fy,
        w: 1,
        h: 2,
        orientation: "vertical",
        rotation,
      });
      foldRotation = foldRotation === 0 ? 180 : 0;
      dir = dir === 1 ? -1 : 1;
      rowY += stackSign === 1 ? 2 : -2;
      inRow = 0;
      // Centro de la 1a ficha de la nueva fila: su centro coincide con el
      // centro del doblez, quedando centrada respecto a la ficha anterior
      // (sin superponerse: solo hace contacto por el borde).
      pendingFirstCenter = fx;
      rowEndX = null;
      nextFold += 1 + ROW_LEN;
      continue;
    }

    const isDouble = tile.left === tile.right;
    const prevPlacement = placements[i - 1];
    // La doble siempre va perpendicular a la ficha anterior.
    const perpendicular: Orientation =
      prevPlacement.orientation === "horizontal" ? "vertical" : "horizontal";
    const orientation: Orientation = isDouble ? perpendicular : "horizontal";
    const w = isDouble ? (orientation === "vertical" ? 1 : 2) : 2;
    const h = isDouble ? (orientation === "vertical" ? 2 : 1) : 1;
    const rotation: 0 | 180 =
      isDouble && orientation === "vertical" ? 0 : dir === 1 ? 0 : 180;
    let cx: number;
    if (inRow === 0) {
      cx = pendingFirstCenter!;
      pendingFirstCenter = null;
      inRow = 1;
    } else {
      // Nunca se superponen fichas: enlace borde-a-borde.
      cx = prevPlacement.x + dir * (prevPlacement.w / 2 + w / 2);
    }
    placements.push({
      x: cx,
      y: rowY,
      w,
      h,
      orientation,
      rotation,
    });
    rowEndX = dir === 1 ? cx + w / 2 : cx - w / 2;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.x - p.w / 2);
    maxX = Math.max(maxX, p.x + p.w / 2);
    minY = Math.min(minY, p.y - p.h / 2);
    maxY = Math.max(maxY, p.y + p.h / 2);
  }
  return { placements, minX, maxX, minY, maxY };
}

interface BoardProps {
  tiles: Tile[];
  dragTileId: string | null;
  dropLeftValid: boolean;
  dropRightValid: boolean;
  onDropTile: (tileId: string, side: "left" | "right") => void;
}

const MOCK_TILE: Tile = { id: "__mock", left: 0, right: 1 };

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
  const [stackSign] = useState<1 | -1>(() => (Math.random() < 0.5 ? 1 : -1));

  const layout = useMemo(
    () => computeLayout(tiles, stackSign),
    [tiles, stackSign]
  );

  // Simula el layout con una ficha ficticia insertada al inicio o al final
  // para calcular dónde quedaría la zona de drop (en el mismo grid real).
  const leftMock = useMemo(
    () => computeLayout([MOCK_TILE, ...tiles], stackSign),
    [tiles, stackSign]
  );
  const rightMock = useMemo(
    () => computeLayout([...tiles, MOCK_TILE], stackSign),
    [tiles, stackSign]
  );

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

      const wU = Math.max(layout.maxX - layout.minX, 1);
      const hU = Math.max(layout.maxY - layout.minY, 1);
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
  }, [layout, tiles.length]);

  const pickingUp = dragTileId !== null;
  const zoneClass = (valid: boolean) =>
    `board-drop${pickingUp ? ` visible ${valid ? "active" : "blocked"}` : ""}`;

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

  const realFirst = layout.placements[0];
  const realLast = layout.placements[layout.placements.length - 1];
  const lRef = leftMock.placements[1];
  const lNew = leftMock.placements[0];
  const leftZone = {
    x: lNew.x - (lRef.x - realFirst.x),
    y: lNew.y - (lRef.y - realFirst.y),
  };
  const rLastMock = rightMock.placements[rightMock.placements.length - 2];
  const rNewMock = rightMock.placements[rightMock.placements.length - 1];
  const rightZone = {
    x: rNewMock.x - (rLastMock.x - realLast.x),
    y: rNewMock.y - (rLastMock.y - realLast.y),
  };

  const toX = (u: number) => (u - layout.minX) * tileH;
  const toY = (u: number) => (u - layout.minY) * tileH;
  const layoutW = (layout.maxX - layout.minX) * tileH;
  const layoutH = (layout.maxY - layout.minY) * tileH;

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
        <div
          className={zoneClass(dropLeftValid)}
          style={{ left: toX(leftZone.x), top: toY(leftZone.y) }}
          aria-label="Colocar ficha a la izquierda"
          {...dropHandlers("left", onDropTile)}
        />
        {layout.placements.map((p, index) => {
          const tile = tiles[index];
          return (
            <div
              key={tile.id}
              className="board-cell"
              style={{
                left: toX(p.x),
                top: toY(p.y),
                transform: `translate(-50%, -50%) rotate(${p.rotation}deg)`,
              }}
            >
              <DominoTile
                tile={tile}
                size="board"
                orientation={p.orientation}
              />
            </div>
          );
        })}
        <div
          className={zoneClass(dropRightValid)}
          style={{ left: toX(rightZone.x), top: toY(rightZone.y) }}
          aria-label="Colocar ficha a la derecha"
          {...dropHandlers("right", onDropTile)}
        />
      </div>
    </div>
  );
}