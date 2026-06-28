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
  '-3': 'Too many kings (max one per side).',
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
