import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  celebrityBadgeLabel,
  celebrityChoreForSave,
  celebrityCompletionOrder,
  celebrityDueDaysForForm,
  celebrityOwnerBadge,
  celebrityTiming,
  isCelebrityChore,
  isPreferredCelebrityActor,
  recurringChores,
} from "./celebrityChore.js";

const NOW = Date.UTC(2026, 6, 29, 12);

describe("celebrity chore timing", () => {
  it("grows from creation to a capped deadline using calendar time", () => {
    const chore = { type: "celebrity", createdAt: NOW, dueAt: NOW + 4 * DAY_MS };
    expect(celebrityTiming(chore, NOW).progress).toBe(0);
    expect(celebrityTiming(chore, NOW + 2 * DAY_MS).progress).toBeCloseTo(0.5);
    expect(celebrityTiming(chore, NOW + 8 * DAY_MS).progress).toBe(1);
  });

  it("labels upcoming, due, and overdue deadlines", () => {
    const chore = { createdAt: NOW, dueAt: NOW + 7 * DAY_MS };
    expect(celebrityTiming(chore, NOW).shortLabel).toBe("7d");
    expect(celebrityTiming(chore, chore.dueAt).shortLabel).toBe("Today");
    expect(celebrityTiming(chore, chore.dueAt + 2 * DAY_MS).shortLabel).toBe("2d late");
  });
});

describe("celebrity chore ownership", () => {
  const settings = { nameA: "Julian", nameB: "Kristine" };

  it("uses the approved compact ownership labels", () => {
    expect(celebrityOwnerBadge("a", settings)).toBe("J");
    expect(celebrityOwnerBadge("joint", settings)).toBe("J+K");
    expect(celebrityOwnerBadge("b", settings)).toBe("K");
    expect(celebrityOwnerBadge("either", settings)).toBe("J or K");
  });

  it("combines ownership and time with a centered dot", () => {
    const chore = { owner: "b", createdAt: NOW, dueAt: NOW + 7 * DAY_MS };
    expect(celebrityBadgeLabel(chore, settings, NOW)).toBe("K · 7d");
  });

  it("puts the assigned completion action first but keeps escape hatches", () => {
    expect(celebrityCompletionOrder({ owner: "joint" }, "a")).toEqual(["joint", "a", "b"]);
    expect(celebrityCompletionOrder({ owner: "b" }, "a")).toEqual(["b", "a", "joint"]);
    expect(celebrityCompletionOrder({ owner: "either" }, "b")).toEqual(["b", "a", "joint"]);
    expect(isPreferredCelebrityActor({ type: "celebrity", owner: "either" }, "a")).toBe(true);
    expect(isPreferredCelebrityActor({ type: "celebrity", owner: "joint" }, "a")).toBe(false);
  });
});

describe("celebrity chore data", () => {
  it("keeps celebrity chores separate from recurring calculations", () => {
    const celebrity = { id: "one", type: "celebrity" };
    const recurring = { id: "repeat" };
    expect(isCelebrityChore(celebrity)).toBe(true);
    expect(recurringChores([celebrity, recurring])).toEqual([recurring]);
  });

  it("normalizes the focused form without recurring-only fields", () => {
    const saved = celebrityChoreForSave({
      name: "  Fix gate  ",
      difficulty: 4,
      owner: "joint",
      dueDays: 3,
      importance: 5,
      freqDays: 9,
      service: true,
    }, NOW);

    expect(saved).toEqual({
      type: "celebrity",
      name: "Fix gate",
      details: "",
      difficulty: 4,
      owner: "joint",
      createdAt: NOW,
      dueAt: NOW + 3 * DAY_MS,
    });
    expect(celebrityDueDaysForForm(saved, NOW)).toBe(3);
  });
});
