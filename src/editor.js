// Board editor — Session 2a: resize the board and play it.
//
// This screen owns its own chessgroundx instance (a read-only *preview*, not a
// play board) and the size picker. Every size change regenerates a standard
// setup for that geometry, re-renders the preview, and runs the golden-rule
// gate so the user gets live red/green feedback before they ever hit Play.
//
// The editor never talks to the engine or builds a Game itself — it produces a
// *compiled variant* and hands it to main.js via onPlay(), which owns the
// Editor → Play handoff. Free placement, castling/side-to-move, and persistence
// land in 2b/2c; the data flow here is the spine they build on.
import { Chessground } from '../vendor/chessgroundx/chessground.js';
import { SIZE_LIMITS, compile, editorSpec, standardSetupFen } from './variant-config.js?v=4';
import { validate } from './rules.js?v=4';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const DEFAULTS = { width: 8, height: 8 };

// Wire up the editor view. `onPlay(compiled)` is called when the user plays a
// valid position. Returns a small handle (also used as the ?debug entry point).
export function initEditor({ onPlay }) {
  const filesIn = document.getElementById('ed-files');
  const ranksIn = document.getElementById('ed-ranks');
  const boardEl = document.getElementById('ed-board');
  const statusEl = document.getElementById('ed-status');
  const playBtn = document.getElementById('ed-play');

  let cg = null;
  let state = { width: 8, height: 8, startFen: standardSetupFen(8, 8) };
  let lastCheck = null;

  // Read + clamp the size inputs back into the valid envelope, echoing the
  // clamped values to the UI so the field can't show an out-of-range number.
  function readSize() {
    const w = clamp(parseInt(filesIn.value, 10) || DEFAULTS.width, SIZE_LIMITS.minFiles, SIZE_LIMITS.maxFiles);
    const h = clamp(parseInt(ranksIn.value, 10) || DEFAULTS.height, SIZE_LIMITS.minRanks, SIZE_LIMITS.maxRanks);
    if (String(w) !== filesIn.value) filesIn.value = w;
    if (String(h) !== ranksIn.value) ranksIn.value = h;
    return { w, h };
  }

  // Rebuild the preview board for the current size and re-run the gate. Called
  // on every edit and whenever the editor view becomes visible (chessgroundx
  // needs real layout bounds, which a display:none board doesn't have).
  function refresh() {
    const { w, h } = readSize();
    state = { width: w, height: h, startFen: standardSetupFen(w, h) };

    boardEl.style.setProperty('--files', w);
    boardEl.style.setProperty('--ranks', h);
    if (cg) cg.destroy();
    cg = Chessground(boardEl, {
      fen: state.startFen,
      dimensions: { width: w, height: h },
      coordinates: false, // chessgroundx mislays coords off 8×8; skip on preview
      viewOnly: true, // a preview, not a play board (free placement is 2b)
    });

    lastCheck = validate(compile(editorSpec(state)));
    if (lastCheck.ok) {
      statusEl.textContent = `✓ Valid ${w}×${h} — Fairy-Stockfish can evaluate this.`;
      statusEl.className = 'status ok';
      playBtn.disabled = false;
    } else {
      statusEl.textContent = `✗ ${lastCheck.message} — can't play this yet.`;
      statusEl.className = 'status bad';
      playBtn.disabled = true;
    }
    return lastCheck;
  }

  // The Editor → Play boundary: re-validate (belt and suspenders) then hand a
  // compiled variant to main.js. Refuses if the gate fails.
  function play() {
    const compiled = compile(editorSpec(state));
    const check = validate(compiled);
    if (!check.ok) {
      refresh();
      return false;
    }
    onPlay(compiled);
    return true;
  }

  filesIn.addEventListener('input', refresh);
  ranksIn.addEventListener('input', refresh);
  playBtn.addEventListener('click', play);

  // First paint happens when the editor is first shown (see main.js setMode),
  // not here — boardEl has no layout while hidden.

  return {
    refresh,
    play,
    setSize(w, h) {
      filesIn.value = w;
      ranksIn.value = h;
      return refresh();
    },
    getState() {
      return { ...state, check: lastCheck };
    },
  };
}
