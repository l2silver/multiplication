"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./MultiplicationGame.module.css";
import { tipForFact } from "@/data/tips";
import {
  FACTOR_MAX,
  maxLevel,
  maxTable,
  newFactsForLevel,
  parseFactKey,
} from "@/lib/facts";
import {
  GAME_MODES,
  modeIsUnlocked,
  modeTitle,
  secondsForMode,
} from "@/lib/modes";
import {
  applyFactCorrect,
  applyFactWrong,
  formatNextRewardPreview,
  formatPointsDisplay,
  rewardWeightForFact,
} from "@/lib/points";
import {
  clearGame,
  defaultSavedGame,
  ensureQuizState,
  goToMenu,
  goToModePicker,
  loadGame,
  mapActiveMode,
  saveGame,
  selectMode,
  selectTable,
  SELECTABLE_TABLES,
  startRetryAfterReview,
  isPackCompletedForLevel,
  withPackMedalBonusIfEligible,
  type ModeProgress,
  type SavedGame,
} from "@/lib/persistence";

const REDEEM_PASSWORD = "1234";

/** Max digits in quiz answer (10×10 = 100; extra headroom). */
const QUIZ_ANSWER_MAX_DIGITS = 4;

const IS_DEV = process.env.NODE_ENV === "development";

export function MultiplicationGame() {
  const [game, setGame] = useState<SavedGame | null>(null);
  const [answer, setAnswer] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [quizDeadline, setQuizDeadline] = useState<number | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemPwd, setRedeemPwd] = useState("");
  const [redeemError, setRedeemError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleTimeoutRef = useRef<() => void>(() => {});
  /** Prevents duplicate auto-submit (e.g. Strict Mode) for the same quiz item. */
  const autoSubmittedQuestionRef = useRef<string | null>(null);
  const gameRef = useRef<SavedGame | null>(null);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  const [pointsBumpKey, setPointsBumpKey] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const loaded = loadGame() ?? defaultSavedGame();
      setGame({ ...loaded, screen: "pickMode" });
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (game) saveGame(game);
  }, [game]);

  const persist = useCallback((updater: (g: SavedGame) => SavedGame) => {
    setGame((g) => (g ? updater(g) : g));
  }, []);

  const tryRedeem = useCallback(() => {
    if (redeemPwd === REDEEM_PASSWORD) {
      persist((g) => ({ ...g, totalPoints: 0, factRewardWeight: {} }));
      setRedeemPwd("");
      setRedeemOpen(false);
      setRedeemError(false);
    } else {
      setRedeemError(true);
    }
  }, [redeemPwd, persist]);

  const handleReset = useCallback(() => {
    clearGame();
    setGame(defaultSavedGame());
    setAnswer("");
    setRedeemOpen(false);
    setRedeemPwd("");
    setRedeemError(false);
    setPointsBumpKey(0);
  }, []);

  const startQuizFromIntro = useCallback((g: SavedGame): SavedGame => {
    return mapActiveMode({ ...g, screen: "play" }, (p) => ({
      ...p,
      introIndex: 0,
      phase: "quiz",
      quiz: ensureQuizState(p.level, null),
      reviewWrongKeys: undefined,
      hadMissThisPack: undefined,
    }));
  }, []);

  const introNext = useCallback(() => {
    persist((g) => {
      if (g.screen !== "play") return g;
      const p = g.progress[g.activeMode]!;
      if (p.introIndex + 1 >= FACTOR_MAX) {
        return startQuizFromIntro(g);
      }
      return mapActiveMode(g, (pr) => ({
        ...pr,
        introIndex: pr.introIndex + 1,
      }));
    });
    setAnswer("");
  }, [persist, startQuizFromIntro]);

  const advanceAfterQuizAnswer = useCallback(
    (correct: boolean) => {
      persist((g) => {
        if (g.screen !== "play") return g;
        const p = g.progress[g.activeMode]!;
        if (p.phase !== "quiz" || !p.quiz) return g;
        const q = p.quiz;
        const currentKey = q.roundKeys[q.roundIndex];
        if (currentKey === undefined) return g;

        const mergeHadMiss = (pr: ModeProgress) =>
          pr.hadMissThisPack === true || !correct ? true : undefined;

        const withPoints = (next: SavedGame): SavedGame => {
          if (correct) {
            const { totalPoints, factRewardWeight } = applyFactCorrect(
              next.totalPoints,
              next.factRewardWeight,
              currentKey,
            );
            return { ...next, totalPoints, factRewardWeight };
          }
          return {
            ...next,
            factRewardWeight: applyFactWrong(next.factRewardWeight, currentKey),
          };
        };

        const wrong = new Set(q.wrongThisRound);
        if (!correct) wrong.add(currentKey);
        const wrongArr = [...wrong];

        const nextIndex = q.roundIndex + 1;
        if (nextIndex < q.roundKeys.length) {
          return withPoints(
            mapActiveMode(g, (pr) => ({
              ...pr,
              hadMissThisPack: mergeHadMiss(pr),
              quiz: {
                ...q,
                roundIndex: nextIndex,
                wrongThisRound: wrongArr,
              },
            })),
          );
        }

        if (wrongArr.length === 0) {
          return withPoints(
            mapActiveMode(g, (pr) => ({
              ...pr,
              quiz: null,
              phase: "intro",
              introIndex: 0,
              awaitingLevelAdvance: true,
              reviewWrongKeys: undefined,
            })),
          );
        }

        return withPoints(
          mapActiveMode(g, (pr) => ({
            ...pr,
            hadMissThisPack: mergeHadMiss(pr),
            phase: "review",
            quiz: null,
            reviewWrongKeys: wrongArr,
          })),
        );
      });
      setAnswer("");
    },
    [persist],
  );

  const submitAnswer = useCallback(() => {
    if (!game || game.screen !== "play") return;
    const p = game.progress[game.activeMode]!;
    if (p.phase !== "quiz" || !p.quiz) return;
    const key = p.quiz.roundKeys[p.quiz.roundIndex];
    if (key === undefined) return;
    const { a, b } = parseFactKey(key);
    const parsed = Number.parseInt(answer.trim(), 10);
    if (!Number.isFinite(parsed)) return;
    const ok = parsed === a * b;
    advanceAfterQuizAnswer(ok);
    if (ok) setPointsBumpKey((k) => k + 1);
  }, [game, answer, advanceAfterQuizAnswer]);

  const tryAutoSubmitIfCorrect = useCallback(
    (cleaned: string) => {
      const g = gameRef.current;
      if (!g || g.screen !== "play") return;
      const p = g.progress[g.activeMode]!;
      if (p.phase !== "quiz" || !p.quiz) return;
      const factKey = p.quiz.roundKeys[p.quiz.roundIndex];
      if (factKey === undefined) return;
      const { a, b } = parseFactKey(factKey);
      const parsed = Number.parseInt(cleaned.trim(), 10);
      if (!Number.isFinite(parsed) || parsed !== a * b) return;
      const qid = `${p.quiz.roundIndex}-${factKey}`;
      if (autoSubmittedQuestionRef.current === qid) return;
      autoSubmittedQuestionRef.current = qid;
      advanceAfterQuizAnswer(true);
      setPointsBumpKey((k) => k + 1);
    },
    [advanceAfterQuizAnswer],
  );

  const scheduleAutoSubmitCheck = useCallback(
    (
      cleaned: string,
      expectedRoundIndex: number,
      expectedFactKey: string,
    ) => {
      queueMicrotask(() => {
        const g = gameRef.current;
        if (!g || g.screen !== "play") return;
        const p = g.progress[g.activeMode]!;
        if (p.phase !== "quiz" || !p.quiz) return;
        if (p.quiz.roundIndex !== expectedRoundIndex) return;
        if (p.quiz.roundKeys[p.quiz.roundIndex] !== expectedFactKey) return;
        tryAutoSubmitIfCorrect(cleaned);
      });
    },
    [tryAutoSubmitIfCorrect],
  );

  const appendQuizDigit = useCallback(
    (digit: string) => {
      if (!/^\d$/.test(digit)) return;
      const g = gameRef.current;
      if (!g || g.screen !== "play") return;
      const pr = g.progress[g.activeMode]!;
      if (pr.phase !== "quiz" || !pr.quiz) return;
      const ri = pr.quiz.roundIndex;
      const fk = pr.quiz.roundKeys[ri];
      if (fk === undefined) return;

      setAnswer((prev) => {
        const cleaned = (prev + digit)
          .replace(/\D/g, "")
          .slice(0, QUIZ_ANSWER_MAX_DIGITS);
        scheduleAutoSubmitCheck(cleaned, ri, fk);
        return cleaned;
      });
    },
    [scheduleAutoSubmitCheck],
  );

  const backspaceQuizAnswer = useCallback(() => {
    setAnswer((prev) => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    handleTimeoutRef.current = () => {
      advanceAfterQuizAnswer(false);
    };
  }, [advanceAfterQuizAnswer]);

  const answerMs = useMemo(
    () => (game ? secondsForMode(game.activeMode) * 1000 : 8000),
    [game],
  );

  useEffect(() => {
    if (!game || game.screen !== "play") {
      const clearId = window.setTimeout(() => setQuizDeadline(null), 0);
      return () => window.clearTimeout(clearId);
    }
    const p = game.progress[game.activeMode]!;
    if (p.phase !== "quiz" || !p.quiz) {
      const clearId = window.setTimeout(() => setQuizDeadline(null), 0);
      return () => window.clearTimeout(clearId);
    }
    const key = p.quiz.roundKeys[p.quiz.roundIndex];
    if (key === undefined) {
      const clearId = window.setTimeout(() => setQuizDeadline(null), 0);
      return () => window.clearTimeout(clearId);
    }

    const deadline = Date.now() + secondsForMode(game.activeMode) * 1000;
    const schedId = window.setTimeout(() => setQuizDeadline(deadline), 0);

    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) {
        handleTimeoutRef.current();
      }
    }, 50);
    return () => {
      window.clearTimeout(schedId);
      window.clearInterval(id);
    };
  }, [game]);

  useEffect(() => {
    let raf = 0;
    const p = game?.progress[game.activeMode];
    if (game?.screen === "play" && p?.phase === "quiz" && p.quiz) {
      raf = requestAnimationFrame(() => inputRef.current?.focus());
    }
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [game]);

  const timerWidthPct = useMemo(() => {
    if (!game || game.screen !== "play") return 100;
    const p = game.progress[game.activeMode]!;
    if (p.phase !== "quiz" || !p.quiz || quizDeadline === null) return 100;
    const left = Math.max(0, quizDeadline - now);
    return Math.min(100, (left / answerMs) * 100);
  }, [game, now, quizDeadline, answerMs]);

  const pointsTotal = game?.totalPoints ?? 0;
  const topBar = (
    <div className={styles.topBar}>
      <div className={styles.topBarCluster}>
        <div className={styles.topBarRow}>
          <span
            key={pointsBumpKey}
            className={`${styles.pointsPill} ${pointsBumpKey > 0 ? styles.pointsPillWin : ""}`}
            title="Earned on timed questions. Miss a fact and the next correct pays more; keep getting it right and the reward tapers down toward 0.01."
          >
            {formatPointsDisplay(pointsTotal)} pts
          </span>
          <button
            type="button"
            className={styles.redeemBtn}
            disabled={!game}
            aria-expanded={redeemOpen}
            onClick={() => {
              if (!game) return;
              setRedeemOpen((o) => !o);
              setRedeemError(false);
            }}
          >
            Redeem
          </button>
        </div>
        {redeemOpen && game ? (
          <div
            className={styles.redeemPanel}
            role="dialog"
            aria-label="Redeem points"
          >
            <label className={styles.redeemLabel} htmlFor="redeem-password">
              Password
            </label>
            <input
              id="redeem-password"
              type="password"
              className={styles.redeemInput}
              value={redeemPwd}
              autoComplete="off"
              onChange={(e) => {
                setRedeemPwd(e.target.value);
                setRedeemError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") tryRedeem();
              }}
            />
            {redeemError ? (
              <p className={styles.redeemError}>Incorrect password.</p>
            ) : null}
            <div className={styles.redeemActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => tryRedeem()}
              >
                Clear points
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => {
                  setRedeemOpen(false);
                  setRedeemPwd("");
                  setRedeemError(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (!game) {
    return (
      <div className={styles.root}>
        {topBar}
        <p className={styles.subtitle}>Loading…</p>
      </div>
    );
  }

  const unlockState = {
    silverUnlocked: game.silverUnlocked,
    goldUnlocked: game.goldUnlocked,
  };

  if (game.grandComplete) {
    return (
      <div className={styles.root}>
        {topBar}
        <div className={styles.centerStack}>
          <h1 className={styles.title}>Gold complete!</h1>
          <p className={styles.subtitle}>
            You&apos;ve mastered every times table through {maxTable()} in{" "}
            <strong>Bronze</strong>, <strong>Silver</strong>, and{" "}
            <strong>Gold</strong> pacing.
          </p>
          <div className={styles.card}>
            <p className={styles.tip}>
              Come back anytime to practice again — speed and accuracy both
              stick with repetition.
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() =>
                persist((g) => ({
                  ...g,
                  grandComplete: false,
                  screen: "pickMode",
                }))
              }
            >
              Back to modes
            </button>
            {IS_DEV ? (
              <button
                type="button"
                className={styles.ghostBtn}
                style={{ marginTop: "0.65rem", width: "100%" }}
                onClick={handleReset}
              >
                Reset all progress
              </button>
            ) : null}
          </div>
          <p className={styles.footerNote}>Progress is stored on this device.</p>
        </div>
      </div>
    );
  }

  const p = game.progress[game.activeMode]!;

  if (p.awaitingLevelAdvance) {
    const isFinalTable = p.level >= maxLevel();
    const maxTableDone = p.level + 1;
    const packPerfect = p.hadMissThisPack !== true;
    return (
      <div className={styles.root}>
        {topBar}
        <div className={styles.centerStack}>
          <h1 className={styles.title}>
            {!packPerfect
              ? "Redo this pack"
              : isFinalTable
                ? `${modeTitle(game.activeMode)} — pack complete!`
                : `Through the ${maxTableDone} times table`}
          </h1>
          <p className={styles.subtitle}>
            {!packPerfect
              ? "To unlock the next times table, you need a perfect run — no wrong answers or timeouts. You’ll go through the lesson cards again, then another timed round."
              : isFinalTable
                ? game.activeMode === "gold"
                  ? "You finished the final timed set. The full medal path is yours."
                  : `You've finished every table in ${modeTitle(game.activeMode)}. The next mode unlocks on the map.`
                : "Perfect round — every answer correct. A new times table is now on the map."}
          </p>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => {
              persist((g) => {
                const m = g.activeMode;
                const pr = g.progress[m]!;
                const nextUnlock = Math.min(
                  maxTable(),
                  Math.max(pr.highestUnlockedTable, pr.level + 2),
                );
                const finalTable = pr.level >= maxLevel();
                const perfect = pr.hadMissThisPack !== true;

                if (!perfect) {
                  return {
                    ...g,
                    screen: "play",
                    progress: {
                      ...g.progress,
                      [m]: {
                        ...pr,
                        phase: "intro",
                        introIndex: 0,
                        quiz: null,
                        awaitingLevelAdvance: false,
                        reviewWrongKeys: undefined,
                        hadMissThisPack: undefined,
                      },
                    },
                  };
                }

                if (finalTable) {
                  const cleared: ModeProgress = {
                    ...pr,
                    highestUnlockedTable: maxTable(),
                    awaitingLevelAdvance: false,
                    modeComplete: true,
                    quiz: null,
                    phase: "intro",
                    introIndex: 0,
                    reviewWrongKeys: undefined,
                    hadMissThisPack: undefined,
                  };
                  let next: SavedGame;
                  if (m === "bronze") {
                    next = {
                      ...g,
                      screen: "pickMode",
                      silverUnlocked: true,
                      progress: { ...g.progress, bronze: cleared },
                    };
                  } else if (m === "silver") {
                    next = {
                      ...g,
                      screen: "pickMode",
                      goldUnlocked: true,
                      progress: { ...g.progress, silver: cleared },
                    };
                  } else {
                    next = {
                      ...g,
                      screen: "pickMode",
                      grandComplete: true,
                      progress: { ...g.progress, gold: cleared },
                    };
                  }
                  return withPackMedalBonusIfEligible(next, m, pr.level);
                }
                const continued: ModeProgress = {
                  ...pr,
                  highestUnlockedTable: nextUnlock,
                  awaitingLevelAdvance: false,
                  quiz: null,
                  phase: "intro",
                  introIndex: 0,
                  reviewWrongKeys: undefined,
                  hadMissThisPack: undefined,
                };
                return withPackMedalBonusIfEligible(
                  {
                    ...g,
                    screen: "menu",
                    progress: { ...g.progress, [m]: continued },
                  },
                  m,
                  pr.level,
                );
              });
            }}
          >
            {!packPerfect
              ? "Try again from the start"
              : isFinalTable && game.activeMode === "gold"
                ? "Continue"
                : isFinalTable
                  ? "Back to modes"
                  : "Back to levels"}
          </button>
        </div>
      </div>
    );
  }

  if (game.screen === "pickMode") {
    return (
      <div className={styles.root}>
        {topBar}
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Choose a mode</h1>
            <p className={styles.subtitle}>
              Clear every times table (2–10) in <strong>Bronze</strong> to unlock{" "}
              <strong>Silver</strong>, then Silver to unlock <strong>Gold</strong>.
              Each step uses a shorter timer.
            </p>
          </div>
          {IS_DEV ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={handleReset}
              >
                Reset progress
              </button>
            </div>
          ) : null}
        </div>
        <div className={styles.modeGrid} role="list">
          {GAME_MODES.map((mode) => {
            const unlocked = modeIsUnlocked(unlockState, mode);
            const prog = game.progress[mode]!;
            const done = prog.modeComplete === true;
            const seconds = secondsForMode(mode);
            return (
              <button
                key={mode}
                type="button"
                role="listitem"
                disabled={!unlocked}
                className={
                  unlocked
                    ? done
                      ? styles.modeCellDone
                      : styles.modeCell
                    : styles.modeCellLocked
                }
                onClick={() => {
                  if (!unlocked) return;
                  persist((g) => selectMode(g, mode));
                  setAnswer("");
                }}
              >
                <span className={styles.modeCellTitle}>{modeTitle(mode)}</span>
                <span className={styles.modeCellMeta}>
                  {unlocked
                    ? `${seconds}s per question`
                    : "Complete the prior mode"}
                </span>
                {done ? (
                  <span className={styles.modeCellBadge}>Complete</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className={styles.footerNote}>
          Bronze {secondsForMode("bronze")}s · Silver {secondsForMode("silver")}s ·
          Gold {secondsForMode("gold")}s
        </p>
      </div>
    );
  }

  if (game.screen === "menu") {
    const progMenu = game.progress[game.activeMode]!;
    const inProgressTable =
      !progMenu.awaitingLevelAdvance &&
      (progMenu.phase === "quiz" ||
        progMenu.phase === "review" ||
        (progMenu.phase === "intro" && progMenu.introIndex > 0))
        ? progMenu.level + 1
        : null;
    const sec = secondsForMode(game.activeMode);

    return (
      <div className={styles.root}>
        {topBar}
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>
              {modeTitle(game.activeMode)} · Times tables
            </h1>
            <p className={styles.subtitle}>
              {sec} seconds per question in this mode. Work from the 2s upward;
              finish a pack to unlock the next column.
            </p>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => persist((g) => goToModePicker(g))}
            >
              Modes
            </button>
            {IS_DEV ? (
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={handleReset}
              >
                Reset progress
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.levelGrid} role="list">
          {SELECTABLE_TABLES.map((n) => {
            const unlocked = n <= progMenu.highestUnlockedTable;
            const levelIdx = n - 1;
            const completed = isPackCompletedForLevel(
              game,
              game.activeMode,
              levelIdx,
            );
            const playable = unlocked && !completed;
            const inProgress = inProgressTable === n;
            return (
              <button
                key={n}
                type="button"
                role="listitem"
                disabled={!playable}
                className={
                  !unlocked
                    ? styles.levelCellLocked
                    : completed
                      ? styles.levelCellDone
                      : inProgress
                        ? styles.levelCellActive
                        : styles.levelCell
                }
                onClick={() => {
                  if (!playable) return;
                  persist((g) => selectTable(g, n));
                  setAnswer("");
                }}
              >
                <span className={styles.levelCellNum}>{n}</span>
                <span className={styles.levelCellHint}>
                  {!unlocked
                    ? "Locked"
                    : completed
                      ? "Done"
                      : inProgress
                        ? "Continue"
                        : "×" + n}
                </span>
              </button>
            );
          })}
        </div>
        <p className={styles.footerNote}>
          Each pack teaches the new row, then quizzes on every table in this level
          (×1–×{FACTOR_MAX}).
        </p>
      </div>
    );
  }

  if (p.phase === "review" && p.reviewWrongKeys && p.reviewWrongKeys.length > 0) {
    const uniqueKeys = [...new Set(p.reviewWrongKeys)];
    const facts = uniqueKeys.map((k) => parseFactKey(k));
    const sec = secondsForMode(game.activeMode);

    return (
      <div className={styles.root}>
        {topBar}
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Reviewing hard questions</h1>
            <p className={styles.subtitle}>
              You missed {uniqueKeys.length} fact
              {uniqueKeys.length === 1 ? "" : "s"} this round. Take a moment
              with the answers — then you&apos;ll get another timed pass with
              just these problems ({sec}s each).
            </p>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => persist((g) => goToMenu(g))}
            >
              Levels
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => persist((g) => goToModePicker(g))}
            >
              Modes
            </button>
            {IS_DEV ? (
              <button type="button" className={styles.ghostBtn} onClick={handleReset}>
                Reset progress
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.card}>
          <ul className={styles.reviewList}>
            {facts.map(({ a, b }) => (
              <li key={`${a}-${b}`} className={styles.reviewItem}>
                <span className={styles.reviewEquation}>
                  {a} × {b} = {a * b}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ marginTop: "1.25rem", width: "100%" }}
            onClick={() => {
              persist((g) => startRetryAfterReview(g));
              setAnswer("");
            }}
          >
            Practice these questions
          </button>
        </div>
      </div>
    );
  }

  if (p.phase === "intro") {
    const facts = newFactsForLevel(p.level);
    const fact = facts[p.introIndex];
    if (!fact) {
      return (
        <div className={styles.root}>
          {topBar}
          <p className={styles.subtitle}>
            {IS_DEV
              ? "Something went wrong. Try reset."
              : "Something went wrong. Reload the page to try again."}
          </p>
          {IS_DEV ? (
            <button type="button" className={styles.primaryBtn} onClick={handleReset}>
              Reset progress
            </button>
          ) : null}
        </div>
      );
    }
    const { a, b } = fact;
    const tip = tipForFact(a, b);
    const tablesLabel =
      p.level + 1 === 2
        ? "just the 2s"
        : `2s through ${p.level + 1}s`;
    const sec = secondsForMode(game.activeMode);

    return (
      <div className={styles.root}>
        {topBar}
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>
              {modeTitle(game.activeMode)} · Level {p.level}
            </h1>
            <p className={styles.subtitle}>
              Meeting the {a} times table — card {p.introIndex + 1} of{" "}
              {FACTOR_MAX}. Timed round will use {sec}s per question.
            </p>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => persist((g) => goToMenu(g))}
            >
              Levels
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => persist((g) => goToModePicker(g))}
            >
              Modes
            </button>
            {IS_DEV ? (
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={handleReset}
              >
                Reset progress
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.equation}>
            {a} × {b} = ?
          </div>
          <div className={styles.answerLine}>
            {a} × {b} = {a * b}
          </div>
          {tip ? (
            <div className={styles.tip}>
              <div className={styles.tipLabel}>Memorization tip</div>
              {tip}
            </div>
          ) : null}
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ marginTop: "1.25rem", width: "100%" }}
            onClick={introNext}
          >
            {p.introIndex + 1 >= FACTOR_MAX ? "Start timed practice" : "Next"}
          </button>
        </div>
        <p className={styles.footerNote}>
          After intro cards, you&apos;ll get random questions from every table in
          this level ({tablesLabel}).
        </p>
      </div>
    );
  }

  if (p.phase !== "quiz") {
    return (
      <div className={styles.root}>
        {topBar}
        <p className={styles.subtitle}>
          {IS_DEV
            ? "Lesson state missing. Try reset."
            : "Lesson state missing. Reload the page to try again."}
        </p>
        {IS_DEV ? (
          <button type="button" className={styles.primaryBtn} onClick={handleReset}>
            Reset progress
          </button>
        ) : null}
      </div>
    );
  }

  const q = p.quiz;
  if (!q || q.roundKeys.length === 0) {
    return (
      <div className={styles.root}>
        {topBar}
        <p className={styles.subtitle}>
          {IS_DEV
            ? "Quiz state missing. Try reset."
            : "Quiz state missing. Reload the page to try again."}
        </p>
        {IS_DEV ? (
          <button type="button" className={styles.primaryBtn} onClick={handleReset}>
            Reset progress
          </button>
        ) : null}
      </div>
    );
  }

  const key = q.roundKeys[q.roundIndex];
  if (key === undefined) {
    return (
      <div className={styles.root}>
        {topBar}
        <p className={styles.subtitle}>Loading question…</p>
      </div>
    );
  }

  const { a, b } = parseFactKey(key);
  const total = q.roundKeys.length;
  const position = q.roundIndex + 1;
  const misses = new Set(q.wrongThisRound).size;
  const sec = secondsForMode(game.activeMode);

  return (
    <div className={styles.root}>
      {topBar}
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>
            {modeTitle(game.activeMode)} · Level {p.level}
          </h1>
          <p className={styles.subtitle}>
            {sec} seconds per question. Timeouts count as misses and come back in
            the retry stack.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => persist((g) => goToMenu(g))}
          >
            Levels
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => persist((g) => goToModePicker(g))}
          >
            Modes
          </button>
          {IS_DEV ? (
            <button type="button" className={styles.ghostBtn} onClick={handleReset}>
              Reset progress
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.progressMeta}>
          <span>
            Question {position} of {total}
          </span>
          <span>Misses this round: {misses}</span>
          <span className={styles.rewardHint}>
            +
            {formatNextRewardPreview(
              rewardWeightForFact(game.factRewardWeight, key),
            )}{" "}
            if correct
          </span>
        </div>
        <div className={styles.timerTrack} aria-hidden>
          <div
            className={styles.timerFill}
            style={{ width: `${timerWidthPct}%` }}
          />
        </div>
        <div className={styles.equation}>
          {a} × {b} = ?
        </div>
        <div className={styles.quizAnswerBlock}>
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              className={styles.input}
              inputMode="numeric"
              autoComplete="off"
              aria-label="Your answer"
              value={answer}
              onChange={(e) => {
                const g = gameRef.current;
                if (!g || g.screen !== "play") return;
                const pr = g.progress[g.activeMode]!;
                if (pr.phase !== "quiz" || !pr.quiz) return;
                const ri = pr.quiz.roundIndex;
                const fk = pr.quiz.roundKeys[ri];
                if (fk === undefined) return;

                const cleaned = e.target.value
                  .replace(/\D/g, "")
                  .slice(0, QUIZ_ANSWER_MAX_DIGITS);
                setAnswer(cleaned);
                scheduleAutoSubmitCheck(cleaned, ri, fk);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAnswer();
              }}
            />
            <button type="button" className={styles.primaryBtn} onClick={submitAnswer}>
              Check
            </button>
          </div>
          <div
            className={styles.numPad}
            role="group"
            aria-label="Number buttons"
          >
            {(["7", "8", "9", "4", "5", "6", "1", "2", "3"] as const).map(
              (d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.numPadBtn}
                  onClick={() => appendQuizDigit(d)}
                >
                  {d}
                </button>
              ),
            )}
            <button
              type="button"
              className={`${styles.numPadBtn} ${styles.numPadBack}`}
              aria-label="Backspace"
              onClick={backspaceQuizAnswer}
            >
              ⌫
            </button>
            <button
              type="button"
              className={`${styles.numPadBtn} ${styles.numPadZero}`}
              onClick={() => appendQuizDigit("0")}
            >
              0
            </button>
          </div>
        </div>
      </div>
      <p className={styles.footerNote}>
        Facts in this drill: tables 2 through {p.level + 1} (×1–×{FACTOR_MAX}
        ). The wrong stack clears when you nail every fact in a round.
      </p>
    </div>
  );
}
