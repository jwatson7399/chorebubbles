import { describe, expect, it } from "vitest";
import {
  COMPACT_LABEL_MAX_RADIUS,
  MIN_BUBBLE_RADIUS,
  bubblePriority,
  clampBubbleRadius,
  rankBubbleTargets,
  usesCompactBubbleLabel,
} from "./bubblePresentation.js";

describe("bubble presentation", () => {
  it("keeps every bubble at least 46 pixels across", () => {
    expect(clampBubbleRadius(17)).toBe(MIN_BUBBLE_RADIUS);
    expect(MIN_BUBBLE_RADIUS * 2).toBe(46);
    expect(clampBubbleRadius(72)).toBe(72);
    expect(clampBubbleRadius(140)).toBe(100);
  });

  it("uses compact labels below the large-bubble threshold", () => {
    expect(usesCompactBubbleLabel(MIN_BUBBLE_RADIUS)).toBe(true);
    expect(usesCompactBubbleLabel(COMPACT_LABEL_MAX_RADIUS - 0.1)).toBe(true);
    expect(usesCompactBubbleLabel(COMPACT_LABEL_MAX_RADIUS)).toBe(false);
  });

  it("keeps deeply overdue bubbles different sizes by relative priority", () => {
    const targets = rankBubbleTargets([
      { id: "low", importance: 1, urgency: 8, ageDays: 16 },
      { id: "medium", importance: 3, urgency: 8, ageDays: 16 },
      { id: "critical-old", importance: 5, urgency: 8, ageDays: 30 },
    ], 58);
    const byId = Object.fromEntries(targets.map((item) => [item.id, item]));

    expect(byId["critical-old"].radius).toBeGreaterThan(byId.medium.radius);
    expect(byId.medium.radius).toBeGreaterThan(byId.low.radius);
    expect(new Set(targets.map((item) => Math.round(item.radius))).size).toBe(3);
    expect(byId["critical-old"].prominence).toBe(1);
  });

  it("uses both importance and time since completion in priority", () => {
    expect(bubblePriority({ importance: 5, urgency: 2, ageDays: 14 }))
      .toBeGreaterThan(bubblePriority({ importance: 2, urgency: 2, ageDays: 14 }));
    expect(bubblePriority({ importance: 3, urgency: 2, ageDays: 28 }))
      .toBeGreaterThan(bubblePriority({ importance: 3, urgency: 2, ageDays: 7 }));
  });

  it("gives genuinely equal chores equal prominence and size", () => {
    const targets = rankBubbleTargets([
      { id: "a", importance: 3, urgency: 2, ageDays: 14 },
      { id: "b", importance: 3, urgency: 2, ageDays: 14 },
    ], 60);

    expect(targets[0].prominence).toBe(0.5);
    expect(targets[0].radius).toBe(targets[1].radius);
  });
});
