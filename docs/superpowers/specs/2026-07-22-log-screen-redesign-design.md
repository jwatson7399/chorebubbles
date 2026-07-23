# Log Screen Redesign — Design

Date: 2026-07-22
Status: Approved (pending spec review)

## Goal

Make the Log screen easy to digest for a non-technical household member, replace
the confusing decay/"half-life" mechanic with something explainable in one
sentence, and add a helper that shows how to reach the weekly effort goal.

## Core mechanic change: rolling 7-day tally (replaces decay)

Today each person's effort score is an exponentially decaying sum ("half-life"),
which produces drifting decimals and drops even on idle days — impossible to
explain without science framing.

**New model:** a person's weekly points = the sum of their chore effort values
completed in the **last 7 days** (a rolling window ending "now"). Whole numbers,
no decay. A chore counts for 7 days, then cleanly drops off.

- Plain-language subtitle replaces the half-life line:
  *"What you've each done in the last 7 days. Aim for 14 points a week."*
- Footnote: *"Chores you do together count full for both of you."*
- **Joint chores now count full effort for each person** (was half each). This
  removes fractional displays like "+1.5 each", rewards doing chores together,
  and keeps every number whole. Activity log shows "+3 each" style.
- `decayedPoints()` and the `halfLifeDays` setting/ stepper are removed. The
  `weeklyGoal` setting stays.

## Layout (top to bottom, Log tab)

```
  This week
  What you've each done in the last 7 days

  Together        21 / 28  🤝            <- teamwork total (A+B / 2*goal)
  Last week: both hit goal 🎉 · 🔥 3-week streak   <- recap line (see below)

  Julian                     9 / 14
  ▰▰▰▰▰▰▰▰▰▱▱▱▱▱

  Kristine  🏖 away
  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱

  ┌────────────────────────────────────┐
  │  You're 5 points from your goal 🎯  │   <- gap-closer, for THIS phone's person
  │  Try: Bathroom clean (3) + Dishes   │
  │       (1) + Trash (1)         = 5   │
  │            🎲 shuffle ideas          │
  └────────────────────────────────────┘

  Recent activity
  Dishes        Julian · 2h ago       +1
  Laundry       Together · yesterday  +1 each
  🧹 Bathroom   Cleaning service · 2d  reset
```

### Components

1. **Teamwork total** — `Together  {ptsA + ptsB} / {2 * weeklyGoal} 🤝`, with a
   combined progress bar. Frames the screen as us-vs-the-mess. Household total is
   defined as the sum of the two individual bars (internally consistent).

2. **Last-week recap + streak** (computed from history, no stored state):
   - Last week = points in the window `[now-14d, now-7d)` per person.
   - Recap line summarizes: both hit goal / who hit goal last week.
   - Streak = count of consecutive completed 7-day windows (last week and earlier)
     in which BOTH people met the goal. Shown only when streak ≥ 2 (`🔥 N-week
     streak`). Walk back week-by-week over completions until a week misses.

3. **Per-person bars** — horizontal progress bar + `points / goal` for each
   person (replaces the two tall vertical columns). Paused person (solo or
   household pause active) shows a `🏖 away` badge and is not styled as
   under-goal.

4. **Gap-closer card** — for this phone's person (`me`):
   - `gap = max(0, weeklyGoal - myWeeklyPoints)`.
   - If `gap === 0`: celebratory "You hit your goal this week! 🎉".
   - Else: pick a random combo of the household's chores whose effort values sum
     to `gap` (exact if possible, else smallest overshoot). Render as
     `Chore (d) + Chore (d) … = sum`. A 🎲 button reshuffles to a new combo.
   - If `me` is unknown, hide the card.

5. **Recent activity** — unchanged behavior, kept as-is (already readable).

## What's unaffected

Bubbles, urgency/growth, health bar, vacation pauses (as a mechanic), cleaning
service, reset, backdating, and the time-machine sandbox are all unchanged. This
work is contained to the Log tab, the points-calculation helpers, and the
Household-settings stepper list.

## Implementation outline (all in `src/App.jsx`)

- Add `weeklyPoints(completions, who, at)` — sum of effort in `[at-7d, at]` where
  `by === who` or `by === "joint"` (joint = full effort).
- Add `pointsInWindow(completions, who, from, to)` helper (used by weekly + last
  week + streak).
- Add `bothStreak(completions, goal, at)` — consecutive prior 7-day windows where
  both meet goal.
- Add `suggestCombo(chores, gap)` — randomized combo summing to gap; reshuffled
  via a state seed.
- Replace `decayedPoints` usages: `ptsA/ptsB` now use `weeklyPoints`.
- Rewrite the `tab === "log"` block per the layout above; keep `Column` only if
  reused, otherwise replace with a horizontal `Bar` component.
- Remove the "Decay half-life (days)" `Stepper` from Household settings.
- First-run "how it works" card: a one-time `Modal` gated by a
  `localStorage` flag (`chorebubbles:seenIntro`), three plain sentences
  (bubbles grow → tap to pop → hit 14 points a week). Shown on first load.

## Out of scope (deferred)

- Gentle balance/fairness note (declined — friction risk).
- Making gap-closer suggestions one-tap loggable from the card.
- Configurable per-person goals (single shared `weeklyGoal` stays).
