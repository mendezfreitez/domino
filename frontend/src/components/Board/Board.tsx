import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import {
  builderToLayout,
  createChain,
  predictNextPlacement,
  placeTile,
  DEFAULT_CONFIG,
} from "./dominoLayout";
import type { ChainBuilder, ChainLayout, Side } from "./dominoLayout";
import "./Board.css";

const MIN_TILE_H = 16;
const MAX_TILE_H = 108;
const DEFAULT_TILE_H = 64;
const BOARD_PAD_X = 16;
const BOARD_PAD_Y = 12;

// Área reservada del serpentín, en "medias fichas" (una ficha horizontal mide 2
// unidades de ancho). Norma de cruce: cada lado cuenta sus fichas desde la
// primera pieza (el ancla no cuenta); con 6 contadas, la 7ª colocación de la
// derecha gira hacia arriba y la 7ª de la izquierda hacia abajo (la ficha que
// cruza debe ser no doble; si la anterior es doble, cruza conectada al extremo
// libre de esa doble). Norma de reorientación: el tramo vertical cuenta
// 2 fichas (cruce + 1 recta) y la 3ª vuelve a orientarse en horizontal (arriba
// → izquierda, abajo → derecha), solo si no es doble; excepción: si la 2ª ficha
// del tramo es doble, este lado cuenta una ficha más y la reorienta la 4ª. Así
// la altura queda acotada (~±3.5-4.5 unidades) y el crecimiento se traslada al
// eje X: una partida completa de 28 fichas ocupa típicamente ~28-40 unidades de
// ancho y casi nunca necesita desplazamiento vertical. El marco de render se
// calcula una sola vez
// por ronda a partir de esta cabida: las fichas nunca se recolocan ni cambian de
// tamaño al crecer el tablero. Si una partida extrema o una ventana muy pequeña
// exceden la cabida, el contenedor permite desplazarse (scroll) sin mover
// fichas.
const RESERVED_W_UNITS = 40;
const RESERVED_H_UNITS = 28;
const TILE_SCALE = 2.6;

const EMPTY_LAYOUT: ChainLayout = {
  placements: [],
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  leftEnd: null,
  rightEnd: null,
};

interface Frame {
  tileH: number;
  originX: number;
  originY: number;
}

interface BoardProps {
  tiles: Tile[];
  dragTileId: string | null;
  dropLeftValid: boolean;
  dropRightValid: boolean;
  onDropTile: (tileId: string, side: "left" | "right") => void;
}

