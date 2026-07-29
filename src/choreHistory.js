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

// Effort plus any thaw bonus banked on the record when the chore was completed.
export function completionPoints(entry) {
  const positive = (value) => {
    const points = Number(value);
    return Number.isFinite(points) && points > 0 ? points : 0;
  };
  return positive(entry?.difficulty) + positive(entry?.bonus);
}

export function completionImpact(entry) {
  if (entry?.by === "service" || entry?.by === "reset") return "reset";
  return `+${completionPoints(entry)}${entry?.by === "joint" ? " each" : ""}`;
}
