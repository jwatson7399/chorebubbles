# Chore temperature — heat and frost signatures on bubbles

**Date:** 2026-07-29
**Status:** Implemented; streak model revised after browser verification

## Problem

The bubble field shows a chore's *current urgency* well: bubbles swell as they become due,
gain a coloured border and glow once past due, and breathe faster when badly overdue. It
does not show whether the household is sustaining or losing the chore's rhythm.

Add a visual layer that reads a chore's track record, and pay a bonus for rehabilitating the
ones that have gone cold.

## Decisions

### Temperature is a bounded streak

Temperature is one derived number per chore, capped from `-2` to `+2`. It is rebuilt from
the creation date, completions, household pauses, and the current time; no streak field is
stored.

- An on-time completion adds one step.
- Each frequency window that passes without completion removes one step.
- The downward side decrements rather than snapping to zero, so one miss cools a long good
  run from `+2` to `+1` instead of erasing it.
- Completing a cold or frozen chore late adds no heat, but resets the negative streak to
  neutral. The rescue therefore causes an immediate visual change.
- After rescue, one on-time completion becomes warm and two become scorching.

This model replaced the initially approved five-cycle ratio after browser verification
exposed a feedback failure. In the ratio model, the currently overdue interval was already
counted as a miss; completing it merely changed an open miss into a closed miss, leaving the
same frozen sigil immediately after the app said "thawed." The bounded streak preserves the
live cooling behavior while making the rescue itself meaningful.

### Visual treatment is a bare emoji sigil

Considered three directions against real mockups on the app's background:

- **Rim and atmosphere** (desaturate, crystalline rim, slower breathing) — most elegant, but
  it writes into the bubble's outer halo, which is *already spoken for*: `App.jsx:365` glows
  every past-due bubble in its own hue and a shuffle suggestion adds a yellow ring plus a
  second glow. An overdue frozen suggested chore would carry three arguing glows.
- **Surface treatment** (frost facets, ember pooling in the fill) — avoids the halo conflict
  by using the fill, which currently carries nothing but the chore's identity colour.
- **Bare sigil** — the bubble is untouched; a small emoji states the streak. **Chosen.**

The trade-off accepted: a bare emoji *states* the temperature rather than making the bubble
*look* cold. This is a marker, not a mood. The surface treatment remains available as a later
addition if the emoji alone reads thin in practice.

### The reward is a flat integer bonus, not a multiplier

Two hard constraints ruled out multipliers:

1. **Points are deliberately whole numbers.** METHODS.md §1 records that the original
   half-life scoring was removed precisely because it produced drifting decimals nobody could
   explain. A ×1.5 multiplier reintroduces exactly that.
2. **The default weekly goal is 14** (`dataModel.js:9`) and difficulty maxes at 5, so a naive
   ×3 pays 15 points — one tap clearing an entire week's goal.

A capped flat bonus satisfies the actual goal (rehabilitating a neglected *important* chore
pays meaningfully more than topping up an already-hot one) while staying inside the integer
rule and staying bounded enough not to distort the weekly bars.

## Design

### `src/choreTemperature.js` (new)

A pure module in the style of the existing `choreHistory.js` / `logModel.js` / `effortGoal.js`,
with `src/choreTemperature.test.js` beside it.

**Walking the timeline.** Walk a chore's completion timestamps in ascending order, anchored
at `chore.createdAt`. For every span:

1. Count the frequency deadlines that passed unmet and decrement once per deadline.
2. If the completion was inside its first allowed window, increment once.
3. If it was late, add no heat; if the running score is negative, clear it to zero.

The pause-adjusted duration uses `pausedDuration(pauses, ["house"], from, to)` from
`logModel.js`, the same adjustment `activeDaysSinceDone` makes, so a household vacation
never chills the board.

**The open interval.** After the last completion, every further elapsed frequency window
decrements the streak in real time. A chore therefore cools while it is being neglected
rather than waiting for a completion event.

**Anchor guard.** If `chore.createdAt` is missing or non-positive, start the walk at the first
completion instead, so the first interval is simply not scored. Without this, `createdAt || 0`
would produce an epoch-length first interval and brand the chore frozen instantly.

**Tiers.**

| streak | tier | sigil |
| --- | --- | --- |
| `+2` | scorching | 🔥🥵 |
| `+1` | warm | 🔥 |
| `0` | neutral | *(none)* |
| `-1` | cold | ❄️ |
| `-2` | frozen | ❄️🥶 |

**Exports:** `STREAK_MAX`, `STREAK_MIN`, `TEMPERATURE_TIERS`, `choreStreak`,
`choreTemperature`, `streakLabel`, `thawBonus`.