function dropHandlers(
  side: Side,
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

// El marco (escala `tileH` y origen) se fija una sola vez por ronda: se calcula
// del tamaño del contenedor y de la cabida reservada del serpentín. Nunca
// depende de los bounds actuales del tablero, por lo que las fichas ya
// dibujadas conservan exactamente su posición en píxeles mientras crece la
// cadena. Solo se recalcula al redimensionar la ventana o al reiniciar la ronda.
function toResolvedFrame(
  width: number,
  height: number,
  hasTiles: boolean
): Frame {
  const originX = width / 2;
  const originY = height / 2;
  if (!hasTiles) {
    return { tileH: DEFAULT_TILE_H, originX, originY };
  }
  const availW = Math.max(width - BOARD_PAD_X * 2, 1);
  const availH = Math.max(height - BOARD_PAD_Y * 2, 1);
  const fit = Math.min(availW / RESERVED_W_UNITS, availH / RESERVED_H_UNITS) * TILE_SCALE;
  return {
    tileH: Math.min(Math.max(fit, MIN_TILE_H), MAX_TILE_H),
    originX,
    originY,
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
  const builderRef = useRef<ChainBuilder | null>(null);
  const processedRef = useRef<Tile[] | null>(null);
  const lastSideRef = useRef<Side | null>(null);
  const [frame, setFrame] = useState<Frame>({
    tileH: DEFAULT_TILE_H,
    originX: 0,
    originY: 0,
  });

  // Layout incremental: la cadena se construye una sola vez con su ancla fija
  // (la primera ficha de la ronda, la "semilla") y solo se añaden las fichas
  // nuevas a los extremos. Las fichas ya colocadas conservan para siempre sus
  // coordenadas de rejilla: nunca se reordenan ni se re-anclan.
  const layout = useMemo<ChainLayout>(() => {
    if (tiles.length === 0) {
      builderRef.current = null;
      processedRef.current = null;
      lastSideRef.current = null;
      return EMPTY_LAYOUT;
    }

    const ensureInit = () => {
      if (builderRef.current === null || processedRef.current === null) {
        builderRef.current = createChain(tiles[0], DEFAULT_CONFIG);
        processedRef.current = [tiles[0]];
        lastSideRef.current = null;
      }
    };
    ensureInit();

    // Tras ensureInit, ambas referencias están garantizadas no-nulas.
    let builder = builderRef.current!;
    let prevTiles: Tile[] = processedRef.current!;
    let prevIds = new Set(prevTiles.map((t) => t.id));
    let firstPrev = tiles.findIndex((t) => prevIds.has(t.id));
    if (firstPrev === -1) {
      // No coincide la cadena interior con el tablero recibido (reinicio
      // anómalo, p. ej. carga a mitad de partida): reconstruir la cadena desde
      // la primera ficha recibida, que queda como ancla fija.
      builder = createChain(tiles[0], DEFAULT_CONFIG);
      builderRef.current = builder;
      processedRef.current = [tiles[0]];
      lastSideRef.current = null;
      prevTiles = [tiles[0]];
      prevIds = new Set(prevTiles.map((t) => t.id));
      firstPrev = 0;
    }

    const leftAdds = firstPrev > 0 ? tiles.slice(0, firstPrev) : [];
    let lastPrev = -1;
    for (let i = tiles.length - 1; i >= 0; i--) {
      if (prevIds.has(tiles[i].id)) {
        lastPrev = i;
        break;
      }
    }
    const rightAdds = lastPrev >= 0 ? tiles.slice(lastPrev + 1) : [];

    if (leftAdds.length > 0) lastSideRef.current = "left";
    if (rightAdds.length > 0) lastSideRef.current = "right";

    // Las fichas nuevas se colocan de dentro hacia fuera en cada extremo. En
    // el array recibido, las de la izquierda van de la más externa a la más
    // interna; por eso las de la izquierda se recorren en orden inverso.
    for (let i = leftAdds.length - 1; i >= 0; i--) {
      placeTile(leftAdds[i], "left", builder, DEFAULT_CONFIG);
    }
    for (const t of rightAdds) {
      placeTile(t, "right", builder, DEFAULT_CONFIG);
    }

    processedRef.current = tiles.slice();
    return builderToLayout(builder);
  }, [tiles]);

  const leftZone = useMemo(
    () => predictNextPlacement("left", layout, DEFAULT_CONFIG),
    [layout]
  );
  const rightZone = useMemo(
    () => predictNextPlacement("right", layout, DEFAULT_CONFIG),
    [layout]
  );

  // Los bounds de fichas + zonas solo determinan el tamaño del lienzo y las
  // celdas relativas a él. La posición en píxeles de cada pieza depende del
  // marco fijo (origen + escala), no de estos bounds.
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

  // Marco fijo: se calcula al inicio de la ronda y al redimensionar la ventana.
  // NUNCA se recalcula al crecer el tablero (solo cambia `tiles.length`, que al
  // pasar de 0 a 1 fija el marco para toda la ronda).
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width <= 0 || height <= 0) return;
      const next = toResolvedFrame(width, height, tiles.length > 0);
      setFrame((prev) =>
        prev.tileH === next.tileH &&
        prev.originX === next.originX &&
        prev.originY === next.originY
          ? prev
          : next
      );
      if (tiles.length === 0) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tiles.length]);

  // Sigue el último extremo jugado: solo desplaza la VISTA (scroll) si la zona
  // queda fuera del área visible. Las fichas en sí nunca se mueven.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el || tiles.length === 0) return;
    const zone = lastSideRef.current === "left" ? leftZone : rightZone;
    if (!zone) return;
    const px = frame.originX + zone.x * frame.tileH;
    const py = frame.originY + zone.y * frame.tileH;
    const margin = frame.tileH;
    const vx = px - el.scrollLeft;
    const vy = py - el.scrollTop;
    if (vx < margin || vx > el.clientWidth - margin) {
      el.scrollLeft = Math.max(0, px - el.clientWidth / 2);
    }
    if (vy < margin || vy > el.clientHeight - margin) {
      el.scrollTop = Math.max(0, py - el.clientHeight / 2);
    }
  }, [layout, frame, leftZone, rightZone]);

  const pickingUp = dragTileId !== null;
  const zoneClass = (valid: boolean) =>
    `board-drop${pickingUp ? ` visible ${valid ? "active" : "blocked"}` : ""}`;

  if (tiles.length === 0) {
    return (
      <div
        ref={boardRef}
        className={`board board-empty${dragTileId ? " drop-active" : ""}`}
        style={{ "--board-tile-h": `${frame.tileH}px` } as CSSProperties}
        data-drop-side="left"
        {...dropHandlers("left", onDropTile)}
      >
        <p>El tablero está vacío. Arrastra una ficha aquí.</p>
      </div>
    );
  }

  const th = frame.tileH;
  // Posición relativa al lienzo. El lienzo se sitúa de modo que la posición en
  // píxeles absoluta de cada pieza sea `origin + p * tileH`, que no cambia al
  // crecer el tablero (los desplazamientos del lienzo se compensan con los de
  // la celda).
  const toX = (u: number) => (u - bounds.minX + 1) * th;
  const toY = (u: number) => (u - bounds.minY + 1) * th;
  const layoutW = (bounds.maxX - bounds.minX + 2) * th;
  const layerLeft = frame.originX + (bounds.minX - 1) * th;
  const layerTop = frame.originY + (bounds.minY - 1) * th;

  const zoneStyle = (zone: { x: number; y: number }) => {
    const side = 2 * th;
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
      style={{ "--board-tile-h": `${th}px` } as CSSProperties}  
    >
      <div
        className="board-layer"
        style={{
          width: layoutW,
          // height: layoutH,
          left: layerLeft,
          top: layerTop,
        }}
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