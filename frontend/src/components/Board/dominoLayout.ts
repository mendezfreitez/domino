import type { DominoTile } from "../../types/Domino";

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type TurnDirection = "UP" | "DOWN";
export type Orientation = "horizontal" | "vertical";
export type Side = "left" | "right";
export type ConnectionSide = "LEFT" | "RIGHT" | "TOP" | "BOTTOM";

export interface PositionedTile {
  tile: DominoTile;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  direction: Direction;
  orientation: Orientation;
  connectionSide: ConnectionSide;
  displayLeft: number;
  displayRight: number;
}

/** Previsión de la siguiente ficha sin mutar la cadena. */
export interface PredictedPlacement {
  x: number;
  y: number;
  orientation: Orientation;
  connectionSide: ConnectionSide;
  displayLeft: number;
  displayRight: number;
}

export interface ChainEnd {
  x: number;
  y: number;
  direction: Direction;
  connectionValue: number;
  hasTurned: boolean;
  /** La reorientación (2º giro del tramo vertical hacia la horizontal). */
  hasReoriented: boolean;
  /** Fichas colocadas en el tramo vertical desde el cruce (incluido el cruce). */
  segCount: number;
  /**
   * El tramo vertical ya contiene una ficha doble. En ese caso la ficha que
   * reorienta se coloca al ras del costado del antecedente no doble (ver
   * `reorientGeometry`), no fuera de su punta.
   */
  hasDoubleInSegment: boolean;
  turnDirection: TurnDirection;
  connectionSide: ConnectionSide;
  lastPlacementIndex: number;
  /** Fichas colocadas en este lado desde la primera pieza (el ancla no cuenta). */
  countFromAnchor: number;
}

export interface BoardConfig {
  turnLimitPerSide: number;
  /**
   * Fichas colocadas en el tramo vertical (cruce incluido) antes de intentar
   * reorientar; con el valor por defecto (2) el tramo dura cruce + 1 recta y la
   * 3ª ficha intenta volver a horizontal. La cuenta es solo un mínimo: si la
   * separación con la línea principal no da, la ficha va recta y el giro se
   * pospone.
   */
  reorientLimit: number;
  /**
   * Hueco mínimo, en unidades de rejilla, entre la banda de la línea principal y
   * la de la línea secundaria. Se mide entre bordes y contando los dobles de
   * ambas: la principal ocupa y = 0 con dobles que llegan a ±1, y la secundaria
   * corre sobre el eje `y` con dobles que llegan a `|y| - 1`. Para que el hueco
   * sea de `lineSeparation` hace falta `|y| >= lineSeparation + 2`.
   *
   * 2 unidades = 1 ficha (una ficha mide 2 de largo y 1 de grosor): es el piso
   * que nunca se baja. En la práctica el hueco suele quedar en 2.5–3.5 unidades.
   */
  lineSeparation: number;
  tileGap: number;
  rightTurnDirection: TurnDirection;
  leftTurnDirection: TurnDirection;
}

