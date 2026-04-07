import { packMedalCompletionBonus, type GameMode } from "@/lib/modes";
import { POINT_FLOOR, POINT_PEAK } from "@/lib/points";
import {
  FACTOR_MAX,
  factKey,
  isValidLevel,
  maxLevel,
  maxTable,
  newFactsForLevel,
  parseFactKey,
  shuffle,
  allFactsForLevel,
} from "@/lib/facts";

export const STORAGE_KEY = "multiplication-tutor-v1";

export type Phase = "intro" | "fullMixBridge" | "quiz" | "review";

/** `narrow` = new row only (×1–×10 for this level’s table); `full` = all tables through this level. */
export type QuizScope = "narrow" | "full";

export type QuizSlice = {
  roundKeys: string[];
  roundIndex: number;
  wrongThisRound: string[];
};

/** Level grid for the selected mode */
export type Screen = "pickMode" | "menu" | "play";

export type ModeProgress = {
  highestUnlockedTable: number;
  level: number;
  phase: Phase;
  introIndex: number;
  quiz: QuizSlice | null;
  /** Set during `quiz` and `review`; omit during `intro`. Missing in old saves = full quiz. */
  quizScope?: QuizScope;
  /** Fact keys missed in the last round; shown before the retry quiz */
  reviewWrongKeys?: string[];
  /** Any wrong or timed-out answer during this table pack’s quiz tries; blocks unlocking next table until false */
  hadMissThisPack?: boolean;
  awaitingLevelAdvance?: boolean;
  /** Cleared every times table through 10 in this mode */
  modeComplete?: boolean;
  /**
   * Timed-quiz correct-answer points for this pack are multiplied by this (implicit 1).
   * Halves when the learner restarts the pack from the lesson.
   */
  packPointScale?: number;
};

export type SavedGame = {
  v: 4;
  screen: Screen;
  activeMode: GameMode;
  silverUnlocked: boolean;
  goldUnlocked: boolean;
  progress: Record<GameMode, ModeProgress>;
  /** Cumulative; earned in timed quiz (and retries), see `src/lib/points.ts` */
  totalPoints: number;
  /** Per fact key `"a-b"` → next correct-answer weight in [POINT_FLOOR, POINT_PEAK] */
  factRewardWeight: Record<string, number>;
  /**
   * Per mode: level indices (1…maxLevel) that already received the one-time medal bonus
   * for first passing that table’s pack (cumulative quiz) in this mode.
   */
  packMedalBonusesAtLevel?: Partial<Record<GameMode, number[]>>;
  /** Beat Gold (final mode); show celebration until dismissed */
  grandComplete?: boolean;
};

type SavedGameV1 = {
  v: 1;
  level: number;
  phase: Phase;
  introIndex: number;
  quiz: QuizSlice | null;
  awaitingLevelAdvance?: boolean;
  gameComplete?: boolean;
};

type SavedGameV2 = {
  v: 2;
  screen: "menu" | "play";
  highestUnlockedTable: number;
  level: number;
  phase: Phase;
  introIndex: number;
  quiz: QuizSlice | null;
  awaitingLevelAdvance?: boolean;
  gameComplete?: boolean;
};

function isQuizSlice(x: unknown): x is QuizSlice {
  if (!x || typeof x !== "object") return false;
  const q = x as QuizSlice;
  return (
    Array.isArray(q.roundKeys) &&
    q.roundKeys.every((k) => typeof k === "string") &&
    typeof q.roundIndex === "number" &&
    Array.isArray(q.wrongThisRound) &&
    q.wrongThisRound.every((k) => typeof k === "string")
  );
}

function validateKeys(keys: string[], level: number): boolean {
  const allowed = new Set(
    allFactsForLevel(level).map((f) => factKey(f.a, f.b)),
  );
  return keys.every((k) => {
    try {
      const { a, b } = parseFactKey(k);
      return allowed.has(factKey(a, b));
    } catch {
      return false;
    }
  });
}

function validateNarrowKeys(keys: string[], level: number): boolean {
  const allowed = new Set(
    newFactsForLevel(level).map((f) => factKey(f.a, f.b)),
  );
  return keys.every((k) => {
    try {
      const { a, b } = parseFactKey(k);
      return allowed.has(factKey(a, b));
    } catch {
      return false;
    }
  });
}

