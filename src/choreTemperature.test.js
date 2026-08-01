import { describe, expect, it } from "vitest";
import {
  STREAK_MAX,
  STREAK_MIN,
  choreStreak,
  choreTemperature,
  frostTreatment,
  streakLabel,
  thawBonus,
} from "./choreTemperature.js";

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const at = (days = 0) => NOW - days * DAY;

// A chore plus completions, both described in "days ago".
const build = (completionDays, { freqDays = 3, importance = 3, createdDays = 30 } = {}) => ({
  chore: { id: "c1", freqDays, importance, createdAt: at(createdDays) },
  completions: completionDays.map((day, i) => ({ id: `c${i}`, choreId: "c1", by: "a", ts: at(day) })),
});

const streakOf = (completionDays, opts = {}, evaluatedAt = 0) => {
  const { chore, completions } = build(completionDays, opts);
  return choreStreak(chore, completions, [], at(evaluatedAt));
};

describe("building a streak", () => {
  it("starts a brand new chore at zero", () => {
    expect(streakOf([], { createdDays: 1 })).toBe(0);
  });

  it("counts one on-time completion as one step", () => {
    expect(streakOf([1], { createdDays: 2 })).toBe(1);
  });

  it("counts two on-time completions in a row as two steps", () => {
    expect(streakOf([2, 1], { createdDays: 3 })).toBe(2);
  });

  it("holds at the ceiling however long the run continues", () => {
    expect(streakOf([6, 5, 4, 3, 2, 1], { createdDays: 7 })).toBe(STREAK_MAX);
  });
});

describe("losing a streak", () => {
  it("drops one step for a single missed deadline instead of wiping the run", () => {
    // Three on-time completions, then evaluated one full cycle past due.
    expect(streakOf([9, 8, 7], { createdDays: 10 }, 2)).toBe(1);
  });

  it("keeps stepping down as further deadlines pass", () => {
    expect(streakOf([12, 11, 10], { createdDays: 13 }, 3)).toBe(0);
    expect(streakOf([15, 14, 13], { createdDays: 16 }, 3)).toBe(-1);
  });

  it("holds at the floor once a chore is thoroughly abandoned", () => {
    expect(streakOf([], { createdDays: 90 })).toBe(STREAK_MIN);
  });
});

describe("rescuing a cold chore", () => {
  it("follows the full frozen, rescued, warm, hot, then gently cooling path", () => {
    expect(streakOf([], { createdDays: 90, freqDays: 7 })).toBe(-2);
    expect(streakOf([14], { createdDays: 90, freqDays: 7 }, 14)).toBe(0);
    expect(streakOf([14, 7], { createdDays: 90, freqDays: 7 }, 7)).toBe(1);
    expect(streakOf([14, 7, 0], { createdDays: 90, freqDays: 7 })).toBe(2);
    expect(streakOf([14, 7, 0], { createdDays: 90, freqDays: 7 }, -8)).toBe(1);
  });

  it("clears the debt back to neutral when a neglected chore is finally done", () => {
    // Untouched for a month, then done today: back to zero, not still frozen.
    expect(streakOf([0], { createdDays: 30 })).toBe(0);
  });

  it("does not reward a late completion with a step up", () => {
    // Two on-time completions, then one that ran a cycle late.
    expect(streakOf([19, 18, 13], { createdDays: 20 }, 12)).toBe(1);
  });

  it("lets a rescued chore climb again from neutral", () => {
    expect(streakOf([30, 3, 2, 1], { createdDays: 90 })).toBe(2);
  });
});

describe("pauses", () => {
  it("does not count deadlines that fell inside a household pause", () => {
    const { chore, completions } = build([], { createdDays: 10 });
    const pauses = [{ id: "p", scope: "house", start: at(9), end: at(1) }];
    expect(choreStreak(chore, completions, [], NOW)).toBe(STREAK_MIN);
    expect(choreStreak(chore, completions, pauses, NOW)).toBe(0);
  });
});