export interface ChainLayout {
  placements: PositionedTile[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  leftEnd: ChainEnd | null;
  rightEnd: ChainEnd | null;
}

export interface ChainBuilder {
  placements: PositionedTile[];
  leftEnd: ChainEnd;
  rightEnd: ChainEnd;
}

export const DEFAULT_CONFIG: BoardConfig = {
  // 6 fichas contadas en cada lado: la 7ª que se coloque en ese lado cruza.
  turnLimitPerSide: 5,
  // El tramo vertical intenta el 2º giro con, como mínimo, cruce + 1 recta
  // (2 fichas contadas); la 3ª del tramo es la que reorienta si hay hueco.
  reorientLimit: 1,
  // Hueco mínimo entre línea principal y línea secundaria: 2 unidades = 1
  // ficha, contando los dobles de ambas líneas (piso estructural).
  lineSeparation: 1,
  tileGap: 0.02,
  rightTurnDirection: "UP",
  leftTurnDirection: "DOWN",
};

const UNIT_VECTORS: Record<Direction, { x: number; y: number }> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

const CONNECTION_SIDE: Record<Direction, ConnectionSide> = {
  RIGHT: "LEFT",
  LEFT: "RIGHT",
  UP: "BOTTOM",
  DOWN: "TOP",
};

// Mediaaltura de la banda que ocupa una línea con sus dobles: una doble en
// línea horizontal se dibuja vertical y sobresale 1 unidad a cada lado del eje.
// La línea principal pasa por y = 0, así que sus dobles llegan a ±1.
const LINE_BAND_HALF = 1;

export function isDouble(tile: DominoTile): boolean {
  return tile.left === tile.right;
}

export function canConnect(tile: DominoTile, value: number): boolean {
  return tile.left === value || tile.right === value;
}

export function createDominoSet(): DominoTile[] {
  const tiles: DominoTile[] = [];
  for (let left = 0; left <= 6; left++) {
    for (let right = left; right <= 6; right++) {
      tiles.push({ id: `${left}-${right}`, left, right });
    }
  }
  return tiles;
}

export function getTileOrientation(direction: Direction): Orientation {
  return direction === "LEFT" || direction === "RIGHT"
    ? "horizontal"
    : "vertical";
}

export function getTurnDirection(side: Side, config: BoardConfig): TurnDirection {
  return side === "right" ? config.rightTurnDirection : config.leftTurnDirection;
}

// La norma de cruce se cuenta por lado, desde la primera pieza (el ancla no
// cuenta): cuando un lado tiene `turnLimitPerSide` fichas contadas, la
// siguiente ficha que se coloque en ese lado intenta girar (derecha → arriba,
// izquierda → abajo). El giro se evalúa con el conteo previo a la colocación,
// de modo que la 7ª ficha del lado (con 6 ya contadas) es la que cruza.
export function shouldTurn(
  countFromAnchor: number,
  end: ChainEnd,
  config: BoardConfig
): boolean {
  return !end.hasTurned && countFromAnchor >= config.turnLimitPerSide;
}

export function checkCollision(
  candidate: { x: number; y: number; w: number; h: number },
  placements: readonly PositionedTile[]
): boolean {
  const cX0 = candidate.x - candidate.w / 2;
  const cX1 = candidate.x + candidate.w / 2;
  const cY0 = candidate.y - candidate.h / 2;
  const cY1 = candidate.y + candidate.h / 2;
  for (const p of placements) {
    const w = p.orientation === "horizontal" ? 2 : 1;
    const h = p.orientation === "horizontal" ? 1 : 2;
    const pX0 = p.x - w / 2;
    const pX1 = p.x + w / 2;
    const pY0 = p.y - h / 2;
    const pY1 = p.y + h / 2;
    const overlapsX = cX0 < pX1 - 1e-9 && cX1 > pX0 + 1e-9;
    const overlapsY = cY0 < pY1 - 1e-9 && cY1 > pY0 + 1e-9;
    if (overlapsX && overlapsY) return true;
  }
  return false;
}

interface Geometry {
  x: number;
  y: number;
  orientation: Orientation;
  direction: Direction;
  connectionSide: ConnectionSide;
  nextX: number;
  nextY: number;
  nextDirection: Direction;
  nextConnectionValue: number;
  turned: boolean;
  /** La ficha ejecuta la reorientación horizontal (2º giro del tramo vertical). */
  reoriented: boolean;
}

interface GeometryInput {
  tile: DominoTile;
  isDoubleTile: boolean;
  connValue: number;
  freeValue: number;
}

/**
 * Geometría de la reorientación (2º giro): el tramo vertical pasa a horizontal.
 *
 * La ficha que gira se conecta por la cara libre de la última ficha del tramo y
 * queda FUERA del extremo, sin acercarse a la línea principal:
 *
 * * Antecedente no doble (cara de punta de 1 u): contacto rasante. La arista
 *   larga de la ficha nueva se apoya en la cara de la punta —cubriéndola
 *   entera— y la pieza se desplaza media casilla hacia la dirección del giro
 *   (izquierda en `UP → LEFT`, derecha en `DOWN → RIGHT`), con la cara contraria
 *   al giro alineada con el costado del tramo.
 * * Antecedente doble perpendicular (en un tramo vertical se dibuja horizontal):
 *   contacto de extremo a extremo. La ficha nueva se coloca en el EXTREMO de la
 *   doble hacia el que gira la cadena (extremo izquierdo en `UP → LEFT`, derecho
 *   en `DOWN → RIGHT`), a la misma altura que la doble, con su cara de 1 u contra
 *   la cara de 1 u del extremo. Nunca se apoya sobre la cara ancha de la doble:
 *   eso la dejaría "al lado" de ella, no en su extremo.
 * * Tramo que ya contiene una doble y la reorientación se pospuso más allá de
 *   una ficha no doble: la ficha nueva se coloca AL RAS del costado del
 *   antecedente no doble —a la altura de su mitad libre (superior en `UP`,
 *   inferior en `DOWN`)— en vez de fuera de su punta. Así la línea secundaria
 *   no gana una altura extra por el tramo que ya abrió la doble.
 *
 * La ficha devuelta ocupa el eje de la línea secundaria que nace aquí (`y` del
 * resultado), eje que todas las fichas posteriores del tramo horizontal
 * conservan.
 */
function reorientGeometry(
  end: ChainEnd,
  prev: PositionedTile | null,
  freeValue: number,
  tileGap: number
): Geometry {
  const up = end.direction === "UP";
  const direction: Direction = up ? "LEFT" : "RIGHT";
  // Una doble perpendicular al tramo vertical se dibuja horizontal: es el único
  // caso en que el antecedente ocupa 2 u de ancho.
  const prevWideFace = prev !== null && prev.orientation === "horizontal";
  let cx: number;
  let cy: number;
  if (prevWideFace) {
    // Conexión por el extremo de la doble: la ficha nueva arranca en su cara
    // corta y sigue hacia el lado del giro, sobre el mismo eje que la doble.
    cx = prev!.x + (up ? -1 : 1) * (2 + tileGap);
    cy = prev!.y;
  } else if (end.hasDoubleInSegment && prev) {
    // El tramo ya abrió una doble y el giro se pospuso más allá de una no doble:
    // la ficha se apoya en el costado de esa no doble, a la altura de su mitad
    // libre, con el borde superior/inferior al ras del tramo. No se sube una
    // ficha más allá de la punta.
    cx = prev.x + (up ? -1 : 1) * (1.5 + tileGap);
    cy = prev.y + (up ? -0.5 : 0.5);
  } else {
    // Rasante con la punta del tramo: el borde de la ficha nueva toca la cara
    // libre del antecedente y la pieza queda un paso más allá, hacia fuera.
    cx = up ? end.x - 0.5 : end.x + 0.5;
    cy = up ? end.y - 0.5 : end.y + 0.5;
  }
  return {
    x: cx,
    y: cy,
    orientation: "horizontal",
    direction,
    connectionSide: CONNECTION_SIDE[direction],
    nextX: up ? cx - 1 : cx + 1,
    nextY: cy,
    nextDirection: direction,
    nextConnectionValue: freeValue,
    turned: false,
    reoriented: true,
  };
}

function computeGeometry(
  input: GeometryInput,
  end: ChainEnd,
  countFromAnchor: number,
  config: BoardConfig,
  prev: PositionedTile | null
): Geometry {
  const prevIsDouble = prev !== null && isDouble(prev.tile);
  // El giro de 90° solo puede ejecutarse sobre una ficha NO doble: si al
  // alcanzar el umbral toca girar en una ficha doble, esa ficha se coloca recta
  // y el cruce se pospone hasta que aparezca una ficha no doble (hasTurned
  // sigue en false y los siguientes tramos vuelven a intentarlo). Si la ficha
  // anterior a la que cruza es doble (en cadena horizontal se dibuja
  // perpendicular, en "T"), el cruce sí se ejecuta y la ficha se conecta con el
  // extremo libre de esa doble (superior para UP, inferior para DOWN).
  const wantTurn =
    shouldTurn(countFromAnchor, end, config) && !input.isDoubleTile;

  if (wantTurn) {
    const direction = end.turnDirection;
    if (prevIsDouble && prev) {
      // Conexión al extremo libre de la doble (no al lateral): la doble, que en
      // cadena horizontal se dibuja vertical (1×2), deja libre el extremo
      // superior (UP) o inferior (DOWN) según la dirección del cruce.
      if (direction === "UP") {
        return {
          x: prev.x,
          y: prev.y - 2,
          orientation: "vertical",
          direction,
          connectionSide: "BOTTOM",
          nextX: prev.x,
          nextY: prev.y - 3,
          nextDirection: direction,
          nextConnectionValue: input.freeValue,
          turned: true,
          reoriented: false,
        };
      }
      return {
        x: prev.x,
        y: prev.y + 2,
        orientation: "vertical",
        direction,
        connectionSide: "TOP",
        nextX: prev.x,
        nextY: prev.y + 3,
        nextDirection: direction,
        nextConnectionValue: input.freeValue,
        turned: true,
        reoriented: false,
      };
    }
    const o = end.direction === "RIGHT" ? 1 : -1;
    if (direction === "UP") {
      return {
        x: end.x + o * 0.5,
        y: end.y - 0.5,
        orientation: "vertical",
        direction,
        connectionSide: "BOTTOM",
        nextX: end.x + o * 0.5,
        nextY: end.y - 1.5,
        nextDirection: direction,
        nextConnectionValue: input.freeValue,
        turned: true,
        reoriented: false,
      };
    }
    return {
      x: end.x + o * 0.5,
      y: end.y + 0.5,
      orientation: "vertical",
      direction,
      connectionSide: "TOP",
      nextX: end.x + o * 0.5,
      nextY: end.y + 1.5,
      nextDirection: direction,
      nextConnectionValue: input.freeValue,
      turned: true,
      reoriented: false,
    };
  }

  // Reorientación (2º giro): una vez cruzado, el tramo vertical lleva
  // `reorientLimit` fichas (incluido el cruce, que es la 1ª); con el valor por
  // defecto (2) la 3ª ficha del tramo intenta volver a orientarse en horizontal
  // (derecha: arriba → izquierda; izquierda: abajo → derecha).
  //
  // NORMA DE SEPARACIÓN: la reorientación solo se ejecuta si la línea
  // secundaria que nace con ella deja, como mínimo, `lineSeparation` unidades
  // de hueco libre respecto de la línea principal (dobles de ambas incluidos,
  // es decir 1 ficha de piso). Si no hay hueco, la ficha se coloca recta en el
  // tramo vertical y el giro queda pospuesto a la siguiente ficha del tramo.
  // Así la separación está garantizada por construcción, aunque en el tramo
  // haya dobles.
  const wantReorient =
    end.hasTurned &&
    !end.hasReoriented &&
    end.segCount >= config.reorientLimit &&
    !input.isDoubleTile;

  if (wantReorient) {
    const candidate = reorientGeometry(
      end,
      prev,
      input.freeValue,
      config.tileGap
    );
    const clear =
      Math.abs(candidate.y) - LINE_BAND_HALF - LINE_BAND_HALF;
    if (clear >= config.lineSeparation) return candidate;
  }

  const direction = end.direction;
  const chainOrientation = getTileOrientation(direction);
  let orientation: Orientation;
  if (input.isDoubleTile && prevIsDouble) {
    orientation = prev!.orientation === "horizontal" ? "vertical" : "horizontal";
  } else if (input.isDoubleTile) {
    orientation = chainOrientation === "horizontal" ? "vertical" : "horizontal";
  } else {
    orientation = chainOrientation;
  }

  const alongHalf = orientation === chainOrientation ? 1 : 0.5;
  const u = UNIT_VECTORS[direction];
  let originX: number;
  let originY: number;
  if (prev) {
    const prevAlongHalf = prev.orientation === chainOrientation ? 1 : 0.5;
    originX = prev.x + prevAlongHalf * u.x;
    originY = prev.y + prevAlongHalf * u.y;
  } else {
    originX = end.x;
    originY = end.y;
  }

  const move = alongHalf + config.tileGap;
  const x = originX + move * u.x;
  const y = originY + move * u.y;
  const nextX = x + alongHalf * u.x;
  const nextY = y + alongHalf * u.y;

  return {
    x,
    y,
    orientation,
    direction,
    connectionSide: CONNECTION_SIDE[direction],
    nextX,
    nextY,
    nextDirection: direction,
    nextConnectionValue: input.freeValue,
    turned: false,
    reoriented: false,
  };
}

function buildPositionedTile(
  tile: DominoTile,
  g: Omit<Geometry, "nextX" | "nextY" | "nextConnectionValue" | "nextDirection">,
  connValue: number
): PositionedTile {
  const connIsLeft = tile.left === connValue;
  const conn = connIsLeft ? tile.left : tile.right;
  const free = connIsLeft ? tile.right : tile.left;
  const swap = g.direction === "LEFT" || g.direction === "UP";
  return {
    tile,
    x: g.x,
    y: g.y,
    rotation: 0,
    direction: g.direction,
    orientation: g.orientation,
    connectionSide: g.connectionSide,
    displayLeft: swap ? free : conn,
    displayRight: swap ? conn : free,
  };
}

export function placeTile(
  tile: DominoTile,
  side: Side,
  builder: ChainBuilder,
  config: BoardConfig = DEFAULT_CONFIG
): PositionedTile {
  const end = side === "left" ? builder.leftEnd : builder.rightEnd;
  const prevIdx = end.lastPlacementIndex;
  const prev =
    prevIdx >= 0 && prevIdx < builder.placements.length
      ? builder.placements[prevIdx]
      : null;
  const sideCount = end.countFromAnchor;
  const connValue = end.connectionValue;
  const freeValue = tile.left === connValue ? tile.right : tile.left;
  const g = computeGeometry(
    { tile, isDoubleTile: isDouble(tile), connValue, freeValue },
    end,
    sideCount,
    config,
    prev
  );

  let x = g.x;
  let y = g.y;
  const w = g.orientation === "horizontal" ? 2 : 1;
  const h = g.orientation === "horizontal" ? 1 : 2;
  if (checkCollision({ x, y, w, h }, builder.placements)) {
    const u = UNIT_VECTORS[g.direction];
    for (let attempt = 1; attempt <= 10; attempt++) {
      const nx = g.x + u.x * attempt;
      const ny = g.y + u.y * attempt;
      if (!checkCollision({ x: nx, y: ny, w, h }, builder.placements)) {
        x = nx;
        y = ny;
        break;
      }
    }
  }

  const placed = buildPositionedTile(
    tile,
    { ...g, x, y },
    connValue
  );

  if (g.turned) {
    end.hasTurned = true;
    // El cruce es la 1ª ficha del tramo vertical; las siguientes rectas van
    // sumando hasta que `segCount` alcanza el límite de reorientación.
    end.segCount += 1;
  } else if (g.reoriented) {
    end.hasReoriented = true;
  } else if (end.hasTurned && !end.hasReoriented) {
    // Ficha recta del tramo: sigue sumando hasta que toque reorientar (la cuenta
    // llega a `reorientLimit` y la línea secundaria deja el hueco mínimo).
    end.segCount += 1;
  }
  if (end.hasTurned && !end.hasReoriented && isDouble(tile)) {
    // La doble del tramo condiciona la colocación de la ficha que reorienta.
    end.hasDoubleInSegment = true;
  }
  end.direction = g.nextDirection;
  end.connectionValue = g.nextConnectionValue;
  end.connectionSide = CONNECTION_SIDE[g.nextDirection];
  end.x = g.nextX + (x - g.x);
  end.y = g.nextY + (y - g.y);
  end.lastPlacementIndex = builder.placements.length;
  builder.placements.push(placed);
  end.countFromAnchor = sideCount + 1;
  return placed;
}

/**
 * Geometría de la siguiente ficha en un extremo.
 *
 * Sin `tile` devuelve solo la zona genérica de colocación (la que usa el
 * tablero para calcular bounds y dibujar el hueco). Con `tile`, usa la ficha
 * real —dobles incluidos— y devuelve también la orientación y las caras que
 * tendrá al soltarse, para que el fantasma del arrastre pueda mostrar ya la
 * cara que conecta con la cadena.
 */
export function predictNextPlacement(
  side: Side,
  layout: ChainLayout,
  config: BoardConfig = DEFAULT_CONFIG,
  tile?: DominoTile
): PredictedPlacement | null {
  const end = side === "left" ? layout.leftEnd : layout.rightEnd;
  if (!end) return null;
  const prevIdx = end.lastPlacementIndex;
  const prev =
    prevIdx >= 0 && prevIdx < layout.placements.length
      ? layout.placements[prevIdx]
      : null;
  const connValue = end.connectionValue;
  const actual: DominoTile =
    tile ??
    {
      id: "__drop",
      left: connValue,
      right: connValue,
    };
  const freeValue =
    tile === undefined
      ? connValue
      : tile.left === connValue
        ? tile.right
        : tile.left;
  const g = computeGeometry(
    {
      tile: actual,
      // La ficha ficticia de la zona se trata como no doble: la zona es la
      // misma para cualquier ficha y no debe cambiar de orientación por ella.
      isDoubleTile: tile === undefined ? false : isDouble(tile),
      connValue,
      freeValue,
    },
    end,
    end.countFromAnchor,
    config,
    prev
  );
  const placed = buildPositionedTile(actual, g, connValue);
  return {
    x: g.x,
    y: g.y,
    orientation: g.orientation,
    connectionSide: g.connectionSide,
    displayLeft: placed.displayLeft,
    displayRight: placed.displayRight,
  };
}

/**
 * Adapta una previsión al modo móvil rotado 90°.
 *
 * La mesa se dibuja girada un cuarto de vuelta, así que el fantasma debe usar
 * la orientación equivalente en pantalla y el orden de caras que deje la cara
 * que conecta en el mismo extremo visual que tendrá al colocarse.
 */
export function toRotatedView(
  orientation: Orientation,
  displayLeft: number,
  displayRight: number,
  rotated: boolean
): { orientation: Orientation; displayLeft: number; displayRight: number } {
  if (!rotated) return { orientation, displayLeft, displayRight };
  if (orientation === "horizontal") {
    // horizontal lógica -> vertical en pantalla; izquierda -> arriba.
    return { orientation: "vertical", displayLeft, displayRight };
  }
  // vertical lógica -> horizontal en pantalla; arriba -> derecha, abajo ->
  // izquierda, así que se intercambian las caras para conservar el sentido.
  return {
    orientation: "horizontal",
    displayLeft: displayRight,
    displayRight: displayLeft,
  };
}

export function builderToLayout(builder: ChainBuilder): ChainLayout {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of builder.placements) {
    const w = p.orientation === "horizontal" ? 2 : 1;
    const h = p.orientation === "horizontal" ? 1 : 2;
    minX = Math.min(minX, p.x - w / 2);
    maxX = Math.max(maxX, p.x + w / 2);
    minY = Math.min(minY, p.y - h / 2);
    maxY = Math.max(maxY, p.y + h / 2);
  }

