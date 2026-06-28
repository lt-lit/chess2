# Third-party notices

This project vendors the following components (all under `vendor/`, plus the
service-worker shim at the repo root). Their license texts and copyright notices
are preserved as required.

| Component | Version | Role | License | Source |
|-----------|---------|------|---------|--------|
| ffish-es6 | 0.7.9 | Rules / legality / FEN (Fairy-Stockfish move generator, WASM) | GPL-3.0 | https://github.com/fairy-stockfish/Fairy-Stockfish · npm `ffish-es6` |
| fairy-stockfish-nnue.wasm | 1.1.11 | Opponent engine (Fairy-Stockfish UCI search, WASM) | GPL-3.0 | https://github.com/fairy-stockfish/fairy-stockfish.wasm |
| chessgroundx | 10.7.5 | Board UI | GPL-3.0 | https://github.com/gbtami/chessgroundx (license text: `vendor/chessgroundx/LICENSE`) |
| cburnett piece set | — | Chess piece SVGs (inlined in `css/pieces.css`) | GPL-2.0-or-later | Colin M.L. Burnett, via lichess/chessgroundx |
| coi-serviceworker | 0.1.7 | COOP/COEP shim for `SharedArrayBuffer` on static hosts | MIT | https://github.com/gzuidhof/coi-serviceworker |

## Implications

The engine, move generator, board UI, and piece art are all GPL. A combined
distribution of this work is therefore covered by the **GPL-3.0**. This is
expected and fine — Fairy-Stockfish is GPL, so the brief already assumed a
GPL-compatible licensing zone (see brief §5, "Assets").

The project's own source (`src/`, `css/app.css`, `index.html`) does not yet
declare a license. Before any non-prototype release, add a top-level `LICENSE`
(GPL-3.0 is the compatible choice given the dependencies).

## Attribution shown to users

`index.html` displays a visible credit line for Fairy-Stockfish, chessgroundx,
and the cburnett pieces, satisfying the attribution expectation noted in the
brief.
