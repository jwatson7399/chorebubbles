import { describe, expect, it } from "vitest";
import {
  LOG_PERIOD_MS,
  bothStreak,
  effectiveAge,
  effortZone,
  effortZoneThresholds,
  pointsInActivePeriod,
  suggestCombo,
  weeklyPoints,
} from "./logModel.js";

const DAY = 86400000;
const AT = 20 * DAY;
const completion = (overrides = {}) => ({
  id: Math.random().toString(36),
  by: "a",
  difficulty: 3,
  ts: AT - DAY,
  ...overrides,
});

describe("rolling effort points", () => {
  it("awards full personal and joint credit to each eligible person", () => {
    const completions = [
      completion({ by: "a", difficulty: 2 }),
      completion({ by: "joint", difficulty: 3 }),
    ];
    expect(weeklyPoints(completions, "a", [], AT)).toBe(5);
    expect(weeklyPoints(completions, "b", [], AT)).toBe(3);
  });

  it("excludes service, reset, and future events", () => {
    const completions = [
      completion({ by: "service" }),
      completion({ by: "reset" }),
      completion({ ts: AT + 1 }),
    ];
    expect(weeklyPoints(completions, "a", [], AT)).toBe(0);
  });

  it("uses half-open boundaries without double-counting", () => {
    const justInside = completion({ difficulty: 2, ts: AT - LOG_PERIOD_MS + 1 });
    const boundary = completion({ difficulty: 4, ts: AT - LOG_PERIOD_MS });
    expect(pointsInActivePeriod([justInside, boundary], "a", [], AT, 0)).toBe(2);
    expect(pointsInActivePeriod([justInside, boundary], "a", [], AT, 1)).toBe(4);
  });

  it("freezes both people during a household pause", () => {
    const pauses = [{ scope: "house", start: AT - 4 * DAY, end: null }];
    const event = completion({ by: "joint", ts: AT - 9 * DAY });
    expect(effectiveAge(pauses, "a", event.ts, AT)).toBe(5 * DAY);
    expect(weeklyPoints([event], "a", pauses, AT)).toBe(3);
    expect(weeklyPoints([event], "b", pauses, AT)).toBe(3);
  });

  it("freezes only the selected person during a solo pause", () => {
    const pauses = [{ scope: "a", start: AT - 4 * DAY, end: null }];
    const event = completion({ by: "joint", ts: AT - 9 * DAY });
    expect(weeklyPoints([event], "a", pauses, AT)).toBe(3);
    expect(weeklyPoints([event], "b", pauses, AT)).toBe(0);
  });

  it("does not double-count overlapping household and solo pauses", () => {
    const pauses = [
      { scope: "house", start: AT - 5 * DAY, end: AT - 2 * DAY },
      { scope: "a", start: AT - 4 * DAY, end: AT - DAY },
    ];
    expect(effectiveAge(pauses, "a", AT - 8 * DAY, AT)).toBe(4 * DAY);
  });

  it("starts aging a completion made during a pause after resume", () => {
    const eventTime = AT - 5 * DAY;
    const pauses = [{ scope: "a", start: AT - 6 * DAY, end: AT - 2 * DAY }];
    expect(effectiveAge(pauses, "a", eventTime, AT)).toBe(2 * DAY);
  });

  it("counts completed periods until the first shared miss", () => {
    const completions = [
      completion({ by: "joint", difficulty: 5, ts: AT - 8 * DAY }),
      completion({ by: "joint", difficulty: 5, ts: AT - 15 * DAY }),
      completion({ by: "a", difficulty: 5, ts: AT - 22 * DAY }),
    ];
    expect(bothStreak(completions, 5, [], AT)).toBe(2);
  });
});

describe("gap suggestions", () => {
  const chores = [
    { id: "a", name: "A", difficulty: 3 },
    { id: "b", name: "B", difficulty: 2 },
    { id: "c", name: "C", difficulty: 1 },
    { id: "d", name: "D", difficulty: 4 },
  ];

  it("prefers an exact combination of unique chores", () => {
    const result = suggestCombo(chores, 5, { a: 1, b: 1, c: 0.2, d: 0.2 }, 0);
    expect(result.total).toBe(5);
    expect(new Set(result.chores.map((chore) => chore.id)).size).toBe(result.chores.length);
    expect(result.chores.length).toBeLessThanOrEqual(3);
  });

  it("uses the smallest overshoot, then underfill when nothing can reach", () => {
    expect(suggestCombo([{ id: "a", difficulty: 4 }], 3).total).toBe(4);
    const underfill = suggestCombo(chores.slice(0, 2), 20);
    expect(underfill.total).toBe(5);
    expect(underfill.reachesGap).toBe(false);
  });

  it("prioritizes urgent chores and supports stable alternate seeds", () => {
    const urgency = { a: 1, b: 1, c: 1, d: 0 };
    const first = suggestCombo(chores, 4, urgency, 0);
    const again = suggestCombo(chores, 4, urgency, 0);
    const alternate = suggestCombo(chores, 4, urgency, 1);
    expect(first).toEqual(again);
    expect(first.chores.every((chore) => urgency[chore.id] >= 0.75)).toBe(true);
    expect(alternate.total).toBe(first.total);
  });
});

describe("effort zones", () => {
  it("places the green threshold at the upper fifth of the full scale", () => {
    expect(effortZoneThresholds(14)).toEqual({
      fullScale: 14,
      buildingMin: 6,
      greenMin: 12,
    });
  });

  it("uses inclusive whole-point boundaries", () => {
    expect(effortZone(5, 14).key).toBe("starting");
    expect(effortZone(6, 14).key).toBe("building");
    expect(effortZone(11, 14).key).toBe("building");
    expect(effortZone(12, 14).key).toBe("green");
  });

  it("keeps over-scale effort green and normalizes invalid inputs", () => {
    expect(effortZone(22, 14).key).toBe("green");
    expect(effortZone(-3, 0).key).toBe("starting");
    expect(effortZoneThresholds("8")).toEqual({
      fullScale: 8,
      buildingMin: 4,
      greenMin: 7,
    });
  });

  it("honors an explicit green start, clamped to the full scale", () => {
    expect(effortZoneThresholds(14, 9)).toEqual({
      fullScale: 14,
      buildingMin: 5,
      greenMin: 9,
    });
    expect(effortZone(9, 14, 9).key).toBe("green");
    expect(effortZone(8, 14, 9).key).toBe("building");
    // A green start above the scale is capped at the scale.
    expect(effortZoneThresholds(14, 20).greenMin).toBe(14);
  });
});
