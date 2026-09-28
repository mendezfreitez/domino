import assert from "node:assert/strict";
import test from "node:test";
import type { DominoTile } from "../../types/Domino.ts";
import {
  builderToLayout,
  createChain,
  findAnchorIndex,
  placeTile,
  replayBoardLayout,
  replayChain,
  DEFAULT_CONFIG,
} from "./dominoLayout.ts";
import type { ChainBuilder, ChainLayout, Side } from "./dominoLayout.ts";

/**
 * El tablero se dibuja a partir de una cadena que crece durante la ronda. Al
 * recargar la página no hay historial de jugadas, así que la única forma de que
 * las fichas vuelvan a su sitio es reproducir esa cadena a partir de lo que
 * persistió el servidor: el tablero ordenado y su ancla.
 *
 * Estos tests comparan, ficha a ficha, la cadena que se obtiene jugando con la
 * que se obtiene rehidratando. Si divergen, el tablero se recoloca al recargar.
 */

function makeSet(): DominoTile[] {
  const tiles: DominoTile[] = [];
  for (let left = 0; left <= 6; left++) {
    for (let right = left; right <= 6; right++) {
      tiles.push({ id: `${left}-${right}`, left, right });
    }
  }
  return tiles;
}

/** Gira la ficha para que la cara que conecta quede hacia dentro de la cadena. */
function orient(tile: DominoTile, side: Side, freeValue: number): DominoTile {
  if (side === "left") {
    return tile.right === freeValue
      ? { ...tile }
      : { id: tile.id, left: tile.right, right: tile.left };
  }
  return tile.left === freeValue
    ? { ...tile }
    : { id: tile.id, left: tile.right, right: tile.left };
}

interface Step {
  tile: DominoTile;
  side: Side;
}

interface PlayedRound {
  /** Tablero ordenado de izquierda a derecha, como lo guarda el servidor. */
  board: DominoTile[];
  /** Ficha con la que empezó la ronda, tal y como la persiste el servidor. */
  anchorId: string;
  /** Cadena construida jugando: lo que ve el jugador en vivo. */
  live: ChainLayout;
  /** La misma cadena, aún en construcción, para seguir jugando. */
  builder: ChainBuilder;
}

/**
 * Juega una secuencia de fichas replicando lo que hace el servidor: la ficha se
 * orienta hacia dentro, se coloca en el extremo elegido (`unshift` a la
 * izquierda, `push` a la derecha) y la cadena del cliente crece con ella.
 */
function playSequence(seed: DominoTile, steps: readonly Step[]): PlayedRound {
  const board: DominoTile[] = [seed];
  const builder: ChainBuilder = createChain(seed, DEFAULT_CONFIG);
  let leftFree = seed.left;
  let rightFree = seed.right;

  for (const { tile, side } of steps) {
    const free = side === "left" ? leftFree : rightFree;
    const placed = orient(tile, side, free);
    placeTile(placed, side, builder, DEFAULT_CONFIG);
    if (side === "left") {
      board.unshift(placed);
      leftFree = placed.left;
    } else {
      board.push(placed);
      rightFree = placed.right;
    }
  }

  return { board, anchorId: seed.id, live: builderToLayout(builder), builder };
}

/**
 * Juega greedily: en cada turno coloca la ficha que elija `pick` en el extremo
 * pedido; si ese extremo no tiene nada, juega en el otro, como haría un jugador.
 */
function playRound(
  seed: DominoTile,
  sides: readonly Side[],
  pick: (pool: DominoTile[]) => DominoTile
): PlayedRound {
  const set = makeSet();
  const used = new Set([seed.id]);
  const steps: Step[] = [];
  let leftFree = seed.left;
  let rightFree = seed.right;

  for (const side of sides) {
    if (used.size >= 28) break;
    const free = side === "left" ? leftFree : rightFree;
    const pool = set.filter(
      (t) => !used.has(t.id) && (t.left === free || t.right === free)
    );
    if (pool.length === 0) continue;
    const tile = pick(pool);
    used.add(tile.id);
    steps.push({ tile, side });
    if (side === "left") leftFree = orient(tile, side, free).left;
    else rightFree = orient(tile, side, free).right;
  }

  return playSequence(seed, steps);
}

/**
 * Busca con backtracking una secuencia que use las 28 fichas del dominó en una
 * sola cadena. Hace falta porque jugando a lo bruto la partida se atasca antes
 * de agotar el dominó.
 */
