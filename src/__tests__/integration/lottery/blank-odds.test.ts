// @vitest-environment node
/** 真实迁移后的 SQLite：验证 30% 谢谢惠顾的两段式抽奖 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteFixture, seedLotteryUsers, type SqliteFixture } from './sqlite-fixture';

const config = vi.hoisted(() => ({ lottery: { enabled: true, drawsPerDay: 0, blankRate: 0.3 } }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => config }));

let fixture: SqliteFixture;
let lottery: typeof import('@/lib/lottery');

beforeAll(async () => {
    fixture = await createSqliteFixture();
    await seedLotteryUsers(fixture.client);
    vi.doMock('@/lib/prisma', () => ({ prisma: fixture.client }));
    vi.resetModules();
    lottery = await import('@/lib/lottery');
}, 60_000);

afterAll(async () => { await fixture?.cleanup(); });

beforeEach(async () => {
    vi.restoreAllMocks();
    await fixture.client.drawRecord.deleteMany();
    await fixture.client.prize.deleteMany();
});

describe('谢谢惠顾概率', () => {
    it('落空时启用已停用的「谢谢参与」并记录为空奖', async () => {
        await fixture.client.prize.create({ data: { name: '零食券', weight: 50 } });
        const blank = await fixture.client.prize.create({ data: { name: '谢谢参与', isBlank: true, enabled: false } });
        vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.3 → 落空

        const result = await lottery.drawOnce('owner');
        expect(result).toMatchObject({ isBlank: true, prizeId: blank.id });
        expect((await fixture.client.prize.findUniqueOrThrow({ where: { id: blank.id } })).enabled).toBe(true);
    });

    it('没有任何空奖时自动创建「谢谢惠顾」', async () => {
        await fixture.client.prize.create({ data: { name: '零食券' } });
        vi.spyOn(Math, 'random').mockReturnValue(0.1);

        const result = await lottery.drawOnce('owner');
        expect(result).toMatchObject({ isBlank: true, prizeName: '谢谢惠顾' });
    });

    it('未落空时只会抽到真实奖品，即使空奖权重很大', async () => {
        const real = await fixture.client.prize.create({ data: { name: '零食券', weight: 1 } });
        await fixture.client.prize.create({ data: { name: '谢谢惠顾', isBlank: true, weight: 1000 } });
        vi.spyOn(Math, 'random').mockReturnValue(0.5); // ≥ 0.3 → 进入真实奖品池

        const result = await lottery.drawOnce('owner');
        expect(result).toMatchObject({ isBlank: false, prizeId: real.id });
    });

    it('转盘与后台显示的概率按实际规则换算', () => {
        const shares = lottery.computeEffectiveShares([
            { id: 'a', weight: 3, isBlank: false },
            { id: 'b', weight: 1, isBlank: false },
            { id: 'blank', weight: 999, isBlank: true },
        ], 0.3);
        expect(shares.get('blank')).toBeCloseTo(30);
        expect(shares.get('a')).toBeCloseTo(52.5);
        expect(shares.get('b')).toBeCloseTo(17.5);
    });

    it('真实随机 300 次，空奖率约 30%（与权重无关）', async () => {
        await fixture.client.prize.create({ data: { name: '零食券', weight: 25 } });
        await fixture.client.prize.create({ data: { name: '游戏卡', weight: 18 } });
        await fixture.client.prize.create({ data: { name: '谢谢惠顾', isBlank: true, weight: 1 } });

        let blank = 0;
        for (let i = 0; i < 300; i++) {
            if ((await lottery.drawOnce('owner')).isBlank) blank++;
        }
        // 300 次的标准差约 2.6%，0.2~0.4 的区间足够稳定
        expect(blank / 300).toBeGreaterThan(0.2);
        expect(blank / 300).toBeLessThan(0.4);
    }, 60_000);
});
