import { describe, expect, it } from "vitest";
import {
  choreHistoryFor,
  completionActor,
  completionImpact,
  lastDoneLabel,
} from "./choreHistory.js";

describe("chore history", () => {
  const settings = { nameA: "Julian", nameB: "Kristine" };

  it("filters to one chore and orders newest first without mutating input", () => {
    const entries = [
      { id: "old", choreId: "dishes", by: "a", ts: 10 },
      { id: "other", choreId: "laundry", by: "b", ts: 30 },
      { id: "new", choreId: "dishes", by: "joint", ts: 20 },
    ];
    expect(choreHistoryFor(entries, "dishes").map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(entries.map((entry) => entry.id)).toEqual(["old", "other", "new"]);
  });

  it("formats household actors and last-done language", () => {
    expect(completionActor({ by: "a" }, settings)).toBe("Julian");
    expect(completionActor({ by: "b" }, settings)).toBe("Kristine");
    expect(lastDoneLabel({ by: "joint" }, settings)).toBe("Last done together");
    expect(lastDoneLabel(null, settings)).toBe("Not done yet");
  });

  it("distinguishes resets from credited completions", () => {
    expect(lastDoneLabel({ by: "service" }, settings)).toBe("Last reset by cleaning service");
    expect(lastDoneLabel({ by: "reset" }, settings)).toBe("Last reset when caught up");
    expect(completionImpact({ by: "service", difficulty: 3 })).toBe("reset");
    expect(completionImpact({ by: "joint", difficulty: 3 })).toBe("+3 each");
  });
});
