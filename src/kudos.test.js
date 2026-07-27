import { describe, expect, it } from "vitest";
import { applyOperation, normalizeData } from "./dataModel.js";
import {
  choreNamesForKudos,
  kudosFeed,
  newestCompletionTimestamp,
  normalizeKudos,
  unseenCompletions,
  unseenKudos,
} from "./kudos.js";

const completions = [
  { id: "a-new", by: "a", ts: 40, choreId: "d", choreName: "Dishes" },
  { id: "b-old", by: "b", ts: 10, choreId: "b", choreName: "Bins" },
  { id: "b-new", by: "b", ts: 30, choreId: "d", choreName: "Dishes" },
  { id: "joint", by: "joint", ts: 50, choreId: "d", choreName: "Dishes" },
  { id: "service", by: "service", ts: 60, choreId: "d", choreName: "Dishes" },
  { id: "reset", by: "reset", ts: 70, choreId: "d", choreName: "Dishes" },
];

describe("unseen activity", () => {
  it("includes only the other person's newer attributable completions", () => {
    expect(unseenCompletions(completions, "a", 20).map((entry) => entry.id)).toEqual(["b-new"]);
    expect(unseenCompletions(completions, "b", 20).map((entry) => entry.id)).toEqual(["a-new"]);
    expect(unseenCompletions(completions, "a", 30)).toEqual([]);
  });

  it("advances to the newest completion in the shown batch, not the wall clock", () => {
    const shown = unseenCompletions(completions, "a", 0);
    const marker = newestCompletionTimestamp(shown);
    expect(marker).toBe(30);

    const arrivedLater = { id: "arrived", by: "b", ts: 35, choreId: "x", choreName: "Laundry" };
    expect(unseenCompletions([...completions, arrivedLater], "a", marker).map((entry) => entry.id))
      .toEqual(["arrived"]);
  });
});

describe("kudos storage and operations", () => {
  const kudos = { id: "k1", from: "a", to: "b", at: 80, message: "", completionIds: ["b-new"] };

  it("adds a kudos record idempotently", () => {
    const once = applyOperation(normalizeData({}), { type: "kudos:add", kudos, createdAt: 80 });
    const twice = applyOperation(once, { type: "kudos:add", kudos, createdAt: 81 });
    expect(twice.kudos).toEqual([kudos]);
  });

  it("preserves unknown top-level keys while coercing kudos", () => {
    const result = normalizeData({ futureFeature: { safe: true }, kudos: [kudos] });
    expect(result.futureFeature).toEqual({ safe: true });
    expect(result.kudos).toEqual([kudos]);
  });

  it("keeps the 200 most recent records", () => {
    const many = Array.from({ length: 205 }, (_, index) => ({
      id: `k${index}`,
      from: "a",
      to: "b",
      at: index,
      message: "",
      completionIds: [],
    }));
    const normalized = normalizeKudos(many);
    expect(normalized).toHaveLength(200);
    expect(normalized[0].id).toBe("k5");
    expect(normalized.at(-1).id).toBe("k204");
  });

  it("selects unread kudos for the recipient only", () => {
    const items = [
      kudos,
      { ...kudos, id: "k2", from: "b", to: "a", at: 90 },
    ];
    expect(unseenKudos(items, "b", 0).map((entry) => entry.id)).toEqual(["k1"]);
    expect(unseenKudos(items, "a", 80).map((entry) => entry.id)).toEqual(["k2"]);
  });
});

describe("kudos feed", () => {
  const items = [
    { id: "k1", from: "a", to: "b", at: 80, message: "Thanks!", completionIds: ["b-new", "missing"] },
    { id: "k2", from: "b", to: "a", at: 90, message: "", completionIds: ["b-old"] },
  ];

  it("resolves names and omits missing completions", () => {
    expect(choreNamesForKudos(items[0], completions, [])).toEqual(["Dishes"]);
  });

  it("shows both directions newest first and caps the feed", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...items[index % 2],
      id: `feed-${index}`,
      at: index,
    }));
    const feed = kudosFeed(many, completions, [], "a");
    expect(feed).toHaveLength(10);
    expect(feed[0].id).toBe("feed-11");
    expect(new Set(feed.map((entry) => entry.direction))).toEqual(new Set(["given", "received"]));
  });
});
