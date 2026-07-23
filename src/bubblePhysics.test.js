import { describe, expect, it, vi } from "vitest";
import { forceSimulation, forceX, forceY } from "d3";
import { clampBubbleCenter, releaseBubbleNode } from "./bubblePhysics.js";

describe("bubble drag physics", () => {
  it("keeps the dragged center within the visible field", () => {
    expect(clampBubbleCenter(-20, 390, 30)).toBe(34);
    expect(clampBubbleCenter(500, 390, 30)).toBe(356);
    expect(clampBubbleCenter(180, 390, 30)).toBe(180);
  });

  it("unpins and reheats a moved bubble on release", () => {
    const node = { x: 40, y: 120, vx: 0, vy: 0, fx: 40, fy: 120 };
    const simulation = {
      alpha: vi.fn(() => 0.01),
      alphaTarget: vi.fn(),
      restart: vi.fn(),
    };
    simulation.alphaTarget.mockReturnValue(simulation);
    simulation.alpha = vi.fn((value) => {
      if (value == null) return 0.01;
      return simulation;
    });

    releaseBubbleNode(
      node,
      { moved: true, velocityX: 0, velocityY: 0 },
      { w: 390, h: 600 },
      simulation
    );

    expect(node.fx).toBeNull();
    expect(node.fy).toBeNull();
    expect(node.vx).toBeGreaterThan(0);
    expect(node.vy).toBeGreaterThan(0);
    expect(simulation.alphaTarget).toHaveBeenCalledWith(0);
    expect(simulation.alpha).toHaveBeenCalledWith(0.38);
    expect(simulation.restart).toHaveBeenCalledOnce();
  });

  it("also unpins an interrupted tap without opening momentum", () => {
    const node = { fx: 100, fy: 100 };
    const simulation = { alphaTarget: vi.fn() };
    releaseBubbleNode(node, { moved: false }, { w: 390, h: 600 }, simulation);
    expect(node.fx).toBeNull();
    expect(node.fy).toBeNull();
    expect(simulation.alphaTarget).toHaveBeenCalledWith(0);
  });

  it("moves a released edge bubble back toward the field center", () => {
    const size = { w: 390, h: 600 };
    const node = { x: 40, y: 90, vx: 0, vy: 0, fx: 40, fy: 90 };
    const simulation = forceSimulation([node])
      .force("x", forceX(size.w / 2).strength(0.035))
      .force("y", forceY(size.h / 2).strength(0.042))
      .velocityDecay(0.28)
      .alpha(0.001)
      .stop();
    const before = Math.hypot(node.x - size.w / 2, node.y - size.h / 2);

    releaseBubbleNode(
      node,
      { moved: true, velocityX: 0, velocityY: 0 },
      size,
      simulation
    );
    simulation.stop();
    for (let tick = 0; tick < 30; tick++) simulation.tick();

    const after = Math.hypot(node.x - size.w / 2, node.y - size.h / 2);
    expect(node.fx).toBeNull();
    expect(node.fy).toBeNull();
    expect(after).toBeLessThan(before * 0.7);
  });
});
