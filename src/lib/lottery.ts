/**
 * 抽奖核心逻辑（独立功能，不与错题、积分挂钩）
 *
 * 设计要点：
 *  1. 两段式抽奖：先按 blankRate（默认 30%）判定是否「谢谢惠顾」，
 *     未落空再在真实奖品（isBlank=false）里按权重 weight 抽取。
 *     这样中奖率固定为 1 - blankRate，不受管理员配置的权重影响；
 *     之前空奖完全靠权重，「谢谢参与」被停用后变成了 100% 中奖。
 *  2. 库存扣减用「条件更新 + 影响行数判断」：
 *        updateMany({ where: { id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } })
 *     若 count === 0，说明被并发请求抽走了，需要重抽。
 *     不能「先查库存再扣」，那在并发下会超发。
 *  3. 中奖时把奖品名称与图片快照写入记录，之后管理员改名换图不影响历史。
 */
import { prisma } from './prisma';
import { getAppConfig } from './config';
import { BLANK_PRIZE_NAME, normalizeBlankRate, rollBlank } from './lottery-odds';
import type { Prisma } from '@prisma/client';

/** 每天可抽次数：0 表示不限 */
export function getDrawsPerDay(): number {
    const cfg = getAppConfig();
    const n = cfg.lottery?.drawsPerDay;
    if (typeof n !== 'number' || Number.isNaN(n) || n < 0) return 1; // 默认每天 1 次
    return Math.floor(n);
}

/**
 * 每个奖品的实际中奖概率（百分比）：
 * 空奖平分 blankRate，真实奖品按权重平分剩下的 1 - blankRate。
 * 没有真实奖品时空奖为 100%；没有启用的空奖时，落空概率仍存在（抽奖时会自动补建「谢谢惠顾」）。
 */
export function computeEffectiveShares(
    prizes: { id: string; weight: number; isBlank: boolean }[],
    blankRate: number
): Map<string, number> {
    const real = prizes.filter((p) => !p.isBlank);
    const blank = prizes.filter((p) => p.isBlank);
    const sum = (list: typeof prizes) => list.reduce((acc, p) => acc + Math.max(1, p.weight), 0);
    const realTotal = sum(real);
    const blankTotal = sum(blank);
    const blankPart = real.length === 0 ? 1 : blankRate;

    const shares = new Map<string, number>();
    for (const p of real) shares.set(p.id, ((1 - blankPart) * Math.max(1, p.weight)) / realTotal * 100);
    for (const p of blank) shares.set(p.id, (blankPart * Math.max(1, p.weight)) / blankTotal * 100);
    return shares;
}

/** 「谢谢惠顾」概率，默认 30% */
export function getBlankRate(): number {
    return normalizeBlankRate(getAppConfig().lottery?.blankRate);
}

/**
 * 取得「谢谢惠顾」奖品（每次落空都要写一条指向它的抽奖记录）。
 * 优先用已启用的空奖；没有时把已有的「谢谢参与/谢谢惠顾」空奖重新启用，再没有就新建一条。
 */
