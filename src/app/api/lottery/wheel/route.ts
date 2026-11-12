import { NextResponse } from "next/server";
import { computeEffectiveShares, getBlankRate } from "@/lib/lottery";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:lottery:wheel');

/**
 * GET /api/lottery/wheel —— 转盘布局
 *
 * 返回参与抽奖的**全部**奖品（含 isBlank 的「谢谢参与」），顺序固定。
 * 前端按 weight 画等比例扇区，并用返回的 id 把抽奖结果映射到扇区。
 *
 * 为什么要把 weight 暴露出去：
 *   扇区大小本身就等比例地反映了概率，藏 weight 没有意义；
 *   反而会让前端无法画出正确的扇区比例。
 *
 * 注意：这里的筛选条件必须与 drawOnce() 完全一致，
 *   否则会出现「抽中了但转盘上没有这个扇区」的情况。
 */
export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return unauthorized();
    }

    try {
        const prizes = await prisma.prize.findMany({
            where: {
                enabled: true,
                OR: [{ stock: null }, { stock: { gt: 0 } }],
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
                id: true,
                name: true,
                weight: true,
                isBlank: true,
                imagePath: true,
            },
        });

        // 扇区大小与显示的百分比都按「实际概率」计算（30% 谢谢惠顾 + 70% 按权重分给真实奖品），
        // 否则转盘看起来的概率与真实抽奖规则对不上
        const shares = computeEffectiveShares(prizes, getBlankRate());

        return NextResponse.json({
            wheel: prizes.map((p) => {
                const share = shares.get(p.id) ?? 0;
                return {
                    id: p.id,
                    name: p.name,
                    // 以万分比作为扇区权重，避免小概率奖品被 Math.max(1, …) 放大
                    weight: Math.max(1, Math.round(share * 100)),
                    isBlank: p.isBlank,
                    hasImage: !!p.imagePath,
                    share: Math.round(share * 100) / 100,
                };
            }),
            totalWeight: 10000,
        });
    } catch (error) {
        logger.error({ error }, 'Error loading wheel layout');
        return internalError("Failed to load wheel layout");
    }
}
