'use strict';
// tools/lib/match.cjs — play games and measure one (board, matchup) point.
// ffish.js is the rules/adjudication authority; engines only ever see FENs
// from it. Scoring is CHECKMATE-ONLY per GAME-LOOP-PLAN.md "Session H
// findings": stalemates and draws count as player losses.

// One game: player (White) vs defender (Black), each its own engine instance.
async function playGame({ ff, variant, fen, player, defender, movetime, cap }) {
  await player.newGame();
  await defender.newGame();
  const b = new ff.Board(variant, fen);
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
    if (plies >= cap) return finish('move-cap', null);
    const whiteToMove = b.turn();
    const mv = await (whiteToMove ? player : defender).bestmove(b.fen(), movetime);
    if (!mv || mv === '(none)') {
      return finish(b.isCheck() ? 'checkmate' : 'stalemate', whiteToMove ? 'defender' : 'player');
    }
    if (!b.legalMoves().split(/\s+/).includes(mv)) return finish('engine-illegal:' + mv, null);
    b.push(mv);
    plies++;
  }
}

// Wilson 95% upper bound on the true winrate — the early-stop test. Small n
// keeps the bound wide, so a point is only abandoned once failure is
// statistically clear, never on a cold streak.
function wilsonUpper(wins, n, z = 1.96) {
  if (n === 0) return 1;
  const p = wins / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) + z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// N games at one measurement point, with an optional futility rule: once at
// least minGames are played and the Wilson upper bound on the checkmate-only
// winrate drops below earlyStopBelow, stop — the point can't be a candidate.
async function runPoint(opts) {
  const { games: N, earlyStopBelow = 0, minGames = 24, onGame } = opts;
  const games = [];
  let wins = 0;
  let stoppedEarly = false;
  for (let i = 1; i <= N; i++) {
    const g = await playGame(opts);
    games.push({ game: i, ...g });
    if (g.end === 'checkmate' && g.winner === 'player') wins++;
    if (onGame) onGame(games[games.length - 1], wins);
    if (earlyStopBelow > 0 && i >= minGames && wilsonUpper(wins, i) < earlyStopBelow) {
      stoppedEarly = true;
      break;
    }
  }
  const n = games.length;
  const p = wins / n;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / n);
  const tally = {};
  for (const g of games) {
    const k = g.end + (g.winner ? '->' + g.winner : '');
    tally[k] = (tally[k] || 0) + 1;
  }
  const avgMoves = games.reduce((s, g) => s + g.plies, 0) / n / 2;
  return {
    games,
    summary: { gamesPlayed: n, checkmateOnlyWinrate: p, ci95: ci, avgMoves, tally, stoppedEarly },
  };
}

module.exports = { playGame, runPoint, wilsonUpper };
