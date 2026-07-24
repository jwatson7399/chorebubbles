const CREDITED_ACTORS = new Set(["a", "b", "joint"]);

export function creditedCompletionIds(completions) {
  return new Set(
    (completions || [])
      .filter((completion) => CREDITED_ACTORS.has(completion.by))
      .map((completion) => completion.id)
      .filter(Boolean)
  );
}

export function shouldPulseHealth(previousScore, nextScore, previousCompletionIds, completions) {
  if (previousScore == null || previousCompletionIds == null) return false;

  const scoreRose = Number(nextScore) > Number(previousScore) + Number.EPSILON;
  const currentIds = creditedCompletionIds(completions);
  const hasNewCreditedCompletion = [...currentIds].some((id) => !previousCompletionIds.has(id));

  return scoreRose || hasNewCreditedCompletion;
}
