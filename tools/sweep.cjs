#!/usr/bin/env node
'use strict';
// tools/sweep.cjs — run a matrix of (board, matchup) measurement points
// through match-runner.cjs, in parallel child processes (one process per
// point; each point's games stay serial). Writes one JSON per point plus a
// ranked summary.json next to them.
//
// Spec file shape (see tools/sweeps/*.spec.json):
//   {
//     "name": "army-sweep-v1",
//     "defaults": { "games": 100, "movetime": 250, "elo": 1200, "cap": 140,
//                   "earlyStopBelow": 0.55, "minGames": 24 },
//     "points": [ { "id": "a5-2r-vs-r", "size": "5x5", "fen": "...",
//                   "player": "K+2R", "enemy": "K+R", ...per-point overrides } ]
//   }
//
// Usage:
//   node tools/sweep.cjs --spec tools/sweeps/army-sweep-v1.spec.json \
//     [--out tools/sweeps/army-sweep-v1] [--workers 3] [--validate-only]

const { spawn } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const SPEC_PATH = arg('spec', null);
if (!SPEC_PATH) {
  console.error('usage: node tools/sweep.cjs --spec <spec.json> [--out dir] [--workers 3] [--validate-only]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
const OUT = arg('out', path.join(path.dirname(SPEC_PATH), spec.name));
const WORKERS = +arg('workers', 3);
const VALIDATE_ONLY = process.argv.includes('--validate-only');
const RUNNER = path.join(__dirname, 'match-runner.cjs');

const merged = (pt) => ({ ...spec.defaults, ...pt });

function runnerArgs(pt, jsonOut) {
  const m = merged(pt);
  const a = ['--fen', m.fen, '--size', m.size, '--label', m.id,
    '--games', String(m.games), '--movetime', String(m.movetime),
    '--elo', String(m.elo), '--cap', String(m.cap ?? 140),
    '--early-stop-below', String(m.earlyStopBelow ?? 0),
    '--min-games', String(m.minGames ?? 24), '--quiet'];
  if (m.iniExtra) a.push('--ini-extra', m.iniExtra);
  if (m.seed != null) a.push('--seed', String(m.seed));
  if (jsonOut) a.push('--json', jsonOut);
  if (VALIDATE_ONLY) a.push('--validate-only');
  return a;
}

function runPointProcess(pt, jsonOut) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [RUNNER, ...runnerArgs(pt, jsonOut)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (exit) => resolve({ pt, exit, out, err, wallSeconds: (Date.now() - started) / 1000 }));
  });
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const queue = [...spec.points];
  const results = [];
  let done = 0;

  async function worker() {
    for (;;) {
      const pt = queue.shift();
      if (!pt) return;
      const jsonOut = VALIDATE_ONLY ? null : path.join(OUT, pt.id + '.json');
      const r = await runPointProcess(pt, jsonOut);
      done++;
      if (VALIDATE_ONLY) {
        console.log(`[${done}/${spec.points.length}] ${r.out.trim()}${r.exit !== 0 ? ' (exit ' + r.exit + ')' : ''}`);
        results.push({ id: pt.id, ok: r.exit === 0 });
        continue;
      }
      if (r.exit !== 0) {
        console.error(`[${done}/${spec.points.length}] ${pt.id} FAILED (exit ${r.exit})\n${r.err || r.out}`);
        results.push({ id: pt.id, failed: true });
        continue;
      }
      const data = JSON.parse(readFileSync(jsonOut, 'utf8'));
      const s = data.summary;
      const m = merged(pt);
      results.push({
        id: pt.id, size: m.size, player: pt.player, enemy: pt.enemy, fen: m.fen,
        elo: m.elo, movetime: m.movetime,
        gamesPlayed: s.gamesPlayed, checkmateOnlyWinrate: s.checkmateOnlyWinrate,
        ci95: s.ci95, avgMoves: s.avgMoves, tally: s.tally,
        stoppedEarly: s.stoppedEarly, wallSeconds: r.wallSeconds,
      });
      console.log(`[${done}/${spec.points.length}] ${pt.id}: ${(100 * s.checkmateOnlyWinrate).toFixed(0)}% (±${(100 * s.ci95).toFixed(0)}%) over ${s.gamesPlayed} games, ${s.avgMoves.toFixed(1)} moves avg${s.stoppedEarly ? ' [early-stopped]' : ''} (${r.wallSeconds.toFixed(0)}s)`);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, worker));

  if (VALIDATE_ONLY) {
    const bad = results.filter((r) => !r.ok);
    console.log(bad.length ? `\n${bad.length} point(s) failed validation` : '\nall points validate');
    process.exit(bad.length ? 1 : 0);
  }

  const ranked = results.filter((r) => !r.failed)
    .sort((a, b) => b.checkmateOnlyWinrate - a.checkmateOnlyWinrate);
  const summary = {
    meta: {
      spec: path.basename(SPEC_PATH), name: spec.name, defaults: spec.defaults,
      workers: WORKERS, node: process.version, date: new Date().toISOString(),
      note: spec.note || null,
    },
    points: ranked,
    failed: results.filter((r) => r.failed).map((r) => r.id),
  };
  const summaryPath = path.join(OUT, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`\n### ${spec.name} — ranked by checkmate-only winrate`);
  for (const r of ranked) {
    console.log(`  ${(100 * r.checkmateOnlyWinrate).toFixed(0).padStart(3)}% ±${(100 * r.ci95).toFixed(0).padStart(2)}%  ${r.id.padEnd(18)} ${r.size.padEnd(4)} ${String(r.player).padEnd(9)} vs ${String(r.enemy).padEnd(7)} ${r.avgMoves.toFixed(1).padStart(5)} moves${r.stoppedEarly ? '  [early-stopped]' : ''}`);
  }
  console.log('wrote ' + summaryPath);
})().catch((e) => {
  console.error('FATAL:', (e && (e.stack || e.message)) || e);
  process.exit(1);
});
