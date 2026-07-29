import { pausedDuration } from "./logModel.js";

const DAY = 86400000;

// Five cycles is long enough that frost means "chronically neglected" rather than
// "slipped once", and short enough that fixing a chore pays off within a week or two.
export const CYCLE_WINDOW = 5;
export const MIN_SCORED_CYCLES = 3;

export const TEMPERATURE_TIERS = {
  scorching: { key: "scorching", sigil: "🔥🥵", label: "on a scorching streak" },
  warm: { key: "warm", sigil: "🔥", label: "running warm" },
  neutral: { key: "neutral", sigil: "", label: "" },
  cold: { key: "cold", sigil: "❄️", label: "going cold" },
  frozen: { key: "frozen", sigil: "❄️🥶", label: "frozen over" },
};

function tierForRatio(ratio) {
  if (ratio >= 1) return TEMPERATURE_TIERS.scorching;
  if (ratio >= 0.8) return TEMPERATURE_TIERS.warm;
  if (ratio > 0.4) return TEMPERATURE_TIERS.neutral;
  if (ratio > 0.2) return TEMPERATURE_TIERS.cold;
  return TEMPERATURE_TIERS.frozen;
}

// Days between two moments, minus any household pause covering them — the same
// adjustment activeDaysSinceDone makes, so a vacation never chills the board.
function activeDaysBetween(pauses, from, to) {
  return Math.max(0, (to - from - pausedDuration(pauses, ["house"], from, to)) / DAY);
}

// Whether each of a chore's cycles closed inside its frequency window, oldest first.
// A cycle is the span between one completion and the next; resets by the cleaning
// service still count as the chore having been done, matching lastDone and urgencyOf.
export function choreCycleResults(chore, completions, pauses, at) {
  if (!chore?.id) return [];
  const freqDays = Math.max(Number(chore.freqDays) || 1, 0.25);
  const stamps = (completions || [])
    .filter((entry) => entry?.choreId === chore.id)
    .map((entry) => Number(entry.ts))
    .filter((ts) => Number.isFinite(ts) && ts <= at)
    .sort((a, b) => a - b);

  // Without a creation date there is no honest start for the first cycle, so it goes
  // unscored rather than being measured from the epoch and branded frozen instantly.
  const createdAt = Number(chore.createdAt);
  const anchored = Number.isFinite(createdAt) && createdAt > 0;
  let previous = anchored ? createdAt : stamps[0];
  if (previous == null) return [];

  const results = [];
  for (const ts of stamps.slice(anchored ? 0 : 1)) {
    results.push(activeDaysBetween(pauses, previous, ts) <= freqDays);
    previous = ts;
  }

  // The open cycle cools the chore in real time once it runs late, but stays unscored
  // while it is merely young — an unfinished chore is not yet a failed one.
  if (activeDaysBetween(pauses, previous, at) > freqDays) results.push(false);

  return results;
}

export function choreTemperature(chore, completions, pauses, at) {
  const cycles = choreCycleResults(chore, completions, pauses, at).slice(-CYCLE_WINDOW);
  const onTime = cycles.filter(Boolean).length;

  if (cycles.length < MIN_SCORED_CYCLES) {
    return { ...TEMPERATURE_TIERS.neutral, tier: "neutral", ratio: null, scored: cycles.length, onTime };
  }

  const ratio = onTime / cycles.length;
  const tier = tierForRatio(ratio);
  return { ...tier, tier: tier.key, ratio, scored: cycles.length, onTime };
}

// A flat, capped bonus rather than a multiplier: points stay whole numbers, and no
// single tap can swallow a week's goal. Neglect still costs more than it pays back.
export function thawBonus(chore, tier) {
  if (tier !== "cold" && tier !== "frozen") return 0;
  const important = (Number(chore?.importance) || 0) >= 4;
  if (tier === "frozen") return important ? 3 : 2;
  return important ? 2 : 1;
}
