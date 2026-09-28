import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import { DominoTile } from "../DominoTile/DominoTile";
import {
  builderToLayout,
  createChain,
  findAnchorIndex,
  placeTile,
  predictNextPlacement,
  replayChain,
  DEFAULT_CONFIG,
} from "./dominoLayout";
import type { ChainBuilder, ChainLayout, Side } from "./dominoLayout";
import "./Board.css";

const MIN_TILE_H = 42;
const MAX_TILE_H = 108;
const DEFAULT_TILE_H = 64;
const BOARD_PAD_X = 16;
const BOARD_PAD_Y = 12;
// Cabida reservada para una partida completa, en unidades de rejilla (una
// ficha horizontal mide 2): radio máximo medido del serpentín desde el ancla
// con la norma actual: ±22.24 en X y ±11.1 en Y; la cabida añade zonas de
// colocación (±1) y margen de render (±1) por lado antes de redondear.
const RESERVED_W_UNITS = 50;
const RESERVED_H_UNITS = 28;

// Área del serpentín, en "unidades" (una ficha horizontal mide 2 unidades de
// ancho). Norma de cruce: cada lado cuenta sus fichas desde la primera pieza
// (el ancla no cuenta); con 6 contadas, la 7ª colocación de la derecha gira
// hacia arriba y la 7ª de la izquierda hacia abajo (la ficha que cruza debe ser
// no doble; si la anterior es doble, cruza conectada al extremo libre de esa
// doble). Norma de reorientación: el tramo vertical cuenta 2 fichas (cruce + 1
// recta) y la 3ª vuelve a orientarse en horizontal (arriba → izquierda, abajo
// → derecha), solo si no es doble; excepción: si la 2ª ficha del tramo es
// doble, este lado cuenta una ficha más y la reorienta la 4ª. Así la altura
// queda acotada (~±3.5-4.5 unidades) y el crecimiento se traslada al eje
// horizontal.
//
// El render usa un ORIGEN FIJO (el centro del contenedor) y una escala fija por
// ronda: `tileH` se calcula UNA SOLA VEZ (al iniciar la ronda o al redimensionar
// la ventana) para que una partida completa entre en la cabida reservada la
// mesa (50×28 unidades) con ajuste "aspect-fit". Mientras crece la cadena, la
// escala y el origen NO cambian: las fichas ya colocadas conservan su posición
// en píxeles y no se reposicionan en cada jugada. Si una partida extrema o una
// ventana diminuta exceden la cabida, el contenedor permite desplazarse (scroll
// como reserva, no como solución principal).

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

/**
 * Centro de la cadena tal y como estaba cuando empezó la ronda: solo la ficha
 * ancla y las dos zonas de colocación, nada más.
 *
 * El marco se congela con ESE centro, no con el centro que tenga el tablero en
 * el momento de dibujarlo. La diferencia importa: en vivo el marco se fija al
 * abrir la ronda y la cadena crece alrededor del ancla; si al abrir una partida
 * a medias se centrara la cadena actual, el tablero entero se desplazaría
 * respecto de lo que ve el resto de la mesa. Como el ancla no se mueve en toda
 * la ronda, su centro de inicio siempre se puede volver a calcular, y el marco
 * sale idéntico al que ya tenían los demás.
 */
