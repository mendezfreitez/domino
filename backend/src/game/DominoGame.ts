import {
  DominoTile,
  GameState,
  MATCH_TARGET_SCORE,
  MoveResult,
  Player,
  PublicGameState,
  TILES_PER_PLAYER,
  TEAM_COUNT,
  WinnerReason,
} from "./game.types.js";

type BoardSide = "left" | "right";

export interface DominoGameOptions {
  targetScore?: number;
}

/**
 * Copia profunda del GameState. El estado solo contiene JSON (números, cadenas,
 * listas y registros), por lo que `structuredClone` es suficiente y evita
 * mantener a mano una función de clonado que se quedaría obsoleta en cuanto se
 * añada un campo.
 */
function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export class DominoGame {
  public state: GameState;

  constructor(
    roomId: string,
    players: Player[],
    options?: DominoGameOptions
  ) {
    const sortedPlayers = [...players].sort((a, b) => a.position - b.position);
    this.state = {
      roomId,
      players: sortedPlayers,
      hands: {},
      board: [],
      boardAnchorId: null,
      bunk: [],
      currentPlayer: null,
      status: "waiting",
      winnerId: null,
      winnerTeam: null,
      winnerReason: null,
      blockedById: null,
      teamScores: [0, 0],
      roundNumber: 0,
      currentStarterId: null,
      matchWinnerTeam: null,
      targetScore: options?.targetScore ?? MATCH_TARGET_SCORE,
      readyForNextRound: [],
      revision: 0,
    };
  }

  /**
   * Reconstruye una partida a partir de un GameState persistido sin volver a
   * repartir. Es la puerta de entrada de la recuperación: lo que sale de SQLite
   * vuelve a ser un Game Engine normal, indistinguible de uno creado al vuelo.
   */
  static fromState(state: GameState): DominoGame {
    const game = new DominoGame(state.roomId, state.players, {
      targetScore: state.targetScore,
    });
    game.state = cloneState(state);
    return game;
  }

  /**
   * Copia profunda e independiente del estado actual. Sirve tanto para persistir
   * (el JSON guardado no debe cambiar si el motor sigue mutando) como para
   * deshacer una jugada cuando el guardado en SQLite falla.
   */
  snapshot(): GameState {
    return cloneState(this.state);
  }

  /** Restaura un snapshot previo, dejando el motor como estaba antes. */
  restore(snapshot: GameState): void {
    this.state = cloneState(snapshot);
  }

  /** Avanza el contador de revisión. Se llama tras cada cambio de estado. */
  bumpRevision(): number {
    this.state.revision += 1;
    return this.state.revision;
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
    this.startNewRound();
  }

  startNextRound(): void {
    if (this.state.status !== "round-over") {
      throw new Error("La partida no está en estado de ronda terminada.");
    }
    this.startNewRound();
  }

  markReadyForNextRound(playerId: string):
    | { started: boolean; duplicate: boolean }
    | null {
    if (this.state.status !== "round-over") return null;
    const exists = this.state.players.some((p) => p.id === playerId);
    if (!exists) return null;
    const list = this.state.readyForNextRound;
    if (list.includes(playerId)) {
      return { started: false, duplicate: true };
    }
    list.push(playerId);
    const allReady = this.state.players.length > 0 &&
      list.length >= this.state.players.length;
    if (allReady) {
      this.startNewRound();
      return { started: true, duplicate: false };
    }
    return { started: false, duplicate: false };
  }

  private startNewRound(): void {
    const tiles = DominoGame.shuffleTiles(DominoGame.createTiles());
    this.state.hands = DominoGame.dealTiles(tiles, this.state.players);
    this.state.board = [];
    this.state.boardAnchorId = null;
    this.state.bunk = [];

    if (this.state.status === "waiting") {
      // Primera ronda: empieza quien tenga el doble-seis (o el primer asiento).
      this.state.roundNumber = 1;
      this.state.currentStarterId = this.findStartingPlayer().id;
      this.state.teamScores = [0, 0];
      this.state.matchWinnerTeam = null;
    } else {
      // Rondas siguientes: inicia el jugador siguiente en sentido antihorario
      // respecto a quien inició la ronda anterior. El marcador se conserva.
      const previousStarter =
        this.state.currentStarterId ?? this.state.players[0]?.id;
      if (!previousStarter) {
        throw new Error("No hay jugadores para iniciar la ronda.");
      }
      this.state.roundNumber += 1;
      this.state.currentStarterId = this.nextPlayerId(previousStarter);
    }

    this.state.winnerId = null;
    this.state.winnerTeam = null;
    this.state.winnerReason = null;
    this.state.blockedById = null;
    this.state.currentPlayer = this.state.currentStarterId;
    this.state.readyForNextRound = [];
    this.state.status = "playing";
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

    if (this.state.board.length === 1) {
      // La primera ficha de la ronda es el ancla de la cadena: queda fija en el
      // centro geométrico del tablero mientras crece a ambos lados.
      this.state.boardAnchorId = oriented.id;
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
    this.state.blockedById = this.state.currentPlayer;
    const winnerTeam = this.blockingWinnerTeam();
    this.finishRound(winnerTeam, this.bestPlayerInTeam(winnerTeam), "blocked");
  }

  hasWinner(): boolean {
    const hand = this.state.hands[this.state.currentPlayer ?? ""];
    return hand !== undefined && hand.length === 0;
  }

  finishWithWinner(): void {
    const playerId = this.state.currentPlayer;
    const winnerTeam = playerId ? this.teamOf(playerId) : null;
    if (winnerTeam === null) {
      this.state.winnerId = playerId;
      this.state.winnerReason = "empty-hand";
      this.state.status = "finished";
      return;
    }
    this.finishRound(winnerTeam, playerId, "empty-hand");
  }

  private finishRound(
    winnerTeam: number,
    winnerId: string | null,
    reason: WinnerReason
  ): void {
    this.state.winnerTeam = winnerTeam;
    this.state.winnerId = winnerId;
    this.state.winnerReason = reason;
    this.state.teamScores[winnerTeam] += this.rivalPips(winnerTeam);
    this.state.currentPlayer = null;

    if (this.state.teamScores[winnerTeam] >= this.state.targetScore) {
      this.state.matchWinnerTeam = winnerTeam;
      this.state.status = "finished";
    } else {
      this.state.status = "round-over";
    }
  }

  finishBecausePlayerLeft(): void {
    this.state.winnerId = null;
    this.state.winnerTeam = null;
    this.state.winnerReason = "player-left";
    this.state.blockedById = null;
    this.state.matchWinnerTeam = null;
    this.state.currentPlayer = null;
    this.state.status = "finished";
  }

  /**
   * Da de baja a un jugador dentro del Game Engine: desaparece del estado
   * persistido junto con su mano, de la lista de confirmados y de las
   * referencias que lo señalaban como ganador, trancador o iniciador de ronda.
   *
   * Mantener la sala y el motor de acuerdo en el roster es lo que permite
   * recuperar la partida desde SQLite sin resucitar al jugador que se fue.
   */
  removePlayer(playerId: string): boolean {
    const index = this.state.players.findIndex((p) => p.id === playerId);
    if (index === -1) return false;

    this.state.players.splice(index, 1);
    delete this.state.hands[playerId];
    this.state.readyForNextRound = this.state.readyForNextRound.filter(
      (id) => id !== playerId
    );
    if (this.state.currentPlayer === playerId) {
      this.state.currentPlayer = this.state.players[0]?.id ?? null;
    }
    if (this.state.currentStarterId === playerId) {
      this.state.currentStarterId = this.state.players[0]?.id ?? null;
    }
    if (this.state.winnerId === playerId) this.state.winnerId = null;
    if (this.state.blockedById === playerId) this.state.blockedById = null;
    this.reassignPositions();
    return true;
  }

  getPublicState(playerId: string): PublicGameState {
    const handCounts: Record<string, number> = {};
    for (const player of this.state.players) {
      handCounts[player.id] = (this.state.hands[player.id] ?? []).length;
    }

    let revealedHands: Record<string, DominoTile[]> = {};
    if (
      this.state.status === "round-over" ||
      this.state.status === "finished"
    ) {
      revealedHands = {};
      for (const player of this.state.players) {
        revealedHands[player.id] = [...(this.state.hands[player.id] ?? [])];
      }
    }

    return {
      roomId: this.state.roomId,
      players: this.state.players,
      board: this.state.board,
      boardAnchorId: this.state.boardAnchorId,
      currentPlayer: this.state.currentPlayer,
      status: this.state.status,
      winnerId: this.state.winnerId,
      winnerTeam: this.state.winnerTeam,
      winnerReason: this.state.winnerReason,
      blockedById: this.state.blockedById,
      yourPlayerId: playerId,
      yourHand: this.state.hands[playerId] ?? [],
      handCounts,
      teamScores: [...this.state.teamScores],
      roundNumber: this.state.roundNumber,
      targetScore: this.state.targetScore,
      matchWinnerTeam: this.state.matchWinnerTeam,
      mustPass: this.currentMustPass(),
      revealedHands,
      readyForNextRound: [...this.state.readyForNextRound],
      revision: this.state.revision,
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
    const player = this.state.players.find((p) => p.id === fromId);
    const count = this.state.players.length;
    if (!player || count === 0) return "";
    // Los turnos avanzan en sentido antihorario alrededor de la mesa.
    const next = this.state.players[
      (player.position - 1 + count) % count
    ];
    return next.id;
  }

  /**
   * Recalcula las posiciones (0..n) alternando equipos, igual que hace el
   * RoomManager, para que la mesa siga siendo coherente tras una baja.
   */
  private reassignPositions(): void {
    const counters: number[] = [];
    for (const player of this.state.players) {
      const index = counters[player.team] ?? 0;
      player.position = player.team + index * TEAM_COUNT;
      counters[player.team] = index + 1;
    }
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

  private rivalPips(winnerTeam: number): number {
    return this.teamPips(1 - winnerTeam);
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