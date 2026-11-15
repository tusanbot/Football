# Football Empire Match Architecture

**Decision status:** Approved product architecture  
**Interaction model:** Semi-active, server-authoritative simulation  
**Client parity:** Telegram Bot and Telegram Mini App use the same match capabilities and domain APIs  
**Scope:** Friendly matches, leagues, cups, group/alliance competitions, and future seasonal competitions

## 1. Product decision

Football Empire matches are **not fully manual and not a single unattended roll of the dice**.

The server simulates football in deterministic phases. At selected tactical checkpoints, each manager can submit a bounded set of decisions. If a manager is offline or does not respond, the match continues on its server-owned schedule using that club's saved pre-match plan and then safe AI defaults.

**A manager response is never a prerequisite for match progression.** The response window runs alongside the match clock; it does not pause the match. A decision is applied only if it arrives before the next simulation segment begins and before its decision deadline.

The manager is the head coach: they prepare the team, choose the match plan, react at key moments, and review the result. Both the Bot and Mini App must support the complete set of match operations.

## 2. Match lifecycle

1. **PREPARATION** — starting XI, bench, formation, tactics, fallback plan.
2. **SCHEDULED** — fixture and participant references stored.
3. **KICKOFF** — server snapshots both clubs' eligible players, tactics, and deterministic seed.
4. **SIMULATING** — deterministic simulation advances through persisted segments.
5. **TACTICAL CHECKPOINT** — a decision window opens while the match clock continues.
6. **RESUME** — at the scheduled segment boundary, timely manager decisions are applied; otherwise fallback instructions or safe AI defaults are used.
7. **COMPLETED** — result and all side effects are settled exactly once.
8. **REPORT** — both clubs retrieve the same canonical report.

Matches never depend on users keeping the app open. A durable server worker resumes matches after process restarts.

## 3. Match clock and decisions

Tactical checkpoints occur at half-time, minute 60, and minute 75. Each checkpoint has a server-owned decision deadline, initially 60 seconds after the checkpoint opens, but the next simulation segment has its own fixed start time.

The segment starts at its scheduled time **even when neither manager has responded**. The server resolves each club independently:
1. latest valid manager decision received before both the decision deadline and segment start;
2. saved pre-match fallback plan;
3. safe AI default.

A decision arriving after the segment starts is rejected for that checkpoint and cannot retroactively alter simulated play. Managers may change formation, mentality, pressing, tempo, passing style, and make legal substitutions. All actions are validated atomically by the server.

The Bot and Mini App display the same deadline and resolved state. Neither client runs a local countdown that can influence authoritative progression.

## 4. Substitution rules

The default competition rules are:
- **Maximum five players substituted per team over the entire match. Half-time substitutions count toward these five.**
- **Maximum three in-play substitution windows. Half-time changes do not consume an in-play window, but they still consume the five-player substitution allowance.**
- Multiple substitutions in the same checkpoint/window consume one in-play window, but each player entering counts toward the five-player limit.
- Forced injury substitutions also count toward the five-player limit and the in-play window allowance.
- A player who has left the field cannot return; a substitute can enter only once.
- A sent-off player cannot be substituted or return.
- At least one goalkeeper must remain on the field.
- Competition-specific rules are configurable in the domain layer and shared by Bot and Mini App.

A whole substitution package is validated before any changes are applied. A failed package leaves the match state unchanged.

## 5. Offline and timeout behavior

A missing response never pauses or extends the match. At the next segment boundary, the server applies the saved pre-match plan; if no valid plan exists, it applies safe tactical AI. The AI respects player eligibility, the substitution allowance, in-play windows, and goalkeeper constraints. It cannot perform economic actions.

## 6. Authoritative architecture

- **packages/domain:** deterministic simulation, checkpoint resolution, substitution and competition rules; no transport or database dependencies.
- **apps/api:** authorization, match orchestration, deadlines, persistence, concurrency and settlement.
- **apps/bot:** Telegram commands, callback decisions, notifications and reports.
- **apps/web:** Mini App match center, timeline, tactical decisions and full report.
- **apps/api/prisma:** durable match state, decisions, event log and performances.

Both clients use the same API use cases. Neither client calculates scores, rewards, or match state.

## 7. Persistence and integrity

