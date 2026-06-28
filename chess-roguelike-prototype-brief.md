# Chess Roguelike — Prototype Design Brief

*Working title — rename as you like. Prepared for Claude Code implementation.*

**Premise:** A chess roguelike. The player builds and upgrades a chess army across a run of escalating games against a **full-strength Fairy-Stockfish** opponent. Difficulty comes from asymmetric advantages handed to the player, never from weakening the AI. The board grows over a run; acts have universal modifiers; between rounds the player rearranges pieces and buys upgrades to pursue a "build."

---

## 0. How to read this doc

- **Three things are fixed (§1). Everything else is a working hypothesis to be validated by playtesting, not a requirement.** Section 5 in particular is our current best guess from design discussion — change anything that doesn't survive contact with play.
- **The goal of this prototype is to make design decisions, not to ship a game.** Build the smallest thing that lets us judge whether the core concept is fun and technically viable.
- Sections are ordered: hard constraints → the architectural prime directive → engine integration → phased scope → provisional design → dev tooling → open questions → decided non-goals.

---

## 1. Hard constraints (immovable)

1. **FSF-legibility.** Every board state the game produces must be fully evaluable by Fairy-Stockfish. The engine must never face a game it can't see. This is the prime directive and constrains every mechanic.
2. **Static hosting on GitHub Pages.** No server, no backend, no build step. Everything runs client-side; vendored assets loaded directly (ES modules / script tags), no bundler.
3. **Mobile-first.** Primary target is a phone browser. Touch input, small screen, limited CPU.

---

## 2. Prime directive, expanded: what "FSF-legible" means architecturally

