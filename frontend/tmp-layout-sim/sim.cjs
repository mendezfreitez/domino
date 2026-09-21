/* Simulación de la lógica incremental del Board (replica exacta del useMemo)
 * contra el dominoLayout real compilado a JS. Verifica que:
 *  1) ninguna ficha ya colocada cambia de posición al crecer el tablero,
 *  2) el ancla (semilla) permanece fija,
 *  3) el giro de 90° ocurre en la ficha 17 (16 rectas),
 *  4) una partida completa (28 fichas) cabe en el área reservada 36x30.
 */
const { createChain, placeTile, builderToLayout, DEFAULT_CONFIG } = require(
  "./out/components/Board/dominoLayout.cjs"
);

function makeSet() {
  const s = [];
  for (let l = 0; l <= 6; l++)
    for (let r = l; r <= 6; r++) s.push({ id: `${l}-${r}`, left: l, right: r });
  return s;
}

function run(label, strategy) {
  const set = makeSet();
  const seed = { id: "6-6", left: 6, right: 6 };
  const used = new Set([seed.id]);
  const board = [seed]; // board[0] = extremo izquierdo
  let leftFree = seed.left;
  let rightFree = seed.right;

  let builder = null;
  let processedIds = null;
  const history = new Map(); // tileId -> "x,y|orientation|direction"

  function update() {
    if (!builder || !processedIds) {
      builder = createChain(board[0], DEFAULT_CONFIG);
      processedIds = new Set([board[0].id]);
    }
    let prevIds = processedIds;
    let firstPrev = board.findIndex((t) => prevIds.has(t.id));
    if (firstPrev === -1) {
      builder = createChain(board[0], DEFAULT_CONFIG);
      processedIds = new Set([board[0].id]);
      prevIds = processedIds;
      firstPrev = board.findIndex((t) => prevIds.has(t.id));
    }
    const leftAdds = firstPrev > 0 ? board.slice(0, firstPrev) : [];
    let lastPrev = -1;
    for (let i = board.length - 1; i >= 0; i--)
      if (prevIds.has(board[i].id)) {
        lastPrev = i;
        break;
      }
    const rightAdds = lastPrev >= 0 ? board.slice(lastPrev + 1) : [];
    for (let i = leftAdds.length - 1; i >= 0; i--)
      placeTile(leftAdds[i], "left", builder, DEFAULT_CONFIG);
    for (const t of rightAdds) placeTile(t, "right", builder, DEFAULT_CONFIG);
    processedIds = new Set(board.map((t) => t.id));
    return builderToLayout(builder);
  }

  function pick(side, freeVal) {
    const cands = set.filter(
      (t) => !used.has(t.id) && (t.left === freeVal || t.right === freeVal)
    );
    if (cands.length === 0) return null;
    const t = cands[Math.floor(Math.random() * cands.length)];
    used.add(t.id);
    const other = t.left === freeVal ? t.right : t.left;
    if (side === "right") {
      board.push(t);
      rightFree = other;
    } else {
      board.unshift(t);
      leftFree = other;
    }
    return t;
  }

  let layout = update();
  let violations = 0;
  let plays = 0;
  while (plays < 40) {
    const side = strategy(board.length, plays);
    const freeVal = side === "right" ? rightFree : leftFree;
    const t = pick(side, freeVal);
    if (!t) {
      const otherSide = side === "right" ? "left" : "right";
      const otherFree = otherSide === "right" ? rightFree : leftFree;
      const t2 = pick(otherSide, otherFree);
      if (!t2) break;
    }
    layout = update();
    plays++;
    for (const p of layout.placements) {
      const key = `${p.x},${p.y}|${p.orientation}|${p.direction}`;
      if (history.has(p.tile.id)) {
        if (history.get(p.tile.id) !== key) {
          violations++;
          console.log(
            `  [${label}] VIOLACIÓN: ${p.tile.id} pasó de ${history.get(p.tile.id)} a ${key}`
          );
        }
      } else {
        history.set(p.tile.id, key);
      }
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of layout.placements) {
    const w = p.orientation === "horizontal" ? 2 : 1;
    const h = p.orientation === "horizontal" ? 1 : 2;
    minX = Math.min(minX, p.x - w / 2);
    maxX = Math.max(maxX, p.x + w / 2);
    minY = Math.min(minY, p.y - h / 2);
    maxY = Math.max(maxY, p.y + h / 2);
  }
  const turnIdx = layout.placements.findIndex(
    (p, i) => i > 0 && (p.direction === "UP" || p.direction === "DOWN")
  );
  console.log(`--- ${label} ---
  fichas jugadas: ${layout.placements.length}
  violaciones de estabilidad: ${violations}
  ancla(semilla): ${history.get(seed.id)}
  primer giro (dirección vertical) en índice: ${turnIdx} (ficha #${turnIdx + 1} del string)
  extents: x = [${minX.toFixed(1)}, ${maxX.toFixed(1)}]  y = [${minY.toFixed(1)}, ${maxY.toFixed(1)}]
  cabe en 36x30: ${maxX - minX <= 36 && maxY - minY <= 30}`);
  return { violations, len: layout.placements.length };
}

run("MIXTO (ambos lados)", (len) => (Math.random() < 0.5 ? "right" : "left"));
run("SOLO DERECHA", () => "right");
run("SOLO IZQUIERDA", () => "left");