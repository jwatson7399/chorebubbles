import { describe, expect, it } from "vitest";
import { creditedCompletionIds, shouldPulseHealth } from "./healthPulse.js";

const completion = (id, by) => ({ id, by });

describe("home health pulse", () => {
  it("does not pulse while seeding the initial household state", () => {
    expect(shouldPulseHealth(null, 0.75, null, [completion("old", "a")])).toBe(false);
  });

  it.each(["a", "b", "joint"])("pulses for a newly observed %s completion", (by) => {
    const previousIds = creditedCompletionIds([completion("old", "a")]);
    const completions = [completion("old", "a"), completion("new", by)];

    // The rounded percentage can remain unchanged; the completion should still
    // give immediate feedback on either phone.
    expect(shouldPulseHealth(0.754, 0.7544, previousIds, completions)).toBe(true);
  });

  it("does not treat service or board-reset records as credited completions", () => {
    const previousIds = creditedCompletionIds([completion("old", "a")]);
    const completions = [
      completion("old", "a"),
      completion("service", "service"),
      completion("reset", "reset"),
    ];

    expect(shouldPulseHealth(0.75, 0.75, previousIds, completions)).toBe(false);
  });

  it("still pulses when the score rises for another reason", () => {
    expect(shouldPulseHealth(0.6, 0.7, new Set(), [])).toBe(true);
  });
});
