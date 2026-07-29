import { describe, expect, it } from "vitest";
import {
  choreDemandPerDay,
  householdDemandPerWeek,
  paddingCeilingPerWeek,
  suggestEffortGoal,
  goalPresetOptions,
  GOAL_PRESETS,
  isGoalStale,
  shouldShowGoalNudge,
  activeGoalId,
  CUSTOM_GOAL_ID,
} from "./effortGoal.js";

const chore = (patch) => ({ importance: 3, difficulty: 2, freqDays: 7, ...patch });

const twoStep = (a, b) => ({
  ...chore(a),
  twoStep: { enabled: true, active: 0, steps: [chore(a), chore(b)] },
});

describe("choreDemandPerDay", () => {
  it("is effort over frequency for a plain chore", () => {
    expect(choreDemandPerDay(chore({ difficulty: 3, freqDays: 3 }))).toBeCloseTo(1);
  });

  it("uses the full cycle for a two-step chore, not the active step alone", () => {
    // Load (3 effort / 3 days) then Unload (3 / 3): one completion every 3 days,
    // so 6 effort per 6 days — the same 1/day, but reached via the summed cycle.
    const c = twoStep({ difficulty: 3, freqDays: 3 }, { difficulty: 3, freqDays: 3 });
    expect(choreDemandPerDay(c)).toBeCloseTo(1);
  });

  it("averages asymmetric two-step legs across the whole cycle", () => {
    // A cheap 1-day step and an expensive 9-day step: 6 effort per 10 days.
    const c = twoStep({ difficulty: 1, freqDays: 1 }, { difficulty: 5, freqDays: 9 });
    expect(choreDemandPerDay(c)).toBeCloseTo(0.6);
  });

  it("falls back to defaults rather than dividing by zero", () => {
    expect(choreDemandPerDay({ difficulty: 2, freqDays: 0 })).toBeCloseTo(2 / 7);
    expect(choreDemandPerDay(null)).toBe(0);
  });
});

describe("paddingCeilingPerWeek", () => {
  it("counts only chores that are both unimportant and genuinely quick", () => {
    const chores = [
      chore({ importance: 2, difficulty: 1, freqDays: 1 }), // trivial: 7/wk
      chore({ importance: 1, difficulty: 5, freqDays: 7 }), // high effort, not padding
      chore({ importance: 5, difficulty: 1, freqDays: 7 }), // important, not padding
    ];
    expect(paddingCeilingPerWeek(chores)).toBeCloseTo(7);
  });

  it("excludes effort 2, which is a real job rather than walk-past tidying", () => {
    // A load of couch blankets: unimportant, but not a ten-second tidy.
    expect(paddingCeilingPerWeek([chore({ importance: 2, difficulty: 2, freqDays: 7 })])).toBe(0);
    expect(paddingCeilingPerWeek([chore({ importance: 2, difficulty: 1, freqDays: 7 })])).toBeCloseTo(1);
  });

  it("treats a two-step chore as padding only when neither step matters", () => {
    const trivial = twoStep({ importance: 2, difficulty: 1 }, { importance: 1, difficulty: 1 });
    const mixed = twoStep({ importance: 2, difficulty: 1 }, { importance: 5, difficulty: 1 });
    expect(paddingCeilingPerWeek([trivial])).toBeGreaterThan(0);
    expect(paddingCeilingPerWeek([mixed])).toBe(0);
  });
});

