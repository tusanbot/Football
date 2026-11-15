# Football Empire Match Architecture

**Decision status:** Approved product architecture  
**Interaction model:** Semi-active, server-authoritative simulation  
**Client parity:** Telegram Bot and Telegram Mini App use the same match capabilities and domain APIs  
**Scope:** Friendly matches, leagues, cups, group/alliance competitions, and future seasonal competitions

## 1. Product decision

Football Empire matches are **not fully manual and not a single unattended roll of the dice**.

The server simulates football in deterministic phases. At selected tactical checkpoints, each manager can make a bounded set of decisions. If a manager is offline or does not respond before the checkpoint deadline, the match continues using that club's saved pre-match plan and then safe AI defaults.

The manager is the head coach: they prepare the team, choose the match plan, react at key moments, and review the result. They do not control individual players or every pass.

Both the Bot and Mini App must support the complete set of match operations. Their presentation can differ, but neither may be a reduced-feature client.

## 2. Match lifecycle

Target lifecycle:

1. **PREPARATION** — select the starting XI, bench, formation, tactics, and fallback plan.
2. **SCHEDULED** — fixture and immutable participant/competition references are stored.
3. **KICKOFF** — the server snapshots both clubs' eligible players, tactics, and relevant attributes.
4. **SIMULATING** — the match engine advances through deterministic time segments and persists events.
5. **TACTICAL CHECKPOINT** — both managers may submit decisions for their own club. The match waits only until both submit or the bounded decision window expires.
6. **RESUME** — accepted decisions are applied and the next segment is simulated.
7. **COMPLETED** — score, events, player performances, injuries, fitness, rewards, finances, and competition standings are settled exactly once.
8. **REPORT** — both clubs can retrieve the same canonical match report.

A match must never depend on a user keeping the app open. A durable server worker resumes due matches after process restarts. There is no user-controlled pause that can hold a competition indefinitely.

## 3. Simulation clock and checkpoints

Use a 90-minute football clock, plus stoppage-time handling in the engine. The first release uses four simulation segments:

- First half: minute 1–45.
- Early second half: minute 46–60.
- Middle second half: minute 61–75.
- Closing phase: minute 76–90+.

Manager checkpoints occur at:

- **Half-time:** full tactical review, formation/mentality changes, substitutions.
- **Minute 60:** substitutions and tactical changes.
- **Minute 75:** final substitutions and risk/mentality changes.

The server opens a short decision window (initial default: **60 seconds**) at each checkpoint. It can resume earlier when both managers have submitted. The deadline is server-owned and cannot be extended by clients. If no response arrives, the saved fallback plan is applied. The exact wall-clock duration can be tuned from telemetry without changing football rules.

Important incidents such as a red card or injury are recorded immediately. A medically forced replacement may be applied automatically when waiting would leave an invalid lineup; it is clearly marked as an automatic/forced change in the report.

## 4. Manager controls

### Before kickoff

Each manager configures and saves:

- Starting XI and up to seven substitutes (subject to roster rules).
- Formation and player roles/positions.
- Mentality, pressing, tempo, and passing style.
- Fallback instructions for half-time, minute 60, and minute 75.
- A substitution priority list, including outgoing player, preferred replacement, and optional conditions.

The server validates that the starting lineup contains exactly 11 eligible players, including a goalkeeper, and that selected players belong to the club and are not injured/suspended/ineligible.

### At a checkpoint

A manager may submit one atomic decision package for their own club:

- Make one or more legal substitutions.
- Change formation.
- Change mentality, pressing, tempo, or passing style.
- Choose a conservative, balanced, or aggressive risk profile for the next segment.

A submitted package is validated as a whole. Invalid packages are rejected without partially applying changes. A manager may revise their package until the checkpoint closes; only the latest accepted revision is applied.

### Substitution rules

Initial rules follow the standard five-substitute model:

- Maximum five substitutions per club.
- Maximum three substitution opportunities during normal time; half-time substitutions do not consume an opportunity.
- One player may leave only once; one substitute may enter only once.
- A goalkeeper replacement must preserve a valid goalkeeper on the field.
- A red-carded player cannot be substituted back into play.
- Forced injury substitutions count toward the normal allowance in the first release.

