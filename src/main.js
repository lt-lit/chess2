// Fairy-Stockfish playground — pick a variant, a side, a strength and a search
// limit, and play it. The board UI is chessgroundx; rules are ffish.js; the
// opponent is the FSF WASM engine. Everything variant-specific is described in
// src/variants.js so this file stays mostly variant-agnostic.
import { Chessground } from '../vendor/chessgroundx/chessground.js';
import { initRules, Game } from './rules.js';
import { initEngine, configure, newGame, getBestMove } from './engine.js';
import { VARIANTS, getVariant, pocketRoles } from './variants.js';

const boardEl = document.getElementById('board');
const pocketTopEl = document.getElementById('pocket-top');
const pocketBottomEl = document.getElementById('pocket-bottom');
const statusEl = document.getElementById('status');
const linesEl = document.getElementById('lines');
const promoEl = document.getElementById('promo');
const newGameBtn = document.getElementById('new-game');
const variantSel = document.getElementById('variant');
const sideSel = document.getElementById('side');
const strengthSel = document.getElementById('strength');
const limitSel = document.getElementById('limit');
const multipvSel = document.getElementById('multipv');

let game;
let cg;
let variant; // active variant for the current game
let playerColor = 'white';
let thinking = false;
let lastMove; // [from, to] for highlighting

const opposite = (c) => (c === 'white' ? 'black' : 'white');
const engineColor = () => opposite(playerColor);

function setStatus(msg) {
  statusEl.textContent = msg;
}

// --- panel readers -------------------------------------------------------

function readStrength() {
  const v = strengthSel.value;
  if (v === 'full') return { mode: 'full' };
  const [mode, value] = v.split(':');
  return { mode, value: parseInt(value, 10) };
}

function readLimit() {
  const [type, value] = limitSel.value.split(':');
  return { type, value: parseInt(value, 10) };
}

function readMultipv() {
  return parseInt(multipvSel.value, 10);
}

// --- board rendering -----------------------------------------------------

function playerDests() {
  return !thinking && game.turnColor() === playerColor ? game.dests() : new Map();
}

function render() {
  cg.set({
    fen: game.fen(),
    turnColor: game.turnColor(),
    check: game.inCheck(),
    lastMove,
    movable: {
      free: false,
      color: playerColor,
      dests: playerDests(),
    },
  });
}

function checkGameOver() {
  if (!game.isGameOver()) return false;
  const r = game.result();
  let msg;
  if (r === '1/2-1/2' || (r !== '1-0' && r !== '0-1')) {
    msg = `Draw (${r}).`;
  } else {
    const playerWon =
      (r === '1-0' && playerColor === 'white') || (r === '0-1' && playerColor === 'black');
    msg = playerWon ? 'You win! 🎉' : 'Fairy-Stockfish wins.';
  }
  setStatus(msg);
  return true;
}

// --- engine turn + readout ----------------------------------------------

const GLYPHS = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘', k: '♔' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞', k: '♚' },
};

// Render the live MultiPV readout. `lines` is a Map keyed by multipv index.
function renderLines(lines) {
  const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]);
  linesEl.innerHTML = rows
    .map(([i, l]) => {
      // UCI score is from the side-to-move (the engine). Negate so the readout
      // is always from the player's point of view: positive = good for you.
      const raw = -l.score;
      const score = l.mate ? `#${raw}` : (raw / 100).toFixed(2);
      const move = l.pv ? l.pv.split(' ')[0] : '';
      const tag = rows.length > 1 ? `<b>${i}.</b> ` : '';
      return `<div class="pvline">${tag}<span class="sc">${score}</span> <span class="mv">${move}</span> <span class="d">d${l.depth}</span></div>`;
    })
    .join('');
}

function parseInfo(line, lines) {
  // e.g. "info depth 14 ... multipv 2 score cp -23 ... pv e2e4 e7e5 ..."
  const idx = (line.match(/ multipv (\d+)/) || [, '1'])[1];
  const dm = line.match(/ depth (\d+)/);
  const sm = line.match(/ score (cp|mate) (-?\d+)/);
  const pm = line.match(/ pv (.+)$/);
  if (!sm) return;
  lines.set(parseInt(idx, 10), {
    depth: dm ? parseInt(dm[1], 10) : 0,
    mate: sm[1] === 'mate',
    score: parseInt(sm[2], 10),
    pv: pm ? pm[1] : '',
  });
}

async function engineTurn() {
  thinking = true;
  render();
  // Re-apply strength / MultiPV live so the panel can be tuned mid-game.
  await configure({ variant, multipv: readMultipv(), strength: readStrength() });
  const limit = readLimit();
  setStatus(`Fairy-Stockfish is thinking… (${limit.type} ${limit.value})`);

  const lines = new Map();
  const t0 = performance.now();
  const uci = await getBestMove(game.fen(), {
    limit,
    onInfo: (line) => {
      parseInfo(line, lines);
      renderLines(lines);
    },
  });
  const elapsed = Math.round(performance.now() - t0);

  game.applyUci(uci);
  lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
  thinking = false;
  render();

  setStatus(`Engine: ${uci} in ${elapsed} ms. Your move.`);
  checkGameOver();
}

