# tools/ — offline calibration harness (Session H)

Never shipped; runs the repo's **vendored** engine WASMs under plain Node — no
browser, no installs, no network. Fairy-Stockfish plays both sides (capped
`UCI_Elo` as the player stand-in, full strength as the defender) and ffish.js
is the rules/adjudication authority. Costs CPU time only.

## match-runner.cjs

Measure one `(board, matchup)` point: N games, termination breakdown, and the
run-scored winrate under **checkmate-only** scoring (stalemates and draws count
as player losses — see GAME-LOOP-PLAN.md "Session H findings").

```sh
# Reproduce the Session H reference point (~90–100% checkmate, ~5 moves):
node tools/match-runner.cjs --fen "r3k/5/5/5/RR2K w - - 0 1" --size 5x5 \
  --games 30 --movetime 100 --elo 1200 --json results.json
```

Flags: `--games` (30), `--movetime` ms/move (100), `--elo` player cap (1200),
`--cap` ply limit (140), `--ini-extra "key = value;key = value"` extra variant
lines, `--json` full results (per-game terminations + move lists for replay).

Conventions baked in: White = player stand-in (capped), Black = defender
(full); `Threads=1`, classical eval; variant inherits `:chess` with
`stalemateValue = loss` + `nFoldValue = loss` (the engine-level draw=loss
stack); castling/double-step off unless re-enabled via `--ini-extra`.

**Caveats.** Wall-clock ≈ games × plies × movetime. Numbers at low movetime/N
are directional; production sweeps want `--movetime 1000` (the run's real
pace) and larger N. `UCI_Elo` is nominal on small boards — a consistent
yardstick, not a human rating. One engine instance serves both sides
(strength switched per move); per-side instances are a TODO for rigor.

**Still to build** (GAME-LOOP-PLAN.md, Session H section): parallel workers,
army sweeps over ≤8×8 matchups, the generation-time checkmate-convertibility
screen, `UCI_ShowWDL` plumbing, and sweep outputs as repo JSON.
