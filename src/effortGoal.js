import { isTwoStepChore } from "./twoStepChore.js";

// The effort scale and green threshold used to be hand-picked numbers. They were
// calibrated against a ten-chore starter list, then the household tripled the list
// and the numbers silently stopped meaning anything — green sat at 18% of the work
// the chores actually demanded, so a single trivial chore held the bar green forever.
//
// These helpers derive a suggestion from the chore list itself, so the goal can be
// re-grounded whenever the list changes. Nothing here mutates state: the suggestion
// is a pure function of chores, which also makes it identical on both phones.

// Green is a fraction of one person's fair share, not the whole of it. Chore
// frequencies describe an ideal, and a household that hits every one of them every
// time is cleaning constantly; a goal set at the full share would sit permanently
// out of reach and read as failure rather than encouragement.
export const GREEN_COVERAGE = 0.47;
export const SCALE_COVERAGE = 0.75;

// Keeps green near 62-65% of the bar so reaching it never nearly pegs the bar.
const GREEN_SHARE_OF_SCALE = 0.65;

// Households differ in how much upkeep they actually want. Coverage is the share of
// one person's fair share that green represents. The padding floor still applies to
// every preset, so a relaxed setting can never drop green low enough for trivial
// chores alone to reach it.
export const GOAL_PRESETS = [
  {
    id: "balanced",
    label: "Balanced",
    blurb: "A healthy home without cleaning nonstop.",
    coverage: GREEN_COVERAGE,
  },
  {
    id: "tidy",
    label: "Tidy",
    blurb: "Most things current, most of the time.",
    coverage: 0.62,
  },
  {
    id: "spotless",
    label: "Spotless",
    blurb: "Everything current, always. A lot of upkeep.",
    coverage: 0.8,
  },
];

// Green must also clear the "padding ceiling" — every trivial chore in the house at
// full frequency. Without this floor the coverage fractions alone could drift below
// it as trivial chores are added, and the bar would once again be reachable without
// doing anything that matters.
export const PADDING_MARGIN = 1.15;

// Matches the Settings steppers so a suggestion is always applicable as-is.
const SCALE_MIN = 4;
const SCALE_MAX = 40;
const GREEN_FLOOR = 2;

// A chore counts as trivial padding only when it is both unimportant and cheap.
// High-effort/low-importance work (Clean Stove) is not padding — it is real labour.
const TRIVIAL_IMPORTANCE = 2;
const TRIVIAL_EFFORT = 2;

// How far the live threshold may drift from the suggestion before it is called stale.
export const DRIFT_LOW = 0.6;
export const DRIFT_HIGH = 1.5;

// How much the suggestion must move before a dismissed nudge returns.
export const DISMISS_TOLERANCE = 0.15;

const positive = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A two-step chore only ever shows one step, and completing it advances to the other.
// Over a full cycle both steps are done, which takes the sum of the frequencies and
// costs the sum of the efforts — so the active step's own numbers understate demand.
export function choreDemandPerDay(chore) {
  if (!chore) return 0;
  if (isTwoStepChore(chore)) {
    const [first, second] = chore.twoStep.steps;
    const effort = positive(first?.difficulty, 2) + positive(second?.difficulty, 2);
    const days = positive(first?.freqDays, 7) + positive(second?.freqDays, 7);
    return effort / days;
  }
  return positive(chore.difficulty, 2) / positive(chore.freqDays, 7);
}

const stepIsTrivial = (step) =>
  positive(step?.importance, 3) <= TRIVIAL_IMPORTANCE && positive(step?.difficulty, 2) <= TRIVIAL_EFFORT;

// A two-step chore is padding only if neither of its steps is worth doing for its own
// sake; one meaningful step makes the whole cycle meaningful.
const choreIsTrivial = (chore) =>
  isTwoStepChore(chore) ? chore.twoStep.steps.every(stepIsTrivial) : stepIsTrivial(chore);

export function householdDemandPerWeek(chores) {
  const list = Array.isArray(chores) ? chores : [];
  return list.reduce((total, chore) => total + choreDemandPerDay(chore), 0) * 7;
}

// The most one person could earn per week doing nothing but trivial chores, at full
// frequency. Green above this means padding cannot reach the green zone.
export function paddingCeilingPerWeek(chores) {
  const list = Array.isArray(chores) ? chores : [];
  return list.reduce(
    (total, chore) => (choreIsTrivial(chore) ? total + choreDemandPerDay(chore) * 7 : total),
    0
  );
}

export function suggestEffortGoal(chores, coverage = GREEN_COVERAGE) {
  const list = Array.isArray(chores) ? chores : [];
  if (!list.length) return null;

  const demandPerWeek = householdDemandPerWeek(list);
  if (!(demandPerWeek > 0)) return null;

  const fairShare = demandPerWeek / 2;
  const paddingCeiling = paddingCeilingPerWeek(list);

  const wanted = coverage * fairShare;
  const floor = PADDING_MARGIN * paddingCeiling;
  const rawGreen = Math.max(wanted, floor);
  const rawScale = Math.max(SCALE_COVERAGE * fairShare, rawGreen / GREEN_SHARE_OF_SCALE);

  const scale = clamp(Math.round(rawScale), SCALE_MIN, SCALE_MAX);
  const green = clamp(Math.round(rawGreen), GREEN_FLOOR, scale);

  return {
    choreCount: list.length,
    demandPerWeek,
    fairShare,
    paddingCeiling,
    scale,
    green,
    // What the user actually ends up covering, which is what the copy should quote —
    // the padding floor can lift green above the coverage that was asked for.
    actualCoverage: fairShare > 0 ? green / fairShare : 0,
    floorLimited: floor > wanted,
  };
}

// Each preset priced against the same chore list, so the UI can show what every home
// style would actually cost per week.
export function goalPresetOptions(chores) {
  const options = GOAL_PRESETS.map((preset) => {
    const suggestion = suggestEffortGoal(chores, preset.coverage);
    return suggestion ? { ...preset, ...suggestion } : null;
  });
  return options.every(Boolean) ? options : null;
}

export function isGoalStale(currentGreen, suggestion) {
  if (!suggestion) return false;
  const green = Number(currentGreen);
  if (!Number.isFinite(green) || green <= 0) return true;
  return green < DRIFT_LOW * suggestion.green || green > DRIFT_HIGH * suggestion.green;
}

// Dismissing records the suggestion that was dismissed rather than a flag, so the
// nudge stays gone for that situation but returns if the chore list moves on.
export function shouldShowGoalNudge(currentGreen, suggestion, dismissedAtGreen) {
  if (!isGoalStale(currentGreen, suggestion)) return false;
  const dismissed = Number(dismissedAtGreen);
  if (!Number.isFinite(dismissed) || dismissed <= 0) return true;
  return Math.abs(suggestion.green - dismissed) / dismissed > DISMISS_TOLERANCE;
}
