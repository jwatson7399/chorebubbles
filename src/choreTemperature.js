import { pausedDuration } from "./logModel.js";

const DAY = 86400000;

// A chore carries one number: positive momentum from on-time completions, or
// negative momentum from missed deadlines. Two steps in either direction is as
// far as it goes, so the board reads at a glance instead of hoarding history.
export const STREAK_MAX = 2;
export const STREAK_MIN = -2;

export const TEMPERATURE_TIERS = {
  scorching: { key: "scorching", sigil: "🔥", label: "on a scorching streak" },
  warm: { key: "warm", sigil: "🔥", label: "running warm" },
  neutral: { key: "neutral", sigil: "", label: "" },
  cold: { key: "cold", sigil: "❄️", label: "going cold" },
  frozen: { key: "frozen", sigil: "🧊", label: "frozen over" },
};

const TIER_BY_STREAK = {
  2: TEMPERATURE_TIERS.scorching,
  1: TEMPERATURE_TIERS.warm,
  0: TEMPERATURE_TIERS.neutral,
  "-1": TEMPERATURE_TIERS.cold,
  "-2": TEMPERATURE_TIERS.frozen,
};

const clampStreak = (value) => Math.max(STREAK_MIN, Math.min(STREAK_MAX, value));

// Cold and frozen share one construction: an icy glyph carrying a glow that
// washes onto the bubble. Only frozen sets it moving. That matters because ❄️
// and 🧊 are indistinguishable at the ~13px the sigil actually renders at, while
// "travelling" against "parked" reads instantly at any size — so the tier that
// pays the larger thaw bonus is told by behaviour rather than by glyph shape.
export const FROST_RGB = "168,224,255";

export function frostTreatment(tier) {
  if (tier === "frozen") return { rgb: FROST_RGB, orbit: true, seconds: 5.2 };
  if (tier === "cold") return { rgb: FROST_RGB, orbit: false, seconds: null };
  return null;
}

// Days between two moments, minus any household pause covering them — the same
// adjustment activeDaysSinceDone makes, so a vacation never chills the board.
function activeDaysBetween(pauses, from, to) {
  return Math.max(0, (to - from - pausedDuration(pauses, ["house"], from, to)) / DAY);
}

// How many due dates went by unmet across a span. The first frequency window is
// the chore's allowance; every window after it is another deadline missed.
function missedDeadlines(days, freqDays) {
  if (days <= freqDays) return 0;
  return Math.ceil(days / freqDays) - 1;
}

export function choreStreak(chore, completions, pauses, at) {
  if (!chore?.id) return 0;
  const freqDays = Math.max(Number(chore.freqDays) || 1, 0.25);
  const stamps = (completions || [])
    .filter((entry) => entry?.choreId === chore.id)
    .map((entry) => Number(entry.ts))
    .filter((ts) => Number.isFinite(ts) && ts <= at)
    .sort((a, b) => a - b);

  // Without a creation date there is no honest start for the first span, so the
  // walk begins at the first completion rather than at the epoch.
  const createdAt = Number(chore.createdAt);
  const anchored = Number.isFinite(createdAt) && createdAt > 0;
  let previous = anchored ? createdAt : stamps[0];
  if (previous == null) return 0;

  let streak = 0;
  for (const ts of stamps.slice(anchored ? 0 : 1)) {
    const missed = missedDeadlines(activeDaysBetween(pauses, previous, ts), freqDays);
    // Each slipped deadline costs one step, so a long good record degrades
    // gracefully rather than falling off a cliff after a single bad week.
    streak = clampStreak(streak - missed);
    // Finishing on time builds the run. Finishing late earns nothing, but it does
    // clear the backlog — doing the thing always puts you back to level ground.
    streak = missed === 0 ? clampStreak(streak + 1) : Math.max(streak, 0);
    previous = ts;
  }

  // Deadlines missed since the last completion count as they pass, so a bubble
  // cools while it is being neglected rather than waiting to be dealt with.
  const openMissed = missedDeadlines(activeDaysBetween(pauses, previous, at), freqDays);
  return clampStreak(streak - openMissed);
}

export function choreTemperature(chore, completions, pauses, at) {
  const streak = choreStreak(chore, completions, pauses, at);
  return { ...TIER_BY_STREAK[streak], tier: TIER_BY_STREAK[streak].key, streak };
}

export function streakLabel(streak) {
  if (streak >= STREAK_MAX) return "Hot streak";
  if (streak === 1) return "Warm streak";
  if (streak <= STREAK_MIN) return "Frozen streak";
  if (streak === -1) return "Cold streak";
  return "Neutral";
}

// A flat, capped bonus rather than a multiplier: points stay whole numbers, and no
// single tap can swallow a week's goal. Neglect still costs more than it pays back.
export function thawBonus(chore, tier) {
  if (tier !== "cold" && tier !== "frozen") return 0;
  // One-point chores recur often enough that neglecting them should not create a
  // steady bonus faucet. They still show their temperature; rescue just pays the
  // chore's normal effort value.
  if (Number(chore?.difficulty) === 1) return 0;
  const important = (Number(chore?.importance) || 0) >= 4;
  if (tier === "frozen") return important ? 3 : 2;
  return important ? 2 : 1;
}
