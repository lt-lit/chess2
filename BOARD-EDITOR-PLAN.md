# Board Editor — plan

> **Status: rough, living plan.** This is the agreed direction as of 2026-06-28,
> not a frozen spec. Sessions, scope, and ordering will shift as we learn things
> (especially after the Session 1 spike). Update this doc as decisions change.

## Vision

A full **board editor** for the Fairy-Stockfish playground — think the lichess
board editor, but with *all* the fairy options. You can resize the board, freely
arrange the starting pieces, and dial in the full range of Fairy-Stockfish
variant rules. The point is to **get wacky**: build positions and rulesets FSF
was never specifically tuned for, then play them.

## The keystone insight

A board editor "with all the fairy options" is, mechanically, **a front-end that
emits a Fairy-Stockfish `variants.ini` config string + a `startFen`**, and hands
that to the two authorities the app already has.

Both vendored wasm builds are the **largeboards** build and already contain the
entire custom-variant machinery (`loadVariantConfig`, `VariantPath`,
`pieceToCharTable`, Betza `customPiece*`, ~150 modifier parameters). **So the
whole thing is achievable client-side with no engine rebuild.** The work is UI +
a config compiler, not engine work.

This reframes `src/variants.js`: today it is a static registry of 9 hardcoded
variants; it becomes a **variant compiler** — editor state → `.ini` + FEN →
loaded into both engines at runtime.

Mapping onto the app's prime directive (one rules authority + one engine, both
fed the same position):

- **Rules side (ffish):** `ffish.loadVariantConfig(iniString)`, then
  `new ffish.Board(name, fen)`. Confirmed present in `vendor/ffish/ffish.js`.
- **Engine side (stockfish.wasm):** the *same* `.ini` written into the wasm's
  in-memory FS and selected via `setoption name VariantPath` + `UCI_Variant`.
  The `VariantPath` symbol is in our binary; `engine.js` already sets
  `UCI_Variant`. **This is the one integration path not yet exercised in this
  repo — de-risk it first (Session 1).**

## The golden rule (hard invariant)

**Every board state the editor produces MUST be evaluable by Fairy-Stockfish.**

Enforced at the **Editor → Play boundary**: the editor refuses to start a
playtest unless the config passes `ffish.validateFen(fen, name) === 1`
(`FEN_OK` — the only passing value) *and* the engine successfully loads it.
"Evaluable by FSF" is enforced by FSF itself, not by us guessing. Nothing wacky
reaches the board without first proving the engine can run it.

### What "evaluable" gets you (honest expectations)

- **Legality: always perfect.** The move generator is exact for any valid
  config. It never makes or allows an illegal move on any board you can build.
- **Tactics: strong, often superhuman, on any board.** Still deep alpha-beta
  search. Bigger boards raise the branching factor, so at a *fixed* depth it
  sees less far — compensate with more depth / movetime.
- **Strategy: variable on alien variants.** FSF's classical eval (NNUE off, per
  the brief) is hand-tuned for *known* variants. On novel ones it falls back to
  generic material + piece-square heuristics, and custom pieces get rough
  auto-estimated values. Exotic win conditions are only partly understood. A
  thoughtful human can sometimes out-strategize it even while it crushes
  tactically.
- **Levers to push it back toward superhuman:** deeper search, and setting
  `pieceValueMg` / `pieceValueEg` for custom pieces so it knows their worth.

For a playground this is a feature, not a bug — probing where FSF's understanding
breaks is half the point.

## Decisions locked in (from discussion)

1. **Anything-goes**, bounded only by the golden rule above.
2. **No new chess assets until the fairy-piece session.** v1 palette is the 6
   piece types we already have art for (`k q r b n p`). All fairy/custom-piece
   art + the Betza designer are deferred to Session 4. **But** the editor data
   model represents arbitrary piece types from day one, so adding fairy pieces
   later is additive, not a refactor.
3. **Separate Editor mode and Play mode** — different screens. Editing and
   playtesting do not share a screen. The compile-and-validate step is the
   boundary between them.

## Board-size envelope (verified against FSF `types.h` / `apiutil.h`)

- **Max 12 files × 10 ranks** (hard largeboards compile-time cap). Min 1×1
  geometrically; floor the picker around 3×3 for sanity. **Picker range:
  1–12 files, 1–10 ranks.**
- **FEN must be exactly rectangular** — `maxRank+1` ranks, each exactly
  `maxFile+1` files. No "holes" in the FEN.
- **Non-rectangular / restricted boards** (palaces, odd shapes) are done by
  *confining pieces* with `mobilityRegion`, not by gaps in the FEN. Bounding box
  still ≤ 12×10.
- **Max one actual king per side.** "Multiple royals" only via
  `extinctionPseudoRoyal` on non-king types.
- **Validation:** build the `.ini`, call `ffish.validateFen(fen, name)`, accept
  only `1`. Other values map to specific errors (`-8` geometry, `-3` too many
  kings, `-9` touching kings, …) for live red/green feedback. A trial
  `new ffish.Board(...)` in try/catch is the belt-and-suspenders check.

