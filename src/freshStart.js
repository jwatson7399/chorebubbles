import { recurringChores } from "./celebrityChore.js";
import { choreTemperature } from "./choreTemperature.js";

// Once half the recurring chores have frozen over, the board has gotten away from
// the household, and opening the app offers a clean slate before the bubbles.
export const FRESH_START_FROZEN_SHARE = 0.5;
// Health below this (the 😫 and 🥀 faces) also counts as the board getting away,
// even when most chores are only cold: a lapse soon after a fresh start leaves the
// short-cycle chores frozen and everything else merely chilled.
export const FRESH_START_HEALTH = 0.3;
// A declined offer stays quiet on this phone for a while rather than greeting
// every reopen while someone digs out by hand.
export const FRESH_START_QUIET_MS = 12 * 3600000;

export function boardGotAway(chores, completions, pauses, at) {
  const recurring = recurringChores(chores);
  if (recurring.length === 0) return false;
  const frozen = recurring.filter((chore) => choreTemperature(chore, completions, pauses, at).tier === "frozen").length;
  return frozen / recurring.length >= FRESH_START_FROZEN_SHARE;
}

export function shouldOfferFreshStart({ chores, completions, pauses, at, lastOfferedAt, health = 1 }) {
  if (at - (Number(lastOfferedAt) || 0) < FRESH_START_QUIET_MS) return false;
  if (recurringChores(chores).length === 0) return false;
  return health < FRESH_START_HEALTH || boardGotAway(chores, completions, pauses, at);
}
