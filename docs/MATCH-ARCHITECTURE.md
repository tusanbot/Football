# Football Empire Match Architecture

**Decision status:** Approved product architecture  
**Interaction model:** Semi-active, server-authoritative simulation  
**Client parity:** Telegram Bot and Telegram Mini App use the same match capabilities and domain APIs  
**Scope:** Friendly matches, leagues, cups, group/alliance competitions, and future seasonal competitions

## 1. Product decision

Football Empire matches are **not fully manual and not a single unattended roll of the dice**.

The server simulates football in deterministic phases. At selected tactical checkpoints, each manager can make a bounded set of decisions. If a manager is offline or does not respond before the checkpoint deadline, the match continues using that club's saved pre-match plan and then safe AI defaults.

The manager is the head coach: they prepare the team, choose the match plan, react at key moments, and review the result.

Both the Bot and Mini App must support the complete set of match operations.

## 2. Match lifecycle

1. **PREPARATION** — starting XI, bench, formation, tactics, fallback plan.
2. **SCHEDULED** — fixture and participant references stored.
3. **KICKOFF** — server snapshots both clubs' eligible players and tactics.
4. **SIMULATING** — deterministic simulation advances through persisted segments.
5. **TACTICAL CHECKPOINT** — managers may submit decisions for their own clubs.
6. **RESUME** — accepted decisions are applied; timeout uses fallback instructions.
7. **COMPLETED** — result and all side effects are settled exactly once.
8. **REPORT** — both clubs retrieve the same canonical report.

Matches never depend on users keeping the app open. A durable server worker resumes matches after process restarts.

## 3. Match clock and decisions

The football clock is 90 minutes plus stoppage time. Checkpoints occur at half-time, minute 60, and minute 75. Each checkpoint has a server-owned decision window, initially 60 seconds. The match resumes earlier if both managers have responded.

The manager may change formation, mentality, pressing, tempo, passing style, and make legal substitutions. The server validates all decisions atomically. A missed deadline applies the saved pre-match plan, then safe AI defaults.

## 4. Substitution rules

The default competition rules are:

- **Maximum five players substituted per team over the entire match. Half-time substitutions count toward these five.**
- **Maximum three in-play substitution windows. Half-time changes do not consume an in-play window, but they still consume the five-player substitution allowance.**
- Multiple substitutions in the same checkpoint/window consume one in-play window, but each player entering counts toward the five-substitution limit.
- Forced injury substitutions also count toward the five-player limit and the in-play window allowance.
- A player who has left the field cannot return; a substitute can enter only once.
- A sent-off player cannot be substituted or return.
- At least one goalkeeper must remain on the field.
- Competition-specific rules are configurable in the domain layer and shared by Bot and Mini App.

A whole substitution package is validated before any changes are applied. A failed package leaves the match state unchanged.

## 5. Offline and timeout behavior

Each club stores a pre-match fallback plan. At a checkpoint, the latest valid manager decision wins; otherwise the saved plan is applied, then safe tactical AI. The AI respects player eligibility, the substitution allowance, in-play windows, and goalkeeper constraints. It cannot perform economic actions.

## 6. Authoritative architecture

- **packages/domain:** deterministic simulation, substitution and competition rules; no transport or database dependencies.
- **apps/api:** authorization, match orchestration, deadlines, persistence, concurrency and settlement.
- **apps/bot:** Telegram commands, callback decisions, notifications and reports.
- **apps/web:** Mini App match center, timeline, tactical decisions and full report.
- **apps/api/prisma:** durable match state, decisions, event log and performances.

Both clients use the same API use cases. Neither client calculates scores, rewards, or match state.

## 7. Persistence and integrity

The existing FootballMatch, MatchEvent and PlayerMatchPerformance models are the base. Semi-active matches require persisted lifecycle state, segment/minute, checkpoint deadline, immutable kickoff snapshots, decision records, optimistic concurrency and worker leases.

Progression must use a durable lease-based worker. Each segment/checkpoint and its events/state transition are committed transactionally. Expired leases recover after crashes. Idempotency prevents duplicate events, substitutions, rewards, fitness loss and table updates.

## 8. Competition formats

- **Friendly:** one match.
- **League:** round-robin fixtures, 3/1/0 points, goal difference and goals-for tie-breakers.
- **Cup:** single-match knockout in the first release; tied matches resolved by penalties.
- **Group/alliance competitions:** same fixture, simulation, decision and settlement services.

Two-leg cups, promotion/relegation and advanced season scheduling are later extensions.

## 9. Delivery sequence

1. Domain foundation: deterministic segment simulation and shared rule validation.
2. Persistence/state machine: lifecycle, checkpoint and decision schema.
3. API orchestration: durable worker, deadlines, idempotency and concurrency.
4. Bot experience: callbacks, notifications, timeout/fallback and reports.
5. Mini App experience: same decisions and match center.
6. Competition integration and end-to-end parity tests.

Do not migrate a live database or deploy the Bot/API without separate explicit approval.

## 10. Acceptance criteria

- Matches progress while both managers are offline.
- Managers can affect matches before kickoff and at bounded checkpoints.
- Identical actions exist in Bot and Mini App.
- Invalid or duplicate actions cannot alter match state.
- Checkpoint timeout resolves with fallback behavior.
- Worker restarts neither lose nor duplicate progression.
- All substitution rules, including the five-player total and three in-play windows, are enforced.
- Completed reports are immutable and historical matches remain readable.