  return {
    placements: builder.placements,
    minX,
    maxX,
    minY,
    maxY,
    leftEnd: builder.leftEnd,
    rightEnd: builder.rightEnd,
  };
}

/**
 * Crea una cadena nueva con la ficha dada como ancla. El ancla permanece fija
 * durante toda la ronda: las fichas posteriores solo se añaden a los extremos
 * con `placeTile`, de modo que ninguna ficha ya colocada cambia de posición.
 */
export function createChain(
  anchor: DominoTile,
  config: BoardConfig = DEFAULT_CONFIG
): ChainBuilder {
  const anchorIsDouble = isDouble(anchor);
  const anchorOrientation: Orientation = anchorIsDouble
    ? "vertical"
    : "horizontal";
  const anchorHalf = anchorOrientation === "horizontal" ? 1 : 0.5;

  const builder: ChainBuilder = {
    placements: [],
    leftEnd: {
      x: -anchorHalf,
      y: 0,
      direction: "LEFT",
      connectionValue: anchor.left,
      hasTurned: false,
      hasReoriented: false,
      segCount: 0,
      hasDoubleInSegment: false,
      turnDirection: config.leftTurnDirection,
      connectionSide: "RIGHT",
      lastPlacementIndex: -1,
      countFromAnchor: 0,
    },
    rightEnd: {
      x: anchorHalf,
      y: 0,
      direction: "RIGHT",
      connectionValue: anchor.right,
      hasTurned: false,
      hasReoriented: false,
      segCount: 0,
      hasDoubleInSegment: false,
      turnDirection: config.rightTurnDirection,
      connectionSide: "LEFT",
      lastPlacementIndex: -1,
      countFromAnchor: 0,
    },
  };

  builder.placements.push({
    tile: anchor,
    x: 0,
    y: 0,
    rotation: 0,
    direction: "RIGHT",
    orientation: anchorOrientation,
    connectionSide: "RIGHT",
    displayLeft: anchor.left,
    displayRight: anchor.right,
  });
  builder.leftEnd.lastPlacementIndex = 0;
  builder.rightEnd.lastPlacementIndex = 0;

  return builder;
}

