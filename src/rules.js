// Rules / legality / FEN authority — ffish.js (Fairy-Stockfish move generator).
// This is the single source of truth for what is legal, for every variant. The
// board UI only renders; every move is validated here, and the engine is only
// ever handed FENs that originate from this module.
import ffishModule from '../vendor/ffish/ffish.js';

let ffish = null;

export async function initRules() {
  // locateFile is resolved against the page URL, so keep it relative (no
  // leading slash) — this works whether served from / or from /<repo>/ on
  // GitHub Pages project sites.
  ffish = await ffishModule({ locateFile: (p) => 'vendor/ffish/' + p });
}

export class Game {
  // `variant` is an entry from the variant registry (src/variants.js).
  constructor(variant) {
    this.v = variant;
    if (variant.chess960) {
      // Fairy-Stockfish/ffish need an explicit shuffled start position and the
      // is960 flag (castling targets are file-relative in 960).
      this.startFen = generateChess960Fen();
      this.board = new ffish.Board(variant.ffish, this.startFen, true);
    } else {
      this.board = new ffish.Board(variant.ffish);
      this.startFen = this.board.fen();
    }
  }

  fen() {
    return this.board.fen();
  }

  is960() {
    return !!this.v.chess960;
  }

  // 'white' | 'black' — whose turn it is.
  turnColor() {
    return this.board.turn() ? 'white' : 'black';
  }

  legalUci() {
    const s = this.board.legalMoves();
    return s ? s.split(' ').filter(Boolean) : [];
  }

  // Map<origin, dest[]> for chessgroundx's movable.dests. Origins are board
  // squares for ordinary moves and drop keys ("P@", "N@", …) for drop variants;
  // ffish emits both in the same legal-move list, so one map covers both. The
  // board UI keys pocket drops by exactly these "<LETTER>@" origins.
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

  // Promotion suffixes legally available for a from→to move (e.g. ['q','r','b',
  // 'n']), or [] if this move isn't a promotion. Lets the UI offer a chooser
  // instead of silently auto-queening.
  promotionsFor(orig, dest) {
    const base = orig + dest;
    return this.legalUci()
      .filter((m) => m.length > 4 && m.slice(0, 4) === base)
      .map((m) => m.slice(4));
  }

  // Apply a board move. `promo` (a suffix like 'q') picks the promotion piece;
  // if omitted on a promotion move we fall back to queen. Returns the full UCI
  // actually played, or null if illegal.
  applyMove(orig, dest, promo) {
    const base = orig + dest;
    const legals = this.legalUci();
    let uci;
    if (promo) uci = legals.find((m) => m === base + promo);
    if (!uci) uci = legals.find((m) => m === base);
    if (!uci) {
      const promos = legals.filter((m) => m.length > 4 && m.slice(0, 4) === base);
      uci = promos.find((m) => m.endsWith('q')) || promos[0];
    }
    if (!uci) return null;
    this.board.push(uci);
    return uci;
  }

  // Apply a pocket drop (crazyhouse &c). `role` is a chessgroundx role id
  // ('p-piece'); ffish drop UCI uses the uppercase piece letter ("P@e4").
  applyDrop(role, dest) {
    const uci = role[0].toUpperCase() + '@' + dest;
    if (!this.legalUci().includes(uci)) return null;
    this.board.push(uci);
    return uci;
  }

  applyUci(uci) {
    return this.board.push(uci);
  }

  // Replace the current position from a FEN (same variant). Useful for setting
  // up handicap/test positions.
  setFen(fen) {
    this.board.setFen(fen);
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

// Build a random legal Chess960 starting FEN: bishops on opposite colours, the
// king between the two rooks. (We don't need Scharnagl numbering — any legal
// arrangement is a fine random 960 start.)
function generateChess960Fen() {
  const rank = new Array(8).fill(null);
  const empties = () => rank.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
  const place = (piece, squares) => {
    const i = squares[Math.floor(Math.random() * squares.length)];
    rank[i] = piece;
    return i;
  };

  // Bishops on opposite-coloured squares.
  place('b', [0, 2, 4, 6]);
  place('b', [1, 3, 5, 7]);
  // Queen and the two knights anywhere still free.
  place('q', empties());
  place('n', empties());
  place('n', empties());
  // The three remaining squares, left to right, become rook–king–rook.
  const [r1, k, r2] = empties();
  rank[r1] = 'r';
  rank[k] = 'k';
  rank[r2] = 'r';

  const black = rank.join('');
  const white = black.toUpperCase();
  return `${black}/pppppppp/8/8/8/8/PPPPPPPP/${white} w KQkq - 0 1`;
}
