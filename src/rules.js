// Rules / legality / FEN authority — ffish.js (Fairy-Stockfish move generator).
// This is the single source of truth for what is legal. The board UI only
// renders; every move is validated here, and the engine is only ever handed
// FENs that originate from this module.
import ffishModule from '../vendor/ffish/ffish.js';

let ffish = null;

export async function initRules() {
  // locateFile is resolved against the page URL, so keep it relative (no
  // leading slash) — this works whether served from / or from /<repo>/ on
  // GitHub Pages project sites.
  ffish = await ffishModule({ locateFile: (p) => 'vendor/ffish/' + p });
}

export class Game {
  constructor(variant = 'chess') {
    this.variant = variant;
    this.board = new ffish.Board(variant);
  }

  fen() {
    return this.board.fen();
  }

  // 'white' | 'black' — whose turn it is.
  turnColor() {
    return this.board.turn() ? 'white' : 'black';
  }

  legalUci() {
    const s = this.board.legalMoves();
    return s ? s.split(' ').filter(Boolean) : [];
  }

  // Map<fromSquare, toSquare[]> for chessgroundx's movable.dests.
  dests() {
    const m = new Map();
    for (const mv of this.legalUci()) {
      const from = mv.slice(0, 2);
      const to = mv.slice(2, 4);
      if (!m.has(from)) m.set(from, []);
      const arr = m.get(from);
      if (!arr.includes(to)) arr.push(to);
    }
    return m;
  }

  // Apply a board-origin/dest move. Returns the full UCI string actually
  // played (including promotion suffix), or null if the move is illegal.
  // Phase 0 auto-promotes to queen.
  applyMove(orig, dest) {
    const base = orig + dest;
    const legals = this.legalUci();
    let uci = legals.find((m) => m === base);
    if (!uci) {
      // promotion: same from/to but with a suffix — prefer queen.
      const promos = legals.filter((m) => m.slice(0, 4) === base && m.length > 4);
      uci = promos.find((m) => m.endsWith('q')) || promos[0];
    }
    if (!uci) return null;
    this.board.push(uci);
    return uci;
  }

  applyUci(uci) {
    return this.board.push(uci);
  }

  inCheck() {
    return this.board.isCheck();
  }

  isGameOver() {
    return this.board.isGameOver();
  }

  // '1-0' | '0-1' | '1/2-1/2' | '*'
  result() {
    return this.board.result();
  }
}
