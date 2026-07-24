function stepFromChore(chore, fallbackName) {
  const rawFrequency = Number(chore?.freqDays);
  return {
    name: String(chore?.name || fallbackName).trim() || fallbackName,
    importance: Math.max(1, Math.min(5, Number(chore?.importance) || 3)),
    difficulty: Math.max(1, Math.min(5, Number(chore?.difficulty) || 2)),
    freqDays: Number.isFinite(rawFrequency) && rawFrequency > 0
      ? Math.max(1, Math.min(60, rawFrequency))
      : 7,
  };
}

export function isTwoStepChore(chore) {
  return chore?.twoStep?.enabled === true && Array.isArray(chore.twoStep.steps) && chore.twoStep.steps.length === 2;
}

export function materializeTwoStepChore(chore, active = chore?.twoStep?.active || 0) {
  if (!isTwoStepChore(chore)) return chore;
  const index = active === 1 ? 1 : 0;
  const steps = [
    stepFromChore(chore.twoStep.steps[0], "Step 1"),
    stepFromChore(chore.twoStep.steps[1], "Step 2"),
  ];
  return {
    ...chore,
    ...steps[index],
    twoStep: { enabled: true, active: index, steps },
  };
}

export function enableTwoStepChore(chore) {
  if (isTwoStepChore(chore)) return chore;
  const first = stepFromChore(chore, "Step 1");
  const second = { ...first, name: "Next step" };
  return materializeTwoStepChore({
    ...chore,
    twoStep: { enabled: true, active: 0, steps: [first, second] },
  });
}

export function disableTwoStepChore(chore) {
  if (!isTwoStepChore(chore)) return chore;
  const active = chore.twoStep.active === 1 ? 1 : 0;
  const current = stepFromChore(chore.twoStep.steps[active], chore.name || "Chore");
  const { twoStep: _removed, ...rest } = chore;
  return { ...rest, ...current };
}

export function updateTwoStep(chore, index, patch) {
  const enabled = enableTwoStepChore(chore);
  const stepIndex = index === 1 ? 1 : 0;
  const steps = enabled.twoStep.steps.map((step, current) =>
    current === stepIndex ? { ...step, ...patch } : step
  );
  const active = enabled.twoStep.active === 1 ? 1 : 0;
  return {
    ...enabled,
    ...steps[active],
    twoStep: { ...enabled.twoStep, active, steps },
  };
}

export function advanceTwoStepChore(chore) {
  if (!isTwoStepChore(chore)) return chore;
  return materializeTwoStepChore(chore, chore.twoStep.active === 1 ? 0 : 1);
}
