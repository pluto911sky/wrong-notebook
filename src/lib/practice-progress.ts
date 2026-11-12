/**
 * 举一反三闯关规则（前后端共用的纯函数，无 Node 依赖）
 *
 * 关卡顺序：类似题型(medium) → 困难模式(hard) → 挑战压轴(harder)
 *  - 第一关默认解锁；答对上一关才解锁下一关；
 *  - 每关每天只能作答一次（答错次日再来）；
 *  - 答对即通关，之后只能查看，不能再作答。
 * 这样同一题无法反复刷奖励：每道错题最多发 3 次奖励（每关一次）。
 */

export const PRACTICE_LEVELS = ["medium", "hard", "harder"] as const;
export type PracticeLevel = typeof PRACTICE_LEVELS[number];

export const PRACTICE_LEVEL_LABELS: Record<PracticeLevel, string> = {
    medium: "类似题型",
    hard: "困难模式",
    harder: "挑战压轴",
};

export function isPracticeLevel(value: unknown): value is PracticeLevel {
    return typeof value === "string" && (PRACTICE_LEVELS as readonly string[]).includes(value);
}

export interface PracticeAttemptRecord {
    difficulty: string | null;
    isCorrect: boolean | null;
    createdAt: Date | string;
}

export interface LevelState {
    level: PracticeLevel;
    /** 已答对（通关），之后只能查看 */
    cleared: boolean;
    /** 今天已经作答过（无论对错） */
    attemptedToday: boolean;
    /** 曾经作答过（任意一天）：作答过的关卡不允许再换题 */
    attempted: boolean;
    /** 前一关已通关（第一关恒为 true） */
    unlocked: boolean;
    /** 现在能否作答 = 已解锁 && 未通关 && 今天没答过 */
    canAttempt: boolean;
}

export interface PracticeProgress {
    levels: Record<PracticeLevel, LevelState>;
    /** 下一个要攻克的关卡（第一个未通关的）；全部通关时为 null */
    currentLevel: PracticeLevel | null;
    allCleared: boolean;
}

export function startOfDay(now: Date): Date {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function computePracticeProgress(records: PracticeAttemptRecord[], now: Date = new Date()): PracticeProgress {
    const todayStart = startOfDay(now).getTime();
    const levels = {} as Record<PracticeLevel, LevelState>;
    let previousCleared: boolean = true;

    for (const level of PRACTICE_LEVELS) {
        const mine = records.filter((r) => r.difficulty === level);
        const cleared = mine.some((r) => r.isCorrect === true);
        const attemptedToday = mine.some((r) => new Date(r.createdAt).getTime() >= todayStart);
        const unlocked: boolean = previousCleared;
        levels[level] = {
            level,
            cleared,
            attemptedToday,
            attempted: mine.length > 0,
            unlocked,
            canAttempt: unlocked && !cleared && !attemptedToday,
        };
        // 只有「已解锁且已通关」才能解锁下一关，避免异常数据造成跳关
        previousCleared = unlocked && cleared;
    }

    const currentLevel = PRACTICE_LEVELS.find((l) => !levels[l].cleared) ?? null;
    return { levels, currentLevel, allCleared: currentLevel === null };
}

/**
 * 判断作答是否正确（沿用原先前端的宽松匹配规则，只是改到服务端执行）：
 * 忽略大小写与常见标点/量词；选择题只写选项字母也算对；答案包含作答内容也算对。
 */
export function isAnswerCorrect(userAnswer: string, correctAnswer: string): boolean {
    const normalize = (str: string) => str.trim().toLowerCase().replace(/[.,;!元箱本个]/g, "");
    const user = normalize(userAnswer);
    const correct = normalize(correctAnswer);
    if (!user) return false;
    if (user === correct) return true;
    if (/^[a-d]$/.test(user) && correct.startsWith(user)) return true;
    return correct.includes(user);
}
