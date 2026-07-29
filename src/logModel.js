const DAY = 86400000;
const PERIOD = 7 * DAY;

export function effortZoneThresholds(goal, greenStart) {
  const fullScale = Math.max(1, Math.round(Number(goal) || 1));
  const requested = Number(greenStart);
  // Green defaults to the top fifth of the scale, but can be set explicitly.
  const greenMin =
    Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.round(requested), fullScale)
      : Math.ceil(fullScale * 0.8);
  const buildingMin = Math.max(1, Math.min(Math.ceil(greenMin * 0.5), greenMin));
  return { fullScale, buildingMin, greenMin };
}

export function effortZone(points, goal, greenStart) {
  const thresholds = effortZoneThresholds(goal, greenStart);
  const total = Math.max(0, Number(points) || 0);

  if (total >= thresholds.greenMin) {
    return { key: "green", label: "On top of it! 👌", emoji: "👌", color: "#5FE0BB", ...thresholds };
  }
  if (total >= thresholds.buildingMin) {
    return { key: "building", label: "Maintaining 👍", emoji: "👍", color: "#FFC65E", ...thresholds };
  }
  return { key: "starting", label: "Getting started ⚠️", emoji: "⚠️", color: "#FF8B7B", ...thresholds };
}

// Milliseconds in [from, to] covered by pauses matching any requested scope.
// Intervals are merged so overlapping household and solo pauses count once.
export function pausedDuration(pauses, scopes, from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;

  const intervals = [];
  for (const pause of pauses || []) {
    if (!scopes.includes(pause.scope)) continue;
    const start = Math.max(Number(pause.start), from);
    const rawEnd = pause.end == null ? to : Number(pause.end);
    const end = Math.min(rawEnd, to);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      intervals.push([start, end]);
    }
  }

  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let currentStart = null;
  let currentEnd = null;

  for (const [start, end] of intervals) {
    if (currentStart == null) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }

  return total + (currentStart == null ? 0 : currentEnd - currentStart);
}

export function effectiveAge(pauses, who, eventTime, at) {
  if (!Number.isFinite(eventTime) || !Number.isFinite(at)) return Number.NaN;
  if (eventTime > at) return eventTime - at > 0 ? -(eventTime - at) : 0;
  return at - eventTime - pausedDuration(pauses, ["house", who], eventTime, at);
}

function positivePoints(value) {
  const points = Number(value);
  return Number.isFinite(points) && points > 0 ? points : 0;
}

function completionCredit(completion, who) {
  if (completion.by !== who && completion.by !== "joint") return 0;
  // A thaw bonus is stored on the record when it is earned, so past effort keeps its
  // value even after the chore warms back up.
  return positivePoints(completion.difficulty) + positivePoints(completion.bonus);
}

export function pointsInActivePeriod(completions, who, pauses, at, periodIndex) {
  const index = Math.max(0, Math.floor(Number(periodIndex) || 0));
  const fromAge = index * PERIOD;
  const toAge = (index + 1) * PERIOD;
  let points = 0;

  for (const completion of completions || []) {
    const credit = completionCredit(completion, who);
    if (!credit) continue;
    const age = effectiveAge(pauses, who, Number(completion.ts), at);
    if (age >= fromAge && age < toAge) points += credit;
  }

  return points;
}

export function weeklyPoints(completions, who, pauses, at) {
  return pointsInActivePeriod(completions, who, pauses, at, 0);
}

export function bothStreak(completions, goal, pauses, at) {
  const target = Number(goal);
  if (!Number.isFinite(target) || target <= 0) return 0;

  let oldestPeriod = 0;
  for (const completion of completions || []) {
    if (!["a", "b", "joint"].includes(completion.by)) continue;
    const ts = Number(completion.ts);
    if (!Number.isFinite(ts) || ts > at) continue;
    for (const who of ["a", "b"]) {
      if (completion.by !== who && completion.by !== "joint") continue;
      const age = effectiveAge(pauses, who, ts, at);
      if (age >= 0) oldestPeriod = Math.max(oldestPeriod, Math.floor(age / PERIOD));
    }
  }

  let streak = 0;
  for (let period = 1; period <= oldestPeriod; period++) {
    const a = pointsInActivePeriod(completions, "a", pauses, at, period);
    const b = pointsInActivePeriod(completions, "b", pauses, at, period);
    if (a < target || b < target) break;
    streak++;
  }
  return streak;
}

