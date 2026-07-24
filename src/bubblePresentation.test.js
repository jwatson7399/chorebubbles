import { describe, expect, it } from "vitest";
import {
  COMPACT_LABEL_MAX_RADIUS,
  MIN_BUBBLE_RADIUS,
  clampBubbleRadius,
  usesCompactBubbleLabel,
} from "./bubblePresentation.js";

describe("bubble presentation", () => {
  it("keeps every bubble at least 60 pixels across", () => {
    expect(clampBubbleRadius(17)).toBe(MIN_BUBBLE_RADIUS);
    expect(MIN_BUBBLE_RADIUS * 2).toBe(60);
    expect(clampBubbleRadius(72)).toBe(72);
    expect(clampBubbleRadius(140)).toBe(100);
  });

  it("uses compact labels below the large-bubble threshold", () => {
    expect(usesCompactBubbleLabel(MIN_BUBBLE_RADIUS)).toBe(true);
    expect(usesCompactBubbleLabel(COMPACT_LABEL_MAX_RADIUS - 0.1)).toBe(true);
    expect(usesCompactBubbleLabel(COMPACT_LABEL_MAX_RADIUS)).toBe(false);
  });
});
