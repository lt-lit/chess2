#!/usr/bin/env node
'use strict';
// tools/match-runner.cjs — Session H calibration harness (v0, from the spike).
//
// Plays N games of a capped-strength "player" stand-in (White, UCI_LimitStrength
// + UCI_Elo) against a full-strength defender (Black) on a custom small-board
// variant, with ffish.js as the rules/adjudication authority. Reports a
// termination-type breakdown and the run-scored winrate under CHECKMATE-ONLY
// scoring — stalemates and draws count as player losses, per GAME-LOOP-PLAN.md
// "Session H findings & revised decisions".
//
// Runs the repo's *vendored* WASM builds under plain Node — no browser, no
// downloads (Session W finding: pass wasmBinary explicitly; Fairy-Stockfish's
// pthreads ride worker_threads). One engine instance plays both sides with
// strength switched per move; fine for spikes, but per-side instances (fresh
// hash each) are a TODO before production sweeps.
//
// Usage:
//   node tools/match-runner.cjs --fen "r3k/5/5/5/RR2K w - - 0 1" --size 5x5 \
//     [--games 30] [--movetime 100] [--elo 1200] [--cap 140] \
//     [--ini-extra "key = value;key = value"] [--json results.json]
//
// Wall-clock ≈ games × plies × movetime. Low movetime/N is directional only;
// production numbers want --movetime 1000 (the run's real pace) and larger N.

const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SFDIR = path.join(ROOT, 'vendor', 'stockfish') + path.sep;
const FFDIR = path.join(ROOT, 'vendor', 'ffish') + path.sep;

const Stockfish = require(SFDIR + 'stockfish.js');
const _ff = require(FFDIR + 'ffish.js'); // ESM default export under require()
const ffishFactory = _ff.default || _ff;

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const FEN = arg('fen', null);
const SIZE = arg('size', null);
if (!FEN || !SIZE || !/^\d+x\d+$/.test(SIZE)) {
  console.error('usage: node tools/match-runner.cjs --fen "<fen>" --size WxH [--games N] [--movetime ms] [--elo E] [--cap plies] [--ini-extra "k = v;k = v"] [--json out.json]');
  process.exit(1);
}
const [W, H] = SIZE.split('x').map(Number);
const N = +arg('games', 30);
const MOVETIME = +arg('movetime', 100);
const ELO = +arg('elo', 1200);
const CAP = +arg('cap', 140);
const JSON_OUT = arg('json', null);
const INI_EXTRA = arg('ini-extra', '');

// Same discipline as variant-config.js buildIni: off-8x8, every geometry-coupled
// key must be overridden. Castling/double-step stay off for harness simplicity —
// re-enable via --ini-extra when a measurement needs them.
const NAME = 'harness';
const INI = [
  `[${NAME}:chess]`,
  `maxFile = ${W}`,
  `maxRank = ${H}`,
  `promotionRegionWhite = *${H}`,
  `promotionRegionBlack = *1`,
  'castling = false',
  'doubleStep = false',
  // Draw=loss stack (engine level): the full-strength defender gets no
  // stalemate/repetition safe-harbor. Run-level checkmate-only scoring is
  // applied by THIS script, not the variant — the engine never sees it.
  'stalemateValue = loss',
  'nFoldValue = loss',
  ...INI_EXTRA.split(';').map((s) => s.trim()).filter(Boolean),
].join('\n');

