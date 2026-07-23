# Log Screen Redesign — Final Implementation Spec

Date: 2026-07-22
Status: Implemented

## Goal

Make the Log screen immediately understandable to a non-technical household
member, replace the decay/"half-life" mechanic with a plain rolling tally, and
help each person see a useful path toward a healthy, maintainable effort zone.

The tone should stay cooperative: the household is working together against the
mess. The screen should inform and encourage without judging either person.

## Final product decisions

- Effort uses a rolling seven-active-day tally instead of exponential decay.
- A joint chore awards its full effort value to each person.
- Vacation pauses continue to freeze the affected person's tally.
- The screen says "Last 7 days," not "This week," because the period is rolling
  rather than calendar-aligned.
- The prior-period recap says "Previous 7 days," not "Last week."
- Gap-closer suggestions prioritize chores that are due or approaching due.
- The gap-closer is hidden while the household or this phone's person is paused.
- Intro state is device-local and versioned.
- Service and board-reset events reset bubbles but never award effort.
- Each individual tally has three supportive zones: Getting started below 40%,
  Building from 40%, and Green from 80% onward.
- The product goal is "keep it in the green." Exact points remain secondary.
- The Together bar stays neutral so combined effort cannot conceal either
  person's individual zone.
- There is no above-green tier; extra effort simply remains Green.

## Effort zone model

`weeklyGoal` remains the stored setting for backward compatibility, but now
represents the full-bar scale rather than a pass/fail target.

Whole-point thresholds are rounded upward:

- `buildingMin = ceil(fullScale * 0.4)`
- `greenMin = ceil(fullScale * 0.8)`
- Getting started: `points < buildingMin`
- Building: `buildingMin <= points < greenMin`
- Green: `points >= greenMin`

At the default 14-point scale, Getting started is 0–5, Building is 6–11,
and Green begins at 12. Scores above the full scale remain Green. The labels,
not color alone, communicate status. A paused person's current zone remains
visible but the row is muted and marked away.

## Core mechanic: rolling seven active days

A person's current points equal the sum of eligible effort completed during
their last seven **active** days.

Eligible credit:

- `by === who`: full `difficulty` points.
- `by === "joint"`: full `difficulty` points for each person.
- `by === "service"` or `by === "reset"`: zero points.
- Future-dated events relative to the supplied `at` time: zero points.

An event remains in the current tally while its effective age is less than seven
days. Effective age is wall-clock elapsed time minus the union of pauses that
apply to that person:

- Household pauses apply to both people.
- A solo pause applies only to that person.
- Overlapping household and solo pauses are counted once.

This preserves the existing vacation promise: while a person is paused, their
points do not age out. After resuming, the seven-day countdown continues where
it left off. Chores completed during an active pause begin aging after the pause
ends, matching the current decay behavior.

Use non-overlapping effective-age periods:

- Current period: `0 <= effectiveAge < 7d`
- Previous period: `7d <= effectiveAge < 14d`
- Period `n`: `n*7d <= effectiveAge < (n+1)*7d`

These half-open boundaries ensure an event can never count in two periods.

User-facing explanation:

> What you've each done over your last 7 active days. Keep it in the green.

Footnotes:

> Chores you do together count full for both of you.

> Vacation mode freezes your tally while you're away.

The existing `halfLifeDays` value may remain in previously stored JSON for
backward compatibility, but it is no longer read, displayed, or written by the
app. No database migration is required.

## Log screen layout

Top-to-bottom layout:

```text
  Last 7 days
  What you've each done over your last 7 active days

  Together                         21 / 28  🤝
  ▰▰▰▰▰▰▰▰▰▰▱▱▱▱
  Previous 7 days: both stayed green 🌱 · 🔥 3-period streak

  Julian  Building                 9 / 14
  ▰▰▰▰▰▰▰▰▰▱▱▱▱▱

  Kristine  🏖 away  Building       6 / 14
  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱

  ┌────────────────────────────────────────┐
  │  You're 3 points from green 🎯         │
  │  Try: Bathroom clean (3)                │
  │                              = 3 points │
  │                    🎲 Shuffle ideas     │
  └────────────────────────────────────────┘

  Recent activity
  Dishes        Julian · 2h ago          +1
  Laundry       Together · yesterday     +2 each
  🧹 Bathroom   Cleaning service · 2d    reset
```

All progress bars retain a numeric `points / fullScale` label. Individual bars
show fixed zone regions plus a text status badge. Color is supportive, not the
only way progress or pause state is communicated.

## Components and behavior

### 1. Together total

Display:

`Together  {pointsA + pointsB} / {2 * weeklyGoal}  🤝`

The total is deliberately the sum of the two individual tallies. A three-point
joint chore therefore adds six to the Together total—three to each person. The
full-for-both footnote makes this rule explicit. This bar remains a neutral
mint progress bar and does not display zones.

Use one horizontal progress bar capped visually at 100%; keep the uncapped
numeric total visible when the household exceeds its goal.

### 2. Previous-period recap and streak

The previous period is effective-age period `1` for each person. Because solo
vacations can freeze one timeline, "Previous 7 days" means each person's
previous seven active days, not a shared calendar date range.

Recap states:

- Both were green: `Previous 7 days: both stayed green 🌱`
- Only A was green: `Previous 7 days: {nameA} was green`
- Only B was green: `Previous 7 days: {nameB} was green`
- Neither was green but activity exists:
  `Previous 7 days: {combinedPoints} points together`
- No eligible activity exists: hide the recap.

The streak is the number of consecutive completed effective-age periods,
starting at period `1`, in which both people reached `greenMin`. Stop at the
first missed period. Do not inspect periods older than the earliest eligible
completion. Show only streaks of at least two:

`🔥 {n}-period streak`

"Period" is intentionally used instead of "week" because pauses can extend a
person's seven active days beyond seven calendar days.

### 3. Per-person progress

Replace the two tall columns with compact horizontal progress rows:

- Person's name.
- `🏖 away` badge when their solo pause or the household pause is active.
- Integer `points / fullScale`.
- Horizontal bar, visually capped at 100%.
- A text badge for Getting started, Building, or Green.
- A small celebration when Green is entered.

A paused person is never styled as behind or under-goal. Their points remain
visible and frozen.

### 4. Gap-closer card

The card is for this phone's selected person (`me`).

Visibility:

- Hide when `me` is unknown.
- Hide while the household or `me` is actively paused.
- Calculate `gap` to `greenMin`, not to the full scale.
- Show a success state when `gap === 0`:
  `Your tally is in the green! 🌱`
- Otherwise show the current gap and a chore suggestion.

Suggestion candidates:

- Use each chore at most once in a suggestion.
- Prefer chores whose urgency is at or above `0.75`.
- If that leaves no useful combination, fall back to all chores.
- Never include service/reset log entries; suggestions are based on the current
  chore list only.
- Limit the displayed combination to one through three chores.

Rank combinations in this order:

1. Exact match to the gap.
2. Smallest overshoot.
3. If no combination can reach the gap, largest useful underfill.
4. Within equal totals, prefer greater combined urgency.
5. Within equal urgency, prefer fewer chores.

The first render selects one of the best-ranked alternatives and keeps it stable
across ordinary rerenders. `🎲 Shuffle ideas` advances a local seed to select a
different top alternative when one exists. It does not write shared state.

Render:

`Bathroom clean (3) + Laundry (2) = 5 points`

If the best available combination underfills the gap, use encouraging copy such
as `This gets you 4 points closer` instead of implying it completes the goal.

Suggestions remain informational; they are not tappable completion actions.

### 5. Recent activity

Keep the existing list behavior and 30-item limit.

Display rules:

- Personal completion: `+{difficulty}`
- Joint completion: `+{difficulty} each`
- Service/reset event: `reset`
- Backdated events retain their existing relative-time display.

## First-run explanation

Add a one-time modal gated by the device-local key:

`chorebubbles:seenIntro:v1`

Sequence it only after:

1. Authentication is ready.
2. Household data has loaded.
3. The user has selected whose phone this is.
4. No identity-selection modal is open.

This prevents modal stacking. Existing installations will see the explanation
once after this release, which is desirable because the point model has changed.

Use three short, dynamic sentences:

1. Bubbles grow as chores become due.
2. Tap a bubble when a chore is done.
3. What you do stays in your tally for seven active days; keep your effort in
   the green.

Dismissal stores the versioned flag. Do not hardcode 14 in the modal.

## Implementation structure

### `src/logModel.js` (new)

Extract pure, testable helpers:

- `pausedDuration(pauses, scopes, from, to)` — merged pause duration.
- `effectiveAge(pauses, who, eventTime, at)` — elapsed active time.
- `pointsInActivePeriod(completions, who, pauses, at, periodIndex)` — integer
  total for one non-overlapping seven-active-day period.
- `weeklyPoints(completions, who, pauses, at)` — period `0`.
- `bothStreak(completions, goal, pauses, at)` — completed-period streak.
- `suggestCombo(chores, gap, urgencyById, seed)` — stable ranked suggestion.
- `effortZoneThresholds(goal)` — whole-point zone boundaries.
- `effortZone(points, goal)` — accessible zone label and display metadata.

Move or replace the existing `pausedMs()` implementation so urgency and the Log
model share one interval-merging definition rather than duplicating pause logic.

### `src/App.jsx`

- Replace all `decayedPoints()` calls with `weeklyPoints()`.
- Remove `decayedPoints()` and the vertical `Column` component.
- Add a reusable horizontal `ProgressRow`.
- Compute current totals, prior-period recap, and streak using `now()` so the
  time-machine view remains consistent.
- Compute urgency inputs for the gap-closer from the active `view` data.
- Memoize the suggestion using the chore data, gap, urgency values, and shuffle
  seed so it does not change on unrelated rerenders.
- Rewrite the Log tab to match the final layout.
- Change joint activity copy from fractional half-credit to full integer credit.
- Remove the half-life stepper.
- Add and sequence the versioned intro modal.
- Preserve `simData` behavior: simulated completions and pauses affect the
  redesigned Log locally and disappear when returning to today.

### `src/logModel.test.js` (new)

Add focused unit tests for the pure rules. Use Vitest and add a `test` script to
`package.json`.

### `README.md`

Update all references to:

- Decaying effort and half-life.
- Vertical effort columns.
- Half-credit joint chores.
- Read-only time-machine behavior if any stale wording remains.

Describe rolling seven-active-day points, full-for-both joint credit, and
pause-frozen tallies.

## Verification plan

### Automated tests

Cover at minimum:

1. A personal completion awards full integer credit.
2. A joint completion awards full credit to A and full credit to B.
3. Service and reset events award no points.
4. Future-dated completions are excluded.
5. An event just inside seven active days counts.
6. An event exactly on the seven-day boundary moves to period `1`.
7. No event appears in two periods.
8. Household pauses freeze both people's effective ages.
9. Solo pauses freeze only the selected person.
10. Overlapping solo and household pauses are not double-counted.
11. A completion recorded during a pause begins aging after resume.
12. Streak counting starts at the previous period and stops on the first miss.
13. Suggestion ranking prefers exact totals, then minimal overshoot.
14. Suggestion fallback handles a gap larger than any three-chore combination.
15. Suggestions contain at most three unique chores and favor higher urgency.
16. A seed change can select an alternate top suggestion without changing the
    underlying data.

### Manual UI checks

Check at narrow and typical phone widths, including safe areas:

- Empty household and empty activity states.
- One person in each zone, at the full scale, and over the full scale.
- Both people green and an over-100% Together total.
- Active household pause and each solo pause.
- Gap exact match, overshoot, underfill, success, and hidden states.
- Intro ordering on signed-out, newly signed-in, and already configured devices.
- Joint, service, reset, and backdated activity rows.
- Time-machine sandbox calculations and return-to-today cleanup.
- Reduced-motion preference.
- Progress bars expose readable labels and do not rely on color alone.

Final commands:

```bash
npm test
npm run build
```

## Acceptance criteria

- No half-life or decay language remains in the product UI or README.
- Current points are whole numbers based on seven active days.
- Joint chores count full for each person everywhere.
- Vacation pauses demonstrably freeze the correct tally.
- Period boundaries never double-count completions.
- The Log screen makes each person's zone legible without requiring mental
  arithmetic, and no success behavior still targets the full-bar value.
- Gap suggestions are stable, relevant to chore urgency, and non-judgmental.
- Existing bubble, health, cleaning-service, reset, backdating, authentication,
  sync, and time-machine behaviors continue to work.
- Unit tests and the production build pass.

## Out of scope

- Fairness or balance warnings.
- One-tap completion from gap suggestions.
- Configurable per-person goals.
- Calendar-week reporting.
- Database schema changes.
