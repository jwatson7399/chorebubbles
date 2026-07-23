export function clampBubbleCenter(value, containerSize, radius, padding = 4) {
  const min = radius + padding;
  const max = containerSize - radius - padding;
  return Math.max(min, Math.min(max, value));
}

export function releaseBubbleNode(node, drag, size, simulation) {
  node.fx = null;
  node.fy = null;

  if (!drag.moved) {
    if (simulation) simulation.alphaTarget(0);
    return;
  }

  const inwardX = (size.w / 2 - node.x) * 0.028;
  const inwardY = (size.h / 2 - node.y) * 0.032;
  node.vx = Math.max(-11, Math.min(11, drag.velocityX * 0.55 + inwardX));
  node.vy = Math.max(-11, Math.min(11, drag.velocityY * 0.55 + inwardY));

  if (simulation) {
    simulation
      .alphaTarget(0)
      .alpha(Math.max(simulation.alpha(), 0.38))
      .restart();
  }
}
