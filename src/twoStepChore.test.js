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
