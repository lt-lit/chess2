// Persistence + sharing for the board editor (Session 2c).
//
// The shareable unit is just the position's full FEN: it already encodes the
// board size (files per rank × rank count), the side to move, and — since the
// editor re-derives castling from piece placement — everything needed to
// reconstruct the editor state. So a share link is `…#fen=<encoded FEN>`, and a
// saved library entry is `{ id, name, fen }`. No `.ini`, no bespoke format.
//
// Two surfaces:
//   - URL hash: copy/restore the current position via the address bar.
//   - localStorage: a small named library of saved positions.
// Both are wrapped so a hostile/disabled storage (private mode, sandboxed
// iframe) degrades to "sharing off" rather than throwing.

const HASH_PREFIX = 'fen=';
const LIB_KEY = 'pg.editor.library';

// --- URL hash ------------------------------------------------------------

export function hashFor(fen) {
  return '#' + HASH_PREFIX + encodeURIComponent(fen);
}

export function shareUrl(fen) {
  return location.origin + location.pathname + hashFor(fen);
}

// The FEN encoded in the current URL hash, or null if none/parse fails.
export function readHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h.startsWith(HASH_PREFIX)) return null;
  try {
    return decodeURIComponent(h.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
}

// Reflect a position into the address bar without growing history, so a refresh
// (or copy-link) preserves it. No-op if history isn't writable.
export function syncHash(fen) {
  try {
    history.replaceState(null, '', hashFor(fen));
  } catch {
    /* sharing-by-URL unavailable; ignore */
  }
}

// --- localStorage library ------------------------------------------------

function readLib() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLib(list) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function listSaved() {
  return readLib();
}

export function getEntry(id) {
  return readLib().find((e) => e.id === id) || null;
}

// Save a position under a name. Returns the new entry (with a fresh id), or null
// if storage is unavailable.
export function saveEntry(name, fen) {
  const list = readLib();
  const id = list.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  const entry = { id, name, fen };
  list.push(entry);
  return writeLib(list) ? entry : null;
}

export function removeEntry(id) {
  writeLib(readLib().filter((e) => e.id !== id));
}
