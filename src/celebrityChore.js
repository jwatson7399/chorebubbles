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

export function celebrityOwnerBadge(owner, settings = {}) {
  const a = initial(settings.nameA, "J");
  const b = initial(settings.nameB, "K");
  if (owner === "a") return a;
  if (owner === "b") return b;
  if (owner === "joint") return `${a}+${b}`;
  return `${a} or ${b}`;
}

export function celebrityOwnerLabel(owner, settings = {}) {
  const a = settings.nameA || "Julian";
  const b = settings.nameB || "Kristine";
  if (owner === "a") return a;
  if (owner === "b") return b;
  if (owner === "joint") return `${a} + ${b}`;
  return `${a} or ${b}`;
}

export function celebrityOwnerBackground(owner) {
  if (owner === "a") {
    return "repeating-linear-gradient(135deg, #F3F7FA 0 12px, #6FB9EC 12px 24px)";
  }
  if (owner === "b") {
    return "repeating-linear-gradient(135deg, #F3F7FA 0 12px, #B58AD9 12px 24px)";
  }
  if (owner === "joint") {
    return "repeating-linear-gradient(135deg, #6FB9EC 0 12px, #B58AD9 12px 24px)";
  }
  return "repeating-linear-gradient(135deg, #F3F7FA 0 10px, #6FB9EC 10px 20px, #B58AD9 20px 30px)";
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
