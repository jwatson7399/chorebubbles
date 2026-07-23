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

## 6. Zone language and at-a-glance status on the main screen

**Objective.** Two related goals: (a) make the effort-zone *names* read as plain, encouraging human language rather than a neutral scale, and (b) let a person read their zone status on the Bubbles (main) screen without opening the Log tab.

**Methodology / data.** The zone labels started as engineering-flavored words (`Getting started` / `Building` / `Green`) — descriptive but flat, and "Green" awkwardly named a zone after its own color. We iterated the labels live with the user, converging in stages:
- Green: `Green` → `Ideal 👌` → **`On top of it! 👌`** (the user preferred an active, congratulatory phrase over a static adjective).
- Amber: `Building` → **`Maintaining 👍`** (reframes the middle band as a stable, fine place to be, not an unfinished state).
- Red: `Getting started` → **`Getting started ⚠️`** (kept the gentle name, added a caution glyph so the "needs attention" band is legible at a glance).

Each emoji was chosen to encode the *same* three-step severity the color already conveys (⚠️ attention → 👍 fine → 👌 great), so color and glyph reinforce rather than compete.

**Results.**
- `effortZone` in `src/logModel.js` now returns both a full `label` (text + emoji, shown in the Log-tab zone pills and in ARIA labels) **and** a standalone `emoji` field, so surfaces that want only the icon don't have to parse it out of the label string.
- The Bubbles-tab compact bars (`CompactBar`) were upgraded from a plain track with a single green divider to the **same three-band zoned background** the Log bars use (`linear-gradient` red→amber→green at the real `buildingPct`/`greenPct` thresholds, with two divider ticks), and now render the **current zone's emoji only**, small and centered directly above each person's bar. This mirrors the full Log bar in miniature so the main screen alone answers "how am I doing?".

**Design rationale / notes.**
- Adding an `emoji` field (rather than slicing the label) keeps the two presentations — "full label with words" vs. "icon only" — independent and prevents brittle string surgery if wording changes again.
- The centered emoji is `aria-hidden`: the numeric `points/goal` beside it already carries the state to screen readers, so the bare glyph would be redundant noise.
- Placing the emoji *above the center of the bar* (its own centered line between the name/points row and the track) ties the icon visually to the bar it describes without disturbing the existing left-name / right-score header layout.
- Because zone naming now lives in one place, the same rename rippled to the README feature list and the "Sync model" section, which had described the zones by their old names — both were updated so docs and UI speak the same language.

---

## 7. Reviewing and integrating parallel (Codex) contributions

**Objective.** Two features were authored on a parallel Codex track and needed to be reviewed and folded into `main` without regressing the app: **per-chore activity history** and a **main-screen suggestion shuffle with bubble highlighting**.

**Methodology / data.** Rather than trust the diff blind, each contribution was read in full (`git diff`), reasoned about for coherence with existing patterns, and gated on `npm test` + `npm run build` against the combined working tree before committing.
- *Per-chore history* extracted its logic into a new pure module `src/choreHistory.js` (`choreHistoryFor`, `completionActor`, `lastDoneLabel`, `completionImpact`) with its own vitest suite (`choreHistory.test.js`, 3 tests) — congruent with the project's "pure logic in tested modules" rule (see notes below). It adds last-done banners to each chore row (✓ done / ↻ reset / ○ never) and a scrollable full-history section in the edit modal; the modal gained `maxHeight: 92dvh` + scroll to accommodate it, and rows became keyboard-activatable.
- *Suggestion shuffle* threads a `suggestedIds` set into `BubbleField`, which draws a golden glow/outline (with a `box-shadow`/`outline-color` transition and raised z-index) on suggested bubbles. A new `bubbleSuggestionsVisible` state + `shuffleSuggestions()` handler reveals them; a "🎲 Shuffle chore suggestions" button was added to the Bubbles tab, and the Log tab's existing "Shuffle ideas" button was repointed at the same handler so both entry points share one code path. The inline bubble `boxShadow` was refactored into a `bubbleShadow` variable to avoid duplicating the due/overdue logic when composing the suggested-state shadow.

**Results.** Both features passed the test + build gate (22 tests total after the history suite was added) and were committed and deployed; the live site was verified at HTTP 200 after each GitHub Pages run went green.

**Design rationale / notes.** The review confirmed both diffs followed established conventions — pure logic isolated and tested, presentational refactors that don't change non-target behavior, and accessibility affordances (ARIA labels, keyboard handlers) consistent with the rest of the app — which is why they were accepted rather than reworked. This section documents the *review* methodology as much as the features: parallel work is integrated by reading it, checking it against the codebase's own rules, and proving it green before it lands.

---

## Engineering practice notes

- **Pure logic is extracted and unit-tested.** Scoring (`logModel.js`) and drag physics (`bubblePhysics.js`) live in standalone modules with vitest coverage (`npm test`); the React component consumes them. This keeps the testable rules independent of the UI.
- **Local iteration before commit.** UI-sensitive changes are previewed on the Vite dev server (`npm run dev`, http://localhost:5173) and iterated with hot reload before committing — verified against `npm test` and `npm run build`, then pushed to `main` (which auto-deploys via GitHub Pages).
