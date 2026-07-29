import { describe, expect, it } from "vitest";
import {
  CYCLE_WINDOW,
  MIN_SCORED_CYCLES,
  choreCycleResults,
  choreTemperature,
  thawBonus,
} from "./choreTemperature.js";

const DAY = 86400000;
const START = 1_700_000_000_000;

// Builds a chore whose completions land on the given day offsets from START.
const choreOn = (days, { freqDays = 1, importance = 3, id = "c1" } = {}) => ({
  chore: { id, freqDays, importance, createdAt: START },
  completions: days.map((day, index) => ({
    id: `${id}-${index}`,
    choreId: id,
    by: "a",
    ts: START + day * DAY,
  })),
});

describe("scoring cycles", () => {
  it("scores an interval on time when it fits inside the chore's frequency", () => {
    const { chore, completions } = choreOn([1, 2, 3], { freqDays: 1 });
    expect(choreCycleResults(chore, completions, [], START + 3 * DAY)).toEqual([true, true, true]);
  });

  it("scores an interval as missed when it runs past the chore's frequency", () => {
    const { chore, completions } = choreOn([1, 5], { freqDays: 1 });
    expect(choreCycleResults(chore, completions, [], START + 5 * DAY)).toEqual([true, false]);
  });

  it("does not count a household pause against an interval", () => {
    const { chore, completions } = choreOn([1, 6], { freqDays: 2 });
    const pauses = [{ id: "p", scope: "house", start: START + 2 * DAY, end: START + 6 * DAY }];
    expect(choreCycleResults(chore, completions, [], START + 6 * DAY)).toEqual([true, false]);
    expect(choreCycleResults(chore, completions, pauses, START + 6 * DAY)).toEqual([true, true]);
  });

  it("counts the open interval as a miss once it passes the due date", () => {
    const { chore, completions } = choreOn([1], { freqDays: 1 });
    expect(choreCycleResults(chore, completions, [], START + 4 * DAY)).toEqual([true, false]);
  });

  it("ignores the open interval while the chore is still inside its window", () => {
    const { chore, completions } = choreOn([1], { freqDays: 3 });
    expect(choreCycleResults(chore, completions, [], START + 2 * DAY)).toEqual([true]);
  });

  it("counts a cleaning service reset as the chore having been done", () => {
    const { chore, completions } = choreOn([1, 2], { freqDays: 1 });
    completions[1].by = "service";
    expect(choreCycleResults(chore, completions, [], START + 2 * DAY)).toEqual([true, true]);
  });

  it("skips the first interval when the chore has no creation date to anchor it", () => {
    const { chore, completions } = choreOn([200, 201], { freqDays: 1 });
    delete chore.createdAt;
    expect(choreCycleResults(chore, completions, [], START + 201 * DAY)).toEqual([true]);
  });

  it("ignores completions belonging to other chores", () => {
    const { chore, completions } = choreOn([1, 2], { freqDays: 1 });
    const noise = { id: "x", choreId: "other", by: "a", ts: START + 1.5 * DAY };
    expect(choreCycleResults(chore, [...completions, noise], [], START + 2 * DAY)).toEqual([true, true]);
  });
});

describe("temperature tiers", () => {
  // Produces exactly `window` scored intervals, the first `misses` of them late.
  const ramp = (misses, window = CYCLE_WINDOW) => {
    const days = [];
    let day = 0;
    for (let i = 0; i < window; i++) {
      day += i < misses ? 4 : 1;
      days.push(day);
    }
    return { ...choreOn(days, { freqDays: 1 }), at: START + day * DAY };
  };

  const tierAfter = (misses, window) => {
    const { chore, completions, at } = ramp(misses, window);
    return choreTemperature(chore, completions, [], at).tier;
  };

  it("reads a perfect record as scorching", () => {
    expect(tierAfter(0)).toBe("scorching");
  });

  it("reads four of five on time as warm", () => {
    expect(tierAfter(1)).toBe("warm");
  });

  it("reads three of five on time as neutral", () => {
    expect(tierAfter(2)).toBe("neutral");
  });

  it("reads two of five on time as cold", () => {
    expect(tierAfter(3)).toBe("cold");
  });

  it("reads one of five on time as frozen", () => {
    expect(tierAfter(4)).toBe("frozen");
  });

  it("reads a total washout as frozen", () => {
    expect(tierAfter(5)).toBe("frozen");
  });

  it("stays neutral until there are enough cycles to judge", () => {
    expect(tierAfter(0, MIN_SCORED_CYCLES - 1)).toBe("neutral");
    expect(tierAfter(0, MIN_SCORED_CYCLES)).toBe("scorching");
  });

  it("remembers only the most recent cycles", () => {
    // Five early misses followed by five clean cycles reads as fully recovered.
    const days = [4, 8, 12, 16, 20, 21, 22, 23, 24, 25];
    const { chore, completions } = choreOn(days, { freqDays: 1 });
    expect(choreTemperature(chore, completions, [], START + 25 * DAY).tier).toBe("scorching");
  });

  it("reports a neutral chore with no sigil to draw", () => {
    const { chore, completions, at } = ramp(2);
    expect(choreTemperature(chore, completions, [], at).sigil).toBe("");
  });

  it("gives cold and frozen distinct sigils", () => {
    const { chore, completions, at } = ramp(3);
    expect(choreTemperature(chore, completions, [], at).sigil).toBe("❄️");
    const frozen = ramp(4);
    expect(choreTemperature(frozen.chore, frozen.completions, [], frozen.at).sigil).toBe("❄️🥶");
  });

  it("treats a chore that has never been done as unjudged", () => {
    const chore = { id: "new", freqDays: 7, importance: 3, createdAt: START };
    expect(choreTemperature(chore, [], [], START + 90 * DAY).tier).toBe("neutral");
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
