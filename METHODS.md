# ChoreBubbles — Methods

A living methodology document for ChoreBubbles. Each section records a design or
engineering decision: the objective, the analysis and data that informed it, the
outcome, and the rationale — so the *why* behind the app survives beyond the
conversation that produced it.

---

## 1. Effort accounting: from a decaying score to a rolling 7-day tally

**Objective.** Make the Log screen legible to a non-technical household member
(the target user explicitly "isn't science-brained") while still driving a
weekly effort goal.

**Diagnosis of the old model.** Each person's effort was an exponentially
decaying sum of completed chores (a configurable "half-life," default 7 days).
Two properties made it hard to read: (a) the number surfaced as drifting
decimals like `8.3`, and (b) — the decisive flaw — **the score fell on days the
user did nothing**, because old chores kept fading. That "why did my number drop?"
confusion is impossible to explain without the science framing we were trying to
avoid.

**Decision.** Replace decay with a **rolling 7-day tally**: a person's points are
the sum of the effort values of their completions in the trailing 7 days, in
whole numbers. Implemented as `weeklyPoints`/`pointsInActivePeriod` in
`src/logModel.js`. The window is **pause-aware** ("7 active days"): time spent in
a household or solo vacation pause is subtracted from a completion's age
(`effectiveAge` + `pausedDuration`), so being away does not silently age out your
points.

**Joint-credit change.** Joint chores now award **full effort to both people**
(previously half each). Rationale: it eliminates fractional displays (`+1.5 each`
became `+3 each`), rewards doing chores together, and keeps every number whole.
Consequence, accepted deliberately: the household "Together" total is defined as
`A + B` with goal `2 × weeklyGoal` (28 for a 14 goal), so a joint chore counts
once for each person — internally consistent because the combined goal is also
doubled.

**Implementation note.** The `halfLifeDays` setting and its stepper were removed.
Pure scoring logic was extracted into `src/logModel.js` with vitest coverage.

---

## 2. Rolling window vs. calendar week — the analysis that shaped the model

**Objective.** Decide whether "this week" should be a rolling trailing window or a
fixed calendar week that resets (e.g., every Monday).

**Analysis.**
- *Rolling window:* no reset cliff, fair to irregular schedules — **but** the
  number still drops on idle days as individual chores age out (the same class of
  confusion as decay, just in discrete chunks), and the finish line always moves,
  making "am I on track?" harder to answer.
- *Calendar week:* the number is **monotonic within the week** (only fills, never
  drains) and "this week / last week" is plain English — but it has a hard Monday
  reset cliff (a big Sunday cleanup resets to zero) and both people look "behind"
  early in the week.

**Provisional conclusion, then reversal.** The calendar week initially looked
easier (monotonic fill is the most intuitive property). That conclusion was
**reversed once zones entered the picture** (see §3): zones hide the small
day-to-day dips that made the rolling window confusing, so "keep it in the green"
becomes a stable maintenance metaphor that fits the rolling window naturally. The
app therefore stayed on the rolling window.

**Rationale captured for future work.** If the reset-cliff/early-week-behind
downsides ever matter more than the maintenance framing, a calendar-week variant
is a contained change (compute points since the week boundary; streak/recap
become real calendar weeks).

---

## 3. Effort zones (green = upper fifth) and a configurable threshold

**Objective.** Reframe the goal from a hard "hit 14" line — which is binary and
punishing — into a "healthy range" the user keeps their bar inside.

**Design.** Three zones on each personal bar (`effortZone`/`effortZoneThresholds`
in `src/logModel.js`):
- **Getting started** (red) below 40% of the scale,
- **Building** (amber) 40%–80%,
- **Green** at ≥ 80% of the scale (the "upper quintile" the user asked for; 12 of
  14 by default).

**Key design choices and rationale.**
- **Over-scale stays green** (no "you did too much" penalty). Making excess a
  different/worse color would disincentivize doing extra chores — the opposite of
  the goal.
- **Zones cure the rolling window's flaw.** Watching a color band instead of a
  precise number means a small dip that stays inside green is invisible and
  irrelevant. This insight is why zones + rolling window is the coherent pairing
  (see §2).
- **Configurable green start.** A "Green zone starts at" setting lets the couple
  move the threshold; the bar's colored bands and divider lines are derived from
  the actual thresholds (`buildingPct`/`greenPct`) rather than hard-coded, and
  lowering the effort scale clamps the green start so it can't exceed the scale.
- Everything keyed to "the goal" (gap-closer target, streak, previous-period
  recap) was repointed at the green threshold, so the whole screen speaks one
  language: *keep it in the green.*

