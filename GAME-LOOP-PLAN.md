# Game Loop — plan

> **Status: rough, living plan.** This is the agreed direction as of 2026-07-01,
> not a frozen spec. It pivots the project from the board editor (sessions 3–5
> of BOARD-EDITOR-PLAN.md, now shelved) to the brief's Phase 1: the core
> roguelike run. Update this doc as decisions change.

## Session H findings & revised decisions (2026-07-03)

> A design/measurement pass that effectively did much of Session H's spike work
> in a Node harness (Fairy-Stockfish full + `UCI_Elo`-capped vs ffish
> adjudication — **verified working**, see "Difficulty measurement"). Several
> earlier decisions are **superseded**; they're annotated inline below and the
> reasoning is here. Numbers are small-N spikes (N≈20–30) at reduced movetime
> (80–100ms, not the final 1s) with nominal Elo on tiny boards — **directional,
> not final** — but the *relative* effects are robust.

**The one thing that matters most: the win condition is CHECKMATE ONLY.**
The player advances *only* by delivering checkmate. Stalemate, repetition, any
draw, or getting mated = the run is over. Symmetric for the AI (it ends your run
only by checkmating *you*). n-check and other non-mate win conditions are
rejected — nothing but a factual checkmate satisfies.

**Two-layer stalemate handling (the subtle, load-bearing part).**
- *Engine/variant level:* keep `stalemateValue = loss` + `nFoldValue = loss` +
  `perpetualCheckIllegal`. This denies the full-strength defender any draw/
  stalemate safe-harbor — it can't bail out of a lost position, and it's
  *indifferent* between being mated and stalemated (both = loss), so it never
  steers *into* stalemate to save itself.
- *Run scoring level:* only a delivered checkmate advances the player; a
  board-level stalemate-win still counts as a **player loss**. The engine never
  sees this meta-rule, so it plays honestly and can't game it. Result: which
  ending happens is decided by the *player's* technique + army, not by the
  defender scheming.
- Consequence: the calibration target (~94%/round, ~45%/run) is now a
  *checkmate* rate — a stricter bar than "don't lose."

**What actually produces fast, checkmate-rich games (measured, real 1200-vs-full):**

| board | matchup | result |
|---|---|---|
| 5×5 | player K+2R vs full K+R | **90% checkmate**, ~6 moves, 7% stalemate |
| 5×5 | player K+Q+R vs full K+R | 53% mate, **37% stalemate** (lone queen suffocates the king) |
| 6×6 | player K+2R vs full K+R+P | 47% mate, 37% stalemate, ~19 moves |
| 8×8 | heavy edge vs bare-ish king | mates rarely; games barely resolve |

Levers, in order of impact:
1. **Small boards.** The master dial. 5×5 ≈ 90% mate; each rank bigger halves it.
   *Cap board size at 8×8* (was: grow to 12×10). Big boards are where forcing
   mate against a full engine goes to die.
2. **Stalemate-resistant matchups.** A rook ladder (2R) mates cleanly (90%); a
   lone queen stalemates (37%). Checkmate rate is a property of
   `(board, player army, enemy army)` — exactly what the harness measures.
3. **Defender keeps a unit** (e.g. a pawn) so it always has a move and can't be
   stalemate-baited.
4. **Draw = loss stack** (above) so the defender can't stall into a draw.
5. **Mating-material guardrail** (below).

**Difficulty scales via enemy army + geometry, NOT board size.** With size
capped small, acts get harder through the enemy's material band and position
quality, not by growing the board.

**Generator is board-BLIND.** The enemy board is *not* tailored to the player's
army. Adaptive-to-player generation is a trap: it's sandbaggable *and* it nullifies
build progression (the enemy just rescales to whatever you bring, so your upgrades
stop mattering). Instead: fixed per-act difficulty bands calibrated once against a
**reference army**; the player's actual build determines *their* odds vs the band.
Sandbagging becomes self-punishing (weaker army, same wall). Relies on a narrow
build rail so one reference army calibrates honestly.

**Mating-material guarantee = hard check on the enemy + curation on the player.**
- *Enemy side (hard):* the generation guardrail rejects any board where the
  player lacks a real mating force or that's one trade from an insufficient-
  material draw.
- *Player side (soft, and the weak point):* we don't generate the army, we stock
  the **shop**. Curate the pool so *every reachable build is mate-capable and
  stalemate-resistant* (rooks/majors; never sell the parts for a dead-end army).
  Shop design is load-bearing for the checkmate goal, not flavor.

**The FSF-eval "referee" idea → a generation-time screen, not live intervention.**
Using FSF eval to catch stalemate-prone situations is a good idea, but only
*upstream*: at generation time, reject matchups that don't convert to checkmate
reliably (this sharpens the guardrail). A *live* referee that edits walls to steer
the game was prototyped and shelved — see the graveyard.