// Suggestions used to be combinations of at most three chores, which quietly forced
// heavy work: with a ten-point gap, three slots demand an average effort of 3.3, and
// none of the 389 valid combinations on the real chore list were all-light. The
// suggester was not choosing badly — every option available to it was daunting.
//
// Plans are now built from an "anchor plus fillers" shape with a per-intensity item
// cap, so one bigger job can carry a handful of quick tidying jobs.

const ANCHOR_MIN_EFFORT = 3;
const PREFERRED_URGENCY = 0.75;

export const SUGGESTION_INTENSITIES = [
  { id: "light", label: "Light", blurb: "Quick tidying only", maxItems: 5, maxAnchors: 0 },
  { id: "mixed", label: "Mixed", blurb: "One bigger job plus quick wins", maxItems: 6, maxAnchors: 1 },
  { id: "heavy", label: "Heavy", blurb: "A few big jobs", maxItems: 3, maxAnchors: 3 },
];

export const DEFAULT_INTENSITY = "mixed";

const intensitySpec = (id) =>
  SUGGESTION_INTENSITIES.find((option) => option.id === id) ||
  SUGGESTION_INTENSITIES.find((option) => option.id === DEFAULT_INTENSITY);

const effortOf = (chore) => Number(chore.difficulty);

// Urgency first, because a suggestion should point at work that genuinely needs doing;
// effort descending second, so a plan closes the gap without becoming a long list.
const byUrgencyThenEffort = (urgencyById) => (a, b) =>
  (Number(urgencyById[b.id]) || 0) - (Number(urgencyById[a.id]) || 0) ||
  effortOf(b) - effortOf(a) ||
  String(a.id).localeCompare(String(b.id));

// Shuffle rotates rather than randomises: the order stays urgency-biased and identical
// for a given seed, so both phones show the same idea and Undo-style replays are stable.
const rotate = (items, seed) => {
  if (items.length < 2) return items;
  const offset = Math.abs(Math.floor(Number(seed) || 0)) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
};

function fillPlan(anchors, fillers, gap, spec) {
  const picked = [];
  let total = 0;
  for (const chore of anchors) {
    if (picked.length >= spec.maxAnchors || picked.length >= spec.maxItems || total >= gap) break;
    picked.push(chore);
    total += effortOf(chore);
  }
  for (const chore of fillers) {
    if (picked.length >= spec.maxItems || total >= gap) break;
    picked.push(chore);
    total += effortOf(chore);
  }
  return { picked, total };
}

export function suggestPlan(chores, gap, urgencyById = {}, intensity = DEFAULT_INTENSITY, seed = 0) {
  const target = Math.max(0, Number(gap) || 0);
  if (target === 0) return null;

  const spec = intensitySpec(intensity);
  const eligible = (chores || []).filter(
    (chore) => chore && chore.id && Number.isFinite(effortOf(chore)) && effortOf(chore) > 0
  );
  if (eligible.length === 0) return null;

  const order = byUrgencyThenEffort(urgencyById);
  const build = (pool) => {
    const anchors = rotate(pool.filter((c) => effortOf(c) >= ANCHOR_MIN_EFFORT).sort(order), seed);
    const fillers = rotate(pool.filter((c) => effortOf(c) < ANCHOR_MIN_EFFORT).sort(order), seed);
    // Anchors are taken first up to maxAnchors, then fillers use whatever slots remain.
    // Heavy therefore degrades gracefully: a household with only one big chore still
    // gets that chore plus two quick ones rather than an empty plan.
    return fillPlan(anchors, fillers, target, spec);
  };

  const preferred = eligible.filter((c) => (Number(urgencyById[c.id]) || 0) >= PREFERRED_URGENCY);
  let plan = preferred.length ? build(preferred) : { picked: [], total: 0 };

  // Widen to every chore only when the due-soon pool cannot reach the gap. A light plan
  // is allowed to fall short rather than dragging in work that is not due yet.
  if (plan.total < target) {
    const widened = build(eligible);
    if (widened.total > plan.total) plan = widened;
  }
  if (plan.picked.length === 0) return null;

  return {
    chores: plan.picked,
    total: plan.total,
    intensity: spec.id,
    exact: plan.total === target,
    reachesGap: plan.total >= target,
    shortfall: Math.max(0, target - plan.total),
  };
}

export const LOG_PERIOD_MS = PERIOD;
