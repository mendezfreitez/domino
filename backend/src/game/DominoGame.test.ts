import { DominoGame } from "./DominoGame.js";
import { DominoTile, Player } from "./game.types.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function makePlayers(): Player[] {
  return [
    { id: "p0", name: "Ana", position: 0, team: 0 },
    { id: "p1", name: "Bruno", position: 1, team: 1 },
    { id: "p2", name: "Carla", position: 2, team: 0 },
    { id: "p3", name: "Diego", position: 3, team: 1 },
  ];
}

function tile(id: string): DominoTile {
  const [left, right] = id.split("-").map(Number);
  return { id, left, right };
}

console.log("--- Creación de fichas ---");

const tiles = DominoGame.createTiles();
assert(tiles.length === 28, `createTiles genera 28 fichas (obtuvo ${tiles.length})`);
assert(new Set(tiles.map((t) => t.id)).size === 28, "todas las fichas son únicas");
assert(tiles.some((t) => t.id === "0-0"), "existe [0|0]");
assert(tiles.some((t) => t.id === "6-6"), "existe [6|6]");
assert(!tiles.some((t) => t.id === "5-2"), "[5|2] no existe como ficha independiente");
assert(tiles.some((t) => t.id === "2-5"), "existe [2|5]");
assert(tiles.every((t) => t.left >= 0 && t.left <= 6 && t.right >= 0 && t.right <= 6), "valores entre 0 y 6");

const shuffled = DominoGame.shuffleTiles(tiles);
assert(shuffled.length === 28, "shuffle mantiene 28 fichas");
assert(new Set(shuffled.map((t) => t.id)).size === 28, "shuffle conserva el conjunto completo");

console.log("--- Reparto ---");

const players = makePlayers();
const hands = DominoGame.dealTiles(tiles, players);
const allIds = Object.values(hands).flat().map((t) => t.id);
assert(hands.p0.length === 7, "el jugador 0 recibe 7 fichas");
assert(hands.p1.length === 7, "el jugador 1 recibe 7 fichas");
assert(hands.p2.length === 7, "el jugador 2 recibe 7 fichas");
assert(hands.p3.length === 7, "el jugador 3 recibe 7 fichas");
assert(allIds.length === 28, "se reparten 28 fichas en total");
assert(new Set(allIds).size === 28, "no hay fichas duplicadas entre jugadores");

console.log("--- Inicio de partida ---");

const game = new DominoGame("TEST1", players);
game.start();
assert(game.state.status === "playing", "el estado pasa a playing");
assert(game.state.board.length === 0, "el tablero inicia vacío");
for (const p of players) {
  assert((game.state.hands[p.id] ?? []).length === 7, `${p.name} tiene 7 fichas`);
}
const doubleSixHolder = players.find((p) =>
  (game.state.hands[p.id] ?? []).some((t) => t.id === "6-6")
)!;
assert(game.state.currentPlayer === doubleSixHolder.id, "empieza el jugador con [6|6]");

console.log("--- Validación de jugadas ---");

const g2 = new DominoGame("TEST2", makePlayers());
g2.start();
g2.state.board = [tile("3-5")];
g2.state.currentPlayer = "p0";
g2.state.hands = {
  p0: [tile("2-5"), tile("1-1"), tile("3-4")],
  p1: [],
  p2: [],
  p3: [],
};

assert(g2.canPlayTile("p1", "2-5").valid === false, "no se puede jugar fuera de turno");
assert(g2.canPlayTile("p0", "6-6").valid === false, "no se puede jugar una ficha que no se posee");
assert(g2.canPlayTile("p0", "2-5").valid === true, "[2|5] puede colocarse en el extremo derecho [5]");
assert(g2.canPlayTile("p0", "3-4").valid === true, "[3|4] puede colocarse en el extremo izquierdo [3]");
assert(g2.canPlayTile("p0", "1-1").valid === false, "[1|1] no se puede colocar sobre extremos 3 y 5");

console.log("--- Colocación en el tablero ---");

const g3 = new DominoGame("TEST3", makePlayers());
g3.start();
g3.state.board = [tile("3-5")];
g3.state.currentPlayer = "p0";
g3.state.hands = { p0: [tile("2-5")], p1: [], p2: [], p3: [] };

