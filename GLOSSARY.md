# Holocron: Household Routine & Reward App

Domain language for a self-hosted, single-family wall-tablet app: tracks daily routines, rewards completion with points, and enforces `internet`/`entertainment`/`games` restrictions via router (internet) and PiHole DNS groups (entertainment, games) when routines are missed.

## Index

- [Language](#language)
  - [Roles & accounts](#roles--accounts) — Trackee, Admin, Restrictable Trackee, Household-tablet session
  - [Tasks & misses](#tasks--misses) — Occurrence resolution, Miss, Remediation, Late completion, Escalation ladder, Daily routine streak, Clean streak, Tier
  - [Ledger](#ledger) — Transaction, Adjust Balance, Cash-out, Cash-out request
  - [Household alerts](#household-alerts) — Audible warning
  - [Restrictions](#restrictions) — Restriction, Cause, Lift mechanism
  - [Presence](#presence) — Presence schedule, N-week pattern grid
  - [Goals](#goals) — Goal, Tiered goal, Windowed task, Excused, Deferred, Presence-suppressed, Pending review
- [Relationships](#relationships) — how the entities above interact
- [Example dialogue](#example-dialogue) — illustrative Q&A in the domain language
- [Flagged ambiguities](#flagged-ambiguities) — terms with historical overload, now resolved

Related: [docs/adr/](docs/adr/) for architectural decisions referencing these terms; [docs/](docs/) for architecture + per-engine mechanism reference; [CLAUDE.md](CLAUDE.md) for the broader doc map.

## Language

### Roles & accounts

**Trackee**:
Any user whose routines, goals, points, transactions, streaks, and presence schedule are tracked by the app. Every user is a trackee.
_Avoid_: Member, participant.

**Admin**:
A capability flag on a Trackee. An Admin can manage other Trackees' tasks/goals, approve verifications, lift restrictions, apply ad-hoc penalties, and adjust balances. Stored as `is_admin`.
_Avoid_: Parent, moderator.

**Restrictable Trackee**:
A Trackee whose `is_restrictable` flag is true. Only Restrictable Trackees can have Restrictions applied; enforcement is driven by their enrolled **Devices**. Trackees with `is_restrictable = false` accrue points and incur point Penalties but never trigger Restrictions.
_Avoid_: Child, kid, restricted user.

**Household-tablet session**:
A single synthetic, long-lived session bound to the wall tablet, authorized to act as Trackee for any user in the household. Selects active Trackee via top-of-screen tabs. Exposes no Admin functionality.
_Avoid_: Shared session, kiosk mode, family session.

### Tasks & misses

**Occurrence resolution**:
An engine-level event for any terminal-state transition of an Occurrence — Miss firing, mark-clean completion, Late completion, Excused, Deferred, submit-for-review, approve-review, reject-review. Each Resolution settles its glossary-named consequences atomically as a coarse effect bucket: an optional Penalty/earn/claw-back on the ledger, an optional Escalation-ladder move (advance / retract / reset / clean-streak advance), an optional Restriction Cause apply or remove (delegated to the Lift module on remove), and an optional Daily routine streak break/preserve. Distinct from "resolved Miss" — that phrase refers specifically to a Miss whose Restriction has been lifted by a Remediation; Remediation is one *kind* of Resolution, not a synonym.
_Avoid_: Outcome (overloaded with legacy method names), transition (too generic), event (overloaded with realtime fan-out).

**Miss**:
The event that fires when a task occurrence reaches its deadline (the task's `due_time`, or local midnight if no `due_time` is set) without being completed or excused. A Miss posts the current ladder-tier Penalty, advances the task's escalation ladder by one tier, activates the tier's Restriction (if any, and if the Trackee is a Restrictable Trackee), and breaks the streak. Late-completion within the late window can undo a Miss in full.
_Avoid_: Failure, fault, default.

**Remediation**:
An action that lifts the Restriction component of a Miss. Four paths exist: Late completion, completing a designated remediation Goal, waiting out an `auto_expires` Restriction, and an Admin lifting it directly. With one exception (Late completion — see below), Remediations lift only the Restriction; the Penalty point deduction, the ladder advance, and the streak break persist.
_Avoid_: Recovery, fix, cure.

**Late completion**:
Completing a task after its Miss has fired but before the task's late-completion window expires. Uniquely among Remediations, a successful Late completion is a *full undo* of the Miss: the Penalty points are refunded, the ladder advance is retracted, the Restriction (if any) is lifted, and the streak is preserved. Conceptually, "the task got done, just late" — not a substitute act.
_Avoid_: Catch-up, recovery completion.

**Escalation ladder**:
A per-task ordered list of one or more **Tiers** that defines what happens on the 1st, 2nd, 3rd… consecutive Miss. The current position on the ladder is tracked per (task × Trackee). Each Miss advances the position by one. The last Tier is "and beyond" — once reached, further Misses repeat its payload without advancing further. A clean streak of the task resets the position to Tier 1.
_Avoid_: Penalty schedule, miss tree, escalation chain.

**Daily routine streak**:
A per-Trackee counter of consecutive non-breaking days. A day breaks the streak when there is any unresolved Miss on a non-Presence-suppressed, non-Excused, non-Deferred occurrence at day-rollover (local midnight). Days that are fully Presence-suppressed/Excused/Deferred, or that have zero non-reminder tasks scheduled, are *non-events*: the counter preserves, the day is neither break nor advance. The configurable bonus (default `+5`, admin-editable in Household settings) is paid only when a *qualifying* day advances the counter (≥1 non-reminder task scheduled, all completed or excused). Distinct from the Clean streak: this one drives a *reward*; the Clean streak controls a *penalty*. The bonus and the counter increment both fire at day-rollover.
_Avoid_: Routine streak (ambiguous), completion streak.

**Clean streak**:
A per-(task × Trackee) counter of consecutive Clean occurrences of the task after its most recent Miss-with-advance. When the count reaches the task's `ladder_reset_threshold` (default 3), the Escalation ladder position resets to Tier 1. A Clean occurrence is one whose end-of-day state has no unresolved Miss (Late completion counts as Clean; goal-completion / wait-out / parent-override Remediations do not). Excused and presence-suppressed occurrences preserve the count without advancing it. Counts task *occurrences*, not calendar days.
_Avoid_: Recovery streak, reset streak.

**Tier**:
A position on the Escalation ladder. Carries a non-negative `points` deduction (required, may be zero) and an optional Restriction spec (`type`, duration policy, and the duration-or-remediation-goal that policy requires). A Tier's Restriction is silently skipped when applied to a non-Restrictable Trackee, but the ladder still advances. Typical household use: Tier 1 deducts points, Tier 2 restricts streaming or gaming, Tier 3 restricts all internet.
_Avoid_: Step, level, stage.

### Ledger

**Transaction**:
A single signed change to a Trackee's points balance, with a `kind` discriminator and (where applicable) a `reason` string and `admin_user_id`. Kinds: `earn` (task/goal completion), `penalty` (a Miss firing), `adjustment` (Admin "Adjust Balance" — signed; carries reason + admin), `withdrawal` (Cash-out commit), `claw_back` (system-issued reversal on Pending-review rejection, vacation reconciliation, or Late-completion full-undo). `penalty` and `adjustment` are intentionally distinct kinds even when both are negative — the distinction is "system-issued vs Admin-discretionary."
_Avoid_: Ledger entry, balance change.

**Adjust Balance**:
The Admin action to apply a signed `adjustment` Transaction to any Trackee (including the Admin's own user). Carries an optional reason string. Has no streak effects, no Escalation-ladder effects, and no Restriction effects — it is purely a ledger move. The "ad-hoc penalty" referenced in D1 is the negative-signed case of this single feature; there is no separate penalty action.
_Avoid_: Ad-hoc penalty (collapsed into this), balance correction.

**Cash-out**:
The conversion of a Trackee's points balance (in whole or part) into a real-world IOU at the configured rate (default `$0.10/point`). Recorded as a Withdrawal Transaction; money moves out-of-band. Blocked while the balance is negative. Pressed from the admin browser, commits directly (admin-auto-approved). Pressed from the wall tablet, creates a **Cash-out request** instead — a non-committal record that surfaces for Admin commit/reject in the admin browser.
_Avoid_: Withdrawal (use only for the Transaction kind), redemption, payout.

**Cash-out request**:
A pending Trackee-initiated cash-out from the wall tablet, awaiting Admin commit or reject in the admin browser. Carries no ledger effect until committed. Reversing a committed Cash-out is done via an ad-hoc positive balance adjustment with a "withdrawal reversed" reason — there is no dedicated reversal action.
_Avoid_: Pending withdrawal.

### Household alerts

**Household time zone**:
The single civil-time zone (an IANA name, e.g. `America/Los_Angeles`) that the whole app interprets and displays wall-clock times in — task due times, the tablet clock and greeting, and the day boundaries used by streaks, goal limit windows, miss deadlines, the audible warning, and presence. Admin-set in Settings; the wall tablet reads it (it does not use the device's own zone). All timestamps are stored in UTC; the zone is applied only on projection. See ADR-0007.
_Avoid_: "server time", "local time" (ambiguous — always say household time zone).

**Audible warning**:
A single household-level sound + visual cue that plays at a configurable HH:MM (in the **household time zone**) if any **Restrictable Trackee** who is not an **Admin** has an incomplete non-reminder task that is not Presence-suppressed, Excused, Deferred, or Pending review. Fires at most once per evening regardless of how many Trackees or tasks contribute.
_Avoid_: Alarm (overloaded), reminder, deadline alert.

### Restrictions

**Device**:
A network endpoint enrolled under a Restrictable Trackee's profile, carrying a display name, IP address, and MAC address (both optional individually, but at least one must be set for enforcement to apply). The IP address is the target for **router** enforcement (used by the `internet` scope); the MAC address is the target for **PiHole** enforcement (used by the `entertainment` and `games` scopes). A Trackee may have zero or more Devices. If a Trackee has no Device carrying the address kind a given scope's backend requires, the enforcement adapter writes a `result='skipped'` row to the enforcement log and the admin UI flags the Restriction as "NOT ENFORCED" — the in-app Restriction state is still tracked. Enrolled Devices should have static DHCP leases — an out-of-app admin responsibility.
_Avoid_: Client, endpoint, machine.

**Restriction**:
A block on a Restrictable Trackee's access to one scope (`internet | entertainment | games`), enforced against the Trackee's enrolled Devices by a backend chosen per scope: the **router** (EdgeRouter ipset) for `internet`; **PiHole** (DNS group membership) for `entertainment` and `games`. A Restriction has a non-empty list of **Causes**; its effective lift conditions are derived from those causes. At most one active Restriction exists per (Trackee, scope) — new causes merge into the existing record.
_Avoid_: Block, ban, lockout.

**Cause**:
An entry on a Restriction's cause log explaining why it's active. Two kinds — **MissCause** (created when a Miss's Tier specifies a Restriction) carries the Tier's contributed lift conditions (auto-expiry duration and/or remediation goals; either, both, or neither). **AdminCause** (created by an "Block now" Admin action) is always parent-only (no contributed auto-expiry, no contributed remediation goals).
_Avoid_: Reason, source, trigger.

**Lift mechanism**:
A way to remove a Restriction. Four exist: **Admin lift** (always available, baseline), **Auto-expiry** (lifts at the Restriction's effective `expires_at`), **Goal remediation** (Trackee completes any goal in the Restriction's effective `remediation_options`), and **Late completion** (a Miss-specific full-undo — see ADR-0001). A Restriction with no effective auto-expiry and no effective remediation options is "parent-only" in effect, meaning Admin lift is the only path.
_Avoid_: Remediation (overloaded), unblocking.

### Presence

**Presence schedule**:
A per-Trackee record (single, mutable — no versioning) describing where the Trackee lives. Has at most one recurring residency rule and any number of one-off windows. The recurring rule may be `none`, `full-time`, or an **N-week pattern grid** anchored by an `epoch_date` (ISO `YYYY-MM-DD`); the engine snaps to that week's ISO Monday and computes Week A/B via modulo. Edits rewrite history via the ADR-0003 reconciliation, including changes to `epoch_date`.
_Avoid_: Residency calendar, attendance schedule.

**N-week pattern grid**:
A fixed-length mask (most commonly 2-week) where each cell is "home" or "away" and may carry an optional **per-day hand-off start-time** (default `00:00`). On a "home" cell, the start-time is when the Trackee is considered home from on that day; on an "away" cell, the start-time is when the Trackee leaves. End-of-stay on a home cell is implicit as the start-time of the next "away" cell. Adjacent home cells with no start-time on the right are continuous.
_Avoid_: Custody grid, week mask.

### Goals

**Goal**:
An optional, Admin-defined activity a Trackee can pull from at any time to earn points. Carries a `category_id`, an icon, point value(s), a `completion_limit` (1–999), and a `limit_window` (`day | week | month | lifetime`). May be flagged `show_in_catalog`, `usable_as_remediation`, and optionally bound to a single `assigned_to_trackee_id`. Window boundaries are ISO week (Monday start) and calendar month, both in the household time zone.
_Avoid_: Reward, activity, task (task is a routine obligation, Goal is opt-in).

**Tiered goal**:
A Goal whose point value is one of several **Tier values** picked by the Trackee at completion time (e.g., Lego at 10/20/30/40/50 points). Used to model a single activity with variable intensity, avoiding the need to create separate Goals per intensity. The Goal's `completion_limit` applies to total completions in the window regardless of which tier was chosen.
_Avoid_: Variable goal, multi-level goal.

**Windowed task**:
A task whose deadline is a window (`window_start`, `window_end`) rather than a single moment. Can be recurring (windowing relative to a cadence) or one-shot. The Miss fires at `window_end`; there is no Late completion for Windowed tasks (the window already provided the flex). Counts toward the Daily routine streak on `window_end`'s day.
_Avoid_: Flexible task, deadline task.

**Excused**:
A per-occurrence Admin action that marks a single task occurrence as "doesn't count" — no Penalty, no points, no streak break, preserves the Clean streak. Stored on the occurrence (`status = excused`).
_Avoid_: Skipped, waived, forgiven.

**Deferred**:
A per-occurrence Admin action equivalent to Excused, plus the creation of a new occurrence of the same task on a future date (linked back via `deferred_from_occurrence_id` for provenance). Used when an Admin wants to push a task without losing it.
_Avoid_: Postponed, rescheduled (rescheduled implies editing the task definition).

**Presence-suppressed**:
A derived (not stored) per-occurrence state: an occurrence is presence-suppressed when its effective time-of-day falls outside the Trackee's home window per the presence schedule. Effective time-of-day is the task's `due_time` if set, else `23:59`. Presence-suppressed occurrences are treated identically to Excused for rule purposes. Because suppression is derived on read, retroactive presence-schedule edits propagate automatically and trigger a reconciliation that reverses or reinstates any Miss effects on newly-affected past occurrences.
_Avoid_: Away, vacationing, off-day (those are UI badges, not the state).

**Pending review**:
The state of a verifiable task between Trackee mark-done and Admin approve/reject. Points credit optimistically into the balance on entry. While Pending review, the task is considered complete for deadline purposes — no Miss can fire even past `due_time`. On rejection (whether by Admin action or by the household-level pending-review timeout auto-rejecting), the optimistic credit is clawed back and a Miss fires *at rejection time* with all four effects (Penalty, ladder advance, Restriction, streak break). Approval makes the optimistic credit permanent.
_Avoid_: Awaiting approval, in-review, unverified.

## Relationships

- A **Trackee** may additionally be an **Admin** (capability flag).
- A **Trackee** may be a **Restrictable Trackee** (independent capability flag).
- Restriction-only state and rules apply exclusively to **Restrictable Trackees**.
- The **Household-tablet session** can impersonate any **Trackee** but is never an **Admin**.
- A task occurrence produces at most one **Miss**, fired at `due_time` (else midnight).
- A **Miss** can be undone in full by a **Late completion**, or have its Restriction lifted by any other **Remediation**.
- A **Restriction** has 1+ **Causes**. Effective auto-expiry = MAX of cause expiries, or none if any cause is parent-only-on-expiry. Effective remediation options = UNION of cause remediation goals, or empty if any cause is parent-only-on-remediation. **Most-restrictive-wins on each dimension independently.**
- **Late completion** of a Miss lifts only that Miss's **Cause** from the Restriction, then recomputes. If it was the last Cause, the Restriction lifts entirely.

## Example dialogue

> **Dev:** "When a Penalty escalation tier specifies a restriction, what happens if the **Trackee** isn't a **Restrictable Trackee**?"
> **Domain expert:** "The point deduction still applies; the restriction component is skipped. Restrictions are an `is_restrictable`-only concern — being an **Admin** is a separate axis."

## Flagged ambiguities

- "Child" was used in early planning to mean both "non-Admin Trackee" and "Trackee subject to Restrictions" — resolved: two independent flags, `is_admin` and `is_restrictable`. The household model correlates them (Admin + non-Restrictable for adults; non-Admin + Restrictable for kids) but the schema does not enforce the correlation.
