# tools/ — offline calibration harness (Session H)

Never shipped; runs the repo's **vendored** engine WASMs under plain Node — no
browser, no installs, no network. Fairy-Stockfish plays both sides (capped
`UCI_Elo` as the player stand-in, full strength as the defender) and ffish.js
is the rules/adjudication authority. Costs CPU time only.

Shared plumbing lives in `lib/` (engine boot, variant ini, game loop /
point measurement); the CLIs compose it.

## match-runner.cjs — measure one point

Measure one `(board, matchup)` point: N games, termination breakdown, and the
run-scored winrate under **checkmate-only** scoring (stalemates and draws count
as player losses — see GAME-LOOP-PLAN.md "Session H findings").

```sh
# The Session H reference point, at the hardened-harness yardstick:
node tools/match-runner.cjs --fen "r3k/5/5/5/RR2K w - - 0 1" --size 5x5 \
  --games 100 --movetime 250 --elo 1000 --json results.json
```

Flags: `--games` (30), `--movetime` ms/move (100), `--elo` player cap (1200,
or `full` for an uncapped player — honesty checks), `--cap` ply limit (140),
`--early-stop-below p` + `--min-games` (24) futility stop — abandon the point
once the Wilson 95% upper bound on the winrate falls below `p`,
`--ini-extra "key = value;key = value"` extra variant lines, `--label`,
`--seed` (recorded in JSON; reserved for harness-level randomization —
engine-side stochasticity is not seedable over UCI), `--json` full results
(per-game terminations + move lists for replay), `--quiet`, and
`--validate-only` (gate the FEN and list first-move captures, so hanging
pieces that would corrupt a matchup's identity get eyeballed before games
burn time).

Conventions baked in: White = player stand-in (capped), Black = defender
(full); **per-side engine instances** (own hash each, strength fixed at
boot); `Threads=1`, classical eval; variant inherits `:chess` with
`stalemateValue = loss` + `nFoldValue = loss` (the engine-level draw=loss
stack); castling/double-step off unless re-enabled via `--ini-extra`.

## sweep.cjs — measure a matrix

Runs a spec's points as parallel child processes (games stay serial within a
point) and ranks everything into a `summary.json`.

```sh
node tools/sweep.cjs --spec tools/sweeps/army-sweep-v1.spec.json --workers 3
node tools/sweep.cjs --spec ... --validate-only   # gate every FEN first
```

**Keep `--workers` at most cores−1.** Fixed-movetime search quality collapses
under CPU contention (measured: a contended 60 ms search dropped a known-90%
point to 40%) — oversubscribing cores silently weakens every engine in the
run and biases the numbers. Never run two sweeps at once.

Specs + results live in `tools/sweeps/` and are committed: the spec is the
reproducible definition of a measurement, the JSONs are the record the game's
difficulty bands will eventually consume.

## screen.cjs — per-instance convertibility verdict

The generation-time guardrail (the plan's "referee" idea moved upstream):
PASS/REJECT one board instance on whether the player converts to a literal
checkmate reliably. Exit code 0/1, so generators can regenerate on failure.

```sh
node tools/screen.cjs --fen "..." --size 6x6 --games 12 --movetime 250   # fast-play gate (quiet cores!)
node tools/screen.cjs --fen "..." --size 6x6 --games 0 --min-wdl 900     # probe-only junk floor (~2s)
```

**Measured limits (army-sweep-v1 correlation):** the fixed-depth
`UCI_ShowWDL` probe does *not* predict conversion by the capped player —
nearly every sweep point probes win≈1000‰, including points that measured
0–21% checkmate rate. The probe is a junk floor only (win < ~900‰ ⇒ certainly
reject); the *confirming* signal is fast-play (on quiet cores) or membership
in a sweep-validated matchup band.

## Fidelity — read before comparing numbers

Numbers move a lot with harness fidelity, and both corrections point **down**
(measured on the 5×5 reference point, same FEN):

| harness | settings | winrate |
|---|---|---|
| v0 spike (one engine, shared hash, strength toggled per move) | 100 ms, Elo 1200 | ~90% |
| v1 (per-side engines) | 100 ms, Elo 1200 | 73% |
| v1 (per-side engines) | 250 ms, Elo 1000 or 1200 | 53–54% |

The v0 shortcut let the capped player read the full-strength defender's hash
entries (~15–20 pts of inflation); longer movetime helps the full-strength
defender more than the capped attacker (~20 pts more). **v0/spike numbers are
not comparable to v1 numbers.** Wall-clock ≈ games × plies × movetime;
production numbers want `--movetime 1000` (the run's real pace — `UCI_Elo`
capping verified honest there, see `sweeps/elo-honesty-v1`) and N ≥ 100.
`UCI_Elo` is nominal on small boards — a consistent yardstick, not a human
rating; note it's a *coarse* knob: 1000 and 1200 measure within noise of each
other on the points tried, while 500 collapses and full converts everything.

**Still to build / run** (GAME-LOOP-PLAN.md, Session H section): 1 s-movetime
confirmation runs on the band anchors, the easy-band sweep for act 1's ~98%
rounds, and sweep specs that draw placements from a seeded generator once
Session G exists.
