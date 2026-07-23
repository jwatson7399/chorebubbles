const DAY = 86400000;
const PERIOD = 7 * DAY;

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

function completionCredit(completion, who) {
  if (completion.by !== who && completion.by !== "joint") return 0;
  const effort = Number(completion.difficulty);
  return Number.isFinite(effort) && effort > 0 ? effort : 0;
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

function combinationsOfUpToThree(chores) {
  const combinations = [];
  for (let i = 0; i < chores.length; i++) {
    combinations.push([chores[i]]);
    for (let j = i + 1; j < chores.length; j++) {
      combinations.push([chores[i], chores[j]]);
      for (let k = j + 1; k < chores.length; k++) {
        combinations.push([chores[i], chores[j], chores[k]]);
      }
    }
  }
  return combinations;
}

function rankedCombinations(chores, gap, urgencyById) {
  return combinationsOfUpToThree(chores)
    .map((items) => {
      const total = items.reduce((sum, chore) => sum + Number(chore.difficulty), 0);
      const urgency = items.reduce((sum, chore) => sum + Number(urgencyById[chore.id] || 0), 0);
      const category = total === gap ? 0 : total > gap ? 1 : 2;
      const distance = Math.abs(total - gap);
      return { chores: items, total, urgency, category, distance };
    })
    .sort((a, b) =>
      a.category - b.category ||
      a.distance - b.distance ||
      b.urgency - a.urgency ||
      a.chores.length - b.chores.length ||
      a.chores.map((item) => item.id).join(":").localeCompare(b.chores.map((item) => item.id).join(":"))
    );
}

export function suggestCombo(chores, gap, urgencyById = {}, seed = 0) {
  const target = Math.max(0, Number(gap) || 0);
  if (target === 0) return null;

  const eligible = (chores || []).filter((chore) => {
    const effort = Number(chore.difficulty);
    return chore && chore.id && Number.isFinite(effort) && effort > 0;
  });
  if (eligible.length === 0) return null;

  const preferred = eligible.filter((chore) => Number(urgencyById[chore.id] || 0) >= 0.75);
  let ranked = preferred.length ? rankedCombinations(preferred, target, urgencyById) : [];

  // If due-soon chores cannot reach the gap, widen the idea pool.
  if (!ranked.some((option) => option.total >= target)) {
    ranked = rankedCombinations(eligible, target, urgencyById);
  }
  if (ranked.length === 0) return null;

  const best = ranked[0];
  const alternatives = ranked.filter(
    (option) => option.category === best.category && option.distance === best.distance
  );
  const index = Math.abs(Math.floor(Number(seed) || 0)) % Math.min(alternatives.length, 6);
  const selected = alternatives[index] || best;

  return {
    chores: selected.chores,
    total: selected.total,
    exact: selected.total === target,
    reachesGap: selected.total >= target,
  };
}

export const LOG_PERIOD_MS = PERIOD;