(async () => {
  const ff = await ffishFactory({ wasmBinary: readFileSync(FFDIR + 'ffish.wasm') });
  ff.loadVariantConfig(INI);
  const code = ff.validateFen(FEN, NAME);
  if (code !== 1) console.error(`warning: validateFen returned ${code} for this FEN on ${W}x${H} — continuing anyway`);

  const sf = await Stockfish({
    wasmBinary: readFileSync(SFDIR + 'stockfish.wasm'),
    locateFile: (p) => SFDIR + p,
    mainScriptUrlOrBlob: SFDIR + 'stockfish.js',
  });
  const listeners = new Set();
  sf.addMessageListener((l) => { for (const fn of listeners) fn(l); });
  const send = (c) => sf.postMessage(c);
  const until = (pred) => new Promise((res) => {
    const fn = (l) => { if (pred(l)) { listeners.delete(fn); res(l); } };
    listeners.add(fn);
  });

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Threads value 1');       // Phase 0 invariant: reproducible search
  send('setoption name Use NNUE value false');  // Phase 0 invariant: classical eval
  send('setoption name Hash value 32');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  send(`setoption name UCI_Variant value ${NAME}`);
  const ready = async () => { send('isready'); await until((l) => l === 'readyok'); };
  await ready();

  const setStrength = (capped) => {
    if (capped) {
      send('setoption name UCI_LimitStrength value true');
      send(`setoption name UCI_Elo value ${ELO}`);
    } else {
      send('setoption name UCI_LimitStrength value false');
      send('setoption name Skill Level value 20');
    }
  };
  const bestmove = async (fen) => {
    send('position fen ' + fen);
    send('go movetime ' + MOVETIME);
    const l = await until((x) => typeof x === 'string' && x.startsWith('bestmove'));
    return l.split(/\s+/)[1];
  };

  async function playGame() {
    send('ucinewgame'); await ready();
    const b = new ff.Board(NAME, FEN);
    let plies = 0;
    const finish = (end, winner) => {
      const moves = b.moveStack();
      b.delete();
      return { end, winner, plies, moves };
    };
    for (;;) {
      // Side to move with no legal moves loses (stalemateValue = loss);
      // whether it's a *mate* depends on being in check — the distinction the
      // whole design turns on.
      if (b.numberLegalMoves() === 0) {
        return finish(b.isCheck() ? 'checkmate' : 'stalemate', b.turn() ? 'defender' : 'player');
      }
      if (b.isGameOver(true)) {
        const insuff = b.hasInsufficientMaterial(true) || b.hasInsufficientMaterial(false);
        return finish(insuff ? 'insufficient-material' : 'draw', null);
      }
      if (plies >= CAP) return finish('move-cap', null);
      const whiteToMove = b.turn(); // white = player stand-in (capped)
      setStrength(whiteToMove);
      const mv = await bestmove(b.fen());
      if (!mv || mv === '(none)') {
        return finish(b.isCheck() ? 'checkmate' : 'stalemate', whiteToMove ? 'defender' : 'player');
      }
      if (!b.legalMoves().split(/\s+/).includes(mv)) return finish('engine-illegal:' + mv, null);
      b.push(mv);
      plies++;
    }
  }

  const games = [];
  for (let i = 1; i <= N; i++) {
    const g = await playGame();
    games.push({ game: i, ...g });
    console.log(`  game ${i}/${N}: ${g.end}${g.winner ? ' -> ' + g.winner : ''} in ${(g.plies / 2).toFixed(0)} moves`);
  }

  const wins = games.filter((g) => g.end === 'checkmate' && g.winner === 'player').length;
  const p = wins / N;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / N);
  const tally = {};
  for (const g of games) {
    const k = g.end + (g.winner ? '->' + g.winner : '');
    tally[k] = (tally[k] || 0) + 1;
  }
  const avgMoves = games.reduce((s, g) => s + g.plies, 0) / N / 2;

  console.log(`\n### ${W}x${H} "${FEN}"`);
  console.log(`### player=White @ Elo ${ELO} vs defender=Black @ full | movetime ${MOVETIME}ms | N=${N}`);
  console.log(`run-scored winrate (checkmate-only): ${(100 * p).toFixed(0)}% (±${(100 * ci).toFixed(0)}%)`);
  console.log(`avg game length: ${avgMoves.toFixed(1)} moves`);
  console.log('terminations: ' + Object.entries(tally).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(100 * v / N).toFixed(0)}%`).join(' | '));

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
      meta: {
        fen: FEN, width: W, height: H, games: N, movetime: MOVETIME, elo: ELO,
        cap: CAP, ini: INI, node: process.version, date: new Date().toISOString(),
      },
      summary: { checkmateOnlyWinrate: p, ci95: ci, avgMoves, tally },
      games,
    }, null, 2));
    console.log('wrote ' + JSON_OUT);
  }
  process.exit(0); // emscripten worker threads keep the loop alive otherwise
})().catch((e) => {
  console.error('FATAL:', (e && (e.stack || e.message)) || e);
  process.exit(1);
});