The existing FootballMatch, MatchEvent and PlayerMatchPerformance models are the base. Semi-active matches require persisted lifecycle state, segment/minute, checkpoint deadline, immutable kickoff snapshots, decision records, optimistic concurrency and worker leases.

Progression must use a durable lease-based worker. Each segment/checkpoint and its events/state transition are committed transactionally. Expired leases recover after crashes. Idempotency prevents duplicate events, substitutions, rewards, fitness loss and table updates.

Checkpoint decision records must be append-only or versioned. A manager's latest valid decision before the segment boundary wins; late decisions cannot mutate a resolved checkpoint.

## 8. Competition formats

- **Friendly:** one match.
- **League:** round-robin fixtures, 3/1/0 points, goal difference and goals-for tie-breakers.
- **Cup:** single-match knockout in the first release; tied matches resolved by penalties.
- **Group/alliance competitions:** same fixture, simulation, decision and settlement services.

Two-leg cups, promotion/relegation and advanced season scheduling are later extensions.

## 9. Delivery sequence

1. Domain foundation: deterministic segment simulation, non-blocking checkpoint resolution and shared rule validation.
2. Persistence/state machine: lifecycle, checkpoint and decision schema.
3. API orchestration: durable worker, independent match clock, deadlines, idempotency and concurrency.
4. Bot experience: callbacks, notifications, timeout/fallback and reports.
5. Mini App experience: same decisions and match center.
6. Competition integration and end-to-end parity tests.

Do not migrate a live database or deploy the Bot/API without separate explicit approval.

## 10. Acceptance criteria

- Matches progress on their server-owned schedule even if both managers are offline.
- Checkpoint resolution never waits for a manager response.
- Managers can affect a segment only by submitting a valid decision before its start boundary.
- A missing decision resolves through pre-match fallback and then AI defaults.
- Identical actions exist in Bot and Mini App.
- Invalid, late or duplicate actions cannot alter resolved match state.
- Worker restarts neither lose nor duplicate progression.
- All substitution rules, including the five-player total and three in-play windows, are enforced.
- Completed reports are immutable and historical matches remain readable.


## 11. Durable runtime foundation (implementation status)

Persistence defines `MatchRuntime` (versioned state, minute, kickoff snapshot, simulation state, fallback plan, next action and worker leases), `MatchTacticalCheckpoint` (decision deadline and next segment boundary), and append-only `MatchTacticalDecision` records. The API accepts validated, idempotent instructions only from participating club owners.

The deterministic segment simulator advances through 0→45→60→75→90 with fixture-seeded replay, cumulative score, expected goals and ordered events.

The API now runs a durable lease-based worker every five seconds. It creates kickoff snapshots for due fixtures, advances the first half, opens the 45/60/75 checkpoints, polls for both managers' decisions, resumes immediately when both respond, and otherwise continues at the 60-second boundary. Manager instructions, saved fallback plans and AI defaults are resolved independently for each club. Substitutions are validated with the shared five-player/three-in-play-window rules, applied to the next segment and recorded as match events. Expired leases can be reclaimed after process restarts.

At minute 90, the worker invokes the existing transactional settlement path; score, goals, assists and substitution minutes are sourced from the persisted segment state, while settlement continues to handle rewards, wallets, fitness, performances, league standings and cup progression. The match listing API exposes runtime minute/status and checkpoint deadlines/decision presence for both clients.

**Delivered client integration:** The Mini App now has a dedicated match-center route with live runtime status, score, event timeline, current lineups and benches, checkpoint deadline, tactical controls and up to five proposed substitutions. The Bot exposes inline mentality callbacks plus `/tactic` and `/sub` commands. A durable checkpoint-notification claim endpoint and Bot poller send private Telegram alerts to managers who have not yet submitted a decision; notifications are claimed once per club/checkpoint. Both clients submit to the same authenticated decision endpoint.

**Remaining integration work:** Pre-match fallback-plan editing is not yet exposed. Detailed per-player non-goal statistics currently reuse the existing simulation-statistics routine; segmented injury and red-card generation, forced injury substitutions and their downstream effects are not yet implemented. Notification delivery is best-effort after an atomic claim; failed Telegram sends are logged but are not automatically re-queued.
