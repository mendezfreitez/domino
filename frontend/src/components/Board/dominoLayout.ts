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

export interface ChainEnd {
  x: number;
  y: number;
  direction: Direction;
  connectionValue: number;
  hasTurned: boolean;
  turnDirection: TurnDirection;
  connectionSide: ConnectionSide;
  lastPlacementIndex: number;
}

export interface BoardConfig {
  mainLineLength: number;
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
  mainLineLength: 14,
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

export function shouldTurn(
  totalPlaced: number,
  end: ChainEnd,
  config: BoardConfig
): boolean {
  return !end.hasTurned && totalPlaced >= config.mainLineLength;
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
}

interface GeometryInput {
  tile: DominoTile;
  isDoubleTile: boolean;
  connValue: number;
  freeValue: number;
}

function computeGeometry(
  input: GeometryInput,
  end: ChainEnd,
  totalPlaced: number,
  config: BoardConfig,
  prev: PositionedTile | null
): Geometry {
  const prevIsDouble = prev !== null && isDouble(prev.tile);
  // El giro de 90° solo puede ejecutarse sobre una ficha NO doble conectada a
  // otra NO doble. Si al alcanzar el umbral toca girar en una ficha doble o en
  // una ficha inmediata a una doble, no se gira: la ficha se coloca recta y el
  // cruce se pospone hasta que aparezca una ficha válida (hasTurned sigue en
  // false y los siguientes tramos vuelven a intentarlo).
  const wantTurn =
    shouldTurn(totalPlaced, end, config) &&
    !input.isDoubleTile &&
    !prevIsDouble;

  if (wantTurn) {
    const direction = end.turnDirection;
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
    };
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
  const totalPlaced = builder.placements.length;
  const connValue = end.connectionValue;
  const freeValue = tile.left === connValue ? tile.right : tile.left;
  const g = computeGeometry(
    { tile, isDoubleTile: isDouble(tile), connValue, freeValue },
    end,
    totalPlaced,
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

  if (g.turned) end.hasTurned = true;
  end.direction = g.nextDirection;
  end.connectionValue = g.nextConnectionValue;
  end.connectionSide = CONNECTION_SIDE[g.nextDirection];
  end.x = g.nextX + (x - g.x);
  end.y = g.nextY + (y - g.y);
  end.lastPlacementIndex = builder.placements.length;
  builder.placements.push(placed);
  return placed;
}

export function predictNextPlacement(
  side: Side,
  layout: ChainLayout,
  config: BoardConfig = DEFAULT_CONFIG
): { x: number; y: number; orientation: Orientation } | null {
  const end = side === "left" ? layout.leftEnd : layout.rightEnd;
  if (!end) return null;
  const prevIdx = end.lastPlacementIndex;
  const prev =
    prevIdx >= 0 && prevIdx < layout.placements.length
      ? layout.placements[prevIdx]
      : null;
  const totalPlaced = layout.placements.length;
  const dummy: DominoTile = {
    id: "__drop",
    left: end.connectionValue,
    right: end.connectionValue,
  };
  const g = computeGeometry(
    {
      tile: dummy,
      isDoubleTile: false,
      connValue: end.connectionValue,
      freeValue: end.connectionValue,
    },
    end,
    totalPlaced,
    config,
    prev
  );
  return { x: g.x, y: g.y, orientation: g.orientation };
}

export function buildChainLayout(
  tiles: DominoTile[],
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

  const anchorIndex = Math.floor((tiles.length - 1) / 2);
  const anchor = tiles[anchorIndex];
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
      turnDirection: config.leftTurnDirection,
      connectionSide: "RIGHT",
      lastPlacementIndex: -1,
    },
    rightEnd: {
      x: anchorHalf,
      y: 0,
      direction: "RIGHT",
      connectionValue: anchor.right,
      hasTurned: false,
      turnDirection: config.rightTurnDirection,
      connectionSide: "LEFT",
      lastPlacementIndex: -1,
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

  for (let i = 1; i < tiles.length; i++) {
    const rightIdx = anchorIndex + i;
    const leftIdx = anchorIndex - i;
    if (rightIdx < tiles.length) placeTile(tiles[rightIdx], "right", builder, config);
    if (leftIdx >= 0) placeTile(tiles[leftIdx], "left", builder, config);
  }

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