## The four requirements

1. **Resize the board** — size picker within the envelope above; FSF-validated.
2. **Edit starting pieces & positions** — free-placement board (chessgroundx
   already supports arbitrary geometry + arbitrary piece letters), serialized to
   `startFen`. Includes side-to-move, castling rights, pockets.
3. **Fairy pieces** — built-in fairy types + fully custom Betza pieces.
   *Deferred to Session 4 (asset-dependent).*
4. **All fairy modifiers, separated by scope** — see taxonomy below.

## Modifier taxonomy by scope

Verified against the engine's `parser.cpp`. The rule that makes the three
buckets crisp:

> **Per-color** = keys with a `White`/`Black` *suffix* (the unsuffixed base key
> sets *both* colors; the suffix overrides one). **Per-piece** = keys genuinely
> *indexed by a piece type*. Everything else is **board-wide** — *including*
> board-wide lists that merely *name* which piece types a global mechanic acts
> on (the common trap: those are board-wide, not per-piece).

This maps directly to the editor UI: a global **Rules** panel (board-wide), a
**White army / Black army** toggle (per-color), and a per-piece **inspector**
opened from the palette (per-piece).

### A. Universal / board-wide

- **Geometry:** `maxFile`, `maxRank`, `startFen`, `pieceToCharTable`.
- **Win / loss / draw:** `checkmateValue`, `stalemateValue`, `checking`,
  `stalematePieceCount`; check-counting (`checkCounting`); extinction
  (`extinctionValue`, `extinctionPieceTypes`, `extinctionPieceCount`,
  `extinctionOpponentPieceCount`, `extinctionPseudoRoyal`, `extinctionClaim`,
  `dupleCheck`); race-to-region (`flagPiece`, `flagRegion`, `flagPieceCount`,
  `flagMove`, `flagPieceSafe`, `flagPieceBlockedWin`); n-in-a-row (`connectN`,
  `connectNxN`, `collinearN`, `connectHorizontal/Vertical/Diagonal`,
  `connectValue`, `connectPieceTypes`); built-in flags `kingofthehill` /
  `kinglet`; `castlingWins`; `materialCounting`, `countingRule`,
  `adjudicateFullBoard`.
- **Drops & hands:** `pieceDrops`, `capturesToHand`, `dropLoop`, `dropChecks`,
  `dropPromoted`, `firstRankPawnDrops`, `promotionZonePawnDrops`,
  `dropNoDoubled` / `dropNoDoubledCount`, `dropOppositeColoredBishop`,
  `mustDrop` / `mustDropType`, `enclosingDrop` / `enclosingDropStart`.
- **Castling:** `castling`, `castlingRank`, `castlingKingFile`,
  `castlingKingsideFile`, `castlingQueensideFile`,
  `castlingRookKingsideFile`, `castlingRookQueensideFile`,
  `castlingDroppedPiece`, `oppositeCastling`, `chess960`.
- **Pawn / promotion:** `doubleStep`, `enPassantRegion`, `enPassantTypes`,
  `pawnTypes`, `promotionRegion`, `promotionPieceTypes`, `promotionPawnTypes`,
  `mandatoryPawnPromotion`, `mandatoryPiecePromotion`, `piecePromotionOnCapture`,
  `promotionLimit`.
- **Special move rules:** `pass` / `passOnStalemate`, `wallingRule` /
  `wallingRegion` / `wallOrMove` (duck-style walls), `flipEnclosedPieces`
  (reversi), `mustCapture` (antichess), `immobilityIllegal`, `flyingGeneral`,
  `makpongRule`, `cambodianMoves`, `diagonalLines`, `bikjangRule`,
  `shogiPawnDropMateIllegal`, `shatarMateRule`, `gating` / `seirawanGating`.
- **Capture effects:** `blastOnCapture` (atomic), `blastImmuneTypes`,
  `petrifyOnCaptureTypes`, `petrifyBlastPieces`, `mutuallyImmuneTypes`.
- **Repetition / counting:** `nMoveRule`, `nFoldRule`, `nFoldValue`,
  `nFoldValueAbsolute`, `moveRepetitionIllegal`, `perpetualCheckIllegal`,
  `chasingRule`.
- **⚠️ Board-wide lists that name piece types** (present as multi-select chips
  against the piece roster, but board-wide in scope): `extinctionPieceTypes`,
  `connectPieceTypes`, `pawnTypes`, `enPassantTypes`, `promotionPieceTypes`,
  `promotionPawnTypes`, `nMoveRuleTypes`, `flagPiece`, `castlingKingPiece`,
  `castlingRookPieces`, `blastImmuneTypes`, `mutuallyImmuneTypes`,
  `petrifyOnCaptureTypes`, `mustDropType`, `dropNoDoubled`.

### B. Per-color (the `White`/`Black`-suffix family)