describe("suggestEffortGoal", () => {
  it("returns null when there is nothing to derive from", () => {
    expect(suggestEffortGoal([])).toBeNull();
    expect(suggestEffortGoal(null)).toBeNull();
  });

  it("derives green and scale from coverage of the fair share", () => {
    // 10 chores at 2 effort / 1 day = 20/day household = 140/week, share 70.
    // Clamped to the stepper maximum of 40.
    const chores = Array.from({ length: 10 }, () => chore({ importance: 5, difficulty: 2, freqDays: 1 }));
    const s = suggestEffortGoal(chores);
    expect(s.demandPerWeek).toBeCloseTo(140);
    expect(s.fairShare).toBeCloseTo(70);
    expect(s.scale).toBe(40);
  });

  it("lifts green above the padding ceiling when coverage alone would not", () => {
    // Almost all the work is trivial, so half the share sits below the ceiling.
    const chores = [
      chore({ importance: 1, difficulty: 1, freqDays: 1 }),
      chore({ importance: 2, difficulty: 1, freqDays: 1 }),
      chore({ importance: 2, difficulty: 2, freqDays: 2 }),
    ];
    const s = suggestEffortGoal(chores);
    expect(s.green).toBeGreaterThan(s.paddingCeiling);
    expect(s.green).toBeGreaterThan(0.5 * s.fairShare);
  });

  it("keeps the scale at or above green when the padding floor sets green", () => {
    const chores = [chore({ importance: 1, difficulty: 1, freqDays: 1 })];
    const s = suggestEffortGoal(chores);
    expect(s.scale).toBeGreaterThanOrEqual(s.green);
  });

  it("clamps to the ranges the Settings steppers accept", () => {
    const tiny = suggestEffortGoal([chore({ importance: 1, difficulty: 1, freqDays: 60 })]);
    expect(tiny.scale).toBeGreaterThanOrEqual(4);
    expect(tiny.green).toBeGreaterThanOrEqual(2);

    const huge = Array.from({ length: 60 }, () => chore({ importance: 5, difficulty: 5, freqDays: 1 }));
    const big = suggestEffortGoal(huge);
    expect(big.scale).toBeLessThanOrEqual(40);
    expect(big.green).toBeLessThanOrEqual(big.scale);
  });

  // The bug this whole feature exists to prevent: a household whose green threshold
  // can be held by doing nothing but trivial chores. Uses the real chore list.
  it("keeps green above the padding ceiling for the live household list", () => {
    const chores = [
      twoStep({ importance: 5, difficulty: 3, freqDays: 3 }, { importance: 5, difficulty: 3, freqDays: 3 }),
      chore({ importance: 4, difficulty: 1, freqDays: 2 }), // Kitchen counters
      chore({ importance: 3, difficulty: 2, freqDays: 4 }), // Trash
      chore({ importance: 2, difficulty: 2, freqDays: 7 }), // Wash Couch Blankets
      chore({ importance: 1, difficulty: 1, freqDays: 10 }), // Bathroom mats
      chore({ importance: 1, difficulty: 3, freqDays: 14 }), // Wash bed sheets
      chore({ importance: 4, difficulty: 2, freqDays: 2 }), // Vacuum
      chore({ importance: 2, difficulty: 4, freqDays: 7 }), // Fridge clean-out
      chore({ importance: 2, difficulty: 1, freqDays: 7 }), // Dust
      chore({ importance: 5, difficulty: 5, freqDays: 7 }), // Litter
      chore({ importance: 2, difficulty: 4, freqDays: 7 }), // Recycling
      chore({ importance: 4, difficulty: 3, freqDays: 14 }), // Mop
      chore({ importance: 3, difficulty: 1, freqDays: 6 }), // Water Plants
      chore({ importance: 1, difficulty: 2, freqDays: 14 }), // Microwave
      chore({ importance: 3, difficulty: 4, freqDays: 7 }), // Airfryer
      chore({ importance: 1, difficulty: 5, freqDays: 30 }), // Stove
      chore({ importance: 4, difficulty: 3, freqDays: 14 }), // Dry food
      chore({ importance: 4, difficulty: 2, freqDays: 7 }), // Cat water
      chore({ importance: 3, difficulty: 2, freqDays: 4 }), // Drying Rack
      chore({ importance: 3, difficulty: 1, freqDays: 2 }), // Coffee Table
      chore({ importance: 3, difficulty: 1, freqDays: 7 }), // J Bathroom
      chore({ importance: 4, difficulty: 5, freqDays: 7 }), // K Bathroom
      chore({ importance: 2, difficulty: 1, freqDays: 3 }), // Dish Mat
      chore({ importance: 1, difficulty: 1, freqDays: 3 }), // Shoes
      chore({ importance: 2, difficulty: 1, freqDays: 1 }), // Reset Couch
    ];
    const s = suggestEffortGoal(chores);
    expect(s.demandPerWeek).toBeCloseTo(76.2, 0);
    expect(s.paddingCeiling).toBeCloseTo(13.4, 0);
    expect(s.green).toBe(19);
    expect(s.scale).toBe(29);
    expect(s.green).toBeGreaterThan(s.paddingCeiling);
    // Balanced means half a fair share, and on this list it delivers exactly that.
    expect(Math.round(s.actualCoverage * 100)).toBe(50);
    expect(s.floorLimited).toBe(false);
  });
});

