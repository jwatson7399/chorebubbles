# Chore temperature — heat and frost signatures on bubbles

**Date:** 2026-07-29
**Status:** Approved, ready to implement

## Problem

The bubble field shows a chore's *current* state well: bubbles swell with urgency, gain a
coloured border and glow once past due, and breathe faster when badly overdue. It shows a
chore's *history* not at all. You cannot tell, at a glance, the difference between a reliable
chore having one bad week and a chore the household has quietly given up on — they look
identical the moment their urgency matches.

Add a visual layer that reads a chore's track record, and pay a bonus for rehabilitating the
ones that have gone cold.

## Decisions

### Temperature measures history, not current state

Temperature is computed from completion history alone. It deliberately does **not** blend in
current urgency.

Overdue-right-now is already encoded three ways on the bubble (size, border, glow), so
folding it into temperature would make frost a synonym for "big and glowing" — decoration
rather than information. Keeping the axes separate means a chore that has been reliable for
two months but slipped this week stays warm, which is the honest reading: it is a good chore
having a bad week.

This also gives the bonus a defensible story. It rewards rehabilitating a chronically
neglected chore, not doing something that merely happens to be late today — the latter would
be trivially farmed by letting an easy daily chore slip a single day.

### Memory is five cycles, with a three-cycle floor

Measured in **cycles** rather than days, which is what makes it fair across chores of
different frequencies: five cycles of Dishes is five days, five cycles of Mop floors is ten
weeks, and each is "the recent past" for that chore.

Five was chosen over shorter and longer alternatives:

- **3 cycles** swings too fast. One miss visibly chills a chore and one good week fully
  reheats it, so frost stops meaning "chronically neglected" and Dishes flickers constantly.
- **5 cycles** needs a genuine run of 3–4 misses to look properly frozen and about the same
  to thaw. Frost becomes a statement about a chore's character.
- **8–10 cycles** is so slow that a chore you have *already fixed* stays frosted for weeks,
  which feels unfair and kills the reward loop.

Below **3 scoreable cycles** the chore renders neutral — no sigil at all. A brand-new chore
has no meaningful track record, and silence beats a confident-looking wrong signal. It also
means adding a chore never immediately brands it as failing.

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

**Scoring intervals.** Walk a chore's completion timestamps in ascending order and score each
interval between consecutive completions. The walk is anchored at `chore.createdAt`, the same
anchor `lastDone` uses. An interval is **on time** when its pause-adjusted length is
≤ `freqDays`, using `pausedDuration(pauses, ["house"], from, to)` from `logModel.js` — the
identical call `activeDaysSinceDone` makes, so a household vacation never freezes the board.

**The open interval.** The still-running interval (last completion → now) counts as a **miss**
once it exceeds `freqDays`, and counts as nothing while still inside its window. So a chore
cools in real time as it drifts overdue rather than waiting to be finally done, and a chore
that is merely *young* is never punished for being unfinished.

**Anchor guard.** If `chore.createdAt` is missing or non-positive, start the walk at the first
completion instead, so the first interval is simply not scored. Without this, `createdAt || 0`
would produce an epoch-length first interval and brand the chore frozen instantly.

**Tiers.** Take the most recent 5 scored intervals. Below 3, return neutral. Otherwise the
tier follows the on-time ratio:

| ratio | tier | sigil |
| --- | --- | --- |
| `= 1.0` | scorching | 🔥🥵 |
| `>= 0.8` | warm | 🔥 |
| `> 0.4` | neutral | *(none)* |
| `> 0.2` | cold | ❄️ |
| `<= 0.2` | frozen | ❄️🥶 |

Over a full five-cycle window that reads: 5/5 scorching, 4/5 warm, 3/5 neutral, 2/5 cold,
0–1/5 frozen.

**Exports:** `CYCLE_WINDOW`, `MIN_SCORED_CYCLES`, `TEMPERATURE_TIERS`, `choreCycleResults`,
`choreTemperature`, `thawBonus`.

### Scoring edge cases, decided

- **Service and board-reset completions count as done.** They earn no effort credit, but the
  chore genuinely got done, and this matches what `lastDone` and `urgencyOf` already believe.
- **Two-step chores are scored per `choreId`**, not per step. The rhythm belongs to the chore
  as a whole.
- **Intervals score against the chore's *current* `freqDays`.** Tightening a chore's frequency
  retroactively re-judges its history. This is the simple behaviour and the honest one; the
  alternative is snapshotting frequency onto every completion record.
- **The time-machine sandbox works for free**, since temperature is computed from `now()`,
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

### Why this cannot be farmed

Freezing a chore costs at least three missed cycles at `difficulty` points each; the bonus
pays back at most 3. Neglecting Dishes for three days to earn +2 forfeits 3 points to gain 2.
This is structural rather than a defence bolted on — and it is a direct consequence of the
five-cycle memory. A shorter window would have made it farmable.

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

- interval scoring, including pause-adjusted intervals
- the open interval cooling a chore in real time once overdue
- the open interval *not* counting while still inside its window
- the under-3-cycles neutral floor, and the missing-`createdAt` anchor guard
- every tier boundary
- bonus banding across tier × importance
- `completionCredit` and `completionImpact` picking up stored bonuses

Then the app driven in a browser against the time-machine sandbox, which shifts `now()` and
therefore moves temperatures without waiting real days.
