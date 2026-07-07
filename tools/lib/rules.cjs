'use strict';
// tools/lib/rules.cjs — ffish.js boot + the harness variant ini.
//
// Same discipline as src/variant-config.js buildIni: off-8x8, every
// geometry-coupled key must be overridden. Castling/double-step stay off for
// harness simplicity — re-enable via `extra` when a measurement needs them.

const { readFileSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FFDIR = path.join(ROOT, 'vendor', 'ffish') + path.sep;

const _ff = require(FFDIR + 'ffish.js'); // ESM default export under require()
const ffishFactory = _ff.default || _ff;

const VARIANT = 'harness';

function buildIni(width, height, extra = '', name = VARIANT) {
  return [
    `[${name}:chess]`,
    `maxFile = ${width}`,
    `maxRank = ${height}`,
    `promotionRegionWhite = *${height}`,
    'promotionRegionBlack = *1',
    'castling = false',
    'doubleStep = false',
    // Draw=loss stack (engine level): the full-strength defender gets no
    // stalemate/repetition safe-harbor. Run-level checkmate-only scoring is
    // applied by the harness, not the variant — the engine never sees it.
    'stalemateValue = loss',
    'nFoldValue = loss',
    ...String(extra).split(';').map((s) => s.trim()).filter(Boolean),
  ].join('\n');
}

let ffPromise = null;
function loadFfish() {
  if (!ffPromise) {
    ffPromise = ffishFactory({ wasmBinary: readFileSync(FFDIR + 'ffish.wasm') });
  }
  return ffPromise;
}

module.exports = { VARIANT, buildIni, loadFfish };
