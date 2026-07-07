#!/usr/bin/env node
'use strict';
// tools/match-runner.cjs — Session H calibration harness (v1, hardened).
//
// Plays N games of a capped-strength "player" stand-in (White, UCI_LimitStrength
// + UCI_Elo) against a full-strength defender (Black) on a custom small-board
// variant, with ffish.js as the rules/adjudication authority. Reports a
// termination-type breakdown and the run-scored winrate under CHECKMATE-ONLY
// scoring — stalemates and draws count as player losses, per GAME-LOOP-PLAN.md
// "Session H findings & revised decisions".
//
// v1 over the spike's v0: per-side engine instances (each side its own hash,
// no per-move strength toggling), `--elo full` for uncapped-player honesty
// checks, and a Wilson-bound futility rule (`--early-stop-below`) so sweep
// points that can't be candidates don't burn a full N. Parallelism lives one
// level up in tools/sweep.cjs, which runs one process per measurement point.
//
// Engine-side stochasticity (capped-strength move selection) is inside
// Fairy-Stockfish and NOT seedable over UCI — repeated runs genuinely differ.
// `--seed` is recorded in the JSON for provenance and reserved for
// harness-level randomization (e.g. generated placements, Session G).
//
// Usage:
//   node tools/match-runner.cjs --fen "r3k/5/5/5/RR2K w - - 0 1" --size 5x5 \
//     [--games 30] [--movetime 100] [--elo 1200|full] [--cap 140] \
//     [--early-stop-below 0] [--min-games 24] [--label name] [--seed s] \
//     [--ini-extra "key = value;key = value"] [--json results.json] \
//     [--quiet] [--validate-only]
//
// Wall-clock ≈ games × plies × movetime. Low movetime/N is directional only;
// production numbers want --movetime 1000 (the run's real pace) and larger N.

const { writeFileSync } = require('fs');
const { VARIANT, buildIni, loadFfish } = require('./lib/rules.cjs');
const { createEngine } = require('./lib/engine.cjs');
const { runPoint } = require('./lib/match.cjs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
function flag(name) {
  return process.argv.includes('--' + name);
}

const FEN = arg('fen', null);
const SIZE = arg('size', null);
if (!FEN || !SIZE || !/^\d+x\d+$/.test(SIZE)) {
  console.error('usage: node tools/match-runner.cjs --fen "<fen>" --size WxH [--games N] [--movetime ms] [--elo E|full] [--cap plies] [--early-stop-below p] [--min-games N] [--label name] [--seed s] [--ini-extra "k = v;k = v"] [--json out.json] [--quiet] [--validate-only]');
  process.exit(1);
}
const [W, H] = SIZE.split('x').map(Number);
const N = +arg('games', 30);
const MOVETIME = +arg('movetime', 100);
const ELO = arg('elo', '1200'); // 'full' = uncapped player, for honesty checks
const PLAYER_ELO = ELO === 'full' ? null : +ELO;
const CAP = +arg('cap', 140);
const EARLY = +arg('early-stop-below', 0);
const MIN_GAMES = +arg('min-games', 24);
const LABEL = arg('label', null);
const SEED = arg('seed', null);
const JSON_OUT = arg('json', null);
const INI_EXTRA = arg('ini-extra', '');
const QUIET = flag('quiet');

(async () => {
  const ff = await loadFfish();
  const ini = buildIni(W, H, INI_EXTRA);
  ff.loadVariantConfig(ini);
  const code = ff.validateFen(FEN, VARIANT);

  if (flag('validate-only')) {
    // Spec-authoring aid: gate verdict plus every first move that lands on an
    // enemy-occupied square, so hanging pieces that would corrupt a matchup's
    // identity get eyeballed before a sweep burns time on them.
    const b = new ff.Board(VARIANT, FEN);
    const occupied = new Set();
    const boardPart = FEN.split(/\s+/)[0];
    let r = H, f = 0;
    for (const ch of boardPart) {
      if (ch === '/') { r--; f = 0; }
      else if (/\d/.test(ch)) { f += +ch; }
      else { if (ch >= 'a' && ch <= 'z') occupied.add(String.fromCharCode(97 + f) + r); f++; }
    }
    const caps = b.legalMoves().split(/\s+/).filter(Boolean)
      .filter((m) => { const t = m.match(/^[a-j]\d+([a-j]\d+)/); return t && occupied.has(t[1]); });
    b.delete();
    console.log(`${LABEL || FEN}: validateFen=${code}${code === 1 ? ' OK' : ' *** FAIL ***'}` +
      (caps.length ? ` | first-move captures: ${caps.join(' ')}` : ' | no first-move captures'));
    process.exit(code === 1 ? 0 : 1);
  }

  if (code !== 1) console.error(`warning: validateFen returned ${code} for this FEN on ${W}x${H} — continuing anyway`);

  const [player, defender] = await Promise.all([
    createEngine({ ini, variant: VARIANT, elo: PLAYER_ELO }),
    createEngine({ ini, variant: VARIANT, elo: null }),
  ]);

  const started = Date.now();
  const { games, summary } = await runPoint({
    ff, variant: VARIANT, fen: FEN, player, defender,
    movetime: MOVETIME, cap: CAP, games: N,
    earlyStopBelow: EARLY, minGames: MIN_GAMES,
    onGame: QUIET ? null : (g) => console.log(`  game ${g.game}/${N}: ${g.end}${g.winner ? ' -> ' + g.winner : ''} in ${(g.plies / 2).toFixed(0)} moves`),
  });
  const wallSeconds = (Date.now() - started) / 1000;

  const pct = (x) => (100 * x).toFixed(0) + '%';
  console.log(`\n### ${LABEL ? LABEL + ' | ' : ''}${W}x${H} "${FEN}"`);
  console.log(`### player=White @ ${PLAYER_ELO == null ? 'FULL (uncapped)' : 'Elo ' + PLAYER_ELO} vs defender=Black @ full | movetime ${MOVETIME}ms | N=${summary.gamesPlayed}${summary.stoppedEarly ? ` of ${N} (early-stopped: Wilson UB < ${EARLY})` : ''}`);
  console.log(`run-scored winrate (checkmate-only): ${pct(summary.checkmateOnlyWinrate)} (±${pct(summary.ci95)})`);
  console.log(`avg game length: ${summary.avgMoves.toFixed(1)} moves | wall ${wallSeconds.toFixed(0)}s`);
  console.log('terminations: ' + Object.entries(summary.tally).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v / summary.gamesPlayed)}`).join(' | '));

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
      meta: {
        harness: 'v1', label: LABEL, fen: FEN, width: W, height: H,
        gamesRequested: N, movetime: MOVETIME, elo: PLAYER_ELO == null ? 'full' : PLAYER_ELO,
        cap: CAP, earlyStopBelow: EARLY, minGames: MIN_GAMES, seed: SEED,
        perSideEngines: true, ini, wallSeconds,
        node: process.version, date: new Date().toISOString(),
      },
      summary,
      games,
    }, null, 1));
    console.log('wrote ' + JSON_OUT);
  }
  process.exit(0); // emscripten worker threads keep the loop alive otherwise
})().catch((e) => {
  console.error('FATAL:', (e && (e.stack || e.message)) || e);
  process.exit(1);
});
