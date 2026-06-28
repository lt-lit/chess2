# Chess Roguelike — Fairy-Stockfish playground

A client-side **playground for exploring Fairy-Stockfish's capabilities**,
running entirely in the browser, served from GitHub Pages, tap-to-move on
mobile. It grew out of the Phase 0 technical spike from the
[design brief](./chess-roguelike-prototype-brief.md) — which proved the engine
loads and returns strong moves at acceptable latency in a phone browser,
single-threaded, on a static host — and now exposes a panel of knobs to
experiment with what the engine can actually do.

## What it does

An **experiment panel** drives the engine through its range:

- **Variant** — standard chess plus everything that plays on an 8×8 board:
  Chess960, Crazyhouse (with pockets + drops), King of the Hill, Three-check,
  Atomic, Antichess, Horde, and Racing Kings.
- **You play** — White or Black (the engine opens when you take Black).
- **Strength** — full strength, capped `Skill Level`, or a target `UCI_Elo`, so
  the opponent can be a beatable sparring partner instead of always full power.
- **Think** — bound the search by depth, move-time, or node count.
- **Lines** — show the top 1/3/5 candidate moves (`MultiPV`) with a live
  per-line eval readout, always from your point of view.

Promotions get a proper piece chooser (including under-promotion, and king
promotion in Antichess). Each engine move still reports its think-time in ms.

> Shogi, Xiangqi, and Capablanca are the next step — they each need a different
> board geometry and piece set, so they're staged after this 8×8 family.

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
- **Variant registry** — `src/variants.js` is the single source of truth for
  which variants the panel offers and the per-variant facts (engine name,
  pockets, promotion roles) the rules/engine/UI each need.

No build step. No backend. Everything is vendored and loaded directly.

Append `?debug` to the URL to expose a small read-only `window.__pg` handle
(live game + move entry points) for manual poking; it has no effect otherwise.

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

Validated in headless Chromium: engine loads in ~2s and returns strong legal
moves in well under a second on desktop hardware. All nine 8×8 variants play
end to end (engine replies, no console errors); crazyhouse pockets + drops,
the promotion chooser (incl. under-promotion), strength capping, the search
limits, and the MultiPV readout were each exercised through the UI. The open
Phase 0 question — per-move latency on a real mid-range phone — is what to
measure next on the deployed site.
