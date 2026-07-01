# Game Loop — plan

> **Status: rough, living plan.** This is the agreed direction as of 2026-07-01,
> not a frozen spec. It pivots the project from the board editor (sessions 3–5
> of BOARD-EDITOR-PLAN.md, now shelved) to the brief's Phase 1: the core
> roguelike run. Update this doc as decisions change.

## Vision

The playable run from the design brief, made concrete: the player takes an army
through **13 must-win games** against full-strength Fairy-Stockfish, on boards
that grow, twist, and crumble as the run goes on. Between games the player
rearranges their pieces and picks upgrades. Difficulty comes entirely from how
much asymmetric advantage the player holds — never from weakening the engine —
and is **measured, not authored**: an offline FSF-vs-FSF harness plays every
board archetype thousands of times so no human ever hand-tunes a number.

## Locked decisions

1. **Run structure: 13 games — 4 acts × 3 games, then game 13 as an ultimate
   boss round.** Board size is fixed within an act and grows at act gates.
2. **Permadeath.** A loss ends the run.
3. **Draw = loss.** Every game is must-win for the player. Anti-stall pressure
   comes from the crumble mechanic (below), not from draw-rule tweaks alone.
4. **No manual difficulty tuning.** Difficulty is calibrated by a harness in
   which FSF capped at a nominal **UCI_Elo 1000** plays the player's side
   against full-strength FSF. Target: a nominal-1000 player completes a full
   run **~45% of the time**. (The 45% is a solve parameter, held loosely — see
   "The difficulty math".)
5. **Extreme board variance.** Enemy boards are produced by **archetype
   generators**, not fixed FENs — the player should never see the exact same
   board state twice. Each round draws a random archetype instance from the
   difficulty band appropriate to that round.
