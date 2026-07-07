#!/usr/bin/env node
'use strict';
// tools/screen.cjs — the checkmate-convertibility screen (Session H): the
// FSF-eval "referee" idea moved upstream to generation time, where it's
// neutral. Given one board instance, answer cheaply: does this convert to a
// LITERAL CHECKMATE reliably for the player? Session G's generators run this
// as the fourth runtime guardrail and regenerate on failure; it must stay in
// the seconds range, so it fast-plays a small M at low movetime — a coarse
// but honest miniature of the real measurement.
//
// Two signals:
//   - fast-play: M games, capped player (White) vs full defender (Black), at
//     screen movetime; checkmate-only rate >= --min-rate is the verdict.
//     `--games 0` skips it: fixed-movetime search quality degrades under CPU
//     contention (measured — a contended 60ms search dropped a 90% point to
//     40%), so fast-play only means something on quiet cores. Depth-based
//     probes don't have that failure mode.
//   - a single fixed-depth eval with UCI_ShowWDL from the start position
//     (player to move), reported alongside; gate on it with --min-wdl.
//     MEASURED (army-sweep-v1 correlation): start-position WDL does NOT
//     predict conversion by the capped player — nearly every sweep point
//     probes win~1000 per-mille, including points that measured 0-21%
//     checkmate rate. The full engine answers "is this winnable?", not "will
//     the Elo-1000 stand-in deliver mate?". So the probe is a cheap junk
//     floor at best (win < ~900 = certainly reject); it can never CONFIRM a
//     candidate. The confirming gate is fast-play on quiet cores, or
//     membership in a sweep-validated matchup band.
//
// Exit code: 0 = pass, 1 = reject (scriptable, like validateFen).
//
// Usage:
//   node tools/screen.cjs --fen "r3k/5/5/5/RR2K w - - 0 1" --size 5x5 \
//     [--games 12] [--movetime 60] [--elo 1000] [--cap 140] [--min-rate 0.75] \
//     [--min-wdl 0] [--depth 10] [--ini-extra "k = v"] [--json out.json] [--quiet]

const { writeFileSync } = require('fs');
const { VARIANT, buildIni, loadFfish } = require('./lib/rules.cjs');
const { createEngine } = require('./lib/engine.cjs');
const { runPoint } = require('./lib/match.cjs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const FEN = arg('fen', null);
const SIZE = arg('size', null);
if (!FEN || !SIZE || !/^\d+x\d+$/.test(SIZE)) {
  console.error('usage: node tools/screen.cjs --fen "<fen>" --size WxH [--games M] [--movetime ms] [--elo E] [--cap plies] [--min-rate p] [--min-wdl permille] [--depth D] [--ini-extra "k = v"] [--json out.json] [--quiet]');
  process.exit(1);
}
const [W, H] = SIZE.split('x').map(Number);
const M = +arg('games', 12);
const MOVETIME = +arg('movetime', 60);
const ELO = +arg('elo', 1000);
const CAP = +arg('cap', 140);
const MIN_RATE = +arg('min-rate', 0.75);
const MIN_WDL = +arg('min-wdl', 0);
const DEPTH = +arg('depth', 10);
const INI_EXTRA = arg('ini-extra', '');
const JSON_OUT = arg('json', null);
const QUIET = process.argv.includes('--quiet');

(async () => {
  const started = Date.now();
  const ff = await loadFfish();
  const ini = buildIni(W, H, INI_EXTRA);
  ff.loadVariantConfig(ini);
  if (ff.validateFen(FEN, VARIANT) !== 1) {
    console.log(`REJECT (gate): validateFen failed for "${FEN}" on ${W}x${H}`);
    process.exit(1);
  }

  const defender = await createEngine({ ini, variant: VARIANT, elo: null });
  const player = M > 0 ? await createEngine({ ini, variant: VARIANT, elo: ELO }) : null;

  // The WDL probe runs on the full-strength instance: the question is what an
  // honest engine thinks of the player's position, not what the stand-in sees.
  const probe = await defender.evalWDL(FEN, DEPTH);

  const summary = M > 0 ? (await runPoint({
    ff, variant: VARIANT, fen: FEN, player, defender,
    movetime: MOVETIME, cap: CAP, games: M,
  })).summary : null;

  const rate = summary ? summary.checkmateOnlyWinrate : null;
  const wdlWin = probe && probe.wdl ? probe.wdl.win : null;
  const ratePass = summary == null || rate >= MIN_RATE;
  const wdlPass = MIN_WDL <= 0 || (wdlWin != null && wdlWin >= MIN_WDL);
  const pass = ratePass && wdlPass;
  const wallSeconds = (Date.now() - started) / 1000;

  if (!QUIET) {
    console.log(`${pass ? 'PASS' : 'REJECT'}: ` +
      (summary ? `checkmate rate ${(100 * rate).toFixed(0)}% over ${summary.gamesPlayed} fast games (need >=${(100 * MIN_RATE).toFixed(0)}%)` : 'probe-only') +
      (probe ? ` | eval ${probe.score ? probe.score.type + ' ' + probe.score.value : 'n/a'}${wdlWin != null ? `, wdl ${probe.wdl.win}/${probe.wdl.draw}/${probe.wdl.loss}` : ''} @ depth ${probe.depth}` : ' | eval probe unavailable') +
      ` | ${wallSeconds.toFixed(1)}s`);
    if (summary && !ratePass) console.log(`  fast-play: converts too rarely (${Object.entries(summary.tally).map(([k, v]) => k + ' ' + v).join(', ')})`);
    if (!wdlPass) console.log(`  wdl: win ${wdlWin} < ${MIN_WDL} per-mille`);
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
      meta: { fen: FEN, width: W, height: H, games: M, movetime: MOVETIME, elo: ELO, cap: CAP, minRate: MIN_RATE, minWdl: MIN_WDL, depth: DEPTH, wallSeconds, date: new Date().toISOString() },
      probe, fastPlay: summary, pass,
    }, null, 2));
  }
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', (e && (e.stack || e.message)) || e);
  process.exit(1);
});
