# Phase 0 findings

The brief's Phase 0 was a make-or-break technical spike (brief §4): can a
full-strength Fairy-Stockfish game run in a mobile browser, served from GitHub
Pages, single-threaded? **Verdict: yes — validated.** This note records what we
learned, so the decisions don't have to be re-derived later.

## Result

- The engine loads (~2s) and plays **full strength** in a phone browser on the
  live GitHub Pages site, single-threaded.
- **Latency:** depth 12 returns in **~230 ms on a real phone** (Firefox mobile),
  and <1 s on desktop. The depth selector (8–16) is in the UI to keep probing
  the ceiling — depth 12 is comfortably fast on mobile, with clear headroom to go
  deeper if a position warrants it.
- Open Phase 0 questions from brief §7 now answered:
  - **Mobile engine perf ceiling** — comfortable at depth 12; not a blocker.
  - **Board rendering** — decided: **chessgroundx**, confirmed to load with no
    build step as native ES modules.

## Key technical decisions & deviations from the brief

- **Engine hosting / `SharedArrayBuffer`.** The brief (§3) hoped to use a
  single-threaded FSF build to *avoid* coi-serviceworker. In practice **no
  prebuilt single-threaded Fairy-Stockfish WASM exists** — every published build
  requires `SharedArrayBuffer`, which plain GitHub Pages can't grant via headers.
  Decision: use **coi-serviceworker** (root-scoped) to supply COOP/COEP
  client-side, and keep the *search* single-threaded via UCI `Threads=1` for the
  determinism the brief actually wants. This is a small, reversible deviation.
- **Service-worker scope gotcha.** The coi shim must live at the **site root**;
  a service worker only controls pages at or below its own path. A vendored copy
  in `vendor/` caused an infinite reload loop on the deployed site.
- **Rules library.** Used **ffish-es6** (a proper ESM build) rather than the
  default `ffish` package, which is a non-ESM global — cleaner for the no-build
  module setup.
- **Pieces.** chessgroundx's bundled `cburnett.css` uses the *old* chessground
  class names (`piece.pawn.white`); chessgroundx's runtime uses `-piece` role
  classes (`piece.white.p-piece`). Regenerated as `css/pieces.css`.
- **Eval.** Classical eval only (`Use NNUE = false`, no NNUE file loaded), per
  the brief.

## Known limitations / follow-ups (not blockers for Phase 0)

- **Engine runs on the main thread.** It plays fine (sub-second), but a very deep
  search or a heavy position could jank the UI. If that shows up, move the engine
  into a Web Worker. Deferred until perf proves it necessary.
- **Promotion auto-queens** — no piece chooser yet.
- **Draw / stalemate handling** is unaddressed (brief §7 flags stalemate-as-draw
  as a feel-bad in a must-win game). Relevant from Phase 1 on, not Phase 0.
- **Opening determinism** — fixed depth from a fixed position plays the same game
  every time; MultiPV (brief §5) is the eventual mitigation.