The **starting army itself is inherently per-color** (the two halves of
`startFen` — e.g. Horde). Beyond that, the suffixed overrides:
`promotionRegion{W/B}`, `promotionPieceTypes{W/B}`, `promotionPawnTypes{W/B}`,
`doubleStepRegion{W/B}`, `tripleStepRegion{W/B}`, `enPassantRegion{W/B}`,
`enPassantTypes{W/B}`, `dropRegion{W/B}`, `castlingKingPiece{W/B}`,
`castlingRookPieces{W/B}`, `wallingRegion{W/B}`, `pass{W/B}`,
`passOnStalemate{W/B}`, `nMoveRuleTypes{W/B}`, `flagPiece{W/B}`,
`flagRegion{W/B}`, `connectRegion1/2{W/B}`.

### C. Per-piece (indexed by an individual piece type)

- **Existence + FEN letter:** `<pieceName> = <letter>` enables a built-in type;
  `= -` removes it.
- **Custom movement:** `customPiece1..N = <letter>:<betza>` (Betza notation);
  royal custom king via `king = k:<betza>`.
- **Per-piece promotion:** `promotedPieceType` (source→target, shogi-style),
  per-type caps in `promotionLimit`, `pieceDemotion`.
- **Per-piece values:** `pieceValueMg` / `pieceValueEg` (`q:950 r:500 …`) — how
  you tell the engine what custom pieces are worth (matters for play strength).
- **Per-piece + per-color movement confinement:**
  `mobilityRegion<Color><PieceName>` (e.g. `mobilityRegionWhiteAdvisor`) — also
  the mechanism for non-rectangular boards.

A full per-key reference table (every key with meaning, value-type, example) can
be generated into a separate `docs/` reference when we start Session 3.

### Notes for the compiler

- **Emit modern keys only.** Deprecated aliases exist
  (`promotionRank`→`promotionRegion`, `doubleStepRank`→`doubleStepRegion`,
  `whiteFlag`→`flagRegionWhite`, `dropOnTop`→`enclosingDrop`). Output the
  region-based forms.

## Session breakdown

Ordered by risk and dependency: prove the scary part first, then build outward.
**Each session ends with the app still fully working and shippable.**

### Session 1 — Foundations (de-risking)

- Build the **variant compiler** (editor state → `.ini` + `startFen`).
- Wire it into **both** ffish (`loadVariantConfig`) and the engine
  (`VariantPath` + in-memory FS). **Prove a custom config plays end-to-end** —
  this is the main technical unknown.
- Refactor the 9 existing presets to run *through* the compiler (success =
  current app behaves identically, now compiler-powered).
- Add the **Play ↔ Editor mode switch** (Editor can be a stub).
- Generalize the board to **dynamic dimensions**.
- Ship the shared **validation gate** utility.
- No new assets. Highest technical risk lives here.

### Session 2 — Board editor: geometry + free setup

- Editor screen: **size picker** (1–12 × 1–10), free placement with the 6
  standard pieces, palette / eraser / clear / flip / load-FEN, side-to-move +
  castling rights + pockets.
- **Live red/green validation** with mapped error messages.
- **"Play this position"** handoff (compile → validate → Play mode).
- Save / load / share a variant (URL hash and/or localStorage).
- Delivers requirements **1 & 2** end-to-end, standard pieces only. No assets.
- First genuinely satisfying milestone.

### Session 3 — Modifiers / rules (likely split 3a + 3b)

- **3a:** board-wide rules — win conditions, capture effects (atomic, walls,
  petrify), drops/hands, castling, promotion, special move rules.
- **3b:** per-color asymmetry (the White/Black family) + piece-type-list chips +
  per-piece values for the standard pieces.
- Each modifier ≈ "one compiler field + one control + the validation gate," so
  incremental and parallelizable.
- **Most of the "get wacky" lives here, and it needs zero new assets.**

### Session 4 — Fairy & custom pieces (asset session)

- Wire a fairy SVG set for built-in fairy types (+ per-color art).
- Build the **Betza custom-piece designer** (per-piece inspector: letter,
  movement, promotion mapping, `mobilityRegion`) with a generated-glyph fallback
  for novel pieces.
- The explicitly asset-dependent work, deferred per decision #2.

### Session 5 — Polish

- Variant library, import/export, share codes.
- Move the engine into a **Web Worker** if big boards start to jank the UI
  (already flagged as a Phase-0 follow-up).
- Eval-quality affordances (expose `pieceValueMg/Eg` tuning, depth).

## Open questions / revisit later

- **Fairy timing:** keep the Betza designer in Session 4, or pull a
  letter-glyph-fallback version into Session 3 and backfill art in Session 4?
- **Asset source & licensing** for the fairy set (decide before Session 4).
- **Share format:** full variant (`.ini` + FEN) serialized to URL hash vs. short
  code vs. localStorage library — decide in Session 2.
- **Engine `VariantPath` loading** is assumed-feasible but unproven in this repo
  — the Session 1 spike confirms or forces a fallback.
