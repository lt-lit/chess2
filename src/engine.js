// Opponent engine — full-strength Fairy-Stockfish (WASM UCI).
//
// Phase 0 constraints (see design brief §3):
//   - Single-threaded SEARCH (Threads=1) for reproducibility.
//   - Classical eval only (Use NNUE = false) — no trained nets.
//   - Full strength, always. No Skill Level / UCI_Elo capping.
//
// The WASM build requires SharedArrayBuffer, which plain GitHub Pages can't
// grant via headers; coi-serviceworker (loaded in index.html) supplies the
// COOP/COEP context client-side so this can run on a static host.
//
// stockfish.js is a non-ESM emscripten factory exposed as a global, so we load
// it with a classic <script> tag rather than `import`.

let sf = null;
const listeners = new Set();

function emit(line) {
  for (const l of listeners) l(line);
}

function send(cmd) {
  sf.postMessage(cmd);
}

// Resolve once a line satisfying `until` arrives after sending `cmd`.
function command(cmd, until) {
  return new Promise((resolve) => {
    const l = (line) => {
      if (until(line)) {
        listeners.delete(l);
        resolve(line);
      }
    };
    listeners.add(l);
    send(cmd);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export async function initEngine() {
  await loadScript('vendor/stockfish/stockfish.js');
  // eslint-disable-next-line no-undef
  sf = await Stockfish({ locateFile: (p) => 'vendor/stockfish/' + p });
  sf.addMessageListener((line) => emit(line));

  await command('uci', (l) => l === 'uciok');
  send('setoption name Threads value 1');
  send('setoption name Use NNUE value false');
  send('setoption name Hash value 64');
  send('setoption name UCI_Variant value chess');
  await command('isready', (l) => l === 'readyok');
}

export function newGame() {
  send('ucinewgame');
  return command('isready', (l) => l === 'readyok');
}

// Returns the engine's best move as a UCI string for the given position.
// Fixed depth keeps the move deterministic (single-threaded). `onInfo` (if
// given) receives raw UCI `info` lines for a live thinking readout.
export function getBestMove(fen, { depth = 12, onInfo } = {}) {
  return new Promise((resolve) => {
    const l = (line) => {
      if (typeof line !== 'string') return;
      if (onInfo && line.startsWith('info ')) onInfo(line);
      if (line.startsWith('bestmove')) {
        listeners.delete(l);
        resolve(line.split(/\s+/)[1]);
      }
    };
    listeners.add(l);
    send('position fen ' + fen);
    send('go depth ' + depth);
  });
}
