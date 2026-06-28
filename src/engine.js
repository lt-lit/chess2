// Opponent engine — Fairy-Stockfish (WASM UCI).
//
// The board UI and rules layer are variant-agnostic; this module is where the
// engine is told *which* variant to play, how hard to think, and how strong to
// be. All of that is driven from the experiment panel via configure().
//
// Phase 0 invariants that still hold:
//   - Single-threaded SEARCH (Threads=1) for reproducibility.
//   - Classical eval only (Use NNUE = false) — no trained nets.
// Strength is now adjustable (full / Skill Level / UCI_Elo) instead of always
// full, so the engine can be a beatable sparring partner while experimenting.
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

function setoption(name, value) {
  send(`setoption name ${name} value ${value}`);
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

function ready() {
  return command('isready', (l) => l === 'readyok');
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
  setoption('Threads', 1);
  setoption('Use NNUE', false);
  setoption('Hash', 64);
  await ready();
}

// Apply the per-game options chosen in the panel. Call before newGame().
//   variant   { engine, chess960 } from the variant registry.
//   multipv   how many candidate lines to report (1 = just the best move).
//   strength  { mode: 'full' | 'skill' | 'elo', value }.
export async function configure({ variant, multipv = 1, strength } = {}) {
  setoption('UCI_Variant', variant.engine);
  setoption('UCI_Chess960', !!variant.chess960);
  setoption('MultiPV', Math.max(1, multipv));
  applyStrength(strength || { mode: 'full' });
  await ready();
}

function applyStrength(strength) {
  const { mode, value } = strength;
  if (mode === 'elo') {
    setoption('UCI_LimitStrength', true);
    setoption('UCI_Elo', value);
  } else if (mode === 'skill') {
    setoption('UCI_LimitStrength', false);
    setoption('Skill Level', value);
  } else {
    // full strength
    setoption('UCI_LimitStrength', false);
    setoption('Skill Level', 20);
  }
}

export function newGame() {
  send('ucinewgame');
  return ready();
}

// Returns the engine's best move as a UCI string for the given position.
// `limit` selects the search bound: { type: 'depth'|'movetime'|'nodes', value }.
// `onInfo` (if given) receives raw UCI `info` lines for a live thinking/MultiPV
// readout. With MultiPV > 1 the engine emits one `info … multipv N …` line per
// candidate; the returned move is always the top one (`bestmove`).
export function getBestMove(fen, { limit = { type: 'depth', value: 12 }, onInfo } = {}) {
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
    send(`go ${limit.type} ${limit.value}`);
  });
}
