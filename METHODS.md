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

**Correction (2026-07-28).** "The `halfLifeDays` setting was removed" is true of the code but not of the data. `normalizeData` spreads `...source` before its known-key overrides — deliberately, so an older bundle preserves fields it does not understand (see §10) — which means `halfLifeDays: 7` still sits in the live household blob and will persist indefinitely. Nothing reads it, so it is inert rather than harmful, but the reading-key set and the stored-key set are not the same thing and this document previously conflated them. Removing it needs a deliberate one-off migration, not a normalizer change.

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

**Superseded in part by §12.** The zone *mechanics* above are unchanged, but two claims no longer describe how the numbers are chosen. The scale and green threshold are no longer hand-picked — §12 derives a suggestion from the chore list, because hand-picked values silently went stale when the chore list grew and left green at 18% of the household's actual needs. And "green = top fifth" is now only the fallback when no explicit `greenStart` is stored: the derived suggestion deliberately places green at roughly **62%** of the scale, not 80%, so that reaching green does not nearly peg the bar. That headroom is what keeps a full bar from reading as "we're finished."

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

## 8. Two-step alternating chores and the bubble-size/label trade-off

**Objective.** Support chores that are really a *pair* of alternating actions — load ↔ unload the dishwasher, put out ↔ bring in the bins — where completing one step should surface the other, without cluttering the field with two separate bubbles. A second, coupled objective emerged during review: keep bubble labels legible after this feature raised the pressure on small bubbles.

