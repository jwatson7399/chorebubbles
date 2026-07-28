import { describe, expect, it } from "vitest";
import {
  LOG_PERIOD_MS,
  bothStreak,
  effectiveAge,
  effortZone,
  effortZoneThresholds,
  pointsInActivePeriod,
  suggestPlan,
  SUGGESTION_INTENSITIES,
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
  // Anchors are effort >= 3, fillers effort <= 2.
  const chores = [
    { id: "big1", name: "Litter", difficulty: 5 },
    { id: "big2", name: "Mop", difficulty: 3 },
    { id: "big3", name: "Fridge", difficulty: 4 },
    { id: "sm1", name: "Counters", difficulty: 1 },
    { id: "sm2", name: "Coffee table", difficulty: 1 },
    { id: "sm3", name: "Dish mat", difficulty: 1 },
    { id: "sm4", name: "Shoes", difficulty: 1 },
    { id: "sm5", name: "Plants", difficulty: 1 },
    { id: "sm6", name: "Trash", difficulty: 2 },
  ];
  const allUrgent = Object.fromEntries(chores.map((c) => [c.id, 1]));
  const anchors = (result) => result.chores.filter((c) => c.difficulty >= 3).length;

  it("returns nothing when there is no gap to close", () => {
    expect(suggestPlan(chores, 0, allUrgent, "mixed")).toBeNull();
    expect(suggestPlan([], 10, allUrgent, "mixed")).toBeNull();
  });

  it("pairs one bigger job with quick wins on Mixed", () => {
    const result = suggestPlan(chores, 10, allUrgent, "mixed");
    expect(anchors(result)).toBe(1);
    expect(result.chores.length).toBeGreaterThan(3);
    expect(result.chores.length).toBeLessThanOrEqual(6);
    expect(result.reachesGap).toBe(true);
  });

  it("never includes a bigger job on Light", () => {
    const result = suggestPlan(chores, 10, allUrgent, "light");
    expect(anchors(result)).toBe(0);
    expect(result.chores.every((c) => c.difficulty <= 2)).toBe(true);
    expect(result.chores.length).toBeLessThanOrEqual(5);
  });

  it("lets a Light plan fall short rather than padding the list", () => {
    // Fillers total 7 across six chores, but Light may only use five of them.
    const result = suggestPlan(chores, 10, allUrgent, "light");
    expect(result.reachesGap).toBe(false);
    expect(result.shortfall).toBe(10 - result.total);
    expect(result.total).toBeLessThan(10);
  });

  it("keeps Heavy short and front-loads the big jobs", () => {
    const result = suggestPlan(chores, 10, allUrgent, "heavy");
    expect(result.chores.length).toBeLessThanOrEqual(3);
    expect(anchors(result)).toBe(3);
    expect(result.reachesGap).toBe(true);
  });

  it("gives Heavy quick chores when there are not enough big ones", () => {
    const mostlySmall = [chores[0], ...chores.slice(3)];
    const urgency = Object.fromEntries(mostlySmall.map((c) => [c.id, 1]));
    const result = suggestPlan(mostlySmall, 7, urgency, "heavy");
    expect(result.chores.length).toBeLessThanOrEqual(3);
    expect(anchors(result)).toBe(1);
    expect(result.chores.length).toBeGreaterThan(1);
  });

  it("is stable for a seed and varies when shuffled", () => {
    const first = suggestPlan(chores, 6, allUrgent, "mixed", 0);
    const again = suggestPlan(chores, 6, allUrgent, "mixed", 0);
    const shuffled = suggestPlan(chores, 6, allUrgent, "mixed", 1);
    expect(first).toEqual(again);
    expect(shuffled.chores.map((c) => c.id)).not.toEqual(first.chores.map((c) => c.id));
  });

  it("prefers due-soon chores, widening only when they cannot reach the gap", () => {
    const urgency = { ...Object.fromEntries(chores.map((c) => [c.id, 0])), big1: 1, sm1: 1, sm2: 1 };
    const easy = suggestPlan(chores, 5, urgency, "mixed");
    expect(easy.chores.every((c) => urgency[c.id] >= 0.75)).toBe(true);

    // Nothing due-soon can reach 20, so the pool widens to everything.
    const widened = suggestPlan(chores, 20, urgency, "mixed");
    expect(widened.chores.some((c) => urgency[c.id] < 0.75)).toBe(true);
  });

  it("falls back to a known intensity when given an unknown one", () => {
    const bogus = suggestPlan(chores, 10, allUrgent, "nonsense");
    const mixed = suggestPlan(chores, 10, allUrgent, "mixed");
    expect(bogus).toEqual(mixed);
  });

  it("exposes exactly the three intensities the UI offers", () => {
    expect(SUGGESTION_INTENSITIES.map((option) => option.id)).toEqual(["light", "mixed", "heavy"]);
  });
});
