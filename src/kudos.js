const person = (value) => (value === "a" || value === "b" ? value : null);
const timestamp = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

export function otherPerson(me) {
  return me === "b" ? "a" : "b";
}

export function unseenCompletions(completions, me, seenThrough = 0) {
  const other = otherPerson(me);
  const boundary = timestamp(seenThrough);
  return (completions || [])
    .filter((entry) => entry?.by === other && timestamp(entry.ts) > boundary)
    .slice()
    .sort((a, b) => timestamp(b.ts) - timestamp(a.ts));
}

export function unseenKudos(kudos, me, seenThrough = 0) {
  const boundary = timestamp(seenThrough);
  return (kudos || [])
    .filter((entry) => entry?.to === me && timestamp(entry.at) > boundary)
    .slice()
    .sort((a, b) => timestamp(b.at) - timestamp(a.at));
}

export function newestCompletionTimestamp(completions, fallback = 0) {
  return (completions || []).reduce(
    (latest, entry) => Math.max(latest, timestamp(entry?.ts)),
    timestamp(fallback)
  );
}

export function newestKudosTimestamp(kudos, fallback = 0) {
  return (kudos || []).reduce(
    (latest, entry) => Math.max(latest, timestamp(entry?.at)),
    timestamp(fallback)
  );
}

export function normalizeKudosMessage(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export function normalizeKudos(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      message: normalizeKudosMessage(entry.message),
      completionIds: Array.isArray(entry.completionIds) ? entry.completionIds : [],
    }))
    .sort((a, b) => timestamp(a.at) - timestamp(b.at))
    .slice(-200);
}

export function kudosForPerson(kudos, me) {
  return (kudos || [])
    .filter((entry) => entry?.to === me)
    .slice()
    .sort((a, b) => timestamp(b.at) - timestamp(a.at));
}

export function choreNamesForKudos(kudos, completions, chores) {
  const completionsById = new Map((completions || []).map((entry) => [entry.id, entry]));
  const choresById = new Map((chores || []).map((chore) => [chore.id, chore]));
  const names = [];

  for (const id of kudos?.completionIds || []) {
    const completion = completionsById.get(id);
    if (!completion) continue;
    const name = completion.choreName || choresById.get(completion.choreId)?.name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function kudosFeed(kudos, completions, chores, me, limit = 10) {
  return (kudos || [])
    .filter((entry) => person(entry?.from) && person(entry?.to) && (entry.from === me || entry.to === me))
    .slice()
    .sort((a, b) => timestamp(b.at) - timestamp(a.at))
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      direction: entry.from === me ? "given" : "received",
      choreNames: choreNamesForKudos(entry, completions, chores),
    }));
}
