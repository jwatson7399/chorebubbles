import { describe, expect, it } from "vitest";
import {
  advanceTwoStepChore,
  disableTwoStepChore,
  enableTwoStepChore,
  isTwoStepChore,
  materializeTwoStepChore,
  updateTwoStep,
} from "./twoStepChore.js";

const chore = {
  id: "dish-cycle",
  name: "Load dishwasher",
  importance: 4,
  difficulty: 2,
  freqDays: 2,
  service: false,
};

describe("two-step chores", () => {
  it("creates an editable second step from a normal chore", () => {
    const result = enableTwoStepChore(chore);
    expect(isTwoStepChore(result)).toBe(true);
    expect(result.twoStep.active).toBe(0);
    expect(result.twoStep.steps).toEqual([
      { name: "Load dishwasher", importance: 4, difficulty: 2, freqDays: 2 },
      { name: "Next step", importance: 4, difficulty: 2, freqDays: 2 },
    ]);
  });

  it("keeps independent settings and materializes only the active step", () => {
    const edited = updateTwoStep(enableTwoStepChore(chore), 1, {
      name: "Unload dishwasher",
      importance: 3,
      difficulty: 1,
      freqDays: 1,
    });
    const advanced = advanceTwoStepChore(edited);
    expect(advanced).toMatchObject({
      name: "Unload dishwasher",
      importance: 3,
      difficulty: 1,
      freqDays: 1,
    });
    expect(advanced.twoStep.active).toBe(1);
    expect(advanceTwoStepChore(advanced).name).toBe("Load dishwasher");
  });

  it("preserves independent details and projects the active step", () => {
    const edited = updateTwoStep(
      updateTwoStep(enableTwoStepChore(chore), 0, { details: "  Load every cup.  " }),
      1,
      { name: "Unload dishwasher", details: "Put everything away." }
    );

    const first = materializeTwoStepChore(edited, 0);
    expect(first.details).toBe("Load every cup.");
    expect(first.twoStep.steps[0].details).toBe("Load every cup.");
    expect(first.twoStep.steps[1].details).toBe("Put everything away.");

    const second = materializeTwoStepChore(edited, 1);
    expect(second.details).toBe("Put everything away.");
    expect(advanceTwoStepChore(second).details).toBe("Load every cup.");
  });

  it("does not add a details property when neither step has details", () => {
    const materialized = materializeTwoStepChore(enableTwoStepChore(chore));
    expect(materialized.details).toBeUndefined();
    expect(materialized.twoStep.steps.every((step) => !("details" in step))).toBe(true);
  });

  it("preserves in-progress step names until save-time normalization", () => {
    const withTrailingSpace = updateTwoStep(enableTwoStepChore(chore), 0, {
      name: "Load ",
    });
    expect(withTrailingSpace.name).toBe("Load ");
    expect(withTrailingSpace.twoStep.steps[0].name).toBe("Load ");

    const cleared = updateTwoStep(withTrailingSpace, 0, { name: "" });
    expect(cleared.name).toBe("");
    expect(cleared.twoStep.steps[0].name).toBe("");
    expect(materializeTwoStepChore(cleared).name).toBe("Step 1");
  });

  it("normalizes invalid stored values and can return to a normal chore", () => {
    const malformed = {
      ...chore,
      twoStep: {
        enabled: true,
        active: 1,
        steps: [
          { name: "", importance: 99, difficulty: 0, freqDays: -2 },
          { name: "Clear mat", importance: 2, difficulty: 1, freqDays: 1 },
        ],
      },
    };
    const normalized = materializeTwoStepChore(malformed);
    expect(normalized.twoStep.steps[0]).toEqual({
      name: "Step 1",
      importance: 5,
      difficulty: 2,
      freqDays: 7,
    });
    expect(disableTwoStepChore(normalized)).toMatchObject({
      name: "Clear mat",
      importance: 2,
      difficulty: 1,
      freqDays: 1,
    });
  });
});

describe("two-step details isolation", () => {
  const chore = () => ({
    id: "c", name: "Dishwasher", importance: 3, difficulty: 2, freqDays: 2,
    twoStep: { enabled: true, active: 0, steps: [
      { name: "Load", importance: 3, difficulty: 2, freqDays: 2, details: "scrape plates first" },
      { name: "Unload", importance: 3, difficulty: 1, freqDays: 2 },
    ] },
  });

  it("does not leak one step's details onto a step that has none", () => {
    // materializeTwoStepChore projects {...chore, ...step}. If the step object
    // omits `details` when empty, the previous step's text survives onto it.
    const onStepTwo = materializeTwoStepChore(chore(), 1);
    expect(onStepTwo.name).toBe("Unload");
    expect(onStepTwo.details).toBeUndefined();
    expect("details" in onStepTwo).toBe(false);
  });

  it("projects each step's own details when active", () => {
    expect(materializeTwoStepChore(chore(), 0).details).toBe("scrape plates first");
    expect(materializeTwoStepChore(chore(), 1).details).toBeUndefined();
  });

  it("keeps both steps' details stored independently", () => {
    const both = { ...chore() };
    both.twoStep.steps[1] = { ...both.twoStep.steps[1], details: "put away, wipe rack" };
    const m = materializeTwoStepChore(both, 0);
    expect(m.twoStep.steps[0].details).toBe("scrape plates first");
    expect(m.twoStep.steps[1].details).toBe("put away, wipe rack");
  });
});
