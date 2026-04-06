/** Default reward for a fact you haven’t stored a weight for yet (first drills). */
export const POINT_BASE = 0.1;
/** Minimum reward after many correct answers in a row on the same fact. */
export const POINT_FLOOR = 0.01;
/** After a wrong or timeout on a fact, the next correct on that fact earns this much. */
export const POINT_PEAK = 0.2;
/**
 * Each correct answer on a fact moves its weight from the current value toward POINT_FLOOR
 * by this factor on the excess over the floor (exponential decay).
 */
export const POINT_WEIGHT_DECAY = 0.78;

const WEIGHT_EPS = 1e-9;

function clampWeight(x: number): number {
  return Math.min(POINT_PEAK, Math.max(POINT_FLOOR, x));
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

/** Award points for a correct quiz answer and decay that fact’s weight toward POINT_FLOOR. */
export function applyFactCorrect(
  totalPoints: number,
  factRewardWeight: Record<string, number>,
  factKey: string,
): { totalPoints: number; factRewardWeight: Record<string, number> } {
  const safeTotal = Number.isFinite(totalPoints) && totalPoints >= 0 ? totalPoints : 0;
  const w = rewardWeightForFact(factRewardWeight, factKey);
  const nextTotal = safeTotal + w;
  const nextRaw = POINT_FLOOR + (w - POINT_FLOOR) * POINT_WEIGHT_DECAY;
  const nextW = quantizeWeight(nextRaw);
  const nextMap = { ...factRewardWeight };
  const clamped = clampWeight(nextW);
  if (clamped <= POINT_FLOOR + WEIGHT_EPS) {
    nextMap[factKey] = POINT_FLOOR;
  } else {
    nextMap[factKey] = clamped;
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
