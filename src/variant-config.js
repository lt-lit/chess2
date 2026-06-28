// Variant compiler — the seam between "what the user picked/built" and "what the
// rules layer, the engine, and the board UI each need".
//
// A *spec* is the unit the registry (and, from Session 2, the editor) work in.
// `compile()` turns a spec into a *compiled variant*: the concrete facts every
// downstream consumer reads, plus — for custom variants — the variants.ini text
// that BOTH Fairy-Stockfish instances (ffish for rules, the WASM engine for the
// opponent) must load. Built-in variants are known to FSF by name and carry no
// ini; custom variants declare their own name + board size + start FEN + ini.
//
// Keeping this pure (no ffish, no DOM) means the same compiler serves the static
// preset registry and the live editor, and the rest of the app stays
// variant-agnostic.

export const DEFAULT_DIMENSIONS = { width: 8, height: 8 };

// Fairy-Stockfish largeboards build hard limits (see BOARD-EDITOR-PLAN.md).
// The editor must keep board sizes inside this envelope; anything outside simply
// cannot be represented by the engine.
export const SIZE_LIMITS = { minFiles: 1, maxFiles: 12, minRanks: 1, maxRanks: 10 };

// Fairy-Stockfish FenValidation codes (src/apiutil.h). Only 1 (FEN_OK) passes;
// 0 and every negative is a rejection. Used to turn validateFen()'s int into a
// human-readable reason at the editor → play boundary (the golden-rule gate).
export const FEN_MESSAGES = {
  1: 'OK',
  0: 'Empty FEN.',
  '-1': 'Invalid move counter.',
  '-2': 'Invalid half-move counter.',
  '-3': 'Wrong number of kings (need exactly one per side).',
  '-4': 'Invalid en-passant square.',
  '-5': 'Invalid castling info.',
  '-6': 'Invalid side to move.',
  '-7': 'Invalid pocket info.',
  '-8': 'Board geometry does not match the declared size.',
  '-9': 'Kings are touching.',
  '-10': 'Invalid character in FEN.',
  '-11': 'Wrong number of FEN fields.',
  '-12': 'Invalid promoted piece.',
  '-13': 'Invalid check count.',
  '-14': 'Invalid counting rule.',
};

// --- editor FEN + ini emitter (Session 2a) -------------------------------
//
// The editor produces *structured state* (so far: just a board size); these
// pure helpers turn that into the two artifacts the pipeline needs — a start
// FEN and the variants.ini text — without touching ffish or the DOM. Built in
// 2a; the free-placement editor (2b) reuses the same emitter, swapping the
// auto-generated FEN for one read off the board.

// A unique FSF/ffish variant name per board geometry. Encoding the size means
// different sizes register as different variants (no override ambiguity), while
// re-emitting the same size is a harmless no-op re-registration.
// NOTE: once rules become user-editable (Session 3) this must also encode the
// rule set (e.g. a hash) so two different rulesets at one size don't collide.
export function editorVariantName(width, height) {
  return `editor${width}x${height}`;
}

