# Chess Roguelike — Phase 0 spike

A playable game of **standard chess vs. full-strength Fairy-Stockfish**, running
entirely client-side, served from GitHub Pages, tap-to-move on mobile. This is
the make-or-break technical spike from the [design brief](./chess-roguelike-prototype-brief.md):
it exists to prove the engine loads and returns strong moves at acceptable
latency in a phone browser, single-threaded, on a static host.

## What it does

- Standard 8×8 chess, you play **White** against the engine.
- The opponent is **full-strength** Fairy-Stockfish (fixed depth, single-threaded
  search for reproducibility — no strength capping).
- Pick the engine search depth (8–16) to probe the mobile latency ceiling. Each
  engine move reports its think-time in ms and a live depth/eval readout.

## Architecture (per the brief's prime directive)

Everything derives from one rules authority and one engine, both fed the same
position:

- **Rules / legality / FEN** — [ffish.js](https://github.com/fairy-stockfish/Fairy-Stockfish)
  (`vendor/ffish/`, the ES6 build). Single source of truth; every move is
  validated here and the engine only ever sees FENs from it. (`src/rules.js`)
- **Opponent** — [Fairy-Stockfish WASM](https://github.com/fairy-stockfish/fairy-stockfish.wasm)
  UCI engine (`vendor/stockfish/`). Classical eval only, `Threads=1`. (`src/engine.js`)
- **Board UI** — [chessgroundx](https://github.com/gbtami/chessgroundx)
  (`vendor/chessgroundx/`), the lichess variant board. Loads as native ESM, no
  bundler. (`src/main.js`)
- **Pieces** — cburnett SVGs (GPL), inlined as data URIs in `css/pieces.css`,
  remapped to chessgroundx's `-piece` role classes.

No build step. No backend. Everything is vendored and loaded directly.

## SharedArrayBuffer / GitHub Pages

The Fairy-Stockfish WASM build requires `SharedArrayBuffer`, which needs COOP/COEP
response headers that GitHub Pages can't set. `coi-serviceworker.min.js` (loaded
first in `index.html`) supplies that context client-side. On first visit the page
auto-reloads once while the service worker installs.

The shim lives at the **repo root** on purpose: a service worker can only control
pages at or below its own path, so a copy in `vendor/` would never control the
root page and would reload forever. An inline reload-count guard in `index.html`
is a safety net against any future isolation failure.

The search itself runs single-threaded (`Threads=1`) for deterministic,
reproducible moves at a given depth — what the brief wants for later WDL/balance
work — independent of the SharedArrayBuffer requirement.

## Running locally

A service worker (and `SharedArrayBuffer`) needs a secure context. Either:

- serve over `http://localhost` (the coi-serviceworker handles the headers), or
- serve with COOP/COEP headers directly:
  `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`.

Then open `index.html`.

## Deploying to GitHub Pages

Push to the repo, then in **Settings → Pages**, set the source to deploy from the
branch (root). The `.nojekyll` file ensures the `vendor/` directory is served
as-is. No further configuration needed.

## Status

Validated in headless Chromium: engine loads in ~2s, returns strong legal moves
at depth 12 in well under a second on desktop hardware. The open Phase 0 question
— per-move latency on a real mid-range phone — is what to measure next on the
deployed site.