function postPlayerMove() {
  render();
  if (checkGameOver()) return;
  // Hand off to the engine on the next frame so the player's move paints first.
  if (game.turnColor() === engineColor()) requestAnimationFrame(() => engineTurn());
}

// --- player input --------------------------------------------------------

function onPlayerMove(orig, dest) {
  const choices = game.promotionsFor(orig, dest);
  if (choices.length > 1) {
    askPromotion(choices, (promo) => finishMove(orig, dest, promo));
    return;
  }
  finishMove(orig, dest, choices[0]);
}

function finishMove(orig, dest, promo) {
  const uci = game.applyMove(orig, dest, promo);
  if (!uci) {
    render(); // shouldn't happen — dests constrain input — but resync to truth.
    return;
  }
  lastMove = [orig, dest];
  postPlayerMove();
}

function onPlayerDrop(piece, dest) {
  const uci = game.applyDrop(piece.role, dest);
  if (!uci) {
    render();
    return;
  }
  lastMove = [dest];
  postPlayerMove();
}

// Promotion chooser overlay. `choices` are suffix letters (q/r/b/n/k…).
function askPromotion(choices, done) {
  promoEl.innerHTML = '';
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.textContent = (GLYPHS[playerColor] && GLYPHS[playerColor][c]) || c.toUpperCase();
    btn.addEventListener('click', () => {
      promoEl.classList.add('hidden');
      done(c);
    });
    promoEl.appendChild(btn);
  }
  promoEl.classList.remove('hidden');
}

// --- new game ------------------------------------------------------------

async function startNewGame() {
  variant = getVariant(variantSel.value);
  playerColor = sideSel.value === 'black' ? 'black' : 'white';
  thinking = false;
  lastMove = undefined;
  linesEl.innerHTML = '';

  game = new Game(variant);
  await configure({ variant, multipv: readMultipv(), strength: readStrength() });
  await newGame();

  const cfg = {
    fen: game.fen(),
    orientation: playerColor,
    turnColor: game.turnColor(),
    coordinates: true,
    pocketRoles: pocketRoles(variant),
    movable: {
      free: false,
      color: playerColor,
      dests: game.dests(),
      showDests: true,
      events: { after: onPlayerMove, afterNewPiece: (piece, dest) => onPlayerDrop(piece, dest) },
    },
    animation: { enabled: true, duration: 200 },
    highlight: { lastMove: true, check: true },
    draggable: { showGhost: true },
  };
  // Pockets are created at construction time, so rebuild the board each new
  // game. Destroy the previous instance first to unbind its document listeners.
  // Reset the pocket hosts so a non-pocket variant doesn't inherit a stale
  // .pocket class / sizing from a previous crazyhouse game.
  if (cg) cg.destroy();
  for (const el of [pocketTopEl, pocketBottomEl]) {
    el.className = '';
    el.removeAttribute('style');
    el.innerHTML = '';
  }
  // chessgroundx renders pockets into these host elements (cleared above).
  cg = Chessground(boardEl, cfg, pocketTopEl, pocketBottomEl);

  setStatus(`${variant.label} — you play ${playerColor}.`);
  document.querySelector('.sub').textContent = variant.blurb;

  // If the human took Black, the engine (White) opens.
  if (game.turnColor() === engineColor()) requestAnimationFrame(() => engineTurn());
}

// --- boot ----------------------------------------------------------------

function populateVariants() {
  for (const v of VARIANTS) {
    const opt = document.createElement('option');
    opt.value = v.key;
    opt.textContent = v.label;
    variantSel.appendChild(opt);
  }
}

async function main() {
  populateVariants();
  setStatus('Loading rules + engine…');
  try {
    await Promise.all([initRules(), initEngine()]);
  } catch (e) {
    setStatus('Failed to load engine: ' + e.message);
    throw e;
  }
  // Read-only-ish debug handle (opt-in via ?debug) for manual inspection and
  // automated testing — exposes the live game + move entry points. No effect on
  // normal play.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__pg = {
      get game() { return game; },
      finishMove,
      drop: (role, dest) => onPlayerDrop({ role, color: playerColor }, dest),
      loadFen: (fen) => { game.setFen(fen); render(); },
    };
  }

  newGameBtn.addEventListener('click', () => startNewGame());
  // Changing variant or side starts a fresh game (board/pockets must rebuild).
  variantSel.addEventListener('change', () => startNewGame());
  sideSel.addEventListener('change', () => startNewGame());
  await startNewGame();
}

main();
