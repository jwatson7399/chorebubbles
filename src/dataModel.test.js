import { describe, expect, it } from "vitest";
import { applyOperation, defaultData } from "./dataModel.js";

const celebrity = {
  id: "gate",
  type: "celebrity",
  name: "Fix the gate",
  difficulty: 3,
  owner: "joint",
  createdAt: 100,
  dueAt: 200,
};

const completion = {
  id: "done",
  choreId: celebrity.id,
  choreName: celebrity.name,
  difficulty: celebrity.difficulty,
  by: "joint",
  ts: 150,
  celebrityChore: celebrity,
};

describe("celebrity completion operations", () => {
  it("atomically logs completion and removes the one-time chore", () => {
    const data = { ...defaultData(), chores: [celebrity] };
    const result = applyOperation(data, {
      type: "completion:add-and-delete-chore",
      choreId: celebrity.id,
      completion,
      createdAt: 151,
    });

    expect(result.chores).toEqual([]);
    expect(result.completions).toEqual([completion]);
  });

  it("is replay-safe when the same completion operation arrives twice", () => {
    const data = { ...defaultData(), chores: [celebrity] };
    const operation = {
      type: "completion:add-and-delete-chore",
      choreId: celebrity.id,
      completion,
      createdAt: 151,
    };
    const once = applyOperation(data, operation);
    const twice = applyOperation(once, operation);

    expect(twice.chores).toEqual([]);
    expect(twice.completions).toEqual([completion]);
  });

  it("credits only the first phone when two phones complete the same one-time chore", () => {
    const data = { ...defaultData(), chores: [celebrity] };
    const first = applyOperation(data, {
      type: "completion:add-and-delete-chore",
      choreId: celebrity.id,
      completion,
      createdAt: 151,
    });
    const second = applyOperation(first, {
      type: "completion:add-and-delete-chore",
      choreId: celebrity.id,
      completion: { ...completion, id: "done-elsewhere", by: "a" },
      createdAt: 152,
    });

    expect(second.completions).toEqual([completion]);
  });

  it("restores the full chore when its completion is removed", () => {
    const data = { ...defaultData(), completions: [completion] };
    const result = applyOperation(data, {
      type: "completion:remove-and-restore-chore",
      ids: [completion.id],
      chore: celebrity,
      createdAt: 152,
    });

    expect(result.completions).toEqual([]);
    expect(result.chores).toEqual([celebrity]);
  });

  it("does not duplicate an already-restored chore on replay", () => {
    const data = { ...defaultData(), chores: [celebrity], completions: [completion] };
    const result = applyOperation(data, {
      type: "completion:remove-and-restore-chore",
      ids: [completion.id],
      chore: celebrity,
      createdAt: 152,
    });

    expect(result.chores).toEqual([celebrity]);
  });

  it("restores each celebrity chore once when clearing a repeated log history", () => {
    const repeated = { ...completion, id: "done-again" };
    const data = { ...defaultData(), completions: [completion, repeated] };
    const result = applyOperation(data, {
      type: "completion:remove-many-and-restore-chores",
      ids: [completion.id, repeated.id],
      chores: [celebrity, celebrity],
      createdAt: 153,
    });

    expect(result.completions).toEqual([]);
    expect(result.chores).toEqual([celebrity]);
  });
});