**Related helper.** The gap-closer (`suggestCombo`) proposes a real combination of
the household's chores that closes the gap to green, biased toward due-soon chores
(urgency ≥ 0.75) and deterministic via a seed so a "shuffle" button yields stable,
testable alternatives.

---

## 4. Correcting logged work: per-entry delete with undo (not confirm)

**Objective.** Let the couple fix mistakes — remove a chore marked done in error,
or one they forgot and logged late — beyond the brief post-log undo toast.

**Design.** Each row in Recent activity has an ✕ that removes that single
completion via the existing `completion:remove` operation. One action does three
things: drops the log entry, takes its effort points back off the tally/zone, and
regrows that chore's bubble (its `lastDone` reverts).

**Rationale.** Deletion is **undoable via a toast rather than gated by a confirm
dialog**, matching the app's existing pattern (logging a chore already uses an
undo toast). Instant action + easy reversal beats a modal for a low-stakes,
frequently-used correction.

---

## 5. Input affordances: full-scale tappable pickers

**Objective.** Make setting a chore's Importance and Effort feel like judging a
value on a scale, not nudging a dial.

**Design.** Replaced the `- value +` steppers for Importance and Effort with a
`ScaleSelector`: all 1–5 options rendered as tappable segments so the **entire
range is visible at once**, plus a plain-language descriptor ("How hard is this
chore?"), the selected word (Very easy → Very hard / Low → Critical), and
low/high end labels. Goal frequency kept its stepper (1–60 is too wide to show as
a full scale).

**Rationale.** Seeing the whole scale supports *relative* judgment ("is this a 3
or a 4?") that a hidden-state dial obscures, and the descriptor removes any doubt
about what the number means.

---

## 6. Single-view strategizing: tab-merge analysis → compact strip

**Objective.** The user asked whether to merge the Bubbles and Log tabs into one
view.

**Analysis.** The real benefit sought was a **feedback loop** — pop a bubble, see
your effort respond — which today requires a tab switch. But a literal full merge
was rejected because: the bubble field is a physics playground that needs room
(its roominess is the app's charm); a draggable, non-scrolling canvas conflicts
with a scrolling info feed for the same finger gesture; and the two have different
usage cadences (bubbles are the daily driver, the activity log is occasional).

**Decision.** Keep three tabs but add a **compact two-person zoned effort strip**
to the Bubbles tab (`CompactBar`), so popping a bubble updates your tally in
place. The full breakdown (gap-closer, recent activity, streak, teamwork total)
stays on the Log tab. Additionally, each **bubble now shows its effort value**, so
the field itself can be read to plan which chores to knock out toward green — the
strategizing the user wanted, without leaving the main screen.

**Rationale.** This captures ~80% of the merge's benefit (the feedback loop) at
none of its costs (lost space, gesture conflict).

---

## 7. Bubble aesthetics: soft gloss and a wider palette

**Objective.** Make bubbles read as bubbles and give the field more color variety.

**Method and iteration.** Bubbles were rebuilt from a single radial gradient into
layered gradients (a top-left highlight, a bottom color glow, a rounder color
body) with inset highlights and a small reflection dot. Gloss was then **dialed
down twice on live feedback** ("a little less reflection" → "less gloss"),
lowering the specular highlight, inset shine, and reflection-dot opacity/size to
land on a soft/matte-round look rather than wet glass. The palette was expanded
from **8 to 16 curated hues** so colors repeat far less often across the field.

**Rationale.** The visual change is purely presentational (no effect on sizing,
which is driven separately by importance and urgency), and the matte endpoint was
chosen by the user through direct visual comparison.

---

## 8. Working method: local-preview iteration and verified deploys

**Objective.** Iterate on visuals with the user before committing, and never ship
unverified.

**Practices used this session.**
- **Local dev preview before commit** for visual work: run the Vite dev server,
  share `http://localhost:5173/`, edit with hot-reload so the user sees each tweak
  instantly, and only commit once they approve. (Sign-in works locally because
  `localhost:5173` is in Supabase's redirect allow-list and the OTP code path is
  URL-independent.)
- **Test + build gate on every commit:** `npm test` (vitest over `logModel.js` and
  `bubblePhysics.js`) and `npm run build` must pass before pushing.
- **Deploy verification:** after pushing to `main`, watch the GitHub Pages Action
  to green, then confirm the change is actually in the live bundle by grepping the
  deployed asset for a known new string — assertions backed by evidence, not
  assumptions.
- **Pure logic in tested modules:** scoring (`logModel.js`) and drag physics
  (`bubblePhysics.js`) live as pure functions with deterministic behavior (seeded
  combo suggestions) so they can be unit-tested independently of the React tree.