describe("timeline guards", () => {
  it("uses the first completion as the anchor when createdAt is missing", () => {
    const { chore, completions } = build([2, 1], { createdDays: 3 });
    delete chore.createdAt;
    expect(choreStreak(chore, completions, [], NOW)).toBe(1);
  });

  it("ignores completions belonging to another chore", () => {
    const { chore, completions } = build([2], { createdDays: 3 });
    completions.push({ id: "other", choreId: "other", by: "a", ts: at(1) });
    expect(choreStreak(chore, completions, [], NOW)).toBe(1);
  });
});

describe("tiers", () => {
  const tierFor = (completionDays, opts, evaluatedAt) => {
    const { chore, completions } = build(completionDays, opts);
    return choreTemperature(chore, completions, [], at(evaluatedAt ?? 0));
  };

  it("shows nothing at all for a chore with no streak either way", () => {
    const temp = tierFor([], { createdDays: 1 });
    expect(temp.tier).toBe("neutral");
    expect(temp.sigil).toBe("");
  });

  it("gives one flame for one on-time completion", () => {
    expect(tierFor([1], { createdDays: 2 }).sigil).toBe("🔥");
  });

  it("keeps the single fire lit at the top of a hot streak", () => {
    expect(tierFor([2, 1], { createdDays: 3 }).sigil).toBe("🔥");
  });

  it("gives one snowflake for a single missed cycle", () => {
    expect(tierFor([15, 14, 13], { createdDays: 16 }, 3).sigil).toBe("❄️");
  });

  it("switches from a snowflake to an ice cube when fully frozen", () => {
    expect(tierFor([], { createdDays: 90 }).sigil).toBe("🧊");
  });
});

describe("thaw bonus", () => {
  it("pays nothing for a chore that is not cold", () => {
    expect(thawBonus({ importance: 5 }, "scorching")).toBe(0);
    expect(thawBonus({ importance: 5 }, "warm")).toBe(0);
    expect(thawBonus({ importance: 5 }, "neutral")).toBe(0);
  });

  it("pays more for frozen chores than merely cold ones", () => {
    expect(thawBonus({ importance: 2 }, "cold")).toBe(1);
    expect(thawBonus({ importance: 2 }, "frozen")).toBe(2);
  });

  it("pays more for important chores", () => {
    expect(thawBonus({ importance: 4 }, "cold")).toBe(2);
    expect(thawBonus({ importance: 5 }, "frozen")).toBe(3);
  });

  it("never pays more than three points", () => {
    for (const importance of [1, 2, 3, 4, 5]) {
      for (const tier of ["scorching", "warm", "neutral", "cold", "frozen"]) {
        expect(thawBonus({ importance }, tier)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("describing a streak", () => {
  it("names the bounded state without overstating a capped count", () => {
    expect(streakLabel(2)).toBe("Hot streak");
    expect(streakLabel(1)).toBe("Warm streak");
    expect(streakLabel(0)).toBe("Neutral");
    expect(streakLabel(-1)).toBe("Cold streak");
    expect(streakLabel(-2)).toBe("Frozen streak");
  });
});

describe("frost treatment", () => {
  // Cold and frozen must stay one construction so they read as the same
  // material, with motion as the only thing separating them — ❄️ against 🧊 at
  // the size the sigil renders is not a distinction anyone can actually see.
  it("gives both chilled tiers the same shape and lets only frozen move", () => {
    const cold = frostTreatment("cold");
    const frozen = frostTreatment("frozen");
    expect(Object.keys(frozen).sort()).toEqual(Object.keys(cold).sort());
    expect(cold.rgb).toBe(frozen.rgb);
    expect(cold.orbit).toBe(false);
    expect(frozen.orbit).toBe(true);
    expect(frozen.seconds).toBeGreaterThan(0);
  });

  it("leaves every other tier untreated", () => {
    for (const tier of ["neutral", "warm", "scorching", undefined]) {
      expect(frostTreatment(tier)).toBeNull();
    }
  });
});
