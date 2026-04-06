import { factKey } from "@/lib/facts";

/**
 * Optional memorization hints keyed as factKey(a, b), e.g. "3-4".
 * Facts without an entry simply omit the tips section in the intro.
 */
const raw: Record<string, string> = {
  "2-2": "Think “pairs”: 2 twos are 4, like the corners of a small square.",
  "2-3": "Count by twos: 2, 4, 6 — three jumps.",
  "2-4": "Doubling twice: double 2 is 4, double again is 8.",
  "2-5": "Half of 10×: 10 × 2 is 20, half is 10.",
  "2-9": "One less than double 10: 9 is almost 10, so 2×9 = 18 (2×10 − 2).",

  "3-3": "Three groups of 3: 3, 6, 9.",
  "3-4": "3×4 is the same as 4×3 — both are 12 (a dozen).",
  "3-9": "The digits of 27 add to 9: 2 + 7 = 9 (nice check for 3×9).",

  "4-4": "Square number: 4×4 is 16 (four fours).",
  "4-5": "Half of 8×5: 8×5 is 40, half is 20.",
  "4-9": "One less than 4×10: 40 − 4 = 36.",

  "5-6": "Half of 10×6: 60 ÷ 2 = 30.",
  "5-8": "Half of 10×8: 80 ÷ 2 = 40.",

  "6-6": "Square: 36 — six sixes.",
  "6-7": "6×7 = 42 — rhymes help some people lock it in.",
  "6-8": "Double 3×8: 3×8 is 24, doubled is 48.",

  "7-8": "56 = 7×8 — some memorize “5-6-7-8” as a pattern.",
  "7-9": "One less than 7×10: 70 − 7 = 63.",

  "8-8": "Square: 64 (eight eights).",
  "8-9": "One less than 8×10: 80 − 8 = 72.",

  "9-9": "Square: 81 — nine nines.",

  "11-10": "11×10 is 110 — just tack a 0 onto 11.",
  "12-10": "12×10 is 120 — same idea as ×10 on any whole number.",
};

export const TIPS: Readonly<Record<string, string>> = raw;

export function tipForFact(a: number, b: number): string | undefined {
  return TIPS[factKey(a, b)];
}
