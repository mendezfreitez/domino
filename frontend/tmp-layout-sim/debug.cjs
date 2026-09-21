const { createChain, placeTile, builderToLayout, DEFAULT_CONFIG, isDouble } = require(
  "./out/components/Board/dominoLayout.cjs"
);
function makeSet(){ const s=[]; for(let l=0;l<=6;l++) for(let r=l;r<=6;r++) s.push({id:`${l}-${r}`,left:l,right:r}); return s; }

const seed = { id: "6-6", left: 6, right: 6 };
const board = [seed];
let rightFree = 6;
const used = new Set([seed.id]);
const set = makeSet();
const builder = createChain(seed, DEFAULT_CONFIG);
const seen = [];

while (seen.length < 27) {
  const cands = set.filter(t => !used.has(t.id) && (t.left === rightFree || t.right === rightFree));
  if (!cands.length) break;
  const t = cands[0]; // determinista
  used.add(t.id);
  board.push(t);
  rightFree = t.left === rightFree ? t.right : t.left;
  placeTile(t, "right", builder, DEFAULT_CONFIG);
  seen.push(t);
}
const layout = builderToLayout(builder);
console.log("idx | tile | orient | dir | isDouble | prevIsDouble");
for (let i = 1; i < layout.placements.length; i++) {
  const p = layout.placements[i];
  const prev = layout.placements[i - 1];
  console.log(
    `${String(i).padStart(3)} | ${p.tile.id.padEnd(4)} | ${p.orientation.padEnd(10)} | ${p.direction.padEnd(5)} | ${isDouble(p.tile)} | ${isDouble(prev.tile)}`
  );
}
console.log("total:", layout.placements.length);