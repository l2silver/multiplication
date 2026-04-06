/** Baseline points per correct answer (fact not in “difficult” state). */
export const POINT_BASE = 0.1;
/** After a wrong or timeout on a fact, the next correct on that fact earns this much. */
export const POINT_PEAK = 0.2;
/**
 * Each time you answer a fact correctly, its weight moves from PEAK toward BASE by this factor
 * applied on the excess over BASE (exponential decay).
 */
export const POINT_WEIGHT_DECAY = 0.78;

const WEIGHT_EPS = 1e-9;

function clampWeight(x: number): number {
  return Math.min(POINT_PEAK, Math.max(POINT_BASE, x));
}

function quantizeWeight(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function rewardWeightForFact(
  factRewardWeight: Record<string, number> | undefined,
  factKey: string,
): number {
  const w = factRewardWeight?.[factKey];
  if (typeof w !== "number" || !Number.isFinite(w)) return POINT_BASE;
  return clampWeight(w);
}

/** Award points for a correct quiz answer and decay that fact’s weight toward BASE. */
export function applyFactCorrect(
  totalPoints: number,
  factRewardWeight: Record<string, number>,
  factKey: string,
): { totalPoints: number; factRewardWeight: Record<string, number> } {
  const safeTotal = Number.isFinite(totalPoints) && totalPoints >= 0 ? totalPoints : 0;
  const w = rewardWeightForFact(factRewardWeight, factKey);
  const nextTotal = safeTotal + w;
  const nextRaw = POINT_BASE + (w - POINT_BASE) * POINT_WEIGHT_DECAY;
  const nextW = quantizeWeight(nextRaw);
  const nextMap = { ...factRewardWeight };
  if (nextW <= POINT_BASE + WEIGHT_EPS) {
    delete nextMap[factKey];
  } else {
    nextMap[factKey] = clampWeight(nextW);
  }
  return { totalPoints: nextTotal, factRewardWeight: nextMap };
}

/** Mark a fact as difficult: next correct on it pays PEAK until it decays again. */
export function applyFactWrong(
  factRewardWeight: Record<string, number>,
  factKey: string,
): Record<string, number> {
  return { ...factRewardWeight, [factKey]: POINT_PEAK };
}

export function formatPointsDisplay(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function formatNextRewardPreview(weight: number): string {
  return clampWeight(weight).toFixed(2);
}