function coerceQuizScope(x: unknown): QuizScope | undefined {
  if (x === "narrow" || x === "full") return x;
  return undefined;
}

function inferQuizScopeFromKeys(
  roundKeys: string[],
  wrongKeys: string[],
  level: number,
): QuizScope | null {
  if (roundKeys.length === 0) return null;
  if (validateKeys(roundKeys, level) && validateKeys(wrongKeys, level)) {
    return "full";
  }
  if (validateNarrowKeys(roundKeys, level) && validateNarrowKeys(wrongKeys, level)) {
    return "narrow";
  }
  return null;
}

function clampUnlockTable(n: number): number {
  return Math.min(maxTable(), Math.max(2, Math.floor(n)));
}

function migrateV1ToV2(raw: unknown): SavedGameV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as SavedGameV1;
  if (typeof g.level !== "number" || !Number.isInteger(g.level) || g.level < 1 || g.level > 11)
    return null;
  if (g.phase !== "intro" && g.phase !== "quiz") return null;
  if (typeof g.introIndex !== "number" || !Number.isInteger(g.introIndex))
    return null;

  const level = Math.min(maxLevel(), Math.max(1, g.level));
  let phase = g.phase;
  let introIndex = g.introIndex;
  let quiz = g.quiz;

  if (phase === "intro") {
    if (introIndex < 0 || introIndex >= FACTOR_MAX) return null;
    quiz = null;
  } else {
    if (
      !isQuizSlice(quiz) ||
      quiz.roundIndex < 0 ||
      quiz.roundIndex > quiz.roundKeys.length ||
      !validateKeys(quiz.roundKeys, level) ||
      !validateKeys(quiz.wrongThisRound, level)
    ) {
      phase = "intro";
      introIndex = 0;
      quiz = null;
    }
  }

  const maxTableReached = level + 1;
  let unlock = clampUnlockTable(maxTableReached);
  if (g.awaitingLevelAdvance) {
    unlock = clampUnlockTable(maxTableReached + 1);
  }
  if (g.gameComplete) {
    unlock = maxTable();
  }

  const midLesson =
    !g.gameComplete &&
    !g.awaitingLevelAdvance &&
    (phase === "quiz" || (phase === "intro" && introIndex > 0));

  return {
    v: 2,
    screen: midLesson ? "play" : "menu",
    highestUnlockedTable: unlock,
    level,
    phase,
    introIndex,
    quiz,
    awaitingLevelAdvance: g.awaitingLevelAdvance,
    gameComplete: g.gameComplete ? true : undefined,
  };
}

function parseV2Payload(data: Record<string, unknown>): SavedGameV2 | null {
  const g = data as SavedGameV2;
  if (!isValidLevel(g.level)) return null;
  if (g.screen !== "menu" && g.screen !== "play") return null;
  if (typeof g.highestUnlockedTable !== "number" || !Number.isInteger(g.highestUnlockedTable))
    return null;
  if (g.highestUnlockedTable < 2 || g.highestUnlockedTable > maxTable()) return null;

  if (g.gameComplete === true) {
    return {
      ...g,
      v: 2,
      screen: "menu",
      quiz: null,
      phase: "intro",
      introIndex: 0,
      awaitingLevelAdvance: false,
      highestUnlockedTable: maxTable(),
    };
  }

  if (typeof g.introIndex !== "number" || !Number.isInteger(g.introIndex))
    return null;
  if (g.phase !== "intro" && g.phase !== "quiz") return null;

  if (g.phase === "intro") {
    if (g.introIndex < 0 || g.introIndex >= FACTOR_MAX) return null;
    if (g.quiz !== null) return null;
    return g;
  }

  if (!isQuizSlice(g.quiz)) return null;
  const q = g.quiz;
  if (q.roundIndex < 0 || q.roundIndex > q.roundKeys.length) return null;
  if (!validateKeys(q.roundKeys, g.level)) return null;
  if (!validateKeys(q.wrongThisRound, g.level)) return null;
  return g;
}