function findFullChain(
  set: readonly DominoTile[]
): { seed: DominoTile; steps: Step[] } | null {
  const deadEnds = new Set<string>();
  const steps: Step[] = [];

  const search = (
    used: Set<string>,
    leftFree: number,
    rightFree: number
  ): boolean => {
    if (used.size === set.length) return true;
    const key = `${leftFree}|${rightFree}|${[...used].sort().join(",")}`;
    if (deadEnds.has(key)) return false;

    for (const side of ["left", "right"] as const) {
      const free = side === "left" ? leftFree : rightFree;
      for (const tile of set) {
        if (used.has(tile.id)) continue;
        if (tile.left !== free && tile.right !== free) continue;
        const placed = orient(tile, side, free);
        used.add(tile.id);
        steps.push({ tile, side });
        if (
          search(
            used,
            side === "left" ? placed.left : leftFree,
            side === "right" ? placed.right : rightFree
          )
        ) {
          return true;
        }
        steps.pop();
        used.delete(tile.id);
      }
    }

    deadEnds.add(key);
    return false;
  };

  // La ronda siempre empieza con el doble seis, como en el reparto real.
  const seed = set.find((t) => t.id === "6-6")!;
  const used = new Set([seed.id]);
  return search(used, seed.left, seed.right) ? { seed, steps: [...steps] } : null;
}

/** Posición de cada ficha: coordenadas, orientación y caras mostradas. */
function positions(layout: ChainLayout): Map<string, string> {
  return new Map(
    layout.placements.map((p) => [
      p.tile.id,
      `${p.x},${p.y},${p.orientation},${p.displayLeft}-${p.displayRight}`,
    ])
  );
}

function assertSameLayout(live: ChainLayout, replayed: ChainLayout): void {
  const expected = positions(live);
  const actual = positions(replayed);
  assert.equal(actual.size, expected.size, "hay fichas de más o de menos");
  for (const [id, position] of expected) {
    assert.equal(actual.get(id), position, `la ficha ${id} cambió de sitio`);
  }
}

/** Todas las fichas del tablero tienen su sitio, una vez cada una. */
function assertAllPlaced(
  layout: ChainLayout,
  board: readonly DominoTile[]
): void {
  assert.deepEqual(
    layout.placements.map((p) => p.tile.id).sort(),
    board.map((t) => t.id).sort()
  );
}

const pickMiddle = (pool: DominoTile[]): DominoTile =>
  pool[Math.floor(pool.length / 2)];

/**
 * Primera ficha del dominó que se puede jugar en alguno de los dos extremos del
 * tablero, con el extremo libre al que encaja. Devuelve `null` si la cadena está
 * cerrada.
 */
function siguienteJugada(
  board: readonly DominoTile[]
): { tile: DominoTile; side: Side; libre: number } | null {
  const usados = new Set(board.map((t) => t.id));
  const extremos: { side: Side; libre: number }[] = [
    { side: "left", libre: board[0].left },
    { side: "right", libre: board[board.length - 1].right },
  ];
  for (const extremo of extremos) {
    const tile = makeSet().find(
      (t) => !usados.has(t.id) && (t.left === extremo.libre || t.right === extremo.libre)
    );
    if (tile) return { tile, side: extremo.side, libre: extremo.libre };
  }
  return null;
}

const CASES: ReadonlyArray<{ name: string; sides: Side[] }> = [
  { name: "todas a la derecha", sides: Array.from({ length: 30 }, () => "right") },
  { name: "todas a la izquierda", sides: Array.from({ length: 30 }, () => "left") },
  {
    name: "mezclando los dos extremos",
    sides: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? "left" : "right")),
  },
  {
    name: "bloques alternos",
    sides: Array.from({ length: 30 }, (_, i) =>
      Math.floor(i / 3) % 2 === 0 ? "right" : "left"
    ),
  },
];

for (const { name, sides } of CASES) {
  test(`recargar a mitad de ronda mantiene cada ficha en su sitio: ${name}`, () => {
    const round = playRound({ id: "6-6", left: 6, right: 6 }, sides, pickMiddle);
    assert.ok(
      round.board.length > 5,
      `la ronda simulada debe tener fichas, tiene ${round.board.length}`
    );

    const rehydrated = replayBoardLayout(round.board, round.anchorId, DEFAULT_CONFIG);
    assertSameLayout(round.live, rehydrated);
  });
}

test("una partida completa de 28 fichas se reconstruye igual", () => {
  const solved = findFullChain(makeSet());
  assert.ok(solved, "no se encontró una cadena con las 28 fichas");
  const round = playSequence(solved.seed, solved.steps);
  assert.equal(round.board.length, 28, "no se repartieron las 28 fichas");

  const rehydrated = replayBoardLayout(round.board, round.anchorId, DEFAULT_CONFIG);
  assertSameLayout(round.live, rehydrated);
});

