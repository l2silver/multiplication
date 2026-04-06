export type Fact = { a: number; b: number };

export const FACTOR_MAX = 10;

export function factKey(a: number, b: number): string {
  return `${a}-${b}`;
}

export function parseFactKey(key: string): Fact {
  const [a, b] = key.split("-").map(Number);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < 2 ||
    b < 1 ||
    b > FACTOR_MAX
  ) {
    throw new Error(`Invalid fact key: ${key}`);
  }
  return { a, b };
}

/** Tables 2–10 → level 9 covers tables 2..10 */
export function maxTable(): number {
  return 10;
}

export function maxLevel(): number {
  return maxTable() - 1;
}

export function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= maxLevel();
}

/** All facts for level L: tables 2 .. L+1 */
export function allFactsForLevel(level: number): Fact[] {
  const maxTable = level + 1;
  const out: Fact[] = [];
  for (let a = 2; a <= maxTable; a++) {
    for (let b = 1; b <= FACTOR_MAX; b++) {
      out.push({ a, b });
    }
  }
  return out;
}

/** New table introduced at level L: (L+1)×1 .. (L+1)×10 */
export function newFactsForLevel(level: number): Fact[] {
  const a = level + 1;
  return Array.from({ length: FACTOR_MAX }, (_, i) => ({ a, b: i + 1 }));
}

export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