### Shelved for v1 — the mechanic graveyard (don't re-litigate)

Every anti-stall / decisiveness mechanic below was explored and rejected *because
it fought the checkmate-only goal*. Recorded so future sessions don't rebuild them.

- **Walls / board-shrink (snailtrail `past`, `arrow`, `edge`, random "storm",
  occupied-square crumble).** These end games by *suffocation* (mobility
  exhaustion) — structurally the "no legal moves" ending we're eliminating, not
  checkmate. Occupied-square crumble additionally destroys mating material →
  ~38% insufficient-material draws. Measured: crumble *lowered* checkmate rate
  (47%→21% on 6×6). Walls can't deliver check, so they can never *create* a mate
  (only seal an escape when a piece is already checking — a biased, exploitable
  assist). Engine-capability notes on walling modes retained below in case walls
  return as post-v1 *flavor* (never as anti-stall).
- **n-check / flag / extinction / material-count win conditions.** Not a factual
  checkmate. Rejected on principle.
- **Crazyhouse drops / gating.** Drops let the defender plug mating nets
  (suppress mate) and are wall-incompatible; gating is a reinforcement *upgrade*
  (shop material), not an anti-stall, and pulls in deferred fairy pieces.
- **The "pressure" referee** (eval-gated, randomized, stalemate-safe adaptive
  walling). Prototyped end-to-end. It *works* marginally (15%→25% checkmate on a
  bad 6×6 matchup, genuinely unbiased — it helped the defender mate too) but
  **structurally trades fast-stalemate for slow-mate**: it doubled game length
  (14→31 moves), blowing the ≤20-move goal, because the fast endings it removes
  *are* the stalemates. And 25% is an order of magnitude worse than just using a
  5×5 rook matchup (90%, for free). Conclusion: the referee polishes the wrong
  lever. Fast *and* mate comes from the matchup, not a live intervention.

### Engine-capability notes retained (from probes, for post-v1)

- `wallingRule` modes in both builds: `past` (wall on vacated square/snailtrail),
  `arrow` (Amazons — shoot a wall along a queen line from the landing square),
  `static` (place a wall on any empty square), `edge` (place on any empty square
  **orthogonally adjacent to a boundary or existing wall** — perimeter on a
  rectangle; on carved boards it hugs interior walls too, eroding inward from
  every boundary), `duck` (one relocating wall). Walling move UCI format is
  `<from><to>,<to><wallSquare>`.
- Gating (`seirawanGating`): reserve pieces in the FEN pocket `[EHeh]` enter the
  board on the square a back-rank piece *vacates*, once each, at the mover's
  option; notation `<from><to><gatedPiece>` (e.g. `g1f3h`). Gating *rights* must
  be granted in the FEN castling field, not just the pocket.
- `hasInsufficientMaterial()`, `isCheck()`, `result()`, `isGameOver()` on the
  ffish `Board` are the adjudication surface the harness uses.

### Still to do in the actual Session H build

- Harden the harness (larger N, real 1s movetime, parallel workers, seedable).
- The generation-time **checkmate-rate screen** (eval or fast-play) as a guardrail.
- **Army sweeps** on ≤8×8 to find matchups that clear ~95%+ checkmate for the
  reference army; feed the per-act bands.
- Confirm `UCI_LimitStrength` capping stays honest at 1s movetime (it demonstrably
  *engages* on custom variants — the 1200 stand-in plays weak and even loses).

## Vision

The playable run from the design brief, made concrete: the player takes an army
through **13 must-win games** against full-strength Fairy-Stockfish, on varied
small boards (capped at 8×8 — Session H). Between games the player
rearranges their pieces and picks upgrades. Difficulty comes entirely from how
much asymmetric advantage the player holds — never from weakening the engine —
and is **measured, not authored**: an offline FSF-vs-FSF harness plays every
board archetype thousands of times so no human ever hand-tunes a number.

## Locked decisions

1. **Run structure: 13 games — 4 acts × 3 games, then game 13 as an ultimate
   boss round.** Board size is fixed within an act. *(Superseded re: growth — see
   Session H findings: board size is **capped at 8×8** and does not grow as a
   difficulty lever; acts scale via enemy army/geometry.)*
2. **Permadeath.** A loss ends the run.
3. **Draw = loss.** Every game is must-win for the player. *(Superseded/sharpened
   — see Session H findings: the win condition is **checkmate only**; anti-stall
   is the `stalemateValue`/`nFoldValue`/`perpetualCheckIllegal` = loss stack, NOT
   the crumble mechanic, which is shelved.)*
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
   squares (`*` in FEN) — donuts, corridors, fortresses, islands. *(Superseded
   for v1 — see Session H findings: walls are **shelved**. They end games by
   suffocation, not checkmate, and the envelope is now 8×8, not 12×10. Static
   `*` walls remain proven and may return post-v1 as pure flavor, never as
   anti-stall.)* (Both vendored WASM builds contain the full walling machinery:
   `wallingRule`, `wallingRegion{White,Black}`, `wallOrMove`, and `snailtrail` as
   a known variant — verified by string inspection.)