test("reanudar es idempotente: el estado del servidor manda", () => {
  const round = playRound(
    { id: "6-6", left: 6, right: 6 },
    ["right", "right", "left", "right", "left", "left", "right"],
    pickMiddle
  );

  const first = replayBoardLayout(round.board, round.anchorId, DEFAULT_CONFIG);
  const second = replayBoardLayout(round.board, round.anchorId, DEFAULT_CONFIG);
  assertSameLayout(first, second);
});

test("la jugada siguiente cae igual se recargue o no", () => {
  // Es el caso que más duele: el jugador que recarga no solo ve el tablero bien,
  // sino que su siguiente ficha tiene que ir al mismo sitio que si no hubiera
  // recargado. Si no, los cuatro tableros acaban distintos.
  const round = playRound(
    { id: "6-6", left: 6, right: 6 },
    ["right", "left", "right", "left"],
    pickMiddle
  );
  const rehydrated = replayBoardLayout(round.board, round.anchorId, DEFAULT_CONFIG);
  assertSameLayout(round.live, rehydrated);

  const jugada = siguienteJugada(round.board);
  assert.ok(jugada, "la ronda simulada debería admitir otra jugada");

  // Continuando la partida en vivo, por un lado...
  const enVivo = replayChain(round.board, findAnchorIndex(round.board, round.anchorId), DEFAULT_CONFIG);
  placeTile(orient(jugada.tile, jugada.side, jugada.libre), jugada.side, enVivo, DEFAULT_CONFIG);

  // ...y rehidratando el mismo estado del servidor, por otro.
  const trasRecargar = replayChain(
    round.board,
    findAnchorIndex(round.board, round.anchorId),
    DEFAULT_CONFIG
  );
  placeTile(
    orient(jugada.tile, jugada.side, jugada.libre),
    jugada.side,
    trasRecargar,
    DEFAULT_CONFIG
  );

  assertSameLayout(builderToLayout(enVivo), builderToLayout(trasRecargar));
});

test("sin ancla se dibuja un tablero completo, aunque recolocado", () => {
  // Es el caso de un registro antiguo, que no guardaba el ancla: la partida debe
  // cargarse igual, pero el resultado puede no coincidir con lo que se veía.
  const round = playRound(
    { id: "6-6", left: 6, right: 6 },
    ["right", "left", "right", "left", "right"],
    pickMiddle
  );

  const sinAncla = replayBoardLayout(round.board, null, DEFAULT_CONFIG);
  assertAllPlaced(sinAncla, round.board);

  const anclaInvalida = replayBoardLayout(round.board, "no-existe", DEFAULT_CONFIG);
  assertAllPlaced(anclaInvalida, round.board);
});

test("el ancla se localiza en el tablero ordenado", () => {
  const round = playRound(
    { id: "6-6", left: 6, right: 6 },
    ["right", "right", "left"],
    pickMiddle
  );

  assert.equal(findAnchorIndex(round.board, round.anchorId), 1);
  assert.equal(findAnchorIndex(round.board, null), -1);
  assert.equal(findAnchorIndex(round.board, "no-existe"), -1);
});

test("reconstruir un tablero vacío no inventa fichas", () => {
  const vacio = replayBoardLayout([], "6-6", DEFAULT_CONFIG);
  assert.equal(vacio.placements.length, 0);
  assert.equal(vacio.leftEnd, null);
  assert.equal(vacio.rightEnd, null);
});

test("replayChain coloca el ancla donde se le pide", () => {
  // Tablero ordenado de izquierda a derecha; el ancla (6-6) está en el centro y
  // enlaza con sus dos vecinas, así que la cadena se reproduce desde él.
  const fichas: DominoTile[] = [
    { id: "3-6", left: 3, right: 6 },
    { id: "6-6", left: 6, right: 6 },
    { id: "6-4", left: 6, right: 4 },
  ];

  const desdeElCentro = builderToLayout(replayChain(fichas, 1, DEFAULT_CONFIG));
  assertAllPlaced(desdeElCentro, fichas);
  assert.equal(desdeElCentro.placements[0].tile.id, "6-6");
  assert.equal(desdeElCentro.placements[0].x, 0);
  assert.equal(desdeElCentro.placements[0].y, 0);

  // La doble se dibuja en vertical y cada vecina sale por su lado.
  assert.equal(desdeElCentro.placements[0].orientation, "vertical");
  const izquierda = desdeElCentro.placements.find((p) => p.tile.id === "3-6")!;
  const derecha = desdeElCentro.placements.find((p) => p.tile.id === "6-4")!;
  assert.ok(izquierda.x < 0, "la vecina izquierda queda a la izquierda");
  assert.ok(derecha.x > 0, "la vecina derecha queda a la derecha");
  assert.equal(findAnchorIndex(fichas, "6-6"), 1);
});
