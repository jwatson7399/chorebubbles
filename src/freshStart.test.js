import { describe, expect, it } from "vitest";
import { FRESH_START_QUIET_MS, boardGotAway, shouldOfferFreshStart } from "./freshStart.js";

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const at = (days = 0) => NOW - days * DAY;

// Created a month ago and never touched since: well past two missed deadlines.
const neglected = (id) => ({ id, name: id, freqDays: 3, importance: 3, difficulty: 2, createdAt: at(30) });
const doneYesterday = (id) => ({ chore: neglected(id), completion: { id: `done-${id}`, choreId: id, by: "a", ts: at(1) } });
const celebrity = (id) => ({ id, name: id, type: "celebrity", createdAt: at(30), dueAt: at(20) });

describe("boardGotAway", () => {
  it("stays quiet with no recurring chores", () => {
    expect(boardGotAway([], [], [], NOW)).toBe(false);
    expect(boardGotAway([celebrity("party")], [], [], NOW)).toBe(false);
  });

  it("stays quiet while most of the board is still moving", () => {
    const fresh = [doneYesterday("b"), doneYesterday("c")];
    const chores = [neglected("a"), ...fresh.map((item) => item.chore)];
    const completions = fresh.map((item) => item.completion);
    expect(boardGotAway(chores, completions, [], NOW)).toBe(false);
  });

  it("speaks up once half the recurring chores have frozen over", () => {
    const fresh = doneYesterday("b");
    expect(boardGotAway([neglected("a"), fresh.chore], [fresh.completion], [], NOW)).toBe(true);
    expect(boardGotAway([neglected("a"), neglected("b"), neglected("c")], [], [], NOW)).toBe(true);
  });

  it("leaves celebrity chores out of the share", () => {
    const fresh = [doneYesterday("b"), doneYesterday("c")];
    const chores = [neglected("a"), ...fresh.map((item) => item.chore), celebrity("x"), celebrity("y")];
    expect(boardGotAway(chores, fresh.map((item) => item.completion), [], NOW)).toBe(false);
  });

  it("is satisfied by a board reset, which thaws every chore", () => {
    const chores = [neglected("a"), neglected("b")];
    const resets = chores.map((chore) => ({ id: `reset-${chore.id}`, choreId: chore.id, by: "reset", ts: NOW }));
    expect(boardGotAway(chores, resets, [], NOW)).toBe(false);
  });

  it("does not count time spent on a household pause", () => {
    const pauses = [{ id: "p", scope: "house", start: at(29), end: null }];
    expect(boardGotAway([neglected("a")], [], pauses, NOW)).toBe(false);
  });
});

describe("shouldOfferFreshStart", () => {
  const frozenBoard = { chores: [neglected("a")], completions: [], pauses: [], at: NOW };

  it("offers on a frozen board this phone has never offered on", () => {
    expect(shouldOfferFreshStart({ ...frozenBoard, lastOfferedAt: null })).toBe(true);
  });

  it("stays quiet for a while after the last offer", () => {
    expect(shouldOfferFreshStart({ ...frozenBoard, lastOfferedAt: NOW - FRESH_START_QUIET_MS + 1 })).toBe(false);
    expect(shouldOfferFreshStart({ ...frozenBoard, lastOfferedAt: NOW - FRESH_START_QUIET_MS })).toBe(true);
  });

  it("offers when health has sunk low even though few chores are frozen", () => {
    const fresh = [doneYesterday("b"), doneYesterday("c")];
    const board = { chores: [neglected("a"), ...fresh.map((item) => item.chore)], completions: fresh.map((item) => item.completion), pauses: [], at: NOW, lastOfferedAt: 0 };
    expect(shouldOfferFreshStart({ ...board, health: 0.15 })).toBe(true);
    expect(shouldOfferFreshStart({ ...board, health: 0.3 })).toBe(false);
  });

  it("never offers on an empty board, whatever the health", () => {
    expect(shouldOfferFreshStart({ chores: [], completions: [], pauses: [], at: NOW, lastOfferedAt: 0, health: 0 })).toBe(false);
  });

  it("never offers on a healthy board", () => {
    const fresh = doneYesterday("a");
    expect(shouldOfferFreshStart({ chores: [fresh.chore], completions: [fresh.completion], pauses: [], at: NOW, lastOfferedAt: 0 })).toBe(false);
  });
});
