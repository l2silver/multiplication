# Multiplication tutor — design

## Product goals

Help learners build fluent recall of multiplication facts through **cumulative tables**, a **learn-then-drill** flow, **timed practice** at three difficulty paces, **targeted retries**, and clear **progression rules**: the **narrow** timed round must be **perfect** (no misses); the **cumulative / full-level** round passes with **accuracy above 89%**. **Unlocking the next times table** depends on passing that **full-level** round.

## Navigation & modes

1. **Mode picker** — Choose **Bronze**, **Silver**, or **Gold**. Silver unlocks after clearing every times table (2–10) in Bronze; Gold after the same in Silver.
2. **Level grid** — A 3×3 map for tables **2–10**. Only tables up to **`highestUnlockedTable`** are selectable; the learner works upward.
3. **Play** — A fixed sequence of **intro cards**, **narrow timed quiz** (new row only), **full-mix bridge screen**, **full timed quiz** (everything through this level), optional **review** rounds, then **pack complete** when the **full** quiz passes the accuracy threshold.

Timer per question depends on mode:

| Mode   | Seconds per question |
|--------|----------------------:|
| Bronze | 10 |
| Silver | 8 |
| Gold   | 6 |

## Level model

- Levels are **1-indexed** and **cumulative** (see `src/lib/facts.ts`).
- Level **L** drills **all facts** for tables **2** through **L + 1**, second factor **1–10** (×1 … ×10).
- **Level 1** = 2s only. **Level 9** = 2s through **10s** (`maxTable()` = 10, `maxLevel()` = 9). The UI labels levels by the **table** number (`level + 1`), e.g. “Level 9” corresponds to the 10× table row.

## Phases & pack flow

Progress for the active table is stored in **`ModeProgress`** (`src/lib/persistence.ts`). **`phase`** is one of:

| Phase | Purpose |
|-------|---------|
| **`intro`** | Answer cards for the **new** row only: **(L+1)×1 … (L+1)×10**, one card at a time. Optional tips (`src/data/tips.ts`). No timer. |
| **`quiz`** | Timed drill. Scope is **`quizScope`**: **`narrow`** (that new row only) or **`full`** (all facts for tables 2 … L+1). Shuffled **round** of keys; wrong answers and timeouts accumulate a **wrong stack** for the round. |
| **`fullMixBridge`** | **Between** a passing **narrow** round and the **full** quiz: a non-timed screen that states the learner is about to run the **full mix** (2s through the current table, ×1–×10). **Continue** starts **`quiz`** with **`quizScope: "full"`**. |
| **`review`** | After a round that **fails** the accuracy threshold: list missed facts with answers; **Practice these questions** starts another **`quiz`** retry using **only** those keys (still tagged with the same **`quizScope`** as the failed round). |

**`quizScope`** is stored during **`quiz`** and **`review`**; it is cleared during **`intro`** and **`fullMixBridge`**. Legacy saves without **`quizScope`** infer **narrow** vs **full** from which fact keys appear in the quiz slice.

### Pass rule (timed rounds)

- **Narrow** (`quizScope: "narrow"`): a round **passes** only with **zero** wrong or timed-out questions (including narrow-scoped review retries).
- **Full / cumulative** (`quizScope: "full"`): a round **passes** when **more than 89%** of questions are correct (`roundMeetsPassAccuracy` in **`src/lib/points.ts`**, `LEVEL_PASS_ACCURACY_THRESHOLD = 0.89`).
- **Narrow** must pass to reach the bridge and the **full** mix.
- **Unlocking the next column** requires passing the **full / cumulative** timed round for that level (**> 89%**). **`hadMissThisPack`** may still be set for messaging; it does **not** block unlock after a passing full round.

### Typical happy path

1. **Intro** — advance through 10 cards → start **narrow** quiz.
2. **Narrow quiz** — **perfect** round → **`fullMixBridge`**.
3. **Full mix bridge** — learner reads the heads-up → **Start full mix**.
4. **Full quiz** — finish with **> 89%** correct → **pack-complete** (awaiting advance).

If a timed phase **does not** pass, flow is **review → retry** until a round passes.

### Rounds, retries, lesson review, and restarts