7. **~~Anti-stall = phase-shift crumble.~~** *Superseded — see Session H findings
   and the mechanic graveyard. Anti-stall is now the draw=loss rule stack;
   crumble (and the eval "referee") are shelved because they produce suffocation/
   slow-mate endings instead of the factual checkmates the design requires.*
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

- **`stalemateValue = loss`** stays at the engine level so the defender can't
  bail into stalemate, but conversion now comes from **small boards +
  stalemate-resistant matchups** (Session H) — and a board-level stalemate
  scores as a *player loss* under checkmate-only scoring. *(The crumble half of
  this bullet is superseded; crumble is shelved — see the mechanic graveyard.)*
- Harness scoring is strict: **only a delivered checkmate counts as a player
  win** — draws *and* board-level stalemate-wins score as losses (Session H).
- Calibration happens **per act** (5 regimes: acts 1–4 + boss), not per round —
  13 per-round targets would explode the measurement matrix for no benefit.
  Within an act, difficulty climbs via the enemy-board band, not geometry.

**Board-size gates — superseded (Session H): the envelope is capped at 8×8.**
Bigger boards collapse the forced-checkmate rate, so geometry growth is no
longer the act lever. Acts live in the 5×5–8×8 window (exact per-act sizes set
by harness sweeps); difficulty climbs via the enemy band.

## Boards: archetypes, walls, variance

