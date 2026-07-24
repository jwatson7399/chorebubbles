export const COMPACT_LABEL_MAX_RADIUS = 40;
export const MIN_BUBBLE_HIT_DIAMETER = 44;
const MAX_BUBBLE_RADIUS = 100;

export function clampBubbleRadius(radius) {
  const value = Number(radius);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, MAX_BUBBLE_RADIUS));
}

export function bubbleHitDiameter(radius) {
  return Math.max(MIN_BUBBLE_HIT_DIAMETER, clampBubbleRadius(radius) * 2);
}

export function usesCompactBubbleLabel(radius) {
  return Number(radius) < COMPACT_LABEL_MAX_RADIUS;
}

export function bubblePriority({ importance, urgency, ageDays }) {
  const safeImportance = Math.max(1, Math.min(5, Number(importance) || 1));
  const safeUrgency = Math.max(0, Number(urgency) || 0);
  const safeAgeDays = Math.max(0, Number(ageDays) || 0);
  const importanceScore = ((safeImportance - 1) / 4) * 1.45;
  const overdueScore = Math.log1p(safeUrgency) * 1.25;
  const neglectScore = Math.log1p(safeAgeDays / 7) * 0.35;
  return importanceScore + overdueScore + neglectScore;
}

export function rankBubbleTargets(items, baseRadius) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const scored = items.map((item) => ({
    ...item,
    priority: bubblePriority(item),
  }));
  const priorities = scored.map((item) => item.priority);
  const minPriority = Math.min(...priorities);
  const maxPriority = Math.max(...priorities);
  const spread = maxPriority - minPriority;

  return scored.map((item) => {
    // Relative prominence keeps overdue bubbles visually distinct even after
    // every chore has passed the old absolute urgency ceiling.
    const prominence = spread > 0.001
      ? (item.priority - minPriority) / spread
      : 0.5;
    const urgency = Math.max(0, Number(item.urgency) || 0);
    const overdueGrowth = 0.55 + 0.45 * Math.min(urgency / 1.5, 1);
    const relativeScale = 0.72 + 0.62 * prominence;

    return {
      ...item,
      prominence,
      radius: clampBubbleRadius(Number(baseRadius) * overdueGrowth * relativeScale),
    };
  });
}
