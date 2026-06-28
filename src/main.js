// Phase 0 spike — standard chess, player (White) vs full-strength Fairy-Stockfish.
// Purpose: prove the engine loads and returns strong moves at acceptable
// latency in a mobile browser served from GitHub Pages. The board UI is
// chessgroundx; rules are ffish.js; the opponent is the FSF WASM engine.
import { Chessground } from '../vendor/chessgroundx/chessground.js';
import { initRules, Game } from './rules.js';
import { initEngine, newGame, getBestMove } from './engine.js';

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const newGameBtn = document.getElementById('new-game');
const depthSel = document.getElementById('depth');

let game;
let cg;
let thinking = false;
let lastMove; // [from, to] for highlighting

function setStatus(msg) {
  statusEl.textContent = msg;
}

function playerDests() {
  // White (the human) may move only on White's turn and only when the engine
  // isn't thinking.
  return !thinking && game.turnColor() === 'white' ? game.dests() : new Map();
}

function render() {
  cg.set({
    fen: game.fen(),
    turnColor: game.turnColor(),
    check: game.inCheck(),
    lastMove,
    movable: {
      free: false,
      color: 'white',
      dests: playerDests(),
    },
  });
}

function checkGameOver() {
  if (!game.isGameOver()) return false;
  const r = game.result();
  const msg =
    r === '1-0' ? 'Checkmate — you win! 🎉'
    : r === '0-1' ? 'Checkmate — Fairy-Stockfish wins.'
    : `Draw (${r}).`;
  setStatus(msg);
  return true;
}

async function engineTurn() {
  thinking = true;
  render();
  const depth = parseInt(depthSel.value, 10);
  setStatus(`Fairy-Stockfish is thinking… (depth ${depth})`);
  infoEl.textContent = '';

  const t0 = performance.now();
  const uci = await getBestMove(game.fen(), {
    depth,
    onInfo: (line) => {
      const m = line.match(/ depth (\d+).* score (cp|mate) (-?\d+)/);
      if (m) {
        // UCI scores are from the side-to-move's perspective (the engine, which
        // is Black here). Negate so the readout is always from White's (the
        // player's) point of view: positive = good for you.
        const raw = -parseInt(m[3], 10);
        const score = m[2] === 'mate' ? `#${raw}` : (raw / 100).toFixed(2);
        infoEl.textContent = `depth ${m[1]} · eval ${score}`;
      }
    },
  });
  const elapsed = Math.round(performance.now() - t0);

  game.applyUci(uci);
  lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
  thinking = false;
  render();

  setStatus(`Engine: ${uci} in ${elapsed} ms (depth ${depth}). Your move.`);
  checkGameOver();
}

function onPlayerMove(orig, dest) {
  const uci = game.applyMove(orig, dest);
  if (!uci) {
    // Shouldn't happen — dests constrains input — but resync to truth.
    render();
    return;
  }
  lastMove = [orig, dest];
  render();
  if (checkGameOver()) return;
  // Hand off to the engine on the next frame so the player's move paints first.
  requestAnimationFrame(() => engineTurn());
}

async function startNewGame() {
  game = new Game('chess');
  lastMove = undefined;
  thinking = false;
  await newGame();
  if (!cg) {
    cg = Chessground(boardEl, {
      fen: game.fen(),
      orientation: 'white',
      turnColor: 'white',
      coordinates: true,
      movable: {
        free: false,
        color: 'white',
        dests: game.dests(),
        showDests: true,
        events: { after: onPlayerMove },
      },
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
    });
  } else {
    render();
  }
  setStatus('Your move (White).');
}

async function main() {
  setStatus('Loading rules + engine…');
  try {
    await Promise.all([initRules(), initEngine()]);
  } catch (e) {
    setStatus('Failed to load engine: ' + e.message);
    throw e;
  }
  newGameBtn.addEventListener('click', () => startNewGame());
  await startNewGame();
}

main();