### Scoring edge cases, decided

- **Service and board-reset completions count as done.** They earn no effort credit, but the
  chore genuinely got done, and this matches what `lastDone` and `urgencyOf` already believe.
- **Two-step chores are scored per `choreId`**, not per step. The rhythm belongs to the chore
  as a whole.
- **Intervals score against the chore's *current* `freqDays`.** Tightening a chore's frequency
  retroactively re-judges its history. This is the simple behaviour and the honest one; the
  alternative is snapshotting frequency onto every completion record.
- **A never-completed chore can cool.** Its first open span begins at `createdAt`; repeated
  missed due dates eventually freeze it.
- **The time-machine sandbox works for free**, since the open span is computed from `now()`,
  which already carries `TIME_OFFSET`.

### The sigil on the bubble

Bare emoji, top-right, sized `max(9, min(r * 0.28, 15))`, with
`drop-shadow(0 1px 1.5px rgba(0,0,0,0.5))` so it holds against the pastel fill, and
`pointerEvents: "none"`.

Top-right specifically because bottom-right is occupied by the compact points badge
(`App.jsx:472`). Rendered only when the bubble already shows its inline label (`r >= 14`);
below that the bubble is ~28px across and an emoji pair turns to mush.

The existing `aria-label` (`App.jsx:371`) gains the tier, so the state is never visual-only.

Nothing else about the bubble changes — no fill, halo, border, or animation change. That is
what keeps this clear of the due-glow and the suggestion ring.

### The thaw bonus

```
thawBonus(chore, tier):
  cold   → importance >= 4 ? 2 : 1
  frozen → importance >= 4 ? 3 : 2
  else   → 0
```

Whole numbers, capped at +3.

**Advertised before the tap, not revealed after.** The tap sheet already reads "worth N pts"
(`App.jsx:2247`, `App.jsx:2290`); it gains the tier and the pending bonus. A reward discovered
only afterwards is a pleasant surprise once and motivates nothing thereafter — the point is
that a frozen bubble should look *worth attacking*.

**Stored, not recomputed.** `logCompletion` computes the bonus at completion time and writes
it onto the completion record as `bonus`. History is then immutable: points already earned do
not shift because the chore warmed up afterwards. `normalizeData` spreads unknown fields
through (METHODS.md §10), so older bundles preserve `bonus` rather than dropping it.

**Consumers.** `completionCredit` in `logModel.js` adds `bonus` to `difficulty`;
`completionImpact` in `choreHistory.js` and the log rows at `App.jsx:1834` and `App.jsx:2141`
display the total. Joint completions pay the bonus to **both** people, consistent with
METHODS.md §1. Service and reset completions never earn one. Undo removes the whole record, so
the bonus reverses for free.

### Farming trade-off

An established scorching chore needs four successive missed cycles to become frozen, which
normally costs more opportunity than the rescue bonus returns. A just-rescued neutral chore,
however, needs only two missed cycles to freeze again. If that chore has importance 4–5 but
difficulty 1, deliberately repeating that loop can produce one extra point compared with
doing it on schedule. The importance-based bonus was kept because it is an explicit product
choice; the streak rewrite no longer claims farming is structurally impossible.

### Known imprecision

`effortGoal.js` derives its goal presets from raw chore demand and knows nothing about bonus
points, so a household that thaws frequently runs marginally easy against its goal. Bounded at
+3 and rare by construction, the drift is small — but it is real, and is recorded in
METHODS.md rather than papered over.

## Files

**New**
- `src/choreTemperature.js`
- `src/choreTemperature.test.js`

**Modified**
- `src/logModel.js` — `completionCredit` includes `bonus`
- `src/choreHistory.js` — `completionImpact` includes `bonus`
- `src/App.jsx` — sigil render, `aria-label`, tap sheet, `logCompletion`, log rows
- `METHODS.md` — new section covering the model, the rejected alternatives, and the goal drift

## Verification

`npm test` (vitest) covering:

- on-time completions climbing to the `+2` cap
- missed deadlines decrementing gradually to the `-2` cap
- a cold or frozen late completion resetting immediately to neutral
- the next two on-time completions producing 🔥 and then 🔥🥵
- pause-adjusted spans and the missing-`createdAt` anchor guard
- every streak-to-tier mapping and the bounded status-sheet labels
- bonus banding across tier × importance
- `completionCredit` and `completionImpact` picking up stored bonuses

Then the app driven in a browser against the time-machine sandbox, which shifts `now()` and
therefore moves temperatures without waiting real days.