The rule set must be represented as competition configuration in the domain layer, not hard-coded separately in Bot and Mini App.

## 5. Offline and timeout behavior

Each club stores a pre-match fallback plan. The server resolves a checkpoint in this order:

1. Latest valid manager decision received before the deadline.
2. Matching pre-planned substitution/tactical rule.
3. Safe tactical AI default.

The AI must respect roster eligibility, substitution limits, position/role compatibility, and competition rules. It must not spend currency, change contracts, list players, or perform unrelated economic actions.

If only one manager responds, that decision is applied and the other club uses its fallback after the deadline. The match does not wait indefinitely for a disconnected or inactive manager.

## 6. Authoritative architecture

The **domain engine** is the single source of football rules and simulation outcomes.

- **packages/domain:** deterministic segment simulation, tactical effects, substitution validation/application, competition rules, and result calculation. It must not depend on Telegram, React, HTTP, or Prisma.
- **apps/api:** authorization, match orchestration, checkpoint deadlines, durable state, concurrency control, and settlement.
- **apps/bot:** Telegram commands/callbacks and concise match timeline/report presentation. It calls the same API use cases as the Mini App.
- **apps/web:** Mini App match center, live timeline, tactical checkpoint controls, lineup/bench, and full report. It calls the same API use cases as the Bot.
- **apps/api/prisma:** durable match state, decisions, event log, and performance records.

Neither client may simulate a match, decide a result, calculate rewards, or directly mutate a player's match state.

### Durable progression worker

Match progression must use a persistent, lease-based worker pattern (similar to the existing Telegram message deletion queue):

- Claim due match work atomically with a lease.
- Process one segment/checkpoint at a time.
- Persist resulting events, state transition, and next due time in a transaction.
- Use compare-and-set/version checks so two workers cannot advance the same match concurrently.
- Recover expired leases after crashes.
- Retry transient failures with bounded exponential backoff and expose terminal failures to monitoring/admin tools.

No in-memory timer may be the only record that a match needs to resume.

## 7. Persistence model

The current FootballMatch, MatchEvent, and PlayerMatchPerformance models are a useful base, but the current one-shot SCHEDULED-to-COMPLETED flow is insufficient for semi-active play.

The implementation should evolve the schema in small migrations:

### FootballMatch additions

- Lifecycle state that distinguishes scheduled, in-progress, awaiting decisions, completed, and cancelled.
- Current simulation minute/segment and next progression time.
- Match engine version and immutable snapshot version.
- Optimistic concurrency version and worker lease metadata.
- Snapshot references/data for both sides' lineup, bench, tactics, and relevant player attributes.

The match seed and engine version must remain immutable after kickoff. Replaying a completed match returns the stored result; it must never re-run settlement.

### MatchDecision

A durable record for each club/checkpoint decision:

- Match, club, checkpoint, actor, payload, revision, submitted time, and applied time.
- Unique constraint preventing duplicate active decisions for the same club/checkpoint/revision.
- Idempotency key and audit metadata.

### MatchEvent

Continue using the ordered event log, extending it with structured metadata where needed:

- Goals, assists, cards, injuries, substitutions, tactical changes, half-time, and full-time.
- Source (MANAGER, PREMATCH_PLAN, AI, or ENGINE).
- Stable sequence number and football minute.
- Player references for outgoing/incoming players where applicable.

### PlayerMatchPerformance

Persist final minutes, goals, assists, shots, passes, tackles, cards, rating, and fitness loss. Performance is finalized once, after full-time.

The exact schema should be finalized during implementation after checking existing migrations and relations; do not rewrite or discard historical match data.

## 8. API contract and client parity

Expose transport-neutral use cases through authenticated API endpoints. The initial endpoint family should cover:

- List upcoming/live/recent matches and competition fixtures.
- Read match state, timeline, checkpoint deadline, and available actions.
- Save pre-match plan.
- Submit or revise a checkpoint decision.
- Read the final match report and player performances.
- Read competition table/bracket and match schedule.