6. **Non-rectangular boards via walls.** Board shapes are carved with FSF wall
   squares (`*` in FEN) inside the 12×10 envelope — donuts, corridors,
   fortresses, islands. (Both vendored WASM builds contain the full walling
   machinery: `wallingRule`, `wallingRegion{White,Black}`, `wallOrMove`, and
   `snailtrail` as a known variant — verified by string inspection. Pushing a
   `*` through *our* pipeline end-to-end is Session W's job.)
7. **Anti-stall = phase-shift crumble.** Games start under normal rules; at an
   announced move N the variant is recompiled with `wallingRule = past`
   (snailtrail: every move leaves a permanent wall on its origin square) and
   both engines reload at the current position. The engine cannot anticipate
   the activation but plays the crumble natively — at full strength, in search
   — once it starts. This bounded blindness is accepted; it is categorically
   better than scripted decay the engine could never see.
8. **Full strength, always, in the run.** The playground's strength knobs
   (Skill/Elo) stay in the playground. The run pins `{ mode: 'full' }`. The
   only place engine-weakening exists is the calibration harness, as the
   stand-in human (brief §6).
9. **Standard six piece types only** for the first playable loop, same as the
   editor's v1 palette — fairy pieces remain deferred with their asset session.
   Modifier acts beyond walls/crumble (atomic, crazyhouse, …) are also out of
   scope for v1. Note: **walling and piece drops are mutually incompatible**
   (hard engine error, verified in the binary) — a future crazyhouse-style act
   can never combine with crumble; the act system must know this.

## The difficulty math (why the curve is a hockey stick)

Per-round winrates compound across a 13-game must-win run:

| avg per-round winrate | full-run success |
|---|---|
| 94% | ~45% |
| 90% | ~25% |
| 85% | ~12% |

So the *average* round must be ~94% winnable for the reference 1000 player, and
the curve cannot be flat: early rounds are nearly free (~98%+), and the
difficulty budget concentrates in act 4 and the boss. Draw=loss raises the bar
further — the player must *force a win* against an opponent that will happily
bail into a repetition or 50-move draw when worse. Two consequences:

- **`stalemateValue = loss`** (stalemated side loses) and the crumble mechanic
  are conversion tools, not flavor — they exist so winnable positions convert
  to wins inside the move budget. Under active crumble, repetition is literally
  impossible (the position monotonically changes) and games self-terminate,
  with **mobility exhaustion** becoming a common decisive ending.
- Harness scoring is strict: **draws count as player losses.**
- Calibration happens **per act** (5 regimes: acts 1–4 + boss), not per round —
  13 per-round targets would explode the measurement matrix for no benefit.
  Within an act, difficulty climbs via the enemy-board band, not geometry.

**Board-size gates (provisional, playtest to adjust):**
act 1 ≈ 5×5–6×6 → act 2 ≈ 7×6–8×8 → act 3 ≈ 9×8–10×9 → act 4 ≈ 11×9–12×10 →
boss: 12×10 (or a signature geometry).

## Boards: archetypes, walls, variance

Fixed hand-authored FENs (the brief §5's original choice) cannot deliver
"never the same board twice" — this plan supersedes that decision with
**hand-authored *generators*, procedurally realized**. An archetype is a shape
family + piece theme + declared difficulty levers; every instance randomizes
wall layout and placements within the archetype's constraints, so gimmick
identity survives ("oh no, a fortress") while exact states never repeat.

Starter archetype candidates (3–4 for v1; the pool grows additively — target
8+ so 13 draws per run stay varied):

- **Fortress** — enemy king walled in, 1–2 breaches. Levers: breach width,
  garrison quality.
- **Corridors** — parallel lanes with slots. Levers: lane width (rook lanes vs
  knight mazes play completely differently).
- **Pillars** — scattered single walls breaking sliders' sightlines on an open
  field. Levers: pillar count/density.
- **Horde** — open board, pawn wave. Levers: wave depth, backing pieces.
- **Islands** — two pockets joined by a bridge. Levers: bridge width, force
  split.

**Every generated instance passes runtime guardrails before play** (cheap,
milliseconds, regenerate on failure):

1. The existing golden-rule gate (`validateFen` via the compiler).
2. **Connectivity** — flood fill over non-wall squares; the armies must be able
   to reach each other. A sealed board is an unwinnable staring contest.
3. A single fixed-depth eval with `UCI_ShowWDL` — reject instances that land
   wildly outside their target difficulty band.

Difficulty is *not* modeled from material or wall counts — chokepoints favor
knights, open lanes favor rooks, a walled-in king changes everything. No
formula survives that; measured winrate does (see harness).

## Difficulty measurement — the harness

The heart of "no manual tuning", and the brief §6's calibration harness made
real. Two tiers, because the generator produces effectively infinite boards and
you cannot play 200 games against each one:

- **Offline (expensive, games):** for each archetype, sweep its parameter space
  (material delta, wall density, garrison quality, board size). At each point,
  play N games: FSF at nominal UCI_Elo 1000 takes the player's side with a
  **reference army** for that act; full-strength FSF (fixed depth, Threads=1)
  takes the enemy board. Capped-strength move selection is stochastic, so
  repeated games genuinely differ. Output: an empirical map
  *archetype params → player winrate*, stored as JSON the game consumes (static
  hosting: it's a data file in the repo).
- **Runtime (cheap, per instance):** the guardrails above. The offline map
  picks the parameters; the guardrails catch outlier instances.

Mechanics and honesty notes:

- **Where it runs:** `tools/`, never shipped. Preferred host: Node driving the
  *same vendored WASM builds* (ffish.js is Node-compatible; stockfish.wasm
  under Node is a Session H verification item). Fallback: Playwright + headless
  Chromium driving the app's own modules through the `?debug` handles — the
  repo's established verification habit. Graduate to a native FSF binary only
  if throughput demands it.
- **Throughput ballpark:** a capped-vs-full game on a small board is seconds;
  hundreds of games is a lunch-break sweep, parallelizable across workers.
- **Scoring:** player must win. Draws, stalemate-losses, and mobility
  exhaustion score by the same rules the run uses.
- **The Elo caveat, once:** `UCI_Elo` is calibrated against standard chess. On
  a carved 6×7 board with a pawn horde, "1000" is *nominal* — a consistent
  yardstick, not a certified human rating. All tuning is relative to the
  yardstick; the designer's own playtesting later anchors whether it sits where
  real 1000-Elo humans do. If it's off, one number slides.
- **Reference armies:** difficulty is relative to what the player brings — a
  board that's easy for a queen build is hard for a knight swarm. v1 keeps the
  player's army growth on a narrow rail (fixed start + pick-1-of-3 upgrades),
  so 1–2 reference armies per act calibrate honestly. Widening build diversity
  later means widening the reference set (brief §6 anticipated exactly this).

## The crumble (anti-stall) mechanic

`wallingRule = past` — the snailtrail rule, native to both engines: every move
leaves a permanent wall on the square the piece departed from. Two uses:

1. **Phase-shift anti-stall (the run's default).** Normal rules until an
   announced move N, then: recompile the variant (same geometry, walls
   accumulated so far stay in the FEN, `wallingRule = past` added), reload both
   engines at the current position, re-run the validation gate, continue play.
   The engine is blind only to the activation timing; from move N it plays the
   crumble at full depth. The player, knowing the countdown, can pre-position —
   asymmetric advantage in its purest form. The countdown is visible UI.
2. **Native from move 1 — a possible act/boss gimmick.** With the rule on from
   the start, the whole game is about the trails (sealing lines, denying
   squares, self-fortressing) and games are short by construction (~every ply
   removes a square). One ini line through the compiler when we want it.

Implementation notes:

- With `past`, wall placement is **implicit in the move** — UCI move strings
  are unchanged (unlike duck/arrow variants which carry a wall destination), so
  input UI needs nothing new. Walls only need *rendering*.
- Mid-game variant swap is a new capability for the play path — today a game is
  one compiled variant fixed at `startGame()`. It's the same
  compile → validate → load pipeline, invoked mid-game (Session R).
- The trigger (fixed move number vs "no capture/progress in N moves") is an
  open design question; start with a fixed, telegraphed move number.
- `wallingRegion` × `past` interaction (could restrict which squares crumble)
  is a Session W spike question.

## Player side

- **Army:** fixed starting army per run for v1 (composition TBD via harness —
  it must beat act 1 at ~98% for the reference player).
- **Setup screen:** before each game, the player arranges their pieces within
  their own zone — the editor's free-placement internals (brush model,
  `fullFen()` assembly, live validation) constrained to own-pieces/own-squares.
- **Upgrades:** pick 1 of 3 between games, no currency in v1 (a metered economy
  is Phase 2, per the brief). Pool TBD — add-a-piece / upgrade-a-piece
  offers sized by the harness like everything else.
- **Persistence:** run state (act, game index, army, upgrade history) in
  localStorage, patterns from `share.js`. Permadeath = clearing it.

## Game 13 — the ultimate boss

Deliberately open design space, decided late when the harness can measure
candidates. Directions to explore: a signature setpiece archetype with variance
(memorability without repetition), crumble native from move 1, an
extreme-geometry board (full 12×10), or a "everything you learned" composite.
Constraint: same rules as everything else — measured difficulty, full-strength
engine, expressible as `(config + FEN)`.

## Relationship to existing code and docs

Almost everything carries over; this plan is mostly *game structure* on top of
plumbing that already works:

- **The variant compiler** (`variant-config.js`) generates per-round boards at
  any size; walls and `stalemateValue`/`wallingRule` keys extend `buildIni`.
- **The golden-rule gate** (`rules.js` `validate()`) is the pre-round check and
  the first runtime guardrail.
- **`startGame()`** (`main.js`) is the shared play path the round loop drives —
  exactly as the editor's "Play this position" already does.
- **The editor** stays as the dev/authoring tool (archetype debugging, boss
  authoring); it gains a wall brush in Session W. Editor-plan sessions 3–5 stay
  shelved.
- **`share.js`** patterns seed run persistence.
- **The brief** remains the north star, with two recorded deviations: enemy
  boards are archetype-generated rather than hand-authored FENs (supersedes
  brief §5's choice — generators preserve the memorability rationale), and
  stalemate/draw handling is resolved as draw=loss + `stalemateValue = loss` +
  crumble (brief §7's open question).

## Session breakdown

Ordered risk-first: the two spikes gate everything; the rest is known work.
**Each session ends with the app still fully working and shippable.**

### Session W — Walls (de-risking spike)

The one genuine engine unknown left. Gates the whole non-rectangular premise.

- Prove **static `*` walls in a custom variant's `startFen`** end-to-end:
  `validateFen` accepts, both engines load, sliders are blocked by walls, the
  engine replies legally. Determine the exact ini incantation (bare `*` vs a
  `wallingRule`/`wallingRegion` requirement). Fallback if static FEN walls
  misbehave: `mobilityRegion` carving — verify sliders can't pass *through*
  excluded squares before trusting it.
- Prove **`wallingRule = past`** end-to-end: trails accumulate in the FEN, UCI
  move format unchanged, engine plays it.
- Probe **`wallingRegion` × `past`**: does an out-of-region origin mean "no
  wall" (useful: partial decay) or an illegal move (useless)?
- Prove **`stalemateValue = loss`**: mobility-exhaustion endings resolve, and
  `board.result()` reports them correctly.
- **Render walls** in chessgroundx at any geometry (autoPieces/`_-piece` or a
  CSS overlay; a simple dark block, no licensing concerns).
- **Editor wall brush** (+ FEN round-trip with `*` — `parsePlacementDims`
  already counts them), making the editor the archetype-debugging tool.
- **Connectivity util** (flood fill) as a pure module.
- Extend the `?debug` handles; bump the cache-bust.
- *Ship:* build a walled board in the editor, play it, and watch a snailtrail
  game end in mobility exhaustion.

### Session H — Calibration harness (de-risking spike)

Gates the no-manual-tuning premise. Independent of W (can develop on plain
rectangles); build early per brief §6.

- `tools/` harness, isolated from game code. Resolve the host: same WASM under
  Node, else Playwright + headless Chromium via `?debug`.
- Match runner: `(board config, player army, games N)` → capped
  (`UCI_LimitStrength` + `UCI_Elo 1000`) vs full-strength (fixed depth,
  `Threads=1`), strict must-win scoring, parallel workers.
- `UCI_ShowWDL` plumbing for the cheap instance screen.
- JSON results per measurement point (winrate, game lengths, terminations).
- *Ship:* point the harness at a hand-built editor position and get a
  winrate report.

### Session G — Board generators

Needs W (walls) + H (measurement).

- Archetype interface: `generate(params, rng) → { spec fragment, meta }`,
  difficulty levers declared per archetype; seeded RNG so the harness can
  reproduce instances, unseeded in the live game.
- 3–4 starter archetypes from the candidate list.
- Runtime guardrails (gate + connectivity + WDL screen + regenerate).
- Offline sweeps through H → parameter→winrate maps as repo JSON.
- *Ship:* "deal me an act-2 board" produces varied, valid, band-checked boards.

### Session R — Run loop

Needs W for wall rendering + the mid-game swap; parallelizable with G.

- Run state machine (4 acts × 3 + boss slot, permadeath, localStorage).
- Setup screen: constrained placement on the editor's internals.
- Pick-1-of-3 upgrade step between games.
- Round flow: guardrails → play (full strength pinned) → result → advance or
  run-over. Draw = loss.
- **Mid-game variant swap** for the crumble phase shift + countdown UI.
- Harden the engine turn against restarts (generation counter so a stale
  `bestmove` can't land on a new game — rounds restart constantly).
- *Ship:* a full 13-game run playable end to end with placeholder tuning.

### Session T — Tuning integration

Needs everything above.

- Assemble per-act difficulty bands from G's maps; solve the hockey-stick curve
  for the ~45% full-run target; validate with full-run simulations through H
  (reference rail including upgrade picks).
- Boss-round candidates measured and picked.
- Record findings in a PHASE-0-FINDINGS-style note.
- *Ship:* the tuned default run.

## Open questions / revisit later

- **Boss design** (game 13) — decided in Session T when candidates can be
  measured.
- **Crumble trigger** — fixed move number vs no-progress-in-N; start fixed.
- **Upgrade pool contents** — and whether offers should counter the drawn
  board or stay board-blind (board-blind is simpler and forces adaptation).
- **Setup freedom** — own half vs own ranks vs anywhere-behind-a-line; affects
  both feel and the calibration reference.
- **Elo anchor** — does nominal-1000 difficulty feel right to a real ~1000
  player? First human playtests answer this; if off, slide the yardstick.
- **Archetype wishlist** — dedicated brainstorm before Session G.
- **Act flavor beyond geometry** — v1 acts differ by size/band only; universal
  act modifiers (brief §5) return post-v1, minding the walls×drops
  incompatibility.
- **Run seed** — expose a seed for shareable/reproducible runs? Cheap if the
  generator RNG is already seedable (Session G), but not v1.