// A sane standard-style back rank for a board `w` files wide: rooks in the
// corners, exactly one king near the centre, a queen beside it, bishops next
// and knights filling out. For w=8 this is exactly "rnbqkbnr". Returned in
// lowercase (Black's); uppercase it for White.
function standardBackRank(w) {
  if (w <= 0) return '';
  if (w === 1) return 'k';
  if (w === 2) return 'kr';
  const arr = new Array(w).fill(null);
  arr[0] = 'r';
  arr[w - 1] = 'r';
  arr[Math.floor(w / 2)] = 'k';
  const center = (w - 1) / 2;
  // Empty squares, nearest the centre first (stable tie-break by file).
  const byCenter = () =>
    arr
      .map((p, i) => (p === null ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
  const forQueen = byCenter();
  if (forQueen.length) arr[forQueen[0]] = 'q';
  // Nearest two remaining squares get bishops, the rest knights.
  byCenter().forEach((idx, i) => {
    arr[idx] = i < 2 ? 'b' : 'n';
  });
  return arr.join('');
}

// Placement-only FEN (no side/castling/… fields) for a fresh `w`×`h` board:
// armies on the outer ranks, pawns just inside when there's room (h ≥ 4),
// empty ranks between. For 8×8 this is the standard chess placement. Degenerate
// sizes (e.g. h ≤ 2) may be unplayable — the validation gate is what rejects
// them, so this stays a best-effort generator.
function standardPlacement(w, h) {
  const back = standardBackRank(w);
  const rows = [];
  for (let r = h; r >= 1; r--) {
    if (r === h) rows.push(back); // Black back rank (top)
    else if (r === 1) rows.push(back.toUpperCase()); // White back rank (bottom)
    else if (h >= 4 && r === h - 1) rows.push('p'.repeat(w)); // Black pawns
    else if (h >= 4 && r === 2) rows.push('P'.repeat(w)); // White pawns
    else rows.push(String(w)); // empty rank
  }
  return rows.join('/');
}

// Append the non-placement FEN fields. Split out so the free-placement editor
// (2b) can assemble a full FEN from the board's placement + UI choices.
export function assembleFen(placement, { stm = 'w', castling = '-', ep = '-', half = 0, full = 1 } = {}) {
  return `${placement} ${stm} ${castling} ${ep} ${half} ${full}`;
}

// A full, ready-to-play start FEN for a fresh `w`×`h` board.
export function standardSetupFen(w, h) {
  return assembleFen(standardPlacement(w, h));
}

// Emit variants.ini text for an editor board. Inherits from `chess` (`:chess`)
// and overrides only what geometry forces. THE RULE: whenever the board isn't
// 8×8, every geometry-coupled key must be overridden — the inherited chess
// defaults (promotion on rank 8, double-step from rank 2/7, castling) are wrong
// or invalid on a resized board and would silently break the variant.
//
// The `startFen` here is the variant's *canonical* default (the standard setup
// for the size), NOT the live edited position — it is deliberately a function of
// (width, height) only, so the ini text is stable per geometry. That matters
// for live editing: the editor validates on every change, and a stable ini lets
// loadVariantConfig de-dupe instead of re-registering the variant on each edit.
// The actual position is always passed explicitly to ffish.Board / validateFen
// (via compiled.startFen), so this default is never the position that's played.
export function buildIni({ width, height }) {
  const name = editorVariantName(width, height);
  const lines = [
    `[${name}:chess]`,
    `maxFile = ${width}`,
    `maxRank = ${height}`,
    `startFen = ${standardSetupFen(width, height)}`,
    // Promotion zones: top rank for White, bottom rank for Black.
    `promotionRegionWhite = *${height}`,
    `promotionRegionBlack = *1`,
  ];
  if (height >= 4) {
    // Pawns start on rank 2 (White) and rank height-1 (Black); double-step and
    // the en-passant square behind it scale with the board.
    lines.push(`doubleStepRegionWhite = *2`);
    lines.push(`doubleStepRegionBlack = *${height - 1}`);
    lines.push(`enPassantRegionWhite = *${height - 2}`);
    lines.push(`enPassantRegionBlack = *3`);
  } else {
    // No room for a pawn rank — turn the two-step (and thus en passant) off.
    lines.push(`doubleStep = false`);
  }
  // Castling is a Session-2b concern (king/rook file detection, X-FEN). Until
  // then only the true 8×8 board keeps chess castling; the start FEN carries no
  // castling rights regardless, so no position can actually castle yet.
  if (width !== 8 || height !== 8) lines.push(`castling = false`);
  return lines.join('\n');
}

// Wrap editor state into a *spec* the existing compile() understands, so the
// editor rides the same pipeline as the static registry. `state` is
// { width, height, startFen? } — startFen defaults to the standard setup.
export function editorSpec({ width, height, startFen }) {
  const fen = startFen || standardSetupFen(width, height);
  return {
    kind: 'custom',
    key: 'editor',
    label: `Custom ${width}×${height}`,
    name: editorVariantName(width, height),
    dimensions: { width, height },
    startFen: fen,
    ini: buildIni({ width, height }),
    pocket: false,
    promo: ['q', 'r', 'b', 'n'],
    blurb: `Custom ${width}×${height} board.`,
  };
}

// Compile a spec into the shape rules.js / engine.js / main.js consume.
//
//   name       variant name handed to ffish.Board and UCI_Variant.
//   ini        variants.ini text to load into both engines, or null (built-in).
//   chess960   send UCI_Chess960 + start from a shuffled position.
//   startFen   explicit start FEN, or null to use the variant's built-in default.
//   dimensions { width, height } for the board UI (and a sanity echo of the ini).
//   pocket     drop variant: show pockets, allow drops.
//   promo      promotion roles offered in the UI (null = never promotes).
//   blurb      one-liner shown under the board.
export function compile(spec) {
  const isCustom = spec.kind === 'custom';
  return {
    key: spec.key,
    label: spec.label,
    name: isCustom ? spec.name : spec.engine || spec.ffish || spec.key,
    ini: isCustom ? spec.ini : null,
    chess960: !!spec.chess960,
    startFen: spec.startFen || null,
    dimensions: spec.dimensions || DEFAULT_DIMENSIONS,
    pocket: !!spec.pocket,
    promo: spec.promo === undefined ? ['q', 'r', 'b', 'n'] : spec.promo,
    blurb: spec.blurb || '',
  };
}
