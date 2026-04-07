export type GameMode = "bronze" | "silver" | "gold";

export const GAME_MODES: readonly GameMode[] = ["bronze", "silver", "gold"];

export function secondsForMode(mode: GameMode): number {
  switch (mode) {
    case "bronze":
      return 10;
    case "silver":
      return 8;
    case "gold":
      return 6;
    default: {
      const _: never = mode;
      return _;
    }
  }
}

export function modeTitle(mode: GameMode): string {
  switch (mode) {
    case "bronze":
      return "Bronze";
    case "silver":
      return "Silver";
    case "gold":
      return "Gold";
    default: {
      const _: never = mode;
      return _;
    }
  }
}

export type ModeUnlockState = {
  silverUnlocked: boolean;
  goldUnlocked: boolean;
};

export function modeIsUnlocked(state: ModeUnlockState, mode: GameMode): boolean {
  if (mode === "bronze") return true;
  if (mode === "silver") return state.silverUnlocked;
  return state.goldUnlocked;
}

/** One-time bonus to `totalPoints` when you first pass a times-table pack in this mode (cumulative quiz). */
export function packMedalCompletionBonus(mode: GameMode): number {
  switch (mode) {
    case "bronze":
      return 0.5;
    case "silver":
      return 1;
    case "gold":
      return 1.5;
    default: {
      const _: never = mode;
      return _;
    }
  }
}
