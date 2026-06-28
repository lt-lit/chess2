// Board editor — Session 2b: free placement, then play it.
//
// The editor owns an interactive chessgroundx board and a piece palette. You
// resize the board, stamp the six standard pieces (or erase), drag pieces to
// reposition, set side-to-move, paste a FEN — and every change re-runs the
// golden-rule gate for live red/green feedback. "Play this position" hands a
// compiled variant to main.js, which owns the Editor → Play handoff.
//
// Source of truth for the position is the chessground board itself: getFen()
// gives the placement, and fullFen() appends side-to-move + (conservatively
// derived) castling + the counters. Geometry + rules come from the compiler
// (src/variant-config.js); this file is the DOM/interaction layer.
//
// Interaction model: a *brush* is null (move mode — drag to reposition, drag a
// piece off the board to delete), a piece (stamp mode — tap/drag to place), or
// 'erase'. Brush taps are intercepted in the capture phase before chessground's
// own drag starts; with no brush, chessground handles moves/deletes natively.
import { Chessground } from '../vendor/chessgroundx/chessground.js';
import {
  SIZE_LIMITS, compile, editorSpec, standardSetupFen, assembleFen,
} from './variant-config.js?v=5';
import { validate } from './rules.js?v=5';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const DEFAULTS = { width: 8, height: 8 };
const PIECE_LETTERS = ['k', 'q', 'r', 'b', 'n', 'p'];

// Placement-only FENs (no side/castling fields), used to (re)seed the board.
const placementFor = (w, h) => standardSetupFen(w, h).split(' ')[0];
const emptyPlacement = (w, h) => Array.from({ length: h }, () => String(w)).join('/');

function pieceFromChar(ch) {
  return { role: ch.toLowerCase() + '-piece', color: ch === ch.toUpperCase() ? 'white' : 'black' };
}

// Count the files in a FEN placement rank (handles multi-digit empty runs and
// skips piece modifiers ~ + |), and the ranks, to recover a pasted FEN's size.
function parsePlacementDims(placement) {
  const ranks = placement.split('/');
  let width = 0;
  const row = ranks[0] || '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch >= '0' && ch <= '9') {
      let num = ch;
      while (i + 1 < row.length && row[i + 1] >= '0' && row[i + 1] <= '9') num += row[++i];
      width += parseInt(num, 10);
    } else if (/[a-zA-Z*]/.test(ch)) {
      width += 1;
    }
  }
  return { width, height: ranks.length };
}