const rRight = g3.playTile("p0", "2-5", "right");
assert(rRight.valid === true, "jugada [2|5] a la derecha es válida");
assert(g3.state.board.length === 2, "el tablero tiene 2 fichas");
assert(g3.state.board[1].left === 5 && g3.state.board[1].right === 2, "[2|5] queda orientado [5|2] (5 junto a la mesa, 2 al exterior)");
assert(g3.state.hands.p0.length === 0, "la ficha se quita de la mano del jugador");
assert(g3.boardRight() === 2, "el extremo derecho queda en 2");

const g4 = new DominoGame("TEST4", makePlayers());
g4.start();
g4.state.board = [tile("3-5")];
g4.state.currentPlayer = "p0";
g4.state.hands = { p0: [tile("3-4")], p1: [], p2: [], p3: [] };

const rLeft = g4.playTile("p0", "3-4", "left");
assert(rLeft.valid === true, "jugada [3|4] a la izquierda es válida");
assert(g4.state.board[0].left === 4 && g4.state.board[0].right === 3, "[3|4] rota a [4|3] al colocarse a la izquierda");
assert(g4.boardLeft() === 4, "el extremo izquierdo queda en 4");

console.log("--- Cambio de turno ---");

const g5 = new DominoGame("TEST5", makePlayers());
g5.start();
g5.state.board = [tile("3-5")];
g5.state.currentPlayer = "p0";
g5.state.hands = {
  p0: [],
  p1: [tile("1-1")],
  p2: [tile("5-6")],
  p3: [tile("0-0")],
};

g5.advanceTurn();
assert(g5.state.currentPlayer === "p2", "se salta al jugador sin fichas válidas (p1) y pasa al p2");

console.log("--- Ganador por mano vacía ---");

const g6 = new DominoGame("TEST6", makePlayers());
g6.start();
g6.state.board = [];
g6.state.currentPlayer = "p0";
g6.state.hands = { p0: [tile("4-4")], p1: [], p2: [], p3: [] };
const win = g6.playTile("p0", "4-4");
assert(win.valid === true, "primera ficha se juega con el tablero vacío");
assert(g6.hasWinner() === true, "hay ganador con la mano vacía");
g6.finishWithWinner();
assert(g6.state.status === "finished", "la partida termina");
assert(g6.state.winnerId === "p0", "el ganador es p0");
assert(g6.state.winnerTeam === 0, "gana el equipo de p0 (equipo 0)");
assert(g6.state.winnerReason === "empty-hand", "el motivo es mano vacía");

console.log("--- Finalización por bloqueo ---");

const g7 = new DominoGame("TEST7", makePlayers());
g7.start();
g7.state.board = [tile("5-5")];
g7.state.currentPlayer = "p0";
g7.state.hands = {
  p0: [tile("1-2")],
  p1: [tile("0-0")],
  p2: [tile("3-4")],
  p3: [tile("6-6")],
};
g7.advanceTurn();
assert(g7.state.status === "finished", "sin jugadas posibles la partida termina");
assert(g7.state.winnerReason === "blocked", "el motivo es bloqueo");
assert(g7.state.winnerTeam === 0, "gana el equipo con menos puntos (equipo 0: 10 vs 12)");
assert(g7.state.winnerId === "p0", "el mejor jugador del equipo ganador es p0 (3 puntos)");

console.log("--- Estado público (privacidad de fichas) ---");

const g8 = new DominoGame("TEST8", makePlayers());
g8.start();
const pub = g8.getPublicState("p0");
assert(pub.yourHand.length === 7, "el jugador recibe sus 7 fichas");
assert(pub.handCounts.p1 === 7, "el jugador ve la cantidad de fichas del rival");
assert(pub.yourHand.every((t) => (g8.state.hands.p0 ?? []).some((x) => x.id === t.id)), "la mano propia coincide");
assert("hands" in pub === false, "el estado público no expone la mano de los demás");

console.log("");
if (failed > 0) {
  console.error(`RESULTADO: ${passed} OK, ${failed} FALLIDOS`);
  process.exit(1);
}
console.log(`RESULTADO: ${passed} OK, ${failed} fallidos. Todo correcto.`);