**Methodology / data.** The feature (authored on the parallel Codex track, then reviewed and integrated per the §7 method — read the diff, check it against the codebase's rules, prove it green) models a two-step chore as normal chore fields plus a `twoStep: { enabled, active, steps: [stepA, stepB] }` structure. All state transitions live in a new pure module `src/twoStepChore.js` with vitest coverage (`twoStepChore.test.js`, 4 tests):
- `enableTwoStepChore` / `disableTwoStepChore` convert between a plain chore and a step-pair (disable collapses to the currently active step, so no data is lost).
- `updateTwoStep` edits one step while leaving the other untouched, and **defers name normalization** so an in-progress edit like `"Load "` (trailing space) or `""` is preserved in the field and only cleaned at save/materialize time — otherwise typing would fight the user.
- `materializeTwoStepChore` clamps/normalizes stored values (importance 1–5, effort 1–5, freq 1–60, non-empty name → `"Step N"`) and projects the active step's fields onto the top-level chore so the rest of the app can treat it like any single chore.
- `advanceTwoStepChore` flips `active` 0↔1 — this is what makes completing a step swap the visible bubble.

**Sync-model integration.** Rather than bolt the swap onto the client, two new operations were added to `applyOperation` so the step advance rides the same conflict-safe op-replay pipeline (§ engineering notes / README "Sync model"):
- `completion:add-and-advance` — logs the completion *and* advances the chore's active step in one atomic op.
- `completion:remove-and-restore` — the undo path; removes the completion and restores the exact prior chore object (so undoing a step-completion also rewinds the swap).
The completion records which step it credited via `twoStepIndex`, and the success toast previews the next step ("… · *Unload dishwasher* is up next").

**Editing UI.** The chore-edit form's fields (name, importance, effort, frequency) were extracted into a reusable `ChoreFields` component so the same inputs serve a normal chore and each of the two steps. A "Two-step chore" checkbox toggles between one `ChoreFields` and two (labeled "Step 1 / Step 2 · visible now"); save validation requires *both* step names when two-step is on.

**Results.** All 28 tests pass; the feature was committed and deployed (live verified HTTP 200).

**Design rationale / the bubble-size trade-off.** Two-step editing and denser labels exposed a legibility problem on small bubbles, so bubble presentation was also pulled into a pure module `src/bubblePresentation.js` (`clampBubbleRadius`, `usesCompactBubbleLabel`; 2 tests):
- Below a 40px-radius threshold, bubbles switch to a **compact label** (line-clamped name + a small circular corner badge showing the effort number) instead of the full name + "N pts" line — so even tiny bubbles stay readable.
- The **minimum radius** became the contended knob. Codex first raised it from 17 to 30 (34px→60px across) for label legibility, but that partially undid an earlier explicit user preference ("make minor chores appear as *smaller* bubbles"). This was surfaced to the user rather than silently kept, and the floor was negotiated down to **23** (46px across) — a compromise that restores much of the small-bubble size signal while the compact-label mode keeps text legible at that size. The min-radius constant is the single source of truth (the test that asserted `MIN_BUBBLE_RADIUS * 2` was updated alongside it), so this value can be re-tuned in one place.

**Congruency note.** Both new modules follow the established "pure logic in tested modules" rule, and the sizing constant plus label-mode threshold being centralized in `bubblePresentation.js` means the size/legibility balance is a deliberate, adjustable design parameter rather than a scatter of magic numbers in the render path.

---

## 9. Priority-ranked bubbles, decoupled visual/tap sizing, and cross-phone health feedback

**Objective.** Three parallel-track (Codex) changes reviewed and shipped in one working session, each sharpening how the bubble field communicates state. All three followed the §7 method (read the full diff, check it against the codebase's rules, prove it green with `npm test` + `npm run build`, then push to `main` for the auto-deploy, and verify HTTP 200 live).

**9a. Rank overdue bubbles by relative priority.** The original sizing multiplied importance by an *absolute* urgency ratio capped at 2.2× — once every chore was well overdue, they all pinned to the ceiling and became indistinguishable. The fix (in `bubblePresentation.js`) introduces `bubblePriority({ importance, urgency, ageDays })`, a score that blends importance (linear), overdue urgency (`log1p` so it keeps rising but with diminishing slope), and neglect-by-age (a smaller `log1p` term). `rankBubbleTargets` then computes each bubble's **prominence** as its priority's *position within the current set's min–max range* — so the most-overdue bubbles stay visually distinct even after all have passed the old ceiling, and genuinely equal chores get equal size (prominence 0.5). Prominence also drives layout: a `d3.forceRadial` pulls high-priority bubbles toward center (an orbit whose radius shrinks with prominence) and raises their `z-index`. This kept the pure-module + test discipline (3 new tests asserting distinct sizes for deeply-overdue-but-different chores, and equal size for equal chores).

**9b. Remove the minimum *visual* size; keep a minimum *tap target*.** A follow-up let low-priority bubbles shrink to genuinely small so the priority signal reads at a glance — but a sub-30px circle is an unusable touch target. The resolution decouples the two concerns: `clampBubbleRadius` lost its 23px floor (now clamps only `[0, 100]`), and a new `bubbleHitDiameter` enforces a **44px minimum** (the standard accessible touch size). In the render path the outer element is the invisible hit target at `bubbleHitDiameter`, and a nested element is the actual visual bubble at `n.r*2`; labels hide entirely below r<14 (the effort number persists as a small badge). This is why the "min radius" negotiation of §8 could be dropped — the accessibility concern that motivated a size floor is now met by the hit target, freeing the visual size to be purely a priority signal.

**9c. Pulse home health for every observed completion.** The health bar previously flashed only when the *rounded* health percentage rose, so a completion that nudged the score sub-percent gave no feedback, and completions arriving via sync from the other phone were missed entirely. Logic was extracted to a pure `healthPulse.js`: `creditedCompletionIds` collects the IDs of human-credited completions (`a`/`b`/`joint` — service and board-reset records are excluded), and `shouldPulseHealth` fires if the score rose **or** any new credited completion ID has appeared since the last render. The pulse state became a monotonic sequence counter used as a React `key` on the fill element, so rapid back-to-back completions **remount** it and restart the CSS animation instead of leaving it stranded mid-swell. Six tests cover the seed case (no pulse on first observation), each credited actor, exclusion of service/reset, and the score-rose fallback.

**Design rationale.** The common thread is *make the visual encoding honest*: sizes that stop lying once everything is overdue (9a), a size range no longer floored by an accessibility constraint that belongs elsewhere (9b), and feedback that reflects the real event (a completion) rather than a lossy proxy (a rounded percentage) (9c). Each landed as a pure, tested module consistent with the project's standing convention.

---

## 10. Chore details and give-kudos

**Objective.** Two additions authored on the parallel Codex track from written specs
(`BUBBLE_DETAILS_SPEC.md`, `CHOREBUBBLES_KUDOS_SPEC.md`) and integrated per the §7 method
— read the full diff, check it against the codebase's own rules, prove it green.

### 10a. A `details` field: the shared definition of done

The tap sheet named a chore and said nothing about what doing it meant. In a two-person
household that is a real gap: "dishes" can reasonably mean the dishes, or the dishes and
the sink, and two people can hold different definitions indefinitely without ever
discovering the disagreement.

`details` is an optional free-text field on each chore, normalized by `normalizeDetails`
(trimmed, truncated at 500, non-string coerced to `""` so an object can never render as
`[object Object]`). It renders **above the primary action and is always visible when
set** — deliberately not behind a toggle, because it answers "what am I committing to",
which you need *before* tapping Mark done, not after.

**The trap, and why the fix sits where it does.** `ChoreFields` renders once per step for
two-step chores, so each step can carry its own details — genuinely desirable, since
loading and unloading the dishwasher have different definitions of done. But
`stepFromChore` deliberately **omits** an empty `details` key to keep stored objects
clean, while `materializeTwoStepChore` projects a step with `{...chore, ...step}`. The
omitted key therefore could not clear a previous value: switching to a step with no
details left the *other* step's text showing on it. Found in review, reproduced, and
fixed in the **projection** rather than the step shape, so stored steps stay clean and
the leak is closed. Three regression tests pin it.

### 10b. Kudos

When one person logs completions the other has not seen, **their bar glows and becomes
tappable**; the summary lists what they did and offers kudos with an optional message.
The receiving side is symmetric: your own bar glows when kudos are waiting, with a
different badge (👏 purple) from new activity (✨ gold), because the same treatment for
two meanings would be ambiguous.

Kudos ride the existing op-replay pipeline as `kudos:add`, idempotent on `id` exactly
like `completion:add` — non-idempotent ops duplicate on retry, and every operation is
replayed against the newest server state. The array is capped at 200 in `normalizeData`,
since the shared document is a single JSON blob read and written whole.

Three decisions worth preserving:

- **Seen-markers are per device and never advance on app open.** They live in
  `localStorage`, not the shared document — "what I have seen" is not shared state, and
  syncing it would let one phone mark the other's notifications read. Advancing on open
  would clear the glow before it could be noticed, making the whole feature silently
  inert; it advances only when the summary is opened, to the newest timestamp **in the
  batch shown**, so completions arriving mid-view are not skipped.
- **Seeing is enough.** Reading the summary and closing without sending clears the glow.
  The glow means "new activity", not "you owe praise" — kudos must stay a gesture rather
  than an obligation the app nags you into.
- **Joint completions are excluded, because they cannot be attributed.** A joint
  completion stores `by: "joint"` with no record of who tapped it. "What Kristine did"
  therefore cannot include joint chores — the information does not exist. Adding a
  `loggedBy` field would fix it but changes the completion shape in a live synced app,
  and deserves its own decision rather than riding along with this one.

**Rollout.** `normalizeData` spreads `...source` before its known-key overrides, so a
phone on the older bundle preserves a `kudos` array it does not understand rather than
stripping it — verified before relying on it, because the failure mode would have been
silent data loss between two people. The feature is otherwise inert until both phones
update, since neither writes kudos until it can.

**Results.** 51 tests pass and the build is clean. The model layer was verified
empirically — joint/service/reset exclusion, idempotent replay, the 200 cap, marker
timing — but the kudos **interface** could not be exercised locally, because the shared
app is behind Supabase sign-in. That gap was stated at review time rather than papered
over.

---

## 11. Data export

**Why.** The app had no way to get its own data out. With `SUPABASE_URL` configured,
`storage.js` skips the local cache entirely (`if (!supa)` at lines 59 and 75), so the
household's chores, completions, pauses and kudos exist in exactly one place: the
`value` jsonb column of a single Supabase row. There was no backup path, and no way to
inspect or reason about the real chore list without opening the Supabase dashboard.

That gap surfaced during a calibration discussion: the effort-bar constants
(`weeklyGoal` 14, green at 12) can only be judged against what the chore list actually
demands, and the seeded `STARTERS` list is not what this household uses.

**What it does.** A "Copy all data (backup)" button in Chores → Household settings
serializes the shared blob to pretty-printed JSON and copies it to the clipboard.

- **It exports `data`, not `view`.** The time machine renders from a simulated copy;
  an export that followed the visible state would silently produce fictional data.
- **Clipboard failure is handled, not swallowed.** An installed iOS PWA can refuse
  `navigator.clipboard.writeText`. A rejection opens a modal with a selectable
  textarea rather than appearing to do nothing.
- **No envelope.** The exported shape is exactly the stored `value`, so it stays
  directly comparable to the database row and usable for a future restore.

**Verification.** The interface gap noted in §10 — that the shared app is behind
Supabase sign-in and so cannot be exercised locally — was solved rather than restated.
Temporarily blanking `SUPABASE_URL`/`SUPABASE_ANON_KEY` puts the app in local-only
mode, which reaches every screen without credentials; `src/config.js` is then restored
and `git diff` confirms it. Under that setup the real UI was driven in a browser: the
button produced 2106 characters of valid JSON with all six top-level keys and 10
chores, the toast read "Copied 10 chores and the full history", and a forced
`writeText` rejection opened the fallback modal with identical content. 51 tests pass
and the build is clean.

---

## 12. Deriving the effort goal from the chore list

**The bug.** The effort scale and green threshold were hand-entered numbers, set against
the ten-chore starter list and never revisited after the household replaced it with
twenty-five real chores. Measured against the real list, the household needed **76.2
effort pts/week**; one person's fair share was **38.1**; green sat at **7** — **18% of a
fair share**. Reset Couch alone (effort 1, daily) yields exactly **7.0 pts/week**, so one
trivial chore held the bar green indefinitely while covering 18% of the household's
needs. Both people showed green (9/10 and 13/10) with two thirds of the list untouched.

This is worth stating plainly because a long design brief had proposed replacing the
rolling tally with a leaky-reservoir decay model to stop the bar plateauing. The plateau
was not caused by decay. No decay curve repairs a threshold set five times too low, and
checking that one number first made the larger rewrite unnecessary.

**The model** (`effortGoal.js`) derives a suggestion from the chore list:

```
fairShare      = 7 * sum(effort / freqDays) / 2
paddingCeiling = sum(effort * 7 / freqDays) for importance <= 2 AND effort <= 2
green = round(max(0.47 * fairShare, 1.15 * paddingCeiling))
scale = round(max(0.75 * fairShare, green / 0.8))
```

- **Two-step chores use the summed cycle**, `(e0+e1)/(f0+f1)`. Only one step is visible
  at a time and completing it advances to the other, so the active step's own numbers
  understate demand.
- **The padding floor is the point.** Requiring green to clear the padding ceiling by 15%
  turns "green cannot be reached by trivial work alone" into a structural guarantee that
  survives future chore additions, rather than a property that happens to hold today.
- **Green lands at ~62% of the scale, not the built-in 80%**, leaving 38% of the bar as
  headroom. Reaching green no longer nearly pegs the bar — the plateau the brief worried
  about, solved by geometry instead of by a decay rewrite.

**Suggest, never auto-apply.** The honest fair share (38) is more than double observed
throughput (~17/person/week). Silently setting an unreachable goal would replace one
wrong number with another, so the app proposes and the household decides. The two
existing steppers stay, demoted under a quieter "Fine-tune" caption.

**Why the suggestion is lower than the fair share, and home-style presets.** The card
first states the fair share (38 each) and then suggests a green of 19, which reads as a
contradiction unless the reasoning is given. Chore frequencies describe an *ideal*: a
household that hits every frequency every time is cleaning constantly. Green is therefore
a deliberate fraction of the share, and the card says so and quotes the percentage.

Because households genuinely differ in how much upkeep they want, three presets are
priced against the same chore list:

| Preset | Green | Bar | Share covered |
|---|---:|---:|---:|
| Balanced — a healthy home without cleaning nonstop | 19 | 29 | ~50% |
| Tidy — most things current, most of the time | 24 | 36 | ~63% |
| Spotless — everything current, always | 30 | 40 | ~79% |

Two details are load-bearing. The quoted percentage is the coverage **delivered**, which
can exceed the constant asked for when the padding floor lifts green — quoting the
request instead would be a lie. And the floor applies to every preset, so no home style
can drop green low enough for trivial work alone to reach it.

**Trivial means effort 1, not effort 2 (corrected 2026-07-29).** The ceiling originally
counted anything at effort ≤ 2, which swept in a load of couch blankets and scrubbing the
microwave — real jobs, not the walk-past tidying the ceiling is meant to describe. That
inflated it to 16.4, above half a fair share, so the *floor* rather than the coverage
constant was setting where green sat: Balanced asked for 47% and delivered 52%, and
raising the constant to 50% would have changed nothing because the floor still won.

Narrowing to effort 1 drops the ceiling to 13.4 (35% of a fair share), the floor to 15.4,
and lets coverage drive again — Balanced now means exactly half a fair share and delivers
it. The guarantee is unchanged in kind: green 19 still clears the 13.4 a household could
earn on one-point chores alone.

**The floor is not capped, deliberately.** Adding daily one-point chores drives the
ceiling up and the goal with it — one extra takes coverage to 55%, four takes it to 92%.
Capping the floor as a fraction of the fair share was measured and rejected: the guarantee
is `green > ceiling`, so once trivia can earn 41 pts/week, any cap that holds the goal near
50% necessarily lets padding reach green again. Between a stable number and a goal that
cannot be gamed, the household chose the guarantee.

**A single daily one-point chore dominates the ceiling.** Reset Couch alone is 7.0 of the
13.4, because daily frequency gives it seven chances a week. The ceiling is therefore very
sensitive to adding quick daily chores, and a second one would raise it by another ~7 and
push green up with it. Worth watching: the floor is a guarantee, not a target, and it
should not end up dictating the goal.

Applying a preset dismisses the nudge against the *default* suggestion rather than the
chosen preset, so picking Spotless does not leave the nudge showing forever.

**A fourth "Custom" option.** Presets sit alongside a Custom entry — first in the row on
The Log, first card on the Chores tab — which is where the fine-tune steppers now live.
The steppers used to sit permanently below the presets under a "Fine-tune" caption, which
made hand-tuned numbers look like a footnote rather than a choice.

Custom **remembers its numbers** in `settings.customGoal`, so the household can move
between presets and their own figures without losing them. Shared rather than per-device,
because the goal itself is shared — one phone remembering different custom numbers than
the other would be worse than not remembering at all. It is stored separately from
`weeklyGoal`/`greenStart`, which are the live values whatever their source; overloading
them would make "what did we last tune it to" unanswerable while a preset is selected.

Which pill reads as active stays **derived**: it means the numbers match no preset. A
stored mode would need a migration for households that set a goal before presets existed,
and could disagree with the actual settings — still reading "Balanced" after a stepper
moved. Nudging a stepper therefore flips the badge to Custom on both screens with no
bookkeeping. Tapping Custom on The Log opens the Chores tab with the steppers revealed,
since that is the only surface where tuning happens.

The padding floor governs the presets, not Custom: a household tuning by hand may set
green wherever it likes, but a warning appears below the steppers once green drops to or
below the padding ceiling. Blocking it would be paternalistic; saying nothing would hide
the exact failure this feature exists to prevent.

**A shortcut on The Log.** Living only at the bottom of the Chores tab made the presets
feel buried, so `GoalPresetBar` replaces the static "Full scale / Green starts at" caption
under the personal bars with the same three pills, collapsed by default and expandable to
show each preset's numbers and the fair-share rationale.

That puts **two pill rows within a few inches of each other** on one screen, doing
different jobs: goal presets change a shared household setting, suggestion intensity
changes only what this phone is offered tonight. They are separated by colour using
meaning the app already carries — goal pills green (`#5FE0BB`, the green-zone colour),
intensity pills amber (`#FFC65E`, the gap-closer panel's colour) — and sit in distinct
cards. Tapping the wrong one would silently change something shared, so the distinction
had to be visible rather than merely documented.

When the stored numbers match no preset (because the steppers were nudged), no pill shows
active and the caption reports the real values, rather than rounding the household into
the nearest preset and implying a setting they did not choose.

Both values commit in a single `settings:patch`: the green stepper is capped by the
current scale, so applying them separately would clamp green to the old scale.

**Discovery is the actual failure mode.** A suggestion sitting in Settings would not have
helped — the numbers went stale precisely because nobody had reason to look. A drift
nudge appears on the Bubbles screen when the live threshold falls outside 0.6–1.5x the
suggestion. Per-chore prompting was rejected: fifteen chores were added in one sitting
and each shifts the number only slightly; it is the accumulated drift that matters.

**No new shared state.** Dismissal is local per device and stores the suggested green at
dismissal rather than a flag, so dismissing sticks for that situation while a materially
different one still gets through. The suggestion is a pure function of chores both phones
already have, so it is identical across devices by construction — no migration, no sync
ordering. It derives from canonical `data.chores` rather than the time-machine `view`, so
simulated time cannot suggest a goal for a household that does not exist.

**Results.** 71 tests pass and the build is clean, including a regression test asserting
`green > paddingCeiling` and the exact 19/29 suggestion for the live chore list. Verified
end-to-end in a browser against the household's real exported data: the nudge fired, the
suggestion read 19/29, Apply queued one combined patch and persisted, and the bars moved
from 9/10 and 13/10 (both green) to 9/30 and 13/30 (red and amber) — the same effort,
honestly scored.

---

## 13. Suggestion intensity: anchor-plus-fillers instead of three big jobs

**The complaint.** Ten points from green, the app suggested vacuuming, mopping *and*
doing the litter — a lot for an average Tuesday evening. The wanted shape was one
bigger job plus a few quick tidying jobs.

**The cause was arithmetic, not ranking.** `combinationsOfUpToThree` capped every
suggestion at three chores. Measured against the real chore list at a gap of 10:

| | |
|---|---:|
| Combinations of ≤3 chores reaching the gap | 389 |
| ...that are all-light (every chore ≤ 2 effort) | **0** |
| Maximum reachable with three light chores | **6** |
| Mean effort per chore across valid combinations | 3.62 / 5 |

Three slots for ten points demands an average effort of 3.3, so the suggester had to
reach for the heaviest work available. It was picking the least-bad option from a set
containing nothing reasonable. The ranking made it marginally worse by preferring
*fewer* chores as a tiebreak. Worth recording because the instinct was to tune the
scoring, and no amount of reweighting can surface an option that does not exist.

**The model.** `suggestPlan` replaces `suggestCombo`. An *anchor* is a chore of effort
≥ 3, a *filler* is effort ≤ 2. Each intensity caps both totals:

| Intensity | Max items | Max anchors |
|---|---:|---:|
| Light | 5 | 0 |
| Mixed (default) | 6 | 1 |
| Heavy | 3 | 3 |

Anchors are taken first, then fillers use the remaining slots, both ordered by urgency
and then descending effort. Heavy therefore degrades gracefully — a household with only
one big chore gets that chore plus two quick ones rather than an empty plan.

**Shuffle rotates rather than randomises.** The candidate order stays urgency-biased and
is identical for a given seed, so the idea is deterministic across both phones.

**Light is allowed to fall short.** Reaching the gap used to be a hard preference in the
ranking, which is precisely what forced heavy work. A Light plan now reports
*"Gets you to 8 of 10 — 2 short, but it all counts"* rather than padding itself into a
ten-item checklist. Partial progress is the honest answer when someone has said they are
only up for quick tidying.

**The control lives on both screens.** A shared `IntensityPicker` renders on Bubbles
(compact, above Shuffle) and on The Log (above the plan), driven by the same state, so a
pick on one screen is already applied on the other. Bubbles previously offered Shuffle
without the control that makes rerolling useful, and the bubble highlights read from the
same plan object — so the intensity was changing what Bubbles highlighted while only The
Log could set it. On Bubbles the picker is hidden when there is no gap, since an
intensity with nothing to suggest is dead chrome.

**Intensity is deliberately not persisted.** "What am I up for right now" is a
moment-to-moment judgement, not a preference, so it lives in React state, resets when the
app reopens, and is never synced to the other phone.

**Results.** 80 tests pass and the build is clean. The three `suggestCombo` tests were
rewritten rather than kept: they pinned the exact-gap preference and the fewest-items
tiebreak, which are the behaviours being removed. Verified in a browser against the real
chore list at a gap of 10 — Light gave five quick chores for 8 of 10, Mixed gave
`Fridge clean-out (4)` plus four quick jobs for 11, Heavy gave three big jobs for 13, and
Shuffle varied the plan within a fixed intensity.

---

## 14. Chore temperature: showing a chore's track record, and paying to rescue cold ones

**Objective.** The bubble field read a chore's *current* state well — bubbles swell with
urgency, gain a hue-coloured border and glow past due, and breathe faster when badly overdue
— but showed its *rhythm* not at all. The temperature sigil adds a compact streak signal:
on-time runs heat a chore up, repeated missed deadlines cool it down, and doing a neglected
chore visibly rescues it back to neutral.

**Methodology / data.** The first implementation used an on-time ratio over the last five
cycles. Browser verification exposed a broken feedback loop: the currently overdue interval
already counted as a miss, and completing it merely converted that open miss into a closed
miss. A frozen bubble therefore stayed pixel-identically frozen after its "thawed!" toast.
The model was replaced with a bounded streak that makes rescue an actual state transition.

The streak starts at zero and is derived from the chore's creation date and completion
timestamps; nothing new is persisted.

- An on-time completion adds one step, capped at `+2`.
- Each due date that passes without completion removes one step, capped at `-2`. This is the
  deliberately gentle downward variant: hot becomes warm, then neutral, then ❄️, then 🧊
  across four successive missed cycles instead of losing a long good run all at once.
- Completing late adds no heat. If the chore is below zero, however, doing it clears the debt
  to zero: ❄️ or 🧊 becomes neutral immediately.
- From neutral, the next on-time completion turns 🔥 on. Further on-time completions keep it
  on while the underlying streak stays capped at `+2`.

Misses are measured in each chore's own frequency windows, so the model remains comparable
across daily, weekly, and fortnightly chores. The still-open interval is evaluated against
`now()`, which makes neglect cool a bubble without requiring a completion event.

*What does it look like?* Three directions were mocked up against the real bubble gradient on
the real background. **Rim and atmosphere** (desaturate, crystalline rim, slower breathing) was
the most elegant but wrote into the outer halo, which is already spoken for — a past-due bubble
glows in its own hue and a shuffle suggestion adds a yellow ring plus a second glow, so an
overdue frozen suggested chore would carry three arguing glows. **Surface treatment** (frost
facets, ember pooling in the fill) avoided that conflict. A **bare emoji sigil** was chosen:
the bubble is untouched, and a 14px 🔥 / ❄️ / 🧊 sits top-right, clear of the points badge
that compact bubbles carry bottom-right. Heat is deliberately binary — 🔥 is either on or
off — while cold keeps distinct chilled and frozen symbols.

**Results.** `src/choreTemperature.js` keeps the calculation pure and independently tested.
The first ratio-based version was verified end-to-end against a seeded household; the
streak rewrite adds direct regression coverage for the rescue transition, gradual cooling,
the ±2 caps, pause-adjusted time, every sigil, and the detail-sheet wording.

**Design rationale / notes.**
- **The five states map to three quiet visual marks:** `+2` and `+1` both use 🔥, `0` has no
  sigil, `-1` uses ❄️, and `-2` uses 🧊. The status sheet names the bounded state rather than
  pretending it is a literal count: gradual cooling means `+1` can follow a miss, and the
  `-2` floor can represent more than two missed cycles.
- **The reward is a flat capped bonus, not a multiplier.** Two constraints ruled multipliers
  out. Points are deliberately whole numbers (§1), and a ×1.5 reintroduces exactly the drifting
  decimals that model was built to remove. And with a default goal of 14 and difficulty capped
  at 5, a naive ×3 pays 15 — one tap clearing an entire week. Cold pays +1 (+2 at importance
  ≥ 4); frozen pays +2 (+3 at importance ≥ 4).
- **The bonus is advertised before the tap, not revealed after.** A reward you only discover
  afterwards is a pleasant surprise once and motivates nothing thereafter; the point is that a
  frozen bubble should look *worth attacking*.
- **It is banked on the completion record, not recomputed.** Points already earned must not
  shift because the chore warmed up later. `normalizeData` spreads unknown fields through
  (§10), so older bundles preserve `bonus` rather than dropping it. The key is omitted entirely
  when zero, leaving ordinary records byte-identical to before.
- **Service and board-reset completions count as done.** They earn no effort credit, but the
  chore genuinely got done, matching what `lastDone` and `urgencyOf` already believe.
- **Intervals are scored against the chore's *current* `freqDays`**, so tightening a frequency
  retroactively re-judges history. The alternative is snapshotting frequency onto every
  completion record, which is not worth the storage or the complexity.
- **Known imprecision:** `effortGoal.js` derives its presets from raw chore demand and knows
  nothing about bonus points, so a household that thaws frequently runs marginally easy against
  its goal. Bounded at +3 and rare by construction, the drift is small — but it is real, and
  the goal number is not exact.
- **The shorter recovery window weakens the original anti-farming property.** An established
  hot chore needs four missed cycles to freeze, but a just-rescued neutral chore needs only
  two. In the edge case of an importance-4/5 chore with difficulty 1, deliberately repeating
  that pattern can earn one more point than doing it on schedule. The bonus was left unchanged
  because its importance banding is an explicit product choice; this is a known trade-off,
  not a claim that the new streak makes farming impossible.

---

## Engineering practice notes

- **Pure logic is extracted and unit-tested.** Scoring (`logModel.js`) and drag physics (`bubblePhysics.js`) live in standalone modules with vitest coverage (`npm test`); the React component consumes them. This keeps the testable rules independent of the UI.
- **Local iteration before commit.** UI-sensitive changes are previewed on the Vite dev server (`npm run dev`, http://localhost:5173) and iterated with hot reload before committing — verified against `npm test` and `npm run build`, then pushed to `main` (which auto-deploys via GitHub Pages).
- **Auth-gated screens are reachable locally.** Blanking `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `src/config.js` drops the app into local-only mode, so screens behind household sign-in can be driven end-to-end on the dev server. Restore `src/config.js` afterwards and confirm with `git diff` — the file holds live credentials and must never be committed blank.
