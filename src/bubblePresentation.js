export const MIN_BUBBLE_RADIUS = 23;
export const COMPACT_LABEL_MAX_RADIUS = 40;

export function clampBubbleRadius(radius) {
  const value = Number(radius);
  if (!Number.isFinite(value)) return MIN_BUBBLE_RADIUS;
  return Math.max(MIN_BUBBLE_RADIUS, Math.min(value, 100));
}

export function usesCompactBubbleLabel(radius) {
  return Number(radius) < COMPACT_LABEL_MAX_RADIUS;
}
