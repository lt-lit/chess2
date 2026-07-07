'use strict';
// tools/lib/engine.cjs — one Fairy-Stockfish WASM instance under plain Node
// (Session W finding: pass wasmBinary explicitly; the engine's pthreads ride
// worker_threads). Strength is fixed at boot: the harness runs per-side
// instances with their own hash tables, not one instance toggled per move
// (the v0 spike's shortcut).

const { readFileSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SFDIR = path.join(ROOT, 'vendor', 'stockfish') + path.sep;

const Stockfish = require(SFDIR + 'stockfish.js');

let wasmBinary = null;

// elo: number = capped player stand-in (UCI_LimitStrength); null = full strength.
async function createEngine({ ini, variant, elo = null, hash = 32 }) {
  if (!wasmBinary) wasmBinary = readFileSync(SFDIR + 'stockfish.wasm');
  const sf = await Stockfish({
    wasmBinary,
    locateFile: (p) => SFDIR + p,
    mainScriptUrlOrBlob: SFDIR + 'stockfish.js',
  });
  const listeners = new Set();
  sf.addMessageListener((l) => { for (const fn of [...listeners]) fn(l); });
  const send = (c) => sf.postMessage(c);
  const until = (pred) => new Promise((res) => {
    const fn = (l) => { if (pred(l)) { listeners.delete(fn); res(l); } };
    listeners.add(fn);
  });
  const ready = async () => { send('isready'); await until((l) => l === 'readyok'); };

  send('uci');
  await until((l) => l === 'uciok');
  send('setoption name Threads value 1');       // Phase 0 invariant: reproducible search
  send('setoption name Use NNUE value false');  // Phase 0 invariant: classical eval
  send(`setoption name Hash value ${hash}`);
  sf.FS.writeFile('/variants.ini', ini);
  send('setoption name VariantPath value /variants.ini');
  send(`setoption name UCI_Variant value ${variant}`);
  if (elo != null) {
    send('setoption name UCI_LimitStrength value true');
    send(`setoption name UCI_Elo value ${elo}`);
  } else {
    send('setoption name UCI_LimitStrength value false');
    send('setoption name Skill Level value 20');
  }
  await ready();

  return {
    elo,
    send,
    ready,
    newGame: async () => { send('ucinewgame'); await ready(); },
    bestmove: async (fen, movetime) => {
      send('position fen ' + fen);
      send('go movetime ' + movetime);
      const l = await until((x) => typeof x === 'string' && x.startsWith('bestmove'));
      return l.split(/\s+/)[1];
    },
    // Single fixed-depth probe with UCI_ShowWDL — the cheap per-instance
    // screen from GAME-LOOP-PLAN's runtime guardrails. Score and wdl are
    // per-mille FROM THE SIDE TO MOVE's point of view.
    evalWDL: async (fen, depth = 10) => {
      send('setoption name UCI_ShowWDL value true');
      await ready();
      let last = null;
      const collect = (l) => {
        if (typeof l === 'string' && l.startsWith('info ') && l.includes(' score ')) last = l;
      };
      listeners.add(collect);
      send('position fen ' + fen);
      send('go depth ' + depth);
      await until((x) => typeof x === 'string' && x.startsWith('bestmove'));
      listeners.delete(collect);
      if (!last) return null;
      const wdl = last.match(/ wdl (\d+) (\d+) (\d+)/);
      const score = last.match(/ score (cp|mate) (-?\d+)/);
      const d = last.match(/ depth (\d+)/);
      return {
        depth: d ? +d[1] : null,
        score: score ? { type: score[1], value: +score[2] } : null,
        wdl: wdl ? { win: +wdl[1], draw: +wdl[2], loss: +wdl[3] } : null,
      };
    },
  };
}

module.exports = { createEngine };