function roundStartCenter(anchor: Tile): { x: number; y: number } {
  const layout = builderToLayout(createChain(anchor, DEFAULT_CONFIG));
  let minX = layout.minX;
  let maxX = layout.maxX;
  let minY = layout.minY;
  let maxY = layout.maxY;
  for (const side of ["left", "right"] as const) {
    const zone = predictNextPlacement(side, layout, DEFAULT_CONFIG);
    if (!zone) continue;
    minX = Math.min(minX, zone.x - 1);
    maxX = Math.max(maxX, zone.x + 1);
    minY = Math.min(minY, zone.y - 1);
    maxY = Math.max(maxY, zone.y + 1);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

interface BoardProps {
  tiles: Tile[];
  /**
   * Ficha con la que empezó la ronda, tal y como la persiste el servidor.
   *
   * Es lo que permite que un tablero abierto a medias (página recargada,
   * reconexión o backend reiniciado) se dibuje exactamente igual que antes: sin
   * el ancla, la cadena se re-anclaría en su extremo izquierdo y todas las
   * fichas colocadas a la izquierda se recolocarían.
   */
  anchorId: string | null;
  dragTileId: string | null;
  dropLeftValid: boolean;
  dropRightValid: boolean;
  onDropTile: (tileId: string, side: "left" | "right") => void;
  estadoPartida: string;
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

// El marco (escala `tileH` y origen) se fija UNA SOLA VEZ por ronda y solo se
// recalcula al redimensionar la ventana o al iniciar una ronda nueva. NUNCA se
// recalcula al crecer el tablero: las fichas ya colocadas conservan su posición
// en píxeles mientras crece la cadena (no se reposicionan en cada jugada).
// `tileH` se calcula para que una partida completa (cabida máxima real del
// serpentín, medida con la norma actual: radio hasta ±22.3 en X y ±11.1 en Y,
// incluidas las zonas de colocación con margen) quepa en el área disponible del
// contenedor (ajuste "aspect-fit"). El origen queda fijo en el centro del
// contenedor: la tabla ocupa todo el alto y ancho posibles sin desbordar.
function toResolvedFrame(
  width: number,
  height: number,
  hasTiles: boolean,
  /**
   * Centro de la cadena en unidades de rejilla en el momento en que se dibuja
   * por primera vez. Sirve para colocar esa cadena centrada en la mesa: al
   * jugarse en vivo la cadena nace de la primera ficha y crece hacia los
   * extremos, pero al abrir una partida a medias (por ejemplo al reconectar
   * después de recargar) no hay historial que diga de qué lado crecía, y sin
   * este centro la cadena entera quedaría colgando de un lado del tablero.
   * Después se congela: las fichas ya colocadas nunca se mueven.
   */
  chainCenter: { x: number; y: number } | null
): Frame {
  if (!hasTiles) {
    return { tileH: DEFAULT_TILE_H, originX: width / 2, originY: height / 2 };
  }
  const availW = Math.max(width - BOARD_PAD_X * 2, 1);
  const availH = Math.max(height - BOARD_PAD_Y * 2, 1);
  const fit = Math.min(availW / RESERVED_W_UNITS, availH / RESERVED_H_UNITS);
  const tileH = Math.min(Math.max(fit, MIN_TILE_H), MAX_TILE_H);
  return {
    tileH,
    originX: width / 2 - (chainCenter?.x ?? 0) * tileH,
    originY: height / 2 - (chainCenter?.y ?? 0) * tileH,
  };
}

export function Board({
  tiles,
  anchorId,
  dragTileId,
  dropLeftValid,
  dropRightValid,
  onDropTile,
  estadoPartida,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const builderRef = useRef<ChainBuilder | null>(null);
  const processedRef = useRef<Tile[] | null>(null);
  const lastSideRef = useRef<Side | null>(null);
  /**
   * Marca que en este render la cadena se ha construido desde cero. Solo en ese
   * caso se recentra la mesa; si no, el marco congelado se respeta para que las
   * fichas ya colocadas no cambien de sitio en cada jugada.
   */
  const coldBuildRef = useRef(false);
  /** Centro de la cadena al empezar la ronda; ver `roundStartCenter`. */
  const roundCenterRef = useRef<{ x: number; y: number } | null>(null);
  /** Centro de la cadena ya fijado, para que el marco no vuelva a desplazarse. */
  const centerRef = useRef<{ x: number; y: number } | null>(null);
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
      coldBuildRef.current = true;
      return EMPTY_LAYOUT;
    }

    // Arranque en frío: la partida se abre a medias y no hay historial de
    // jugadas, así que se reproduce la cadena entera desde el ancla que
    // persistió el servidor. `placeTile` se llama en el mismo orden y con los
    // mismos lados que en vivo, así que cada ficha cae en su sitio.
    const rebuild = (): ChainBuilder => {
      const anchor = findAnchorIndex(tiles, anchorId);
      const builder = replayChain(tiles, Math.max(anchor, 0), DEFAULT_CONFIG);
      builderRef.current = builder;
      processedRef.current = tiles.slice();
      // La última jugada fue por el extremo contrario al ancla: se deja la
      // vista apuntando ahí, que es donde el jugador quiere seguir jugando.
      lastSideRef.current = anchor >= 0 && anchor < tiles.length - 1 ? "right" : "left";
      // El marco se congela con el centro que tenía la cadena al empezar la
      // ronda, no con el de ahora: así el tablero se dibuja en el mismo sitio
      // que en el de los que no recargaron. Sin ancla conocida (registro muy
      // antiguo) no se puede saber, y se usa el centro actual.
      roundCenterRef.current = anchor >= 0 ? roundStartCenter(tiles[anchor]) : null;
      coldBuildRef.current = true;
      return builder;
    };

    if (builderRef.current === null || processedRef.current === null) {
      return builderToLayout(rebuild());
    }

    let builder = builderRef.current;
    let prevTiles: Tile[] = processedRef.current;
    let prevIds = new Set(prevTiles.map((t) => t.id));
    let firstPrev = tiles.findIndex((t) => prevIds.has(t.id));
    if (firstPrev === -1) {
      // No coincide la cadena interior con el tablero recibido (reinicio
      // anómalo, p. ej. carga a mitad de partida): reconstruir desde el ancla
      // guardado, no desde la primera ficha recibida.
      return builderToLayout(rebuild());
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
  }, [tiles, anchorId]);

  const leftZone = useMemo(
    () => predictNextPlacement("left", layout, DEFAULT_CONFIG),
    [layout]
  );
  const rightZone = useMemo(
    () => predictNextPlacement("right", layout, DEFAULT_CONFIG),
    [layout]
  );

  // Los bounds de fichas + zonas determinan el tamaño del lienzo y las celdas
  // relativas a él. La escala del marco es FIJA por ronda (cabida reservada),
  // así que estos bounds no afectan a la posición en píxeles de las fichas ya
  // colocadas.
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

  // Marco fijo por ronda: la escala se calcula UNA SOLA VEZ (al iniciar la
  // ronda o al redimensionar la ventana) para que una partida completa quepa en
  // la cabida reservada. Mientras crece la cadena NUNCA se recalcula: las
  // fichas ya colocadas no se reposicionan ni se re-escalan en cada jugada.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    // Solo si en este render la cadena se construyó desde cero se fija el centro
    // de la mesa; después ese centro se conserva, de modo que las jugadas
    // siguientes no mueven nada de lo ya colocado.
    const coldBuild = coldBuildRef.current;
    coldBuildRef.current = false;

    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width <= 0 || height <= 0) return;
      if (tiles.length === 0) {
        centerRef.current = null;
        roundCenterRef.current = null;
      } else if (coldBuild) {
        // Se congela el marco con el centro de inicio de la ronda, que es el
        // mismo que se usó en vivo; si no se conoce (registro antiguo sin ancla)
        // se cae al centro de la cadena actual, que al menos la deja centrada.
        centerRef.current =
          roundCenterRef.current ?? {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          };
      }
      const next = toResolvedFrame(
        width,
        height,
        tiles.length > 0,
        centerRef.current
      );
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
  // píxeles absoluta de cada pieza sea `origin + p * tileH`; como el marco es
  // FIJO por ronda (escala y origen no cambian al crecer el tablero), las
  // fichas ya colocadas conservan exactamente su posición en píxeles, y cada
  // ficha nueva se añade en su posición definitiva.
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
        <div style={{ position: 'fixed', bottom: '37%', left: '35%', fontSize: '2.7rem', fontWeight: '700', opacity: '.7', width: '700px', textAlign: 'center' }}>
          {estadoPartida}
        </div>
      </div>
    </div>
  );
}