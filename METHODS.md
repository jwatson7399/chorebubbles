# ChoreBubbles — Methods

A living methodology document for ChoreBubbles. Each section records the *why* and *how* behind a significant design or engineering decision: the objective, the data/reasoning that informed it, the outcome, and the rationale — so the intent survives independently of the code and the conversations that produced it.

---

## 1. Effort model: replacing decaying "half-life" points with a rolling 7-day tally

**Objective.** Make the Log screen legible to a non-technical household member and remove the need to explain scoring with scientific framing.

**Methodology / data.** The original model scored each person with an exponentially decaying sum: every completion contributed `difficulty × 0.5^(ageDays / halfLifeDays)`. Two properties made it hard to read: (a) scores surfaced as drifting decimals (e.g. "8.3"), and (b) the number **fell on days the user did nothing**, because old completions kept decaying. Both are impossible to explain without invoking half-life/decay.

We evaluated two replacements:
- **Rolling 7-day tally** — sum of effort completed in the trailing 7 days. Whole numbers; matches a weekly goal; a chore drops off cleanly after 7 days.
- **Reword the decay** — keep the math, soften the language. Rejected: the confusing behaviors (decimals, idle-day drops) remained.

**Results.** Adopted the rolling tally. Implementation was extracted into `src/logModel.js` (`weeklyPoints`, `pointsInActivePeriod`, `effectiveAge`, `pausedDuration`, `bothStreak`) with vitest coverage. The `halfLifeDays` setting and `decayedPoints` were removed.

**Design rationale / notes.**
- The window is **pause-aware** ("7 active days"): time spent under a household or solo pause is subtracted from a completion's age, so vacations don't silently age-out a person's tally. Overlapping pauses are merged so they count once.
- **Joint chores award full effort to *both* people** (previously half each). This removes fractional displays ("+1.5 each" → "+3 each") and rewards doing chores together. The household "Together" total is defined as `pointsA + pointsB` against a goal of `2 × weeklyGoal`, so it stays internally consistent even though a joint chore counts on both bars.

---

## 2. Calendar week vs. rolling window — and why zones settled it

**Objective.** Decide whether "this week" should mean a fixed calendar week (resets, e.g., Monday) or the rolling trailing window from Section 1.

**Methodology / data.** The key differentiator is *which direction the number moves*:
- **Calendar week** is monotonic within the week (only fills, resets at the boundary) — very intuitive, but has a "Monday cliff" (a big Sunday effort resets to zero) and makes both people look "behind" early in the week.
- **Rolling window** never has a reset cliff but *still* drops on idle days as chores age out — the same confusion we removed in Section 1, in discrete chunks.

**Results.** Stayed with the **rolling window**, contingent on adding zones (Section 3).

**Design rationale / notes.** Zones changed the calculus. "Keep it in the green" is a *maintenance* metaphor, which matches a rolling window's steady-state behavior. Critically, zones **absorb the rolling window's one flaw**: a small dip that stays inside green is invisible and irrelevant, so the "why did my number drop?" anxiety disappears when the user is watching a color band instead of an exact number. Calendar-week + zones was rejected because the empty-week start would render both bars visibly **red every Monday**, amplifying the early-week discouragement.

---

## 3. Effort zones (green-zone model) with a configurable threshold

**Objective.** Reframe the goal from a hard number ("hit 14") to a healthy range ("stay in the green"), which is softer, more visual, and less binary/punishing.

**Methodology / data.** Each person's bar is banded into three zones by fraction of the full scale:
- **Getting started** (red): below 40%
- **Building** (amber): 40%–80%
- **Green**: ≥ 80% (the "upper fifth" — for a scale of 14, green begins at 12)

Boundaries are inclusive whole points; over-scale effort stays green. Logic lives in `effortZone` / `effortZoneThresholds` (`src/logModel.js`) with tests.

**Results.** Personal bars are zoned (colored fill, band background, divider ticks, a zone-label pill, and a "greenArrival" animation). The household "Together" bar is intentionally **not** zoned. The gap-closer, streak, and previous-period recap all key off the green threshold rather than the full scale.

**Design rationale / notes.**
- **Over-goal stays green (never a worse color).** Making "too much" a different color would disincentivize doing extra — the opposite of the goal.
- **The green threshold is user-configurable** ("Green zone starts at" in settings). `effortZoneThresholds(goal, greenStart)` defaults to 80% of scale but honors an explicit value, clamped to the scale; the bar's visual bands and dividers derive from the actual thresholds so they always match. Lowering the effort scale re-clamps the green start so it can't strand above the scale.
- Consequence surfaced to the user: because green = top fifth, the configured scale (14) is a *bar ceiling*, and the real target ("green") sits below it (12). Settings copy was reworded to "Effort scale (full bar)" to make this explicit.

---

## 4. Tab strategy: a compact effort strip instead of merging Bubbles + Log

**Objective.** Evaluate merging the Bubbles and Log tabs so effort and activity live in one view.

**Methodology / data.** The real benefit a merge chases is **closing the feedback loop**: popping a bubble should visibly move your effort bar without a tab switch. (The household health bar already pulses on every tab; what was missing on the Bubbles screen was the *per-person* signal.) Against that, a full merge has three costs: the bubble field is a physics playground that needs room; drag-and-throw gestures conflict with a scrolling info feed; and the bubbles (daily driver) shouldn't be buried under occasional reference content (recent activity, gap-closer).

**Results.** Chose the lighter option: a **compact two-person zoned strip** pinned to the top of the Bubbles tab (`CompactBar`), with the full breakdown remaining on the Log tab. This captures ~80% of the merge benefit — the pop→bar-moves feedback — without shrinking the bubble field or fighting gestures.

**Design rationale / notes.** The strip reuses the same `effortZone` logic and configurable green threshold as the Log bars, so color/threshold stay consistent across screens. A true single-tab merge (fixed bubbles above a scrolling log) was offered but declined in favor of the strip.

---

## 5. Bubble-field readability: on-bubble effort values and a wider color range

**Objective.** Let the user strategize point accumulation directly on the main (Bubbles) screen.

**Methodology / data & results.**
- **On-bubble effort value.** Each bubble now shows its effort as a small dimmed "N pts" line under the chore name, scaled with the bubble radius, so the whole field can be scanned to plan which chores close the gap to green.
- **Wider color range.** The fixed 8-color palette (which repeated past 8 chores) was replaced with `bubbleHue(i)`, generating pastel colors via the **golden angle** (`hsl((i × 137.508°) mod 360, 62%, 68%)`), converted to 6-digit hex. Golden-angle spacing maximizes distinctness between adjacent bubbles and never repeats within a realistic chore count.

**Design rationale / notes.** Hex output was a hard requirement: the bubble styling appends hex alpha suffixes (`` `${hue}AA` ``) for gradients/glows, so an `hsl()` string would have broken rendering — hence `hslToHex`. Saturation/lightness were kept soft (62/68) to preserve the app's calm pastel aesthetic across the full spectrum. Color is currently keyed by list index (colors shift if a chore is deleted); keying by chore identity for stable colors was noted as an available future refinement.

---

## Engineering practice notes

- **Pure logic is extracted and unit-tested.** Scoring (`logModel.js`) and drag physics (`bubblePhysics.js`) live in standalone modules with vitest coverage (`npm test`); the React component consumes them. This keeps the testable rules independent of the UI.
- **Local iteration before commit.** UI-sensitive changes are previewed on the Vite dev server (`npm run dev`, http://localhost:5173) and iterated with hot reload before committing — verified against `npm test` and `npm run build`, then pushed to `main` (which auto-deploys via GitHub Pages).
