export function choreHistoryFor(completions, choreId) {
  if (!choreId) return [];
  return (completions || [])
    .filter((entry) => entry?.choreId === choreId && Number.isFinite(Number(entry.ts)))
    .sort((a, b) => Number(b.ts) - Number(a.ts));
}

export function completionActor(entry, settings = {}) {
  if (entry?.by === "a") return settings.nameA || "Person A";
  if (entry?.by === "b") return settings.nameB || "Person B";
  if (entry?.by === "joint") return "Together";
  if (entry?.by === "service") return "Cleaning service";
  if (entry?.by === "reset") return "Board reset";
  return "Unknown";
}

export function lastDoneLabel(entry, settings = {}) {
  if (!entry) return "Not done yet";
  if (entry.by === "service") return "Last reset by cleaning service";
  if (entry.by === "reset") return "Last reset when caught up";
  if (entry.by === "joint") return "Last done together";
  return `Last done by ${completionActor(entry, settings)}`;
}

export function completionImpact(entry) {
  if (entry?.by === "service" || entry?.by === "reset") return "reset";
  const effort = Number(entry?.difficulty);
  const points = Number.isFinite(effort) && effort > 0 ? effort : 0;
  return `+${points}${entry?.by === "joint" ? " each" : ""}`;
}