- **Game state ⟷ (variant config + FEN).** The playable board and the engine both derive from a *single variant definition per board* — one source of truth, never two separate rule engines that could disagree.
- Use **ffish.js** as the rules / legality / FEN authority for the game layer (it *is* Fairy-Stockfish's move generator). Use the **Fairy-Stockfish WASM UCI engine** for the opponent's move. The same variant config feeds both.
- **Validate before every engine call** with ffish.js: legal position, exactly one king per side, no pawn on the last rank, the side-to-move's opponent not already in check. Never hand the engine an illegal FEN.
- If a mechanic can't be expressed as `(config flag + FEN)`, it does not go in. See **Non-goals (§8)**.

---

## 3. Engine integration (the part that must be right)

- **Two components:** ffish.js (rules) + Fairy-Stockfish WASM (search / opponent). They are separate; wire both.
- **Reference implementation:** *fairyground* combines ffish.js + chessgroundx + the WASM engine in-browser — use it as the canonical example of how to wire this on a static page. Confirm exact current package names / versions / APIs at implementation time.
- **Single-threaded build for the prototype.** Multithreaded WASM needs `SharedArrayBuffer` → COOP/COEP headers, which GitHub Pages can't set without a `coi-serviceworker` workaround. Skip that complexity until perf proves it necessary.
- **Engine lifecycle:** initialize once, reuse across moves. Never spin up per move (large-board magic init is slow — pay it once).
- **Move selection:** full strength, always. Bounded per-move time or fixed depth. Use **fixed depth, single thread** wherever reproducibility matters (WDL checks), since time-based / multithreaded search is non-deterministic.
- **Variable board:** never hardcode 8×8. FEN parsing, rendering, input, and validation must handle arbitrary dimensions (target range **5×5 → 12×10**).
- **Classical eval only — no NNUE.** There are no trained nets for custom content; classical eval is plenty strong vs. humans and works on any board size / piece set. (For custom pieces, `pieceValueMg`/`pieceValueEg` can correct the eval's estimate if it misjudges a piece.)

---

## 4. Prototype scope — phased

Build in this order. Each phase gates the next.

### Phase 0 — Technical spike (make-or-break)
A playable game of **standard** chess on a small board, vs. full-strength FSF, in a **mobile browser served from GitHub Pages**, tap-to-move.
**Validates:** the engine loads and returns strong moves at acceptable per-move latency on a real mid-range phone, single-threaded.
**If this fails, stop and rethink the whole approach before building anything else.**

### Phase 1 — Core loop
Player customizes their side (rearrange back-rank pieces + buy one upgrade) → plays one round vs. full-strength FSF on a small board → repeat ~3 rounds. Difficulty = the player's asymmetric advantage (more / better pieces via the FEN), never engine strength.
**Validates:** is "full-strength AI vs. asymmetric player advantage" actually fun and winnable? Does the build/customize step feel good? *(This is the central design bet.)*

### Phase 2 — Roguelike texture
Add: one or two hand-authored gimmick boards, one universal act modifier (e.g., atomic), a minimal metered economy + run-specific shop.
**Validates:** the act-modifier × build interaction; whether curated enemy boards + builds produce interesting difficulty.

Everything past Phase 2 is **backlog**, pulled in only after these phases inform the direction.

---

## 5. Working design hypotheses (provisional — validate, don't assume)

All of this came out of design discussion and is our current best guess. **None is a requirement.**

- **Acts:** a run is divided into acts; board size is fixed within an act and **grows only at boss gates** (not every round). Tentative floor **5×5**, ceiling **12×10**.
- **Universal modifiers as act gimmicks (symmetric, both sides):** atomic (king-explosion as a sanctioned win — see §8), crazyhouse (strong late-game act), must-capture, petrify-on-capture, Seirawan gating, the walls/duck family (snailtrail, Atlantis, arrows, isolation, duck), triple-step pawns, Berolina pawns, promotion locks. Modifiers compose (atomic + must-capture, etc.) — many acts from few primitives. Consider a **vanilla act 1** so players learn the base game first.
- **Player upgrades (asymmetric):** centered on the legible asymmetry set — which pieces and where (FEN), fusion / upgraded piece types, and per-color rule perks (promote-to-anything, deeper promotion region, bigger walling range, etc.). The shop sells asymmetric **answers** to the act's symmetric twist (e.g., a blast-immune king during an atomic act).
- **Enemy:** **hand-authored gimmick boards** drawn from a pool larger than any one run uses, randomized selection and order, bosses as signature setpieces. (Chosen over procedural enemy generation for memorability/character.)
- **Pieces:** mostly standard. Any custom pieces are historical or pulled from existing variants, **biased toward intuitive compounds** (archbishop = B+N, chancellor = R+N, amazon = Q+N) for readability. Prefer FSF's **predefined** pieces (built-in, pre-valued, sharper AI).
- **Assets (working choice — locked but swappable):** the **Kaneo** piece set from **Kadagaden/chess-pieces** (`github.com/Kadagaden/chess-pieces`). Covers standard pieces *and* the fairy pieces we'd use (archbishop, chancellor, cannon, elephant, hawk) in one coherent SVG style, already shipping on pychess.org; the same repo has Xiangqi / Janggi / Sittuyin sets for gimmick boards. **License: CC-BY-4.0** — commercial use fine, but requires attribution, so bake a visible credit to the author into the site. SVG scales cleanly across the 5×5–12×10 range and stays crisp on mobile. Gap-fillers if a piece is missing: Alfaerie (chessvariants.com — widest fairy coverage, utilitarian art, partial SVG), Wikimedia Commons (Cburnett-style fairy SVGs), samboy/ChessGraphics (public domain). Safe license zone is CC-BY / GPL / CC0 — GPL is fine since FSF is GPL-3.0; **avoid CC-BY-NC sets** (many lichess ones). Rule: one coherent set, and weight silhouette readability over aesthetic at phone sizes.
- **Vanilla special rules** (castling, double-step, en passant, promotion) are kept, but **authored per board size**: castling only exists from ~7 wide; the rest work from 5×5 up. "Vanilla once the board is big enough to support each rule." This naturally makes early boards stripped-down and late boards full-richness.
- **Builds = chess synergies, not trigger stacks.** Synergy is positional (coordination / structure / control), which the engine already evaluates — **the engine is the synergy calculator**; no hand-authored combo logic, no scripted triggers.
- **Variety:** consider **MultiPV** (pick among near-best moves) so the AI isn't robotically identical across runs.

---

## 6. Balance & dev tooling (separate workstream — not player-facing)

This is how balance actually gets made. Keep it isolated from game code.

- **WDL readout:** read win/draw/loss probabilities for a position from the player's side, to judge whether a matchup is in band.
- **Automated calibration harness:** a weakened FSF (`UCI_Elo` at a target skill band) plays the player's side against full-strength FSF on a given board, a few hundred games, to estimate "winnable at intended skill?" per **build archetype** — without hand-playing every matchup. *(This is the only place engine-weakening is used — as a stand-in human for testing, never in the live game.)*
- With hand-authored enemy boards, WDL shifts from a runtime gate to a **design-time validation instrument:** test each gimmick board (under its act modifier) against a spread of build archetypes (rook-heavy, knight-heavy, cannon-heavy, minimal, balanced); soften it or guarantee buyable counters where it craters.
- Build this early enough that it's ready when tuning starts.

---

## 7. Open questions (resolve via prototyping)

- **Mobile engine perf ceiling:** what per-move latency / search depth is acceptable on a mid-range phone, single-threaded? *(Phase 0 answers this and may reshape everything.)*
- **Board rendering:** chessgroundx (lichess variant board — handles drops / promotion / variant pieces, but verify it works no-build) vs. a minimal custom vanilla board (full control, fits the no-build rule, but reimplements interaction). Shapes the whole UI layer — decide early.
- **Roster vs. board growth:** does the player's army grow to fill bigger boards, or spread thinner as boards expand? Defines the economy curve and round loop. *(Stated intent: economy fast enough to keep boards from feeling empty.)*
- **Economy pace:** fast enough to fill growing boards without trivializing the spending cap (Passant's "too easy" failure mode was an unconstrained economy + board-overloading).
- **Stalemate / draw handling:** stalemate-as-draw is a feel-bad in a must-win game — consider stalemate = win for the attacker. Also: a superhuman defender can escape to a 50-move / repetition draw if the player can't force mate in time, so the player's edge must be enough to mate within the clock, or draw rules adjust per act.
- **Customization UX on mobile:** how much build complexity fits a phone screen before it's overwhelming.
- **Board density at scale:** a proportionally full 12×10 (~30 pieces/side) is congested and the mobile-perf worst case; density may need to ease as boards grow, for openness and frame rate both.
- **Persistence:** run state (build, economy, act progress) persists via `localStorage` / `IndexedDB` (fine on the real deployed site).

---

## 8. Non-goals / explicit exclusions (decided — do not build or re-explore)

These were ruled out during design. Capturing them so they don't get reintroduced.

- **No win-condition changes.** Checkmate is the only win condition. The **one sanctioned exception is atomic's king-explosion**, treated as mate-by-other-means. No three-check, king-of-the-hill, racing kings, antichess, connect, capture-the-flag, or scoring wins.
- **No field-effect / aura pieces.** Anything that alters *other* pieces' legality based on position (immobilizer / freezer, "adjacent enemies can't move," buff/debuff auras) is outside FSF's grammar — excluded. If a "lockdown" feel is wanted, reskin it as threat-domination or a wall.
- **No hidden information, no per-turn randomness, no multi-move turns.** These break FSF evaluation. All dynamism lives in **setup (FEN)** or the **config-flag menu** — never a novel runtime rule.
- **No NNUE.** Classical eval only.
- **No engine strength capping in the live game.** The AI always plays its best move; difficulty comes only from asymmetric player advantage. (No Skill Level / `UCI_Elo` weakening except in the dev calibration harness.)

---

*This brief reflects a loose, exploratory design. Phase 0 and Phase 1 exist to tell us whether the core bet — full-strength AI made fair by asymmetric player advantage, entirely within FSF's grammar — is fun. Treat §5 as a starting point to playtest against, not a spec to implement faithfully.*