> **Session H note:** wall-carved shapes are shelved for v1 (see the mechanic
> graveyard) — v1 archetypes express their identity through army composition
> and placement on plain boards ≤8×8. The generator/guardrail architecture
> below stands; the wall-specific levers wait for post-v1.

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
4. **Checkmate-convertibility screen (Session H)** — reject matchups that don't
   convert to a *literal checkmate* reliably for the reference army (fast-play
   or eval-based; this is the "referee" idea moved upstream to generation time,
   where it's neutral).

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

- **Where it runs:** `tools/`, never shipped. Host: Node driving the *same
  vendored WASM builds* — **verified working during Session W** (both WASMs
  run under plain Node: pass `wasmBinary` explicitly; the engine's pthreads
  ride worker_threads). Fallback if ever needed: Playwright + headless
  Chromium through the `?debug` handles — the repo's established verification
  habit. Graduate to a native FSF binary only if throughput demands it.
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

> **Superseded (Session H): shelved for v1 — do not build.** Measured with real
> engines: crumble *halves* the checkmate rate (47%→21% on 6×6) and ends games
> by suffocation, and the live "referee" variant trades fast stalemates for
> slow mates. Anti-stall is now the draw=loss rule stack. Section kept for the
> engine findings and post-v1 reference.

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

- With `past` the wall square is *determined* by the move (always its origin),
  but the UCI string still carries it explicitly as a suffix — `d1c1,c1d1`,
  promotions `a4a5q,a5a4` — a Session-W finding that corrected this doc. The
  rules layer parses and supplies the suffix, so the input UI still needs
  nothing new; walls only need *rendering*.
- Mid-game variant swap is a new capability for the play path — today a game is
  one compiled variant fixed at `startGame()`. It's the same
  compile → validate → load pipeline, invoked mid-game (Session R).
- The trigger (fixed move number vs "no capture/progress in N moves") is an
  open design question; start with a fixed, telegraphed move number.
- ~~`wallingRegion` × `past` interaction (could restrict which squares crumble)
  is a Session W spike question.~~ — **answered (Session W): a dead end.** The
  region restricts which moves are *legal* (a move's origin must be wallable),
  so a partial region silently forbids moves rather than softening decay.
  Not used.

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
(memorability without repetition) or an "everything you learned" composite.
*(Session H: crumble-from-move-1 and the 12×10 extreme-geometry board are out —
crumble is shelved and the envelope is capped at 8×8.)* Constraint: same rules
as everything else — measured difficulty, full-strength engine, checkmate-only
scoring, expressible as `(config + FEN)`.

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
- **The brief** remains the north star, with three recorded deviations: enemy
  boards are archetype-generated rather than hand-authored FENs (supersedes
  brief §5's choice — generators preserve the memorability rationale);
  stalemate/draw handling is resolved as **checkmate-only scoring** on top of
  the engine-level draw=loss stack (brief §7's open question — crumble is no
  longer part of the answer); and the board envelope is capped at 8×8
  (Session H).

## Session breakdown

Ordered risk-first: the two spikes gate everything; the rest is known work.
**Each session ends with the app still fully working and shippable.**

### Session W — Walls (de-risking spike) ✅ done

> **Status: complete.** Every engine unknown resolved — all in the app's favor
> — and verified end-to-end in headless Chromium (20 checks, `?v=7`):
>
> - **Static `*` walls need no config keys at all.** Wall squares in any
>   position FEN validate, load, and play in both engines under a plain editor
>   variant — no `wallingRule`/`wallingRegion` required. Walls are occupancy:
>   they block sliders, round-trip through `Board.fen()`/`getFen()`, and work
>   across the whole envelope including 12×10.
> - **`wallingRule = past` (crumble) works natively in both engines**, with
>   one surprise: the UCI move format gains a wall suffix (`d1c1,c1d1`;
>   promotions `a4a5q,a5a4`). The rules layer is now comma-aware and pushes
>   the full string; the engine returns the same format and it applies clean.
> - **`wallingRegion` × `past` is a dead end** — the region restricts which
>   moves are legal rather than where walls form (see the crumble section).
> - **`stalemateValue = loss` behaves**: stalemate = attacker wins, and
>   crumble games terminate decisively by mobility exhaustion (verified 1-0 /
>   0-1 results, never a draw). One caveat for the generators: FSF's
>   insufficient-material adjudication still applies — a bare-kings crumble
>   position is an instant draw, so boards must carry mating material.
> - **Rendering was free**: chessgroundx natively maps `*` ↔ the `_-piece`
>   role (util.js `roleOf`/`letterOf`), so walls render and round-trip with
>   only CSS slab art added.
> - **Pre-existing bug found & fixed while proving 12×10**: ffish/UCI spell
>   rank 10 as `a10`, chessgroundx keys as `a:` — the two notations had never
>   been translated, so 10-rank boards were gate-valid but never actually
>   playable to rank 10 (and `slice()`-based move parsing broke on 3-char
>   squares). `Game`'s API now speaks chessgroundx keys and translates to UCI
>   internally; parsing is regex-based (`parseUci`).
> - **Session H bonus**: both vendored WASM builds run under plain Node (pass
>   `wasmBinary`; the engine's pthreads ride worker_threads) — the calibration
>   harness needs no browser.
>
> Shipped: wall brush + Crumble toggle in the editor (share hash `&cr=1` and
> the library carry the flag), wall rendering everywhere, `src/connectivity.js`
> (flood-fill armies-connected check, surfaced as a soft "walls seal the
> armies apart" warning), and the editor→play handoff compiling crumble
> configs through the existing gate.

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

> **Status: spike complete (2026-07-03), hardening remains.** The de-risking
> questions are answered, all in the app's favor: both WASMs drive under plain
> Node, the capped-vs-full match loop works with ffish adjudication, and
> `UCI_LimitStrength` demonstrably engages on custom small-board variants (the
> capped stand-in plays weak — it stalemates, and occasionally loses). A v0
> runner is committed at `tools/match-runner.cjs` (see `tools/README.md`).
> Remaining for the full session: per-side engine instances, parallel workers,
> real-movetime (1s) runs at honest N, `UCI_ShowWDL` plumbing, sweep outputs as
> repo JSON, and the army sweeps from the findings block.

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

Needs H (measurement). *(The W walls dependency is dropped for v1 — wall
geometry is shelved; Session H.)*

- Archetype interface: `generate(params, rng) → { spec fragment, meta }`,
  difficulty levers declared per archetype; seeded RNG so the harness can
  reproduce instances, unseeded in the live game.
- 3–4 starter archetypes from the candidate list.
- Runtime guardrails (gate + connectivity + WDL screen + regenerate).
- Offline sweeps through H → parameter→winrate maps as repo JSON.
- *Ship:* "deal me an act-2 board" produces varied, valid, band-checked boards.

### Session R — Run loop

Parallelizable with G. *(Session H: the W dependencies — run-time wall
rendering, the mid-game swap — dropped with crumble; the loop is simpler than
first planned.)*

- Run state machine (4 acts × 3 + boss slot, permadeath, localStorage).
- Setup screen: constrained placement on the editor's internals.
- Pick-1-of-3 upgrade step between games.
- Round flow: guardrails → play (full strength pinned) → result → advance or
  run-over. **Checkmate-only** (Session H): only a delivered mate advances;
  stalemate or any draw ends the run.
- ~~**Mid-game variant swap** for the crumble phase shift + countdown UI.~~
  *(Dropped for v1 — crumble shelved, Session H.)*
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
- ~~**Crumble trigger**~~ — moot; crumble shelved for v1 (Session H).
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