export function initEditor({ onPlay }) {
  const filesIn = document.getElementById('ed-files');
  const ranksIn = document.getElementById('ed-ranks');
  const boardEl = document.getElementById('ed-board');
  const paletteEl = document.getElementById('ed-palette');
  const statusEl = document.getElementById('ed-status');
  const playBtn = document.getElementById('ed-play');
  const turnBtn = document.getElementById('ed-turn');
  const clearBtn = document.getElementById('ed-clear');
  const resetBtn = document.getElementById('ed-reset');
  const flipBtn = document.getElementById('ed-flip');
  const fenIn = document.getElementById('ed-fen');
  const fenBtn = document.getElementById('ed-fen-load');

  let cg = null;
  let mounted = false;
  let dims = { ...DEFAULTS };
  let turn = 'w';
  let brush = null; // null = move mode | {role,color} = stamp | 'erase'
  let brushEl = null;
  let painting = false;
  let lastPaintKey = null;
  let lastCheck = null;

  // --- FEN assembly + validation -------------------------------------------

  // Conservative castling (Session 2b): only an 8×8 board with king + rook on
  // their standard squares gets rights; everything else is '-'. Full custom-file
  // castling is deferred to Session 3 (matches buildIni, which only keeps chess
  // castling at 8×8).
  function deriveCastling() {
    if (dims.width !== 8 || dims.height !== 8) return '-';
    const pieces = cg.state.boardState.pieces;
    const is = (sq, role, color) => {
      const p = pieces.get(sq);
      return p && p.role === role && p.color === color;
    };
    let s = '';
    if (is('e1', 'k-piece', 'white')) {
      if (is('h1', 'r-piece', 'white')) s += 'K';
      if (is('a1', 'r-piece', 'white')) s += 'Q';
    }
    if (is('e8', 'k-piece', 'black')) {
      if (is('h8', 'r-piece', 'black')) s += 'k';
      if (is('a8', 'r-piece', 'black')) s += 'q';
    }
    return s || '-';
  }

  function fullFen() {
    return assembleFen(cg.getFen(), { stm: turn, castling: deriveCastling() });
  }

  function compiledNow() {
    return compile(editorSpec({ width: dims.width, height: dims.height, startFen: fullFen() }));
  }

  function revalidate() {
    if (!cg) return null;
    lastCheck = validate(compiledNow());
    if (lastCheck.ok) {
      statusEl.textContent = `✓ Valid ${dims.width}×${dims.height} — ready to play.`;
      statusEl.className = 'status ok';
      playBtn.disabled = false;
    } else {
      statusEl.textContent = `✗ ${lastCheck.message} — can't play this yet.`;
      statusEl.className = 'status bad';
      playBtn.disabled = true;
    }
    return lastCheck;
  }

  // --- board lifecycle ------------------------------------------------------

  function mount(placementFen) {
    boardEl.style.setProperty('--files', dims.width);
    boardEl.style.setProperty('--ranks', dims.height);
    if (cg) cg.destroy();
    cg = Chessground(boardEl, {
      fen: placementFen,
      dimensions: { width: dims.width, height: dims.height },
      coordinates: false,
      movable: { free: true, color: 'both', showDests: false },
      draggable: { enabled: true, deleteOnDropOff: true, showGhost: true },
      selectable: { enabled: false },
      drawable: { enabled: false },
      highlight: { lastMove: false, check: false },
      animation: { enabled: false },
      // Native drag-move and drag-off-delete both fire change → revalidate.
      events: { change: () => revalidate() },
    });
    mounted = true;
    revalidate();
  }

  function readSize() {
    const width = clamp(parseInt(filesIn.value, 10) || DEFAULTS.width, SIZE_LIMITS.minFiles, SIZE_LIMITS.maxFiles);
    const height = clamp(parseInt(ranksIn.value, 10) || DEFAULTS.height, SIZE_LIMITS.minRanks, SIZE_LIMITS.maxRanks);
    if (String(width) !== filesIn.value) filesIn.value = width;
    if (String(height) !== ranksIn.value) ranksIn.value = height;
    return { width, height };
  }

  // Changing size reseeds a standard setup at the new geometry (free-placement
  // edits happen at a fixed size; resize is the coarse action).
  function applySize() {
    dims = readSize();
    mount(placementFor(dims.width, dims.height));
  }

  // --- brush + painting -----------------------------------------------------

  function paintAt(key) {
    if (brush === 'erase') cg.setPieces(new Map([[key, undefined]]));
    else if (brush) cg.setPieces(new Map([[key, { role: brush.role, color: brush.color, promoted: false }]]));
    else return;
    lastPaintKey = key;
    revalidate();
  }

  const coordsOf = (e) => {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    return t ? [t.clientX, t.clientY] : [e.clientX, e.clientY];
  };

  // Capture phase: when a brush is active, place/erase and stop the event before
  // chessground's mousedown/touchstart drag handler (bound on the board) runs.
  function onBoardDown(e) {
    if (!brush || !cg) return; // move mode → let chessground handle it
    const key = cg.getKeyAtDomPos(coordsOf(e));
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    painting = true;
    paintAt(key);
  }
  function onDocMove(e) {
    if (!painting || !brush || !cg) return;
    const key = cg.getKeyAtDomPos(coordsOf(e));
    if (key && key !== lastPaintKey) {
      e.preventDefault();
      paintAt(key);
    }
  }
  function onDocUp() {
    painting = false;
    lastPaintKey = null;
  }

  boardEl.addEventListener('mousedown', onBoardDown, true);
  boardEl.addEventListener('touchstart', onBoardDown, { capture: true, passive: false });
  document.addEventListener('mousemove', onDocMove, true);
  document.addEventListener('touchmove', onDocMove, { capture: true, passive: false });
  document.addEventListener('mouseup', onDocUp, true);
  document.addEventListener('touchend', onDocUp, true);

  function selectBrush(el, value) {
    if (brushEl === el) { // tapping the active brush clears it (back to move mode)
      el.classList.remove('selected');
      brushEl = null;
      brush = null;
      return;
    }
    if (brushEl) brushEl.classList.remove('selected');
    brushEl = el;
    brush = value;
    el.classList.add('selected');
  }

  function buildPalette() {
    paletteEl.innerHTML = '';
    const addPiece = (color, letter) => {
      const role = letter + '-piece';
      const el = document.createElement('piece');
      el.className = `${color} ${role}`;
      el.addEventListener('mousedown', (e) => e.preventDefault()); // no text-selection drag
      el.addEventListener('click', () => selectBrush(el, { role, color }));
      paletteEl.appendChild(el);
    };
    for (const l of PIECE_LETTERS) addPiece('white', l);
    for (const l of PIECE_LETTERS) addPiece('black', l);
    const er = document.createElement('button');
    er.className = 'eraser';
    er.title = 'Eraser';
    er.textContent = '⌫';
    er.addEventListener('click', () => selectBrush(er, 'erase'));
    paletteEl.appendChild(er);
  }

  // --- side to move / clear / reset / flip / load-FEN -----------------------

  function updateTurnLabel() {
    if (turnBtn) turnBtn.textContent = turn === 'w' ? 'White to move' : 'Black to move';
  }
  function setTurn(t) {
    turn = t === 'b' ? 'b' : 'w';
    updateTurnLabel();
    revalidate();
  }

  function loadFen(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) {
      statusEl.textContent = '✗ Paste a FEN first.';
      statusEl.className = 'status bad';
      return null;
    }
    const parts = trimmed.split(/\s+/);
    const placement = parts[0].split('[')[0]; // drop any crazyhouse pocket part
    const { width, height } = parsePlacementDims(placement);
    if (
      width < SIZE_LIMITS.minFiles || width > SIZE_LIMITS.maxFiles ||
      height < SIZE_LIMITS.minRanks || height > SIZE_LIMITS.maxRanks
    ) {
      statusEl.textContent =
        `✗ FEN is ${width}×${height} — outside ${SIZE_LIMITS.minFiles}–${SIZE_LIMITS.maxFiles} × ${SIZE_LIMITS.minRanks}–${SIZE_LIMITS.maxRanks}.`;
      statusEl.className = 'status bad';
      playBtn.disabled = true;
      return null;
    }
    dims = { width, height };
    filesIn.value = width;
    ranksIn.value = height;
    turn = parts[1] === 'b' ? 'b' : 'w';
    updateTurnLabel();
    mount(placement); // revalidate() runs inside; castling is re-derived, not taken from the FEN
    return lastCheck;
  }

  function play() {
    const compiled = compiledNow();
    if (!validate(compiled).ok) {
      revalidate();
      return false;
    }
    onPlay(compiled);
    return true;
  }

  // --- wire controls --------------------------------------------------------

  buildPalette();
  updateTurnLabel();
  filesIn.addEventListener('change', applySize);
  ranksIn.addEventListener('change', applySize);
  turnBtn.addEventListener('click', () => setTurn(turn === 'w' ? 'b' : 'w'));
  clearBtn.addEventListener('click', () => mount(emptyPlacement(dims.width, dims.height)));
  resetBtn.addEventListener('click', () => mount(placementFor(dims.width, dims.height)));
  flipBtn.addEventListener('click', () => cg && cg.toggleOrientation());
  fenBtn.addEventListener('click', () => loadFen(fenIn.value));
  playBtn.addEventListener('click', play);

  // chessgroundx needs real layout bounds, which a display:none board lacks, so
  // mount on first show and just re-measure on later shows (preserving edits).
  function refresh() {
    if (!mounted) {
      dims = readSize();
      mount(placementFor(dims.width, dims.height));
    } else if (cg) {
      cg.redrawAll();
    }
    return revalidate();
  }

  return {
    refresh,
    play,
    setSize(w, h) {
      filesIn.value = w;
      ranksIn.value = h;
      applySize();
      return lastCheck;
    },
    place(key, ch) {
      cg.setPieces(new Map([[key, { ...pieceFromChar(ch), promoted: false }]]));
      return revalidate();
    },
    erase(key) {
      cg.setPieces(new Map([[key, undefined]]));
      return revalidate();
    },
    clear() { mount(emptyPlacement(dims.width, dims.height)); return lastCheck; },
    reset() { mount(placementFor(dims.width, dims.height)); return lastCheck; },
    setTurn,
    loadFen,
    getState() {
      return {
        width: dims.width, height: dims.height, turn,
        placement: cg ? cg.getFen() : null,
        fen: cg ? fullFen() : null,
        check: lastCheck,
      };
    },
  };
}
