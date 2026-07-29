import { advanceTwoStepChore } from "./twoStepChore.js";
import { normalizeKudos } from "./kudos.js";

export const defaultData = () => ({
  chores: [],
  completions: [],
  pauses: [],
  kudos: [],
  settings: { nameA: "Julian", nameB: "Kristine", weeklyGoal: 14 },
  updatedAt: 0,
});

export function normalizeData(value) {
  const defaults = defaultData();
  const source = value && typeof value === "object" ? value : {};
  return {
    ...defaults,
    ...source,
    chores: Array.isArray(source.chores) ? source.chores : [],
    completions: Array.isArray(source.completions) ? source.completions : [],
    pauses: Array.isArray(source.pauses) ? source.pauses : [],
    kudos: normalizeKudos(source.kudos),
    settings: { ...defaults.settings, ...(source.settings || {}) },
  };
}

// Operations are intentionally small and replayable. When two phones edit at
// once, each operation is applied to the newest server state instead of either
// phone replacing the other phone's entire snapshot.
export function applyOperation(value, op) {
  const data = normalizeData(value);
  let next = data;

  switch (op.type) {
    case "completion:add": {
      if (data.completions.some((item) => item.id === op.completion.id)) break;
      next = { ...data, completions: [...data.completions, op.completion] };
      break;
    }
    case "completion:add-many": {
      const known = new Set(data.completions.map((item) => item.id));
      next = { ...data, completions: [...data.completions, ...(op.completions || []).filter((item) => !known.has(item.id))] };
      break;
    }
    case "completion:add-and-advance": {
      if (data.completions.some((item) => item.id === op.completion.id)) break;
      const chores = data.chores.map((item) =>
        item.id === op.choreId ? advanceTwoStepChore(item) : item
      );
      next = { ...data, chores, completions: [...data.completions, op.completion] };
      break;
    }
    case "completion:add-and-delete-chore": {
      if (data.completions.some((item) => item.id === op.completion.id)) break;
      if (!data.chores.some((item) => item.id === op.choreId)) break;
      next = {
        ...data,
        chores: data.chores.filter((item) => item.id !== op.choreId),
        completions: [...data.completions, op.completion],
      };
      break;
    }
    case "completion:remove-and-restore": {
      const ids = new Set(op.ids || []);
      const chores = data.chores.map((item) =>
        item.id === op.chore?.id ? op.chore : item
      );
      next = { ...data, chores, completions: data.completions.filter((item) => !ids.has(item.id)) };
      break;
    }
    case "completion:remove-and-restore-chore": {
      const ids = new Set(op.ids || []);
      const exists = data.chores.some((item) => item.id === op.chore?.id);
      next = {
        ...data,
        chores: exists || !op.chore ? data.chores : [...data.chores, op.chore],
        completions: data.completions.filter((item) => !ids.has(item.id)),
      };
      break;
    }
    case "completion:remove": {
      const ids = new Set(op.ids || []);
      next = { ...data, completions: data.completions.filter((item) => !ids.has(item.id)) };
      break;
    }
    case "completion:remove-many-and-restore-chores": {
      const ids = new Set(op.ids || []);
      const known = new Set(data.chores.map((item) => item.id));
      const restored = [];
      for (const chore of op.chores || []) {
        if (!chore?.id || known.has(chore.id)) continue;
        known.add(chore.id);
        restored.push(chore);
      }
      next = {
        ...data,
        chores: [...data.chores, ...restored],
        completions: data.completions.filter((item) => !ids.has(item.id)),
      };
      break;
    }
    case "chore:upsert": {
      const exists = data.chores.some((item) => item.id === op.chore.id);
      const chores = exists
        ? data.chores.map((item) => (item.id === op.chore.id ? op.chore : item))
        : [...data.chores, op.chore];
      next = { ...data, chores };
      break;
    }
    case "chore:add-many": {
      const known = new Set(data.chores.map((item) => item.id));
      next = { ...data, chores: [...data.chores, ...(op.chores || []).filter((item) => !known.has(item.id))] };
      break;
    }
    case "chore:delete":
      next = { ...data, chores: data.chores.filter((item) => item.id !== op.choreId) };
      break;
    case "chore:clear":
      next = { ...data, chores: [] };
      break;
    case "pause:set": {
      let pauses = [...data.pauses];
      const active = pauses.filter((item) => item.scope === op.scope && item.end == null);
      if (op.active && active.length === 0) {
        pauses.push({ id: op.pauseId, scope: op.scope, start: op.at, end: null });
      } else if (!op.active && active.length > 0) {
        const activeIds = new Set(active.map((item) => item.id));
        pauses = pauses.map((item) => (activeIds.has(item.id) ? { ...item, end: op.at } : item));
      }
      next = { ...data, pauses };
      break;
    }
    case "kudos:add": {
      if (data.kudos.some((item) => item.id === op.kudos.id)) break;
      next = { ...data, kudos: normalizeKudos([...data.kudos, op.kudos]) };
      break;
    }
    case "settings:patch":
      next = { ...data, settings: { ...data.settings, ...op.patch } };
      break;
    default:
      break;
  }

  return { ...next, updatedAt: Math.max(next.updatedAt || 0, op.createdAt || 0) };
}