The Bot and Mini App must invoke the same validation and service methods. Telegram Bot callbacks must not bypass normal ownership checks. A manager can submit decisions only for a club they own; a participant can read the match report according to competition visibility rules.

The API should return a canonical state payload so both clients render the same score, minute, events, pending decision, and deadline. Client-side countdowns are display-only; server time determines whether a decision is accepted.

## 9. Competition formats

Initial competition behavior:

- **Friendly:** one scheduled match, no league table, normal match rewards.
- **League:** round-robin fixtures, table points (3/1/0), goal difference and goals-for tie-breakers. The competition completes only after all fixtures are settled.
- **Cup:** single-match knockout ties in the first release; tied matches go to a penalty shootout. The next round is created only after every fixture in the current round has a winner.
- **Group/alliance competitions:** use the same fixture, match engine, decision, and settlement services. Group/alliance membership controls entry and permissions; it must not fork the football simulation implementation.

Two-leg aggregate knockout ties, promotion/relegation between permanent divisions, and more advanced season scheduling are later competition-format extensions. They should be added as explicit configuration and domain rules, not special cases in the Bot or Mini App.

## 10. Settlement and integrity

All final effects are server-side and idempotent:

- Match status and final score.
- Match events and player performances.
- Player fitness loss and injury status.
- Gate receipts, match rewards, reputation, and ledger entries.
- League table updates or cup progression.

Use stable per-match idempotency keys for each settlement effect. A retry must not double-credit wallets, double-count a league result, apply fitness loss twice, or create duplicate fixtures.

The result must be reproducible from the stored seed, engine version, and kickoff snapshots. Once kickoff begins, later edits to the club lineup or player attributes must not silently change that match's inputs.

## 11. Match experience in both clients

**Telegram Bot**
- Match notifications and concise event timeline.
- Inline keyboard actions at half-time, 60', and 75'.
- Buttons for substitutions and tactical presets, with clear remaining substitution count/opportunities.
- Deadline reminder and automatic-fallback notice.
- Final score and compact report with a Mini App deep link.

**Telegram Mini App**
- Match center with score, clock, event timeline, lineups, bench, and team comparison.
- Tactical checkpoint panel with the same actions and validation as the Bot.
- Substitution planner showing legal/used changes and opportunities.
- Full-time report, player ratings, and competition context.

A decision made in either client is immediately reflected in the other because both operate on the same server state.

## 12. Migration and delivery sequence

Implement in vertical slices; do not replace the working match engine in one risky change:

1. **Domain foundation:** extract deterministic segment simulation and shared rule validation; add tests for seed reproducibility, segment continuity, substitutions, cards, injuries, and tactical effects.
2. **Persistence/state machine:** add lifecycle/checkpoint/decision schema and migrations; preserve old completed matches as completed historical records.
3. **API orchestration:** add durable worker, checkpoint deadlines, idempotent decisions, concurrency protection, and settlement guards.
4. **Bot experience:** notifications, callback actions, timeout/fallback behavior, and report.
5. **Mini App experience:** match center and the same decision actions; verify API parity.
6. **Competition integration:** friendly, league, cup, group, and alliance fixtures all advance through the same orchestration path.
7. **Integrated verification:** unit, API, migration, worker-recovery, duplicate-action, timeout, Bot/Mini App parity, and multi-manager concurrency tests.

Do not migrate a live database or deploy the Bot/API as part of this architecture decision. Those remain separate, explicitly approved steps.

## 13. Acceptance criteria

- A match progresses and completes when both managers are offline.
- A manager can affect a match through pre-match choices and bounded in-match decisions.
- The same decision is available through Bot and Mini App.
- No client can decide scores or bypass server-side validation.
- Checkpoint timeout always resolves using the stored fallback plan/AI.
- Restarting a worker does not lose or duplicate match progression.
- Duplicate requests do not duplicate substitutions, events, rewards, injuries, or table updates.
- Every substitution obeys the configured competition rules.
- Completed reports are immutable and reproducible from stored snapshots, seed, and engine version.
- Existing completed matches remain readable after schema evolution.
