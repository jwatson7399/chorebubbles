export const CELEBRITY_CHORE_TYPE = "celebrity";
export const CELEBRITY_OWNERS = ["a", "joint", "b", "either"];
export const DAY_MS = 86400000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function isCelebrityChore(chore) {
  return chore?.type === CELEBRITY_CHORE_TYPE;
}

export function recurringChores(chores) {
  return (Array.isArray(chores) ? chores : []).filter((chore) => !isCelebrityChore(chore));
}

export function celebrityTiming(chore, at = Date.now()) {
  const createdAt = Number(chore?.createdAt);
  const dueAt = Number(chore?.dueAt);
  const validCreatedAt = Number.isFinite(createdAt) ? createdAt : at;
  const validDueAt = Number.isFinite(dueAt) ? dueAt : validCreatedAt + DAY_MS;
  const duration = Math.max(DAY_MS, validDueAt - validCreatedAt);
  const progress = clamp((at - validCreatedAt) / duration, 0, 1);
  const remaining = validDueAt - at;
  const overdue = remaining < 0;

  if (overdue) {
    const days = Math.max(1, Math.ceil(Math.abs(remaining) / DAY_MS));
    return {
      progress: 1,
      overdue: true,
      shortLabel: `${days}d late`,
      longLabel: `${days} day${days === 1 ? "" : "s"} overdue`,
    };
  }

  const days = Math.ceil(remaining / DAY_MS);
  return {
    progress,
    overdue: false,
    shortLabel: days <= 0 ? "Today" : `${days}d`,
    longLabel: days <= 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`,
  };
}

const initial = (name, fallback) => {
  const value = String(name || "").trim();
  return value ? value[0].toUpperCase() : fallback;
};

// Ownership is spelled with initials tinted in each person's colour, so it has
// to travel as segments rather than as one string.
export function celebrityOwnerBadgeParts(owner, settings = {}) {
  const a = { text: initial(settings.nameA, "J"), tone: "a" };
  const b = { text: initial(settings.nameB, "K"), tone: "b" };
  if (owner === "a") return [a];
  if (owner === "b") return [b];
  return [a, { text: owner === "joint" ? "+" : "/", tone: "muted" }, b];
}

export function celebrityOwnerLabel(owner, settings = {}) {
  const a = settings.nameA || "Julian";
  const b = settings.nameB || "Kristine";
  if (owner === "a") return a;
  if (owner === "b") return b;
  if (owner === "joint") return `${a} + ${b}`;
  return `${a} or ${b}`;
}

// Celebrity chores are the only dark bubbles on the field. That is a value
// shift, not a hue shift, so no decorative bubbleHue() pastel can collide with
// it, and unlike stripes it still reads at a 14px radius.
export const CELEBRITY_BUBBLE_BACKGROUND =
  "radial-gradient(circle at 32% 30%, #2E5F76, #17313F 62%, #0E2029)";

// Label ink flips to light on that dark fill.
export const CELEBRITY_INK = "#EAF6FA";

// The spotlight is a moving light *source*, not a ring: a specular glint travels
// the rim while a warm wash tracks it across the orb's own surface, so the bubble
// reads as lit rather than as wearing a halo. Radially symmetric on purpose — a
// stage spotlight needs a floor for its pool and a fixed "up" for its beam, and
// this field is a floorless void with algorithmic, drag-anywhere placement.
// Overdue keeps the identical mechanism and only shifts colour and tempo, so the
// celebrity identity survives exactly when the chore matters most.
export function celebritySpotlight(overdue) {
  return overdue
    ? { rgb: "255,77,97", seconds: 2, ring: "#8A3340", clockInk: "#FF8A9B" }
    : { rgb: "255,212,94", seconds: 4.6, ring: "#7A5C1E", clockInk: "#7FA3AC" };
}

export function celebrityDueDaysForForm(chore, at = Date.now()) {
  const dueAt = Number(chore?.dueAt);
  if (!Number.isFinite(dueAt)) return 3;
  return clamp(Math.max(1, Math.ceil((dueAt - at) / DAY_MS)), 1, 60);
}

export function celebrityChoreForSave(chore, at = Date.now()) {
  const createdAt = Number(chore?.createdAt);
  const dueAt = Number(chore?.dueAt);
  const dueDays = clamp(Math.round(Number(chore?.dueDays) || 3), 1, 60);
  const owner = CELEBRITY_OWNERS.includes(chore?.owner) ? chore.owner : "either";
  const difficulty = clamp(Math.round(Number(chore?.difficulty) || 2), 1, 5);

  return {
    ...(chore?.id ? { id: chore.id } : {}),
    type: CELEBRITY_CHORE_TYPE,
    name: String(chore?.name || "").trim(),
    details: String(chore?.details || "").trim().slice(0, 500),
    difficulty,
    owner,
    createdAt: Number.isFinite(createdAt) ? createdAt : at,
    dueAt: Number.isFinite(dueAt) ? dueAt : at + dueDays * DAY_MS,
  };
}

export function celebrityCompletionOrder(chore, me = "a") {
  const other = me === "b" ? "a" : "b";
  const all = [me, other, "joint"];
  if (chore?.owner === "joint") return ["joint", me, other];
  if (chore?.owner === "a") return ["a", "b", "joint"];
  if (chore?.owner === "b") return ["b", "a", "joint"];
  return all;
}

export function isPreferredCelebrityActor(chore, actor) {
  if (!isCelebrityChore(chore)) return false;
  if (chore.owner === "either") return actor === "a" || actor === "b";
  return chore.owner === actor;
}
