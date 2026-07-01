// Rules / legality / FEN authority — ffish.js (Fairy-Stockfish move generator).
// This is the single source of truth for what is legal, for every variant. The
// board UI only renders; every move is validated here, and the engine is only
// ever handed FENs that originate from this module.
import ffishModule from '../vendor/ffish/ffish.js';
import { FEN_MESSAGES } from './variant-config.js?v=7';

let ffish = null;

export async function initRules() {
  // locateFile is resolved against the page URL, so keep it relative (no
  // leading slash) — this works whether served from / or from /<repo>/ on
  // GitHub Pages project sites.
  ffish = await ffishModule({ locateFile: (p) => 'vendor/ffish/' + p });
}

// Register a custom variant (variants.ini text) with the rules engine.
// Idempotent: identical config text is registered only once. Re-loading the
// same variant name otherwise makes ffish warn ("Variant 'x' already exists"),
// and the editor calls this on every validation — so de-dupe here, mirroring
// the engine side's lastEngineIni guard, and callers can call freely.
const loadedInis = new Set();
export function loadVariantConfig(ini) {
  if (loadedInis.has(ini)) return;
  ffish.loadVariantConfig(ini);
  loadedInis.add(ini);
}

// The golden-rule gate: prove Fairy-Stockfish can actually evaluate this variant
// + start position before anything tries to play it. Returns
// { ok, code, message, fen }; `ok` is true only for FEN_OK (1).
//
// Note on this ffish build: variants registered via loadVariantConfig validate
// by name immediately, but BUILT-IN variants are only registered with
// validateFen on first Board construction. So we "warm" by-name variants with a
// throwaway Board before validating (and read their default FEN there too).
export function validate(compiled) {
  if (compiled.ini) {
    try {
      loadVariantConfig(compiled.ini);
    } catch (e) {
      return { ok: false, code: null, message: 'Bad variant config: ' + e.message, fen: null };
    }
  }
  let fen = compiled.startFen;
  if (!compiled.ini) {
    // Built-in (or chess960): warm so validateFen knows the name; take the
    // default FEN if none was given explicitly.
    try {
      const warm = new ffish.Board(compiled.name);
      if (!fen) fen = warm.fen();
      warm.delete();
    } catch {
      return { ok: false, code: null, message: `Unknown variant "${compiled.name}".`, fen: null };
    }
  }
  const code = ffish.validateFen(fen, compiled.name);
  return { ok: code === 1, code, message: FEN_MESSAGES[code] || `Invalid (code ${code}).`, fen };
}

// --- UCI move parsing ------------------------------------------------------
//
// Two wrinkles beyond "e2e4":
//   - Walling variants (wallingRule, e.g. the editor's crumble mode) suffix
//     moves with a comma + wall placement: "d1c1,c1d1", "a4a5q,a5a4". The part
//     before the comma is the ordinary move; push() needs the full string.
//   - Boards with 10 ranks have three-character squares ("a10"), so fixed
//     slice(0,2)/slice(2,4) parsing is wrong on the 12×10 envelope.
// parseUci handles both; drops ("P@e4") don't match and are handled by their
// own paths (walling and drops are mutually exclusive in FSF anyway).

const baseOf = (uci) => {
  const i = uci.indexOf(',');
  return i === -1 ? uci : uci.slice(0, i);
};

// "10" must be tried before single digits so "a1a10" parses as a1→a10.
const MOVE_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))([a-z]*)$/;

// → { from, to, promo } for a board move (ignoring any wall suffix), or null
// for drops / anything else.
export function parseUci(uci) {
  const m = MOVE_RE.exec(baseOf(uci));
  return m ? { from: m[1], to: m[2], promo: m[3] } : null;
}

// Square-name translation. ffish/UCI spell rank 10 out ("a10"); chessgroundx
// keys use one character per rank, ':' for 10 ("a:"). The Game API below
// accepts and returns CHESSGROUNDX KEYS — its callers are all board-UI-facing
// — and speaks UCI only to ffish. Both helpers pass through squares already in
// their target notation, so mixed input is safe.
export const uciToKey = (sq) => (sq.endsWith('10') ? sq[0] + ':' : sq);
export const keyToUci = (key) => (key[1] === ':' ? key[0] + '10' : key);

export class Game {
  // `compiled` is a compiled variant from src/variant-config.js.
  constructor(compiled) {
    this.v = compiled;
    // Custom variants must be registered with ffish before constructing a Board.
    if (compiled.ini) loadVariantConfig(compiled.ini);
    if (compiled.chess960) {
      // Fairy-Stockfish/ffish need an explicit shuffled start position and the
      // is960 flag (castling targets are file-relative in 960).
      this.startFen = compiled.startFen || generateChess960Fen();
      this.board = new ffish.Board(compiled.name, this.startFen, true);
    } else if (compiled.startFen) {
      this.startFen = compiled.startFen;
      this.board = new ffish.Board(compiled.name, compiled.startFen);
    } else {
      this.board = new ffish.Board(compiled.name);
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
      const p = parseUci(mv);
      const from = p ? uciToKey(p.from) : mv.slice(0, 2); // drops: "P@" origin key
      const to = uciToKey(p ? p.to : baseOf(mv).slice(2));
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
    const from = keyToUci(orig);
    const to = keyToUci(dest);
    const out = [];
    for (const mv of this.legalUci()) {
      const p = parseUci(mv);
      if (p && p.promo && p.from === from && p.to === to) out.push(p.promo);
    }
    return out;
  }

  // Apply a board move. `promo` (a suffix like 'q') picks the promotion piece;
  // if omitted on a promotion move we fall back to queen. Returns the full UCI
  // actually played (including any wall suffix), or null if illegal.
  applyMove(orig, dest, promo) {
    const from = keyToUci(orig);
    const to = keyToUci(dest);
    const candidates = [];
    for (const mv of this.legalUci()) {
      const p = parseUci(mv);
      if (p && p.from === from && p.to === to) candidates.push({ mv, promo: p.promo });
    }
    let hit;
    if (promo) hit = candidates.find((c) => c.promo === promo);
    if (!hit) hit = candidates.find((c) => !c.promo);
    if (!hit) hit = candidates.find((c) => c.promo === 'q') || candidates[0];
    if (!hit) return null;
    this.board.push(hit.mv);
    return hit.mv;
  }

  // Apply a pocket drop (crazyhouse &c). `role` is a chessgroundx role id
  // ('p-piece'); ffish drop UCI uses the uppercase piece letter ("P@e4").
  applyDrop(role, dest) {
    const uci = role[0].toUpperCase() + '@' + keyToUci(dest);
    if (!this.legalUci().includes(uci)) return null;
    this.board.push(uci);
    return uci;
  }

  applyUci(uci) {
    return this.board.push(uci);
  }

  // [from, to] chessgroundx keys of a UCI move (for last-move highlighting),
  // or [dest] for a drop. Wall suffixes and 3-char squares handled.
  endsOf(uci) {
    const p = parseUci(uci);
    if (p) return [uciToKey(p.from), uciToKey(p.to)];
    const base = baseOf(uci);
    const at = base.indexOf('@');
    return at >= 0 ? [uciToKey(base.slice(at + 1))] : undefined;
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