describe("goalPresetOptions", () => {
  const liveList = () => [
    twoStep({ importance: 5, difficulty: 3, freqDays: 3 }, { importance: 5, difficulty: 3, freqDays: 3 }),
    chore({ importance: 4, difficulty: 1, freqDays: 2 }),
    chore({ importance: 3, difficulty: 2, freqDays: 4 }),
    chore({ importance: 2, difficulty: 2, freqDays: 7 }),
    chore({ importance: 1, difficulty: 1, freqDays: 10 }),
    chore({ importance: 1, difficulty: 3, freqDays: 14 }),
    chore({ importance: 4, difficulty: 2, freqDays: 2 }),
    chore({ importance: 2, difficulty: 4, freqDays: 7 }),
    chore({ importance: 2, difficulty: 1, freqDays: 7 }),
    chore({ importance: 5, difficulty: 5, freqDays: 7 }),
    chore({ importance: 2, difficulty: 4, freqDays: 7 }),
    chore({ importance: 4, difficulty: 3, freqDays: 14 }),
    chore({ importance: 3, difficulty: 1, freqDays: 6 }),
    chore({ importance: 1, difficulty: 2, freqDays: 14 }),
    chore({ importance: 3, difficulty: 4, freqDays: 7 }),
    chore({ importance: 1, difficulty: 5, freqDays: 30 }),
    chore({ importance: 4, difficulty: 3, freqDays: 14 }),
    chore({ importance: 4, difficulty: 2, freqDays: 7 }),
    chore({ importance: 3, difficulty: 2, freqDays: 4 }),
    chore({ importance: 3, difficulty: 1, freqDays: 2 }),
    chore({ importance: 3, difficulty: 1, freqDays: 7 }),
    chore({ importance: 4, difficulty: 5, freqDays: 7 }),
    chore({ importance: 2, difficulty: 1, freqDays: 3 }),
    chore({ importance: 1, difficulty: 1, freqDays: 3 }),
    chore({ importance: 2, difficulty: 1, freqDays: 1 }),
  ];

  it("returns null when there is nothing to price", () => {
    expect(goalPresetOptions([])).toBeNull();
  });

  it("prices every preset and keeps them in ascending order", () => {
    const options = goalPresetOptions(liveList());
    expect(options).toHaveLength(GOAL_PRESETS.length);
    for (let i = 1; i < options.length; i += 1) {
      expect(options[i].green).toBeGreaterThan(options[i - 1].green);
    }
  });

  it("keeps every preset above the padding ceiling, including the gentlest", () => {
    const options = goalPresetOptions(liveList());
    options.forEach((option) => expect(option.green).toBeGreaterThan(option.paddingCeiling));
  });

  it("keeps green below the full bar for every preset, so the bar never pegs at green", () => {
    const options = goalPresetOptions(liveList());
    options.forEach((option) => expect(option.green).toBeLessThan(option.scale));
  });

  it("delivers half a fair share on the live list, unhindered by the floor", () => {
    const balanced = goalPresetOptions(liveList())[0];
    expect(balanced.floorLimited).toBe(false);
    expect(Math.round(balanced.actualCoverage * 100)).toBe(50);
  });

  it("reports the coverage actually delivered when the floor does lift green", () => {
    // Almost all of this household's work is one-point tidying, so the floor overrides
    // the coverage constant and the delivered coverage exceeds what was asked for.
    const trivialHome = [
      chore({ importance: 2, difficulty: 1, freqDays: 1 }),
      chore({ importance: 1, difficulty: 1, freqDays: 1 }),
      chore({ importance: 5, difficulty: 2, freqDays: 14 }),
    ];
    const balanced = goalPresetOptions(trivialHome)[0];
    expect(balanced.floorLimited).toBe(true);
    expect(balanced.actualCoverage).toBeGreaterThan(GOAL_PRESETS[0].coverage);
    expect(balanced.green).toBeGreaterThan(balanced.paddingCeiling);
  });

  it("leaves the default suggestion unchanged at the gentlest preset", () => {
    const chores = liveList();
    const base = suggestEffortGoal(chores);
    const balanced = goalPresetOptions(chores)[0];
    expect([base.green, base.scale]).toEqual([balanced.green, balanced.scale]);
    expect([base.green, base.scale]).toEqual([19, 29]);
  });
});

describe("isGoalStale", () => {
  const suggestion = { green: 20 };

  it("flags a threshold far below the suggestion", () => {
    expect(isGoalStale(7, suggestion)).toBe(true);
  });

  it("flags a threshold far above the suggestion", () => {
    expect(isGoalStale(31, suggestion)).toBe(true);
  });

  it("accepts a threshold inside the drift band", () => {
    expect(isGoalStale(14, suggestion)).toBe(false);
    expect(isGoalStale(28, suggestion)).toBe(false);
  });

  it("is quiet when there is no suggestion", () => {
    expect(isGoalStale(7, null)).toBe(false);
  });
});

describe("shouldShowGoalNudge", () => {
  const suggestion = { green: 20 };

  it("shows when stale and never dismissed", () => {
    expect(shouldShowGoalNudge(7, suggestion, 0)).toBe(true);
  });

  it("stays hidden after dismissing the same situation", () => {
    expect(shouldShowGoalNudge(7, suggestion, 20)).toBe(false);
  });

  it("returns when the suggestion has moved materially", () => {
    expect(shouldShowGoalNudge(7, { green: 30 }, 20)).toBe(true);
  });

  it("stays hidden once the threshold is back in range", () => {
    expect(shouldShowGoalNudge(18, suggestion, 0)).toBe(false);
  });
});

describe("activeGoalId", () => {
  const presets = [
    { id: "balanced", scale: 29, green: 19 },
    { id: "tidy", scale: 36, green: 24 },
    { id: "spotless", scale: 40, green: 30 },
  ];

  it("names the preset whose numbers match exactly", () => {
    expect(activeGoalId(presets, 29, 19)).toBe("balanced");
    expect(activeGoalId(presets, 40, 30)).toBe("spotless");
  });

  it("falls to custom when either number differs", () => {
    expect(activeGoalId(presets, 29, 20)).toBe(CUSTOM_GOAL_ID);
    expect(activeGoalId(presets, 30, 19)).toBe(CUSTOM_GOAL_ID);
  });

  it("is custom when there are no presets to match", () => {
    expect(activeGoalId(null, 29, 19)).toBe(CUSTOM_GOAL_ID);
  });

  it("accepts string settings without reporting a false custom", () => {
    expect(activeGoalId(presets, "29", "19")).toBe("balanced");
  });
});