/**
 * Reconstruye la cadena de un tablero completo, con el ancla en el índice dado.
 *
 * `tiles` viene ordenado de izquierda a derecha, así que la reproducción es
 * directa: desde el ancla, el brazo derecho hacia fuera y el brazo izquierdo
 * hacia dentro. El resultado es idéntico al que se obtiene jugando ficha a
 * ficha, porque `placeTile` se llama en el mismo orden y con los mismos lados.
 */
export function replayChain(
  tiles: readonly DominoTile[],
  anchorIndex: number,
  config: BoardConfig = DEFAULT_CONFIG
): ChainBuilder {
  const index = clamp(anchorIndex, 0, Math.max(tiles.length - 1, 0));
  const builder = createChain(tiles[index], config);
  for (let i = index + 1; i < tiles.length; i++) {
    placeTile(tiles[i], "right", builder, config);
  }
  for (let i = index - 1; i >= 0; i--) {
    placeTile(tiles[i], "left", builder, config);
  }
  return builder;
}

/**
 * Igual que `replayChain`, pero devuelve el layout ya calculado, listo para
 * dibujar. Se usa al abrir una partida a medias: el servidor envía el tablero
 * junto con el ancla de la cadena, y con ella cada ficha vuelve a la posición
 * que tenía cuando se recargó la página.
 *
 * Si el ancla no está en el tablero (registro antiguo que no lo guardaba), se
 * usa la primera ficha y todo crece hacia la derecha.
 */
export function replayBoardLayout(
  tiles: readonly DominoTile[],
  anchorId: string | null,
  config: BoardConfig = DEFAULT_CONFIG
): ChainLayout {
  if (tiles.length === 0) {
    return {
      placements: [],
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      leftEnd: null,
      rightEnd: null,
    };
  }
  const found = findAnchorIndex(tiles, anchorId);
  return builderToLayout(replayChain(tiles, found < 0 ? 0 : found, config));
}

/** Índice del ancla dentro de un tablero ordenado, o -1 si no está. */
export function findAnchorIndex(
  tiles: readonly DominoTile[],
  anchorId: string | null
): number {
  if (anchorId === null) return -1;
  return tiles.findIndex((t) => t.id === anchorId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