function migrateV2ToV3(g: SavedGameV2): SavedGame {
  const bronze: ModeProgress = {
    highestUnlockedTable: g.highestUnlockedTable,
    level: g.level,
    phase: g.phase,
    introIndex: g.introIndex,
    quiz: g.quiz,
    awaitingLevelAdvance: g.awaitingLevelAdvance,
    modeComplete: g.gameComplete ? true : undefined,
  };
  const legacyDone = g.gameComplete === true;
  return {
    v: 4,
    screen: "pickMode",
    activeMode: "bronze",
    silverUnlocked: legacyDone,
    goldUnlocked: legacyDone,
    progress: {
      bronze,
      silver: defaultModeProgress(),
      gold: defaultModeProgress(),
    },
    totalPoints: 0,
    factRewardWeight: {},
  };
}

function coerceHadMiss(p: ModeProgress): boolean {
  return p.hadMissThisPack === true;
}

function coercePackPointScaleField(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (raw <= 0 || raw > 1) return undefined;
  return Math.round(raw * 1e9) / 1e9;
}

function attachPackPointScale(raw: unknown, prog: ModeProgress): ModeProgress {
  const ps = coercePackPointScaleField(
    (raw as Record<string, unknown>)?.packPointScale,
  );
  if (ps === undefined) return prog;
  return { ...prog, packPointScale: ps };
}

function parseModeProgress(x: unknown, fallback: ModeProgress): ModeProgress {
  if (!x || typeof x !== "object") return { ...fallback };
  const p = x as ModeProgress;
  if (!isValidLevel(p.level)) return { ...fallback };
  if (typeof p.highestUnlockedTable !== "number" || !Number.isInteger(p.highestUnlockedTable))
    return { ...fallback };
  if (p.highestUnlockedTable < 2 || p.highestUnlockedTable > maxTable())
    return { ...fallback };
  if (typeof p.introIndex !== "number" || !Number.isInteger(p.introIndex))
    return { ...fallback };
  if (
    p.phase !== "intro" &&
    p.phase !== "fullMixBridge" &&
    p.phase !== "quiz" &&
    p.phase !== "review"
  )
    return { ...fallback };

  if (p.phase === "intro") {
    if (p.introIndex < 0 || p.introIndex >= FACTOR_MAX) return { ...fallback };
    if (p.quiz !== null) return { ...fallback };
    return attachPackPointScale(x, {
      highestUnlockedTable: p.highestUnlockedTable,
      level: p.level,
      phase: p.phase,
      introIndex: p.introIndex,
      quiz: null,
      quizScope: undefined,
      awaitingLevelAdvance: p.awaitingLevelAdvance,
      modeComplete: p.modeComplete,
      reviewWrongKeys: undefined,
      hadMissThisPack: coerceHadMiss(p) ? true : undefined,
    });
  }

  if (p.phase === "fullMixBridge") {
    if (p.introIndex !== 0) return { ...fallback };
    if (p.quiz !== null) return { ...fallback };
    const rk = p.reviewWrongKeys;
    if (Array.isArray(rk) && rk.length > 0) return { ...fallback };
    return attachPackPointScale(x, {
      highestUnlockedTable: p.highestUnlockedTable,
      level: p.level,
      phase: "fullMixBridge",
      introIndex: 0,
      quiz: null,
      quizScope: undefined,
      awaitingLevelAdvance: p.awaitingLevelAdvance,
      modeComplete: p.modeComplete,
      reviewWrongKeys: undefined,
      hadMissThisPack: coerceHadMiss(p) ? true : undefined,
    });
  }

  if (p.phase === "review") {
    if (p.introIndex !== 0) return { ...fallback };
    if (p.quiz !== null) return { ...fallback };
    const rk = p.reviewWrongKeys;
    if (!Array.isArray(rk) || rk.length === 0) return { ...fallback };
    if (!rk.every((k) => typeof k === "string")) return { ...fallback };
    const reviewScope: QuizScope = coerceQuizScope(p.quizScope) ?? "full";
    if (reviewScope === "narrow") {
      if (!validateNarrowKeys(rk, p.level)) return { ...fallback };
    } else if (!validateKeys(rk, p.level)) {
      return { ...fallback };
    }
    return attachPackPointScale(x, {
      highestUnlockedTable: p.highestUnlockedTable,
      level: p.level,
      phase: "review",
      introIndex: 0,
      quiz: null,
      quizScope: reviewScope,
      reviewWrongKeys: rk,
      awaitingLevelAdvance: p.awaitingLevelAdvance,
      modeComplete: p.modeComplete,
      hadMissThisPack: coerceHadMiss(p) ? true : undefined,
    });
  }

  if (!isQuizSlice(p.quiz)) return { ...fallback };
  const q = p.quiz;
  if (q.roundIndex < 0 || q.roundIndex > q.roundKeys.length) return { ...fallback };
  const declared = coerceQuizScope(p.quizScope);
  let quizScope: QuizScope;
  if (declared === "narrow" || declared === "full") {
    quizScope = declared;
    const ok =
      quizScope === "narrow"
        ? validateNarrowKeys(q.roundKeys, p.level) &&
          validateNarrowKeys(q.wrongThisRound, p.level)
        : validateKeys(q.roundKeys, p.level) &&
          validateKeys(q.wrongThisRound, p.level);
    if (!ok) return { ...fallback };
  } else {
    const inferred = inferQuizScopeFromKeys(
      q.roundKeys,
      q.wrongThisRound,
      p.level,
    );
    if (inferred === null) return { ...fallback };
    quizScope = inferred;
  }
  return attachPackPointScale(x, {
    highestUnlockedTable: p.highestUnlockedTable,
    level: p.level,
    phase: p.phase,
    introIndex: p.introIndex,
    quiz: q,
    quizScope,
    awaitingLevelAdvance: p.awaitingLevelAdvance,
    modeComplete: p.modeComplete,
    reviewWrongKeys: undefined,
    hadMissThisPack: coerceHadMiss(p) ? true : undefined,
  });
}