- **Round** = one shuffled pass over the current key set (full level set, narrow set, or review subset).
- **Duplicate** misses on the same fact in one round still produce **one** retry entry.
- **`hadMissThisPack`** is set if **any** timed answer in the pack is wrong or timed out (messaging); it does **not** veto unlock once the **full** round passes.
- **Restart this timed round**: reshuffle and reset to question 1 (`restartCurrentQuizRound`); no change to **`packPointScale`**.
- **Start pack over from lesson**: return to **`intro`** at card 1 and **halve** **`packPointScale`** for correct-answer points on that pack (`restartPackFromLessonWithPointPenalty`). Choosing a level fresh from the grid (non-resume **`selectTable`**) clears **`packPointScale`**.
- **Review lesson**: overlay with the same intro cards as the current level, available during intro, quiz, review, and bridge.

## Points system & backoff

Implemented in **`src/lib/points.ts`**; stored on the save as **`totalPoints`** (cumulative) and **`factRewardWeight`** (per fact key `"a-b"`).

### Baseline and bounds

- **`POINT_BASE` (0.1)** — Default **reward weight** for a fact that has no stored weight yet (first drills).
- **`POINT_FLOOR` (0.01)** — Minimum weight; decay approaches this from above.
- **`POINT_PEAK` (0.2)** — Weight after a **wrong** or **timeout** on that fact; the **next correct** on that fact pays this much (then backoff applies again).

Intro cards **do not** change points or weights. Only **timed quiz** answers (including review retries) do.

**`packPointScale`** (on **`ModeProgress`**, implicit **1**): multiplied onto points from **`applyFactCorrect`** for that pack.

### On a correct timed answer

1. Add **`packPointScale ×`** the fact’s current weight `w` to **`totalPoints`**.
2. **Backoff (decay):** update the stored weight toward the floor:

   `w' = POINT_FLOOR + (w - POINT_FLOOR) × POINT_WEIGHT_DECAY`

   with **`POINT_WEIGHT_DECAY = 0.78`**. The value is **quantized** to three decimal places and clamped to **[POINT_FLOOR, POINT_PEAK]**.

So each repeated correct answer on the same fact earns a bit **less** than the previous one, asymptotically approaching **`POINT_FLOOR`** — a simple **per-fact backoff** that rewards consolidation without letting one easy fact dominate scoring forever.

### On a wrong answer or timeout

- **`applyFactWrong`** sets that fact’s weight to **`POINT_PEAK`**. The **next** correct on that fact pays **0.2** again (scaled by **`packPointScale`**), then decay resumes — i.e. **struggling facts pay more** until they stick.

### UX & redeem

- Total points in the **top-right**; correct answers can **animate** the pill (`prefers-reduced-motion` disables it).
- Quiz UI shows a **preview** of the next reward for the current question (`formatNextRewardPreview`), including **`packPointScale`**.
- **Redeem** (parent password **`1234`**) clears **`totalPoints`** and **`factRewardWeight`** (client-only; not secure against inspection).
- The mode picker footer does **not** spell out scoring; discovery is through play and the pill.

## Edge cases

- **Timeout** counts like a wrong answer: wrong stack, **`hadMissThisPack`**, and **`applyFactWrong`** for points.
- **Level 1**: narrow and full key sets are the same size (10 facts); the learner still goes through **narrow → bridge → full** for a consistent ritual.

## Persistence

- **`localStorage`** key: `multiplication-tutor-v1`.
- Saved shape is **`v: 4`** (older **`v: 3`** loads are upgraded on read): `screen`, `activeMode`, per-mode **`ModeProgress`** (`level`, **`phase`**: `intro` \| `fullMixBridge` \| `quiz` \| `review`, **`quizScope`**: `narrow` \| `full`, quiz slice, `reviewWrongKeys`, `hadMissThisPack`, `awaitingLevelAdvance`, `modeComplete`, **`packPointScale`**, …), **`totalPoints`**, **`factRewardWeight`**, mode unlock flags, optional `grandComplete`.
- **Reset progress** clears storage and returns a fresh game (including points and bump UI state in the client).

## Technical map (repo)

| Area | Location |
|------|----------|
| Fact keys, level ranges, shuffle | `src/lib/facts.ts` |
| Bronze / Silver / Gold timers & unlock helpers | `src/lib/modes.ts` |
| Points math, pass threshold & backoff constants | `src/lib/points.ts` |
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
