import { describe, expect, it } from "vitest";
import {
  CELEBRITY_BUBBLE_BACKGROUND,
  DAY_MS,
  celebrityChoreForSave,
  celebrityCompletionOrder,
  celebrityDueDaysForForm,
  celebrityOwnerBadgeParts,
  celebritySpotlight,
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

  it("gives a sole owner their initial alone", () => {
    expect(celebrityOwnerBadgeParts("a", settings)).toEqual([{ text: "J", tone: "a" }]);
    expect(celebrityOwnerBadgeParts("b", settings)).toEqual([{ text: "K", tone: "b" }]);
  });

  it("separates shared ownership so each initial keeps its own person tint", () => {
    expect(celebrityOwnerBadgeParts("joint", settings)).toEqual([
      { text: "J", tone: "a" },
      { text: "+", tone: "muted" },
      { text: "K", tone: "b" },
    ]);
    expect(celebrityOwnerBadgeParts("either", settings)).toEqual([
      { text: "J", tone: "a" },
      { text: "/", tone: "muted" },
      { text: "K", tone: "b" },
    ]);
  });

  it("falls back to J and K when the household has not been named", () => {
    expect(celebrityOwnerBadgeParts("joint", {})).toEqual([
      { text: "J", tone: "a" },
      { text: "+", tone: "muted" },
      { text: "K", tone: "b" },
    ]);
  });

  // Ownership now rides on text, not on the fill, so the fill is free to do the
  // one job it can do at any size: mark the chore as celebrity. It must stay
  // clear of the pastel band every decorative bubble lives in (bubbleHue, L=68%),
  // otherwise a random chore hue can impersonate a celebrity chore.
  it("fills celebrity bubbles far darker than the decorative pastel field", () => {
    const stops = CELEBRITY_BUBBLE_BACKGROUND.match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(stops.length).toBeGreaterThan(1);
    const lightness = (hex) => {
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return (Math.max(...channels) + Math.min(...channels)) / 2;
    };
    expect(Math.max(...stops.map(lightness))).toBeLessThan(0.45);
  });

  // Overdue must keep the spotlight rather than swap to a different effect, so
  // the celebrity identity survives exactly when the chore matters most. Only
  // the colour and the tempo are allowed to change.
  it("keeps one spotlight mechanism and only shifts its colour and tempo", () => {
    const calm = celebritySpotlight(false);
    const late = celebritySpotlight(true);
    expect(Object.keys(late).sort()).toEqual(Object.keys(calm).sort());
    expect(late.rgb).not.toBe(calm.rgb);
    expect(late.seconds).toBeLessThan(calm.seconds);
  });

  it("keeps the spotlight ring dim so the travelling light stays the brightest thing", () => {
    const luminance = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(celebritySpotlight(false).ring)).toBeLessThan(0.4);
    expect(luminance(celebritySpotlight(true).ring)).toBeLessThan(0.4);
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
      details: "  Tighten the latch and test both hinges.  ",
      importance: 5,
      freqDays: 9,
      service: true,
    }, NOW);

    expect(saved).toEqual({
      type: "celebrity",
      name: "Fix gate",
      details: "Tighten the latch and test both hinges.",
      difficulty: 4,
      owner: "joint",
      createdAt: NOW,
      dueAt: NOW + 3 * DAY_MS,
    });
    expect(celebrityDueDaysForForm(saved, NOW)).toBe(3);
  });
});
