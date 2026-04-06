# Multiplication tutor — design

## Product goals

Help learners build fluent recall of multiplication facts through **cumulative tables**, a **learn-then-drill** flow, **timed practice** at three difficulty paces, **targeted retries**, and clear **progression rules** (including a **perfect-run** requirement to advance).

## Navigation & modes

1. **Mode picker** — Choose **Bronze**, **Silver**, or **Gold**. Silver unlocks after clearing every times table (2–10) in Bronze; Gold after the same in Silver.
2. **Level grid** — A 3×3 map for tables **2–10**. Only tables up to **`highestUnlockedTable`** are selectable; the learner works upward.
3. **Play** — Intro cards, timed quiz, optional **review** screen, then retry rounds as needed.

Timer per question depends on mode:

| Mode   | Seconds per question |
|--------|----------------------:|
| Bronze | 8 |
| Silver | 6 |
| Gold   | 4 |

## Level model

- Levels are **1-indexed** and **cumulative** (see `src/lib/facts.ts`).
- Level **L** drills **all facts** for tables **2** through **L + 1**, second factor **1–10** (×1 … ×10).
- **Level 1** = 2s only. **Level 9** = 2s through **10s** (`maxTable()` = 10, `maxLevel()` = 9). The UI labels levels by the **table** number (`level + 1`), e.g. “Level 9” corresponds to the 10× table row.

## Per-table pack flow

### 1. Introduction (“new table”)

- For the current level, the learner sees **one card at a time** for the **new** table: **(L+1)×1 … (L+1)×10**.
- Each card shows equation + answer, plus an optional **tip** (`src/data/tips.ts`).
- After the last card → **Start timed practice** begins the quiz.

### 2. Timed quiz

- Questions are a **shuffled** pass over **all facts** in the level (tables 2 … L+1).
- **Correct** → next question.
- **Wrong** or **timeout** → fact recorded for this round; same rules as a miss for progression (see **Perfect run**, below).

### 3. End of round

- **No misses in the round** → **pack-complete** screen (awaiting advance). Unlock rules below.
- **Any misses** → **`review` phase**: list missed facts as equations with answers (“Reviewing hard questions”), then **Practice these questions** starts a **new timed round** with **only** those keys, shuffled. The wrong stack can fill again until a round ends clean.

So: intro → quiz → (optional) review → retry quiz → … until a round has **zero** misses.

### 4. Perfect run (unlock next table)

- **`hadMissThisPack`** is set if **any** answer in the pack’s quiz attempts is wrong or timed out (including retries).
- On the pack-complete screen, if **`hadMissThisPack`** is true:
  - The learner **does not** unlock the next column.
  - **Continue** sends them back to **intro from the start** (card 1) for the **same** table, with quiz/review/advance state cleared and the miss flag cleared.
- If the completing round was **perfect** (no misses that pack), **Continue** bumps **`highestUnlockedTable`** and returns to the level grid (or handles **mode complete** / **grand complete** when finishing table 10).

Finishing all tables in a mode unlocks the **next medal mode** on the picker (Bronze → silver flag, Silver → gold flag, Gold → `grandComplete` celebration).

## Points (implemented)

- **Cumulative `totalPoints`** and per-fact **`factRewardWeight`** live on the saved game (`src/lib/persistence.ts`); rules in **`src/lib/points.ts`**.
- **Baseline:** each **correct** timed answer adds **0.1** points for that fact.
- **After a miss** (wrong or timeout) on a fact, the **next correct** on that fact earns up to **0.2**; each subsequent correct on that fact **decays** the weight back toward **0.1** (exponential decay on the amount above 0.1 — constant `POINT_WEIGHT_DECAY`).
- Intro cards do **not** award points.
- **Redeem** (top bar): parent password **`1234`** clears **`totalPoints`** and **`factRewardWeight`** (client-only gate; not secure against inspection).
- **UX:** Total appears in the **top-right** on all screens; on a correct answer the pill **wiggles** (CSS keyframes). **`prefers-reduced-motion: reduce`** disables that animation.
- **Copy:** The mode picker deliberately **does not** explain scoring in the footer — learners discover it through play and the pill tooltip.

## Edge cases

- **Timeout** = incorrect (wrong stack + miss flag for the pack + fact weight bump for points).
- **Duplicate** misses on the same fact in a round still yield **one** entry in the retry set.

## Persistence

- **`localStorage`** key: `multiplication-tutor-v1`.
- Saved shape is **`v: 4`** (older **`v: 3`** loads are upgraded on read): `screen`, `activeMode`, per-mode **`ModeProgress`** (`level`, phases `intro` | `quiz` | `review`, quiz slice, `reviewWrongKeys`, `hadMissThisPack`, `awaitingLevelAdvance`, `modeComplete`, …), **`totalPoints`**, **`factRewardWeight`**, mode unlock flags, optional `grandComplete`.
- **Reset progress** clears storage and returns a fresh game (including points and bump UI state in the client).

## Technical map (repo)

| Area | Location |
|------|-----------|
| Fact keys, level ranges, shuffle | `src/lib/facts.ts` |
| Bronze / Silver / Gold timers & unlock helpers | `src/lib/modes.ts` |
| Points math | `src/lib/points.ts` |
| Save / load / migrate / helpers | `src/lib/persistence.ts` |
| Tips | `src/data/tips.ts` |
| UI + state machine | `src/components/MultiplicationGame.tsx` |
| Styles | `src/components/MultiplicationGame.module.css` |
| App entry | `src/app/page.tsx` |

## Future ideas (not implemented)

- Server-side auth or secure “redeem.”
- Audio, haptics, or extra streak rewards beyond points.
- Adjustable timers or accessibility-only overrides in settings.
- Analytics or accounts for cross-device progress.
- Richer tips (images, mnemonics).
