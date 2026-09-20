import type { DragEvent, MouseEvent } from "react";
import type { DominoTile as Tile } from "../../types/Domino";
import "./DominoTile.css";

type Orientation = "vertical" | "horizontal";

const HALF = 72;
const PADDING = 14;
const STEP = (HALF - 2 * PADDING) / 2;
const DOT_RADIUS = 6.5;
const DIVIDER_INSET = 6;

const PIP_POSITIONS: Record<number, [number, number][]> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function PipHalf({ value, x, y }: { value: number; x: number; y: number }) {
  return (
    <g>
      {(PIP_POSITIONS[value] ?? []).map(([col, row], index) => (
        <circle
          key={index}
          className="tile-pip"
          cx={x + PADDING + col * STEP}
          cy={y + PADDING + row * STEP}
          r={DOT_RADIUS}
        />
      ))}
    </g>
  );
}

interface TileSvgProps {
  left: number;
  right: number;
  orientation: Orientation;
}

function TileSvg({ left, right, orientation }: TileSvgProps) {
  const vertical = orientation === "vertical";
  const viewWidth = vertical ? HALF : HALF * 2;
  const viewHeight = vertical ? HALF * 2 : HALF;
  const transform = vertical ? undefined : `rotate(-90) translate(${-HALF} 0)`;

  return (
    <svg
      className="tile-svg"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      focusable="false"
      aria-hidden="true"
    >
      <g transform={transform}>
        <rect
          className="tile-face"
          x="1"
          y="1"
          width={HALF - 2}
          height={HALF * 2 - 2}
          rx="10"
          ry="10"
        />
        <PipHalf value={left} x={0} y={0} />
        <PipHalf value={right} x={0} y={HALF} />
        <line
          className="tile-divider"
          x1={DIVIDER_INSET}
          y1={HALF}
          x2={HALF - DIVIDER_INSET}
          y2={HALF}
        />
      </g>
    </svg>
  );
}

interface DominoTileProps {
  tile: Tile;
  size?: "hand" | "board";
  orientation?: Orientation;
  playable?: boolean;
  disabled?: boolean;
  draggable?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}

export function DominoTile({
  tile,
  size = "hand",
  orientation = "vertical",
  playable = false,
  disabled = false,
  draggable = false,
  dimmed = false,
  onClick,
  onMouseDown,
  onDragStart,
  onDragEnd,
}: DominoTileProps) {
  const classes = [
    "domino-tile",
    `size-${size}`,
    `orientation-${orientation}`,
    playable ? "playable" : "",
    // disabled ? "disabled" : "",
    disabled ? "" : "",
    onClick ? "clickable" : "",
    // draggable ? "drag-source" : "",
    draggable ? "" : "",
    dimmed ? "dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const label = `Ficha ${tile.left} ${tile.right}`;
  const face = (
    <TileSvg left={tile.left} right={tile.right} orientation={orientation} />
  );

  if (onMouseDown) {
    return (
      <div
        className={classes}
        onMouseDown={onMouseDown}
        role="img"
        aria-label={label}
      >
        {face}
      </div>
    );
  }

  if (draggable) {
    return (
      <div
        className={classes}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        role="img"
        aria-label={label}
      >
        {face}
      </div>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {face}
      </button>
    );
  }

  return (
    <span className={classes} role="img" aria-label={label}>
      {face}
    </span>
  );
}