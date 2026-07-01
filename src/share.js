// Persistence + sharing for the board editor (Session 2c; crumble flag added
// in the game-loop plan's Session W).
//
// The shareable unit is the position's full FEN — it already encodes the board
// size (files per rank × rank count), the side to move, and (since the editor
// re-derives castling from placement) everything positional — plus the one
// editor rule toggle, crumble. So a share link is `…#fen=<encoded FEN>` with
// `&cr=1` appended when crumble is on, and a saved library entry is
// `{ id, name, fen, crumble? }`. No `.ini`, no bespoke format.
//
// Two surfaces:
//   - URL hash: copy/restore the current position via the address bar.
//   - localStorage: a small named library of saved positions.
// Both are wrapped so a hostile/disabled storage (private mode, sandboxed
// iframe) degrades to "sharing off" rather than throwing.

const HASH_PREFIX = 'fen=';
const CRUMBLE_FLAG = 'cr=1';
const LIB_KEY = 'pg.editor.library';

// --- URL hash ------------------------------------------------------------

export function hashFor(fen, crumble = false) {
  return '#' + HASH_PREFIX + encodeURIComponent(fen) + (crumble ? '&' + CRUMBLE_FLAG : '');
}

export function shareUrl(fen, crumble = false) {
  return location.origin + location.pathname + hashFor(fen, crumble);
}

// The { fen, crumble } encoded in the current URL hash, or null if none/parse
// fails. Pre-crumble links (bare #fen=…) read as crumble: false.
export function readHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h.startsWith(HASH_PREFIX)) return null;
  const parts = h.split('&');
  try {
    return {
      fen: decodeURIComponent(parts[0].slice(HASH_PREFIX.length)),
      crumble: parts.includes(CRUMBLE_FLAG),
    };
  } catch {
    return null;
  }
}

// Reflect a position into the address bar without growing history, so a refresh
// (or copy-link) preserves it. No-op if history isn't writable.
export function syncHash(fen, crumble = false) {
  try {
    history.replaceState(null, '', hashFor(fen, crumble));
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
// if storage is unavailable. Entries saved before the crumble flag existed have
// no `crumble` key and read back as falsy.
export function saveEntry(name, fen, crumble = false) {
  const list = readLib();
  const id = list.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  const entry = { id, name, fen, crumble };
  list.push(entry);
  return writeLib(list) ? entry : null;
}

export function removeEntry(id) {
  writeLib(readLib().filter((e) => e.id !== id));
}
