/**
 * 抽奖空奖概率（抽奖页与宠物心愿卡包共用）
 *
 * 每次抽奖先按 blankRate 判定是否为「谢谢惠顾」，未落空时再从真实奖品中抽取。
 * 奖品权重只决定「中了的话中哪个」，不再影响中奖率。
 */
export const DEFAULT_BLANK_RATE = 0.3;
export const BLANK_PRIZE_NAME = "谢谢惠顾";

/** 配置值兜底：非数字或越界时回到默认值，最高 95%（避免配置失误导致永远抽不中） */
export function normalizeBlankRate(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 0.95) {
        return DEFAULT_BLANK_RATE;
    }
    return value;
}

/** 这一次是否落空；random 可注入，便于测试 */
export function rollBlank(blankRate: number, random: () => number = Math.random): boolean {
    return random() < blankRate;
}