function coerceTotalPoints(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return 0;
  return x;
}

function coerceFactRewardWeight(x: unknown): Record<string, number> {
  if (!x || typeof x !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = Math.min(POINT_PEAK, Math.max(POINT_FLOOR, v));
  }
  return out;
}

function coercePackMedalBonuses(
  raw: unknown,
): SavedGame["packMedalBonusesAtLevel"] {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const modes: GameMode[] = ["bronze", "silver", "gold"];
  const out: Partial<Record<GameMode, number[]>> = {};
  for (const mode of modes) {
    const arr = o[mode];
    if (!Array.isArray(arr)) continue;
    const levels = [
      ...new Set(
        arr.filter(
          (x): x is number =>
            typeof x === "number" &&
            Number.isInteger(x) &&
            isValidLevel(x),
        ),
      ),
    ].sort((a, b) => a - b);
    if (levels.length > 0) out[mode] = levels;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Add medal pack bonus for `completedLevel` in `mode` if not already awarded. */
export function withPackMedalBonusIfEligible(
  g: SavedGame,
  mode: GameMode,
  completedLevel: number,
): SavedGame {
  if (!isValidLevel(completedLevel)) return g;
  const at = g.packMedalBonusesAtLevel;
  const nextRecord: Record<GameMode, number[]> = {
    bronze: [...(at?.bronze ?? [])],
    silver: [...(at?.silver ?? [])],
    gold: [...(at?.gold ?? [])],
  };
  const modeList = nextRecord[mode];
  if (modeList.includes(completedLevel)) return g;
  modeList.push(completedLevel);
  modeList.sort((a, b) => a - b);
  return {
    ...g,
    totalPoints: g.totalPoints + packMedalCompletionBonus(mode),
    packMedalBonusesAtLevel: nextRecord,
  };
}

/** True after passing a pack (medal bonus recorded) for this level in this mode. */
export function isPackCompletedForLevel(
  g: SavedGame,
  mode: GameMode,
  level: number,
): boolean {
  const list = g.packMedalBonusesAtLevel?.[mode];
  return Array.isArray(list) && list.includes(level);
}

function mergePackMedalsWithModeComplete(
  coerced: SavedGame["packMedalBonusesAtLevel"],
  progress: Record<GameMode, ModeProgress>,
): SavedGame["packMedalBonusesAtLevel"] {
  const modes: GameMode[] = ["bronze", "silver", "gold"];
  const next: Partial<Record<GameMode, number[]>> = {};
  for (const mode of modes) {
    const set = new Set<number>(coerced?.[mode] ?? []);
    if (progress[mode]?.modeComplete === true) {
      for (let lv = 1; lv <= maxLevel(); lv++) {
        set.add(lv);
      }
    }
    const arr = [...set].sort((a, b) => a - b);
    if (arr.length > 0) next[mode] = arr;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function parseSavedGamePayload(
  data: Record<string, unknown>,
  loadPoints: boolean,
): SavedGame | null {
  const g = data;
  if (g.screen !== "pickMode" && g.screen !== "menu" && g.screen !== "play")
    return null;
  if (typeof g.silverUnlocked !== "boolean" || typeof g.goldUnlocked !== "boolean")
    return null;
  const active = g.activeMode;
  if (active !== "bronze" && active !== "silver" && active !== "gold") return null;

  const fb = defaultModeProgress();
  const rawProg = g.progress;
  if (!rawProg || typeof rawProg !== "object") return null;

  const progress: Record<GameMode, ModeProgress> = {
    bronze: parseModeProgress((rawProg as Record<string, unknown>).bronze, fb),
    silver: parseModeProgress((rawProg as Record<string, unknown>).silver, fb),
    gold: parseModeProgress((rawProg as Record<string, unknown>).gold, fb),
  };

  const totalPoints = loadPoints ? coerceTotalPoints(g.totalPoints) : 0;
  const factRewardWeight = loadPoints
    ? coerceFactRewardWeight(g.factRewardWeight)
    : {};

  const packMedalBonusesAtLevel = mergePackMedalsWithModeComplete(
    loadPoints ? coercePackMedalBonuses(g.packMedalBonusesAtLevel) : undefined,
    progress,
  );

  const base: SavedGame = {
    v: 4,
    screen: g.screen as Screen,
    activeMode: active,
    silverUnlocked: g.silverUnlocked,
    goldUnlocked: g.goldUnlocked,
    progress,
    totalPoints,
    factRewardWeight,
    ...(packMedalBonusesAtLevel ? { packMedalBonusesAtLevel } : {}),
  };

  if (g.grandComplete === true) {
    return { ...base, grandComplete: true };
  }

  return base;
}

export function parseSavedGame(raw: string): SavedGame | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const rec = data as Record<string, unknown>;
    const v = rec.v;

    if (v === 1) {
      const v2 = migrateV1ToV2(rec);
      return v2 ? migrateV2ToV3(v2) : null;
    }

    if (v === 2) {
      const v2 = parseV2Payload(rec);
      return v2 ? migrateV2ToV3(v2) : null;
    }

    if (v !== 3 && v !== 4) return null;

    return parseSavedGamePayload(rec, v === 4);
  } catch {
    return null;
  }
}

export function loadGame(): SavedGame | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return parseSavedGame(raw);
}

export function saveGame(state: SavedGame): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearGame(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function defaultModeProgress(): ModeProgress {
  return {
    highestUnlockedTable: 2,
    level: 1,
    phase: "intro",
    introIndex: 0,
    quiz: null,
  };
}

export function defaultSavedGame(): SavedGame {
  const p = defaultModeProgress();
  return {
    v: 4,
    screen: "pickMode",
    activeMode: "bronze",
    silverUnlocked: false,
    goldUnlocked: false,
    progress: {
      bronze: { ...p },
      silver: { ...p },
      gold: { ...p },
    },
    totalPoints: 0,
    factRewardWeight: {},
  };
}

export function ensureQuizState(level: number, quiz: QuizSlice | null): QuizSlice {
  if (quiz && validateKeys(quiz.roundKeys, level) && quiz.roundKeys.length > 0) {
    const clampedIndex = Math.min(
      Math.max(0, quiz.roundIndex),
      quiz.roundKeys.length,
    );
    return {
      roundKeys: quiz.roundKeys,
      roundIndex: clampedIndex,
      wrongThisRound: [...new Set(quiz.wrongThisRound)].filter((k) =>
        validateKeys([k], level),
      ),
    };
  }
  const keys = shuffle(
    allFactsForLevel(level).map((f) => factKey(f.a, f.b)),
  );
  return { roundKeys: keys, roundIndex: 0, wrongThisRound: [] };
}

export function ensureNarrowQuizState(level: number, quiz: QuizSlice | null): QuizSlice {
  if (
    quiz &&
    validateNarrowKeys(quiz.roundKeys, level) &&
    quiz.roundKeys.length > 0
  ) {
    const clampedIndex = Math.min(
      Math.max(0, quiz.roundIndex),
      quiz.roundKeys.length,
    );
    return {
      roundKeys: quiz.roundKeys,
      roundIndex: clampedIndex,
      wrongThisRound: [...new Set(quiz.wrongThisRound)].filter((k) =>
        validateNarrowKeys([k], level),
      ),
    };
  }
  const keys = shuffle(
    newFactsForLevel(level).map((f) => factKey(f.a, f.b)),
  );
  return { roundKeys: keys, roundIndex: 0, wrongThisRound: [] };
}

export const SELECTABLE_TABLES: readonly number[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10,
];

export function mapActiveMode(
  g: SavedGame,
  fn: (p: ModeProgress) => ModeProgress,
): SavedGame {
  const m = g.activeMode;
  return {
    ...g,
    progress: { ...g.progress, [m]: fn(g.progress[m]!) },
  };
}

/** After review screen: start timed retry with the same wrong facts (shuffled). */
export function startRetryAfterReview(g: SavedGame): SavedGame {
  return mapActiveMode(g, (pr) => {
    const keys = pr.reviewWrongKeys;
    if (!keys?.length) return pr;
    return {
      ...pr,
      phase: "quiz",
      reviewWrongKeys: undefined,
      quiz: {
        roundKeys: shuffle([...new Set(keys)]),
        roundIndex: 0,
        wrongThisRound: [],
      },
    };
  });
}

/** Reshuffle the current timed round from question 1 (full deck or retry subset). */
export function restartCurrentQuizRound(g: SavedGame): SavedGame {
  return mapActiveMode(g, (pr) => {
    if (pr.phase !== "quiz" || !pr.quiz || !pr.quizScope) return pr;
    const q = pr.quiz;
    const lv = pr.level;
    const scope = pr.quizScope;
    const narrowCount = newFactsForLevel(lv).length;
    const fullCount = allFactsForLevel(lv).length;
    const fullDeck =
      scope === "narrow"
        ? q.roundKeys.length === narrowCount
        : q.roundKeys.length === fullCount;
    const nextQuiz: QuizSlice = fullDeck
      ? scope === "narrow"
        ? ensureNarrowQuizState(lv, null)
        : ensureQuizState(lv, null)
      : {
          roundKeys: shuffle([...q.roundKeys]),
          roundIndex: 0,
          wrongThisRound: [],
        };
    return { ...pr, quiz: nextQuiz };
  });
}

/** Back to intro cards; halves point scale for this pack (redo penalty). */
export function restartPackFromLessonWithPointPenalty(g: SavedGame): SavedGame {
  return mapActiveMode(g, (pr) => ({
    ...pr,
    phase: "intro",
    introIndex: 0,
    quiz: null,
    quizScope: undefined,
    reviewWrongKeys: undefined,
    hadMissThisPack: undefined,
    packPointScale: (pr.packPointScale ?? 1) * 0.5,
  }));
}

export function goToMenu(g: SavedGame): SavedGame {
  return { ...g, screen: "menu" };
}

export function goToModePicker(g: SavedGame): SavedGame {
  return { ...g, screen: "pickMode" };
}

export function selectMode(g: SavedGame, mode: GameMode): SavedGame {
  if (mode === "silver" && !g.silverUnlocked) return g;
  if (mode === "gold" && !g.goldUnlocked) return g;
  return { ...g, activeMode: mode, screen: "menu" };
}

export function selectTable(g: SavedGame, table: number): SavedGame {
  const mode = g.activeMode;
  const p = g.progress[mode]!;
  if (table < 2 || table > maxTable()) return g;
  if (table > p.highestUnlockedTable) return g;
  const level = table - 1;
  if (isPackCompletedForLevel(g, mode, level)) return g;
  const resume =
    p.level === level &&
    !p.awaitingLevelAdvance &&
    (p.phase === "quiz" ||
      p.phase === "review" ||
      p.phase === "fullMixBridge" ||
      (p.phase === "intro" && p.introIndex > 0));
  const next: ModeProgress = resume
    ? { ...p }
    : {
        ...p,
        level,
        phase: "intro",
        introIndex: 0,
        quiz: null,
        quizScope: undefined,
        awaitingLevelAdvance: false,
        reviewWrongKeys: undefined,
        hadMissThisPack: false,
        packPointScale: undefined,
      };
  return {
    ...g,
    screen: "play",
    progress: {
      ...g.progress,
      [mode]: { ...next, modeComplete: p.modeComplete },
    },
  };
}
