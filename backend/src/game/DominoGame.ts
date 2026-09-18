import {
  DominoTile,
  GameState,
  MoveResult,
  Player,
  PublicGameState,
  TILES_PER_PLAYER,
} from "./game.types.js";

type BoardSide = "left" | "right";

export class DominoGame {
  public state: GameState;

  constructor(roomId: string, players: Player[]) {
    const sortedPlayers = [...players].sort((a, b) => a.position - b.position);
    this.state = {
      roomId,
      players: sortedPlayers,
      hands: {},
      board: [],
      currentPlayer: null,
      status: "waiting",
      winnerId: null,
      winnerTeam: null,
      winnerReason: null,
    };
  }

  static createTiles(): DominoTile[] {
    const tiles: DominoTile[] = [];
    for (let left = 0; left <= 6; left++) {
      for (let right = left; right <= 6; right++) {
        tiles.push({ id: `${left}-${right}`, left, right });
      }
    }
    return tiles;
  }

  static shuffleTiles(tiles: DominoTile[]): DominoTile[] {
    const shuffled = [...tiles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  static dealTiles(
    tiles: DominoTile[],
    players: Player[]
  ): Record<string, DominoTile[]> {
    const hands: Record<string, DominoTile[]> = {};
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const start = i * TILES_PER_PLAYER;
      hands[player.id] = tiles.slice(start, start + TILES_PER_PLAYER);
    }
    return hands;
  }

  start(): void {
    if (this.state.status !== "waiting") {
      throw new Error("La partida ya comenzó.");
    }
    if (this.state.players.length !== 4) {
      throw new Error("Se necesitan 4 jugadores para iniciar la partida.");
    }
    const tiles = DominoGame.shuffleTiles(DominoGame.createTiles());
    this.state.hands = DominoGame.dealTiles(tiles, this.state.players);
    this.state.board = [];
    this.state.status = "playing";
    this.state.winnerId = null;
    this.state.winnerTeam = null;
    this.state.winnerReason = null;
    this.state.currentPlayer = this.findStartingPlayer().id;
  }

  boardLeft(): number | null {
    return this.state.board.length
      ? this.state.board[0].left
      : null;
  }

  boardRight(): number | null {
    return this.state.board.length
      ? this.state.board[this.state.board.length - 1].right
      : null;
  }

  canPlayTile(
    playerId: string,
    tileId: string
  ): { valid: boolean; reason: string } {
    if (this.state.status !== "playing") {
      return { valid: false, reason: "La partida no está en curso." };
    }
    if (!this.state.players.some((p) => p.id === playerId)) {
      return { valid: false, reason: "El jugador no existe en esta sala." };
    }
    if (this.state.currentPlayer !== playerId) {
      return { valid: false, reason: "No es tu turno." };
    }
    const hand = this.state.hands[playerId] ?? [];
    if (!hand.some((t) => t.id === tileId)) {
      return { valid: false, reason: "No posees esa ficha." };
    }
    if (this.state.board.length === 0) {
      return { valid: true, reason: "" };
    }
    const tile = hand.find((t) => t.id === tileId)!;
    if (!this.canPlaceOnLeft(tile) && !this.canPlaceOnRight(tile)) {
      return {
        valid: false,
        reason: "La ficha no puede colocarse en el tablero.",
      };
    }
    return { valid: true, reason: "" };
  }

  playTile(playerId: string, tileId: string, side?: BoardSide): MoveResult {
    const check = this.canPlayTile(playerId, tileId);
    if (!check.valid) {
      return { valid: false, reason: check.reason };
    }

    const hand = this.state.hands[playerId]!;
    const tile = hand.find((t) => t.id === tileId)!;
    const chosenSide = this.resolveSide(tile, side);
    if (chosenSide === null) {
      return {
        valid: false,
        reason: "Esa ficha no va en ese lado del tablero.",
      };
    }
    const oriented = this.orientedTile(tile, chosenSide);

    if (chosenSide === "left") {
      this.state.board.unshift(oriented);
    } else {
      this.state.board.push(oriented);
    }

    this.state.hands[playerId] = hand.filter((t) => t.id !== tileId);

    return { valid: true, played: oriented };
  }

  advanceTurn(): void {
    if (this.state.currentPlayer === null) return;
    this.state.currentPlayer = this.nextPlayerId(this.state.currentPlayer);
  }

  hasPlayableTiles(playerId: string): boolean {
    const hand = this.state.hands[playerId] ?? [];
    if (this.state.board.length === 0) return hand.length > 0;
    const left = this.boardLeft()!;
    const right = this.boardRight()!;
    return hand.some(
      (t) =>
        t.left === left ||
        t.right === left ||
        t.left === right ||
        t.right === right
    );
  }

  canAnyonePlay(): boolean {
    return this.state.players.some((p) => this.hasPlayableTiles(p.id));
  }

  currentMustPass(): boolean {
    return (
      this.state.currentPlayer !== null &&
      this.state.status === "playing" &&
      !this.hasPlayableTiles(this.state.currentPlayer)
    );
  }

  finishBlocked(): void {
    this.state.winnerTeam = this.blockingWinnerTeam();
    this.state.winnerId = this.bestPlayerInTeam(this.state.winnerTeam);
    this.state.winnerReason = "blocked";
    this.state.status = "finished";
  }

  hasWinner(): boolean {
    const hand = this.state.hands[this.state.currentPlayer ?? ""];
    return hand !== undefined && hand.length === 0;
  }

  finishWithWinner(): void {
    const playerId = this.state.currentPlayer;
    this.state.winnerId = playerId;
    this.state.winnerTeam = playerId ? this.teamOf(playerId) : null;
    this.state.winnerReason = "empty-hand";
    this.state.status = "finished";
  }

  finishBecausePlayerLeft(): void {
    this.state.winnerId = null;
    this.state.winnerTeam = null;
    this.state.winnerReason = "player-left";
    this.state.status = "finished";
  }

  getPublicState(playerId: string): PublicGameState {
    const handCounts: Record<string, number> = {};
    for (const player of this.state.players) {
      handCounts[player.id] = (this.state.hands[player.id] ?? []).length;
    }
    const teamPips: Record<string, number> = {};
    for (const player of this.state.players) {
      const team = String(player.team);
      teamPips[team] = (teamPips[team] ?? 0) + this.handPips(player.id);
    }
    return {
      roomId: this.state.roomId,
      players: this.state.players,
      board: this.state.board,
      currentPlayer: this.state.currentPlayer,
      status: this.state.status,
      winnerId: this.state.winnerId,
      winnerTeam: this.state.winnerTeam,
      winnerReason: this.state.winnerReason,
      yourPlayerId: playerId,
      yourHand: this.state.hands[playerId] ?? [],
      handCounts,
      teamPips,
      mustPass: this.currentMustPass(),
    };
  }

  private findStartingPlayer(): Player {
    const doubleSixHolder = this.state.players.find((p) =>
      (this.state.hands[p.id] ?? []).some(
        (t) => t.id === "6-6"
      )
    );
    return doubleSixHolder ?? this.state.players[0];
  }

  private canPlaceOnLeft(tile: DominoTile): boolean {
    const left = this.boardLeft();
    return left !== null && (tile.left === left || tile.right === left);
  }

  private canPlaceOnRight(tile: DominoTile): boolean {
    const right = this.boardRight();
    return right !== null && (tile.left === right || tile.right === right);
  }

  private resolveSide(tile: DominoTile, side?: BoardSide): BoardSide | null {
    if (this.state.board.length === 0) return "right";
    const leftOk = this.canPlaceOnLeft(tile);
    const rightOk = this.canPlaceOnRight(tile);
    if (side === "left" && leftOk) return "left";
    if (side === "right" && rightOk) return "right";
    if (side) return null;
    if (rightOk) return "right";
    return "left";
  }

  private orientedTile(tile: DominoTile, side: BoardSide): DominoTile {
    if (this.state.board.length === 0) return { ...tile };
    if (side === "left") {
      if (tile.right === this.boardLeft()) return { ...tile };
      return { id: tile.id, left: tile.right, right: tile.left };
    }
    if (tile.left === this.boardRight()) return { ...tile };
    return { id: tile.id, left: tile.right, right: tile.left };
  }

  private nextPlayerId(fromId: string): string {
    const player = this.state.players.find((p) => p.id === fromId)!;
    const next = this.state.players[
      (player.position + 1) % this.state.players.length
    ];
    return next.id;
  }

  private handPips(playerId: string): number {
    return (this.state.hands[playerId] ?? []).reduce(
      (sum, t) => sum + t.left + t.right,
      0
    );
  }

  private teamOf(playerId: string): number | null {
    return this.state.players.find((p) => p.id === playerId)?.team ?? null;
  }

  private teamPips(team: number): number {
    return this.state.players
      .filter((p) => p.team === team)
      .reduce((sum, p) => sum + this.handPips(p.id), 0);
  }

  private blockingWinnerTeam(): number {
    const teams = [...new Set(this.state.players.map((p) => p.team))].sort(
      (a, b) => a - b
    );
    let best = teams[0];
    let bestPips = this.teamPips(best);
    for (const team of teams.slice(1)) {
      const pips = this.teamPips(team);
      if (pips < bestPips) {
        best = team;
        bestPips = pips;
      }
    }
    return best;
  }

  private bestPlayerInTeam(team: number): string | null {
    const members = this.state.players.filter((p) => p.team === team);
    if (members.length === 0) return null;
    let best = members[0];
    let bestPips = this.handPips(best.id);
    for (const player of members.slice(1)) {
      const pips = this.handPips(player.id);
      if (pips < bestPips) {
        best = player;
        bestPips = pips;
      }
    }
    return best.id;
  }
}