# Derived effort goal — design

**Date:** 2026-07-28
**Status:** Approved, implemented

## Problem

The effort scale (`weeklyGoal`) and green threshold (`greenStart`) are hand-entered
numbers. The household set them against the ten-chore starter list, then replaced it
with twenty-five real chores. The numbers were never revisited, and nothing in the app
indicated they had stopped meaning anything.

Measured against the real list:

- Household demand: **76.2 effort pts/week**; one person's fair share: **38.1**.
- Green threshold: **7** — **18.4% of a fair share**.
- Reset Couch alone (effort 1, daily) yields **exactly 7.0 pts/week**, so one trivial
  chore held the bar green indefinitely while covering 18% of the household's needs.

Both people sat in green (9/10 and 13/10) while two thirds of the list went untouched.
The failure is the threshold's altitude, not the decay model — no decay curve repairs a
threshold set five times too low.

## Approach

Derive a **suggestion** from the chore list. Do not auto-apply it. The honest derived
share (38) is more than double the household's observed throughput (~17/person/week),
so silently setting an unreachable goal would replace one wrong number with another.
A suggestion invites the judgement call; an auto-set hides it.

## Model — `src/effortGoal.js`

Pure module, no React and no storage, matching `logModel.js` and
`bubblePresentation.js`.

```
choreDemandPerDay(chore)
  two-step : (e0 + e1) / (f0 + f1)     one completion per cycle, alternating
  else     : effort / freqDays

fairShare      = 7 * sum(choreDemandPerDay) / 2
paddingCeiling = sum(effort * 7 / freqDays)  for importance <= 2 AND effort <= 2

green = round( max( 0.47 * fairShare,  1.15 * paddingCeiling ) )
scale = round( max( 0.75 * fairShare,  green / 0.8 ) )
```

Constants: `GREEN_COVERAGE 0.47`, `SCALE_COVERAGE 0.75`, `PADDING_MARGIN 1.15`.

**Two-step chores** show one step at a time and completing it advances to the other, so
the active step's own numbers understate demand. Demand is the summed cycle.

**The padding floor** is the feature's core guarantee. `paddingCeiling` is the most one
person could earn doing nothing but trivial chores at full frequency. Requiring green to
exceed it by 15% makes *"green cannot be reached by trivial work alone"* structural
rather than incidentally true — it keeps holding as the chore list evolves.

**Why green sits at ~62% of the scale, not the app's default 80%:** it leaves 38% of the
bar as headroom above green. Hitting green no longer nearly pegs the bar, which removes
the "full meter, we're done" feeling without any decay-model change.

Service-eligible chores are counted. The cleaning service is irregular and unscheduled,
so excluding them would understate the work done in a typical week.

Empty list returns `null`. Results clamp to the Settings stepper ranges (scale 4–40,
green 2–scale), so a suggestion is always applicable as-is.

On the live list: `fairShare 38.1`, `paddingCeiling 16.4`, `green 19`, `scale 29`.

## Settings UI

The suggestion is the focal point, above the steppers:

> Your 25 chores need about **76 pts a week** to stay current — roughly 38 each.
> **Suggested: green at 19, full bar 29**
> `[ Use these numbers ]`

Both values commit in a **single** `settings:patch`. The green stepper is capped by the
current scale (`App.jsx`), so applying them separately would silently clamp green to the
old scale. When current settings already match, the button is replaced by a static line.

The existing steppers are unchanged functionally but move below a quieter **Fine-tune**
caption. Editable, but not where the eye lands.

## Drift nudge — Bubbles screen

Stale when `currentGreen < 0.6 * suggested` or `> 1.5 * suggested`.

A quiet dismissible line near the compact effort strip: *"Your chore list has changed —
review your effort goal."* Tapping switches to the Chores tab, where Settings lives.

Bubbles rather than The Log: The Log is the semantically correct home, but it loses on
the one thing this feature exists to fix. The threshold went stale because there was no
reason to go looking. The nudge is rare, so the clutter cost is low.

Per-chore prompting was rejected: the household added fifteen chores in one sitting, and
each individually shifts the number only slightly. It is the accumulated drift that
matters.

## State

No new fields in the shared blob. Dismissal is local per device
(`chorebubbles:goalNudge`), following the existing marker pattern in `storage.js`, and
stores the *suggested green at dismissal* rather than a flag — so dismissing sticks for
that situation but a materially different one (>15% move) still gets through.

The suggestion is derived on every render from data both phones already have, so it is
deterministic across devices by construction. No migration, no sync ordering concerns.

Derived from canonical `data.chores`, not the time-machine `view`, so simulated time
cannot produce a suggestion for a household that does not exist.

## Out of scope

Importance weighting of earned credit, any decay-model change, and streak/suggestion
rework. This feature computes and proposes two numbers.

## Acceptance tests — `src/effortGoal.test.js`

- two-step demand uses the summed cycle, not the active step
- asymmetric two-step legs average across the cycle
- zero/absent frequency falls back rather than dividing by zero
- padding ceiling counts only importance <= 2 **and** effort <= 2
- a two-step chore is padding only when neither step matters
- the floor lifts green when coverage alone would sit below the ceiling
- `scale >= green` when the floor sets green
- clamping at both stepper bounds
- empty and null lists return `null`
- drift detection at both edges and with no suggestion
- dismissal suppresses, and a materially moved suggestion returns
- **regression: for the live 25-chore list, `green > paddingCeiling`, and the suggestion
  is exactly 19/29** — the padding exploit encoded as a test