async function ensureBlankPrize(tx: Prisma.TransactionClient) {
    const enabled = await tx.prize.findFirst({
        where: { isBlank: true, enabled: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (enabled) return enabled;

    const existing = await tx.prize.findFirst({
        where: { isBlank: true, name: { startsWith: '谢谢' } },
        orderBy: { createdAt: 'asc' },
    });
    if (existing) {
        return tx.prize.update({ where: { id: existing.id }, data: { enabled: true } });
    }
    return tx.prize.create({
        data: { name: BLANK_PRIZE_NAME, isBlank: true, weight: 1, enabled: true, sortOrder: 999 },
    });
}

export function isLotteryEnabled(): boolean {
    const cfg = getAppConfig();
    return cfg.lottery?.enabled !== false; // 默认开启
}

/** 今日已抽次数（按服务器本地时区的自然日） */
export async function getTodayDrawCount(userId: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return prisma.drawRecord.count({
        where: { userId, createdAt: { gte: start } },
    });
}

export interface LotteryStatus {
    enabled: boolean;
    drawsPerDay: number;
    drawsUsedToday: number;
    drawsLeft: number;      // 剩余次数；drawsPerDay 为 0 时用 -1 表示不限
    canDraw: boolean;
    reason?: string;        // 不可抽的原因
    prizeCount: number;     // 可抽奖品数量（不含「谢谢参与」）
}

export async function getLotteryStatus(userId: string): Promise<LotteryStatus> {
    const enabled = isLotteryEnabled();
    const drawsPerDay = getDrawsPerDay();
    const drawsUsedToday = await getTodayDrawCount(userId);

    const [prizeCount, poolCount] = await Promise.all([
        prisma.prize.count({ where: { enabled: true, isBlank: false } }),
        prisma.prize.count({
            where: {
                enabled: true,
                OR: [{ stock: null }, { stock: { gt: 0 } }],
            },
        }),
    ]);

    const unlimited = drawsPerDay === 0;
    const drawsLeft = unlimited ? -1 : Math.max(0, drawsPerDay - drawsUsedToday);

    let canDraw = true;
    let reason: string | undefined;

    if (!enabled) {
        canDraw = false;
        reason = 'lottery_disabled';
    } else if (poolCount === 0) {
        canDraw = false;
        reason = 'no_prizes';
    } else if (!unlimited && drawsLeft === 0) {
        canDraw = false;
        reason = 'daily_limit_reached';
    }

    return { enabled, drawsPerDay, drawsUsedToday, drawsLeft, canDraw, reason, prizeCount };
}

export class DrawError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

export interface DrawResult {
    prizeId: string;
    prizeName: string;
    prizeDescription: string | null;
    prizeImagePath: string | null;
    isBlank: boolean;
    recordId: string | null;   // 「谢谢参与」也会落库，便于统计
    stockLeft: number | null;
}

/** 按权重挑一个候选（已按库存过滤） */
function weightedPick<T extends { weight: number }>(items: T[]): T | null {
    const total = items.reduce((sum, it) => sum + Math.max(1, it.weight), 0);
    if (total <= 0) return null;

    let r = Math.random() * total;
    for (const it of items) {
        r -= Math.max(1, it.weight);
        if (r < 0) return it;
    }
    return items[items.length - 1] ?? null;
}

// SQLite has one writer. Avoid competing interactive BEGIN calls in this process;
// the database transaction below remains authoritative across processes/engines.
let drawQueue: Promise<void> = Promise.resolve();

/**
 * 执行一次抽奖。
 *
 * 注意：整个流程在一个事务里完成，包含
 *   ① 复查今日次数（防止并发绕过每日上限）
 *   ② 过滤可抽奖品 → 加权随机
 *   ③ 条件更新扣库存（失败则重抽，最多 MAX_RETRY 次）
 *   ④ 写中奖记录
 */
export async function drawOnce(userId: string): Promise<DrawResult> {
    const result = drawQueue.then(() => drawOnceInTransaction(userId));
    // A failed draw must release the queue rather than reject every later draw.
    drawQueue = result.then(() => undefined, () => undefined);
    return result;
}

async function drawOnceInTransaction(userId: string): Promise<DrawResult> {
    const MAX_RETRY = 5;

    if (!isLotteryEnabled()) {
        throw new DrawError('lottery_disabled', '抽奖功能已关闭');
    }

    const drawsPerDay = getDrawsPerDay();

    return prisma.$transaction(async (tx) => {
        // ① 事务内复查次数（SQLite 写事务串行执行，此处足够）
        if (drawsPerDay > 0) {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const used = await tx.drawRecord.count({
                where: { userId, createdAt: { gte: start } },
            });
            if (used >= drawsPerDay) {
                throw new DrawError('daily_limit_reached', '今天的抽奖次数已用完');
            }
        }

        // ② 取候选池：真实奖品与空奖分开
        const candidates = await tx.prize.findMany({
            where: {
                enabled: true,
                OR: [{ stock: null }, { stock: { gt: 0 } }],
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        let pool = candidates.filter((p) => !p.isBlank);
        const blankPool = candidates.filter((p) => p.isBlank);

        if (candidates.length === 0) {
            throw new DrawError('no_prizes', '管理员还没有配置可抽的奖品');
        }

        const writeRecord = async (prize: typeof candidates[number]) => {
            const record = await tx.drawRecord.create({
                data: {
                    userId,
                    prizeId: prize.id,
                    prizeName: prize.name,
                    prizeImagePath: prize.imagePath,
                },
            });
            return {
                prizeId: prize.id,
                prizeName: prize.name,
                prizeDescription: prize.description,
                prizeImagePath: prize.imagePath,
                isBlank: prize.isBlank,
                recordId: record.id,
                stockLeft: prize.stock === null ? null : prize.stock - 1,
            };
        };

        const drawBlank = async () => {
            const blank = weightedPick(blankPool) ?? await ensureBlankPrize(tx);
            return writeRecord({ ...blank, stock: null });
        };

        // ③ 先判定是否落空（默认 30%）；没有真实奖品可抽时也只能落空
        if (pool.length === 0 || rollBlank(getBlankRate())) {
            return drawBlank();
        }

        // ④ 在真实奖品里加权随机 + 条件扣库存
        for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
            const picked = weightedPick(pool);
            if (!picked) break;

            // 限量奖品：条件更新，count 为 0 说明刚好被抽走
            if (picked.stock !== null) {
                const updated = await tx.prize.updateMany({
                    where: { id: picked.id, stock: { gt: 0 } },
                    data: { stock: { decrement: 1 } },
                });
                if (updated.count === 0) {
                    // 从候选池移除后重抽
                    pool = pool.filter((p) => p.id !== picked.id);
                    if (pool.length === 0) break;
                    continue;
                }
            }

            // ⑤ 写记录（含快照）
            return writeRecord(picked);
        }

        // 限量奖品恰好被并发抽完：本次按落空处理
        if (pool.length === 0) {
            return drawBlank();
        }
        throw new DrawError('no_stock', '奖品刚刚被抽完了，请稍后再试');
    });
}
