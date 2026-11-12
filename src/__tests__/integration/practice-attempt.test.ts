// @vitest-environment node
/** 举一反三闯关防刷：真实迁移后的 SQLite + 真实路由，只替换登录态与日志 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { createSqliteFixture, seedLotteryUsers, type SqliteFixture } from './lottery/sqlite-fixture';

const state = vi.hoisted(() => ({
    session: { user: { id: 'owner', email: 'owner@lottery.test' }, expires: '2099-01-01T00:00:00.000Z' } as Session | null,
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => state.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

let fixture: SqliteFixture;
let attemptApi: typeof import('@/app/api/practice/attempt/route');
let progressApi: typeof import('@/app/api/practice/progress/route');
let itemId: string;

const variant = (answer: string) => ({
    questionText: `Q-${answer}`, answerText: answer, analysis: 'A', knowledgePoints: [], subject: '数学',
    wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', requiresImage: false,
});

const attempt = (difficulty: string, userAnswer: string) =>
    attemptApi.POST(new Request('http://test/api/practice/attempt', {
        method: 'POST',
        body: JSON.stringify({ errorItemId: itemId, difficulty, userAnswer }),
    }));

beforeAll(async () => {
    fixture = await createSqliteFixture();
    await seedLotteryUsers(fixture.client);
    vi.doMock('@/lib/prisma', () => ({ prisma: fixture.client }));
    vi.resetModules();
    attemptApi = await import('@/app/api/practice/attempt/route');
    progressApi = await import('@/app/api/practice/progress/route');
}, 60_000);

afterAll(async () => { await fixture?.cleanup(); });

beforeEach(async () => {
    state.session = { user: { id: 'owner', email: 'owner@lottery.test' }, expires: '2099-01-01T00:00:00.000Z' } as Session;
    await fixture.client.practiceRecord.deleteMany();
    await fixture.client.errorItem.deleteMany();
    const item = await fixture.client.errorItem.create({
        data: {
            userId: 'owner',
            originalImageUrl: '',
            questionText: '原题',
            ocrText: JSON.stringify({ medium: variant('4'), hard: variant('8'), harder: variant('16') }),
        },
    });
    itemId = item.id;
});

describe('POST /api/practice/attempt', () => {
    it('必须按顺序闯关：第一关之前不能做困难模式', async () => {
        const res = await attempt('hard', '8');
        expect(res.status).toBe(403);
        expect((await res.json()).message).toBe('PRACTICE_LOCKED');
    });

    it('答错后当天不能再答，也拿不到奖励', async () => {
        const first = await attempt('medium', '5');
        expect(first.status).toBe(200);
        expect(await first.json()).toMatchObject({ isCorrect: false, rewarded: false });

        const again = await attempt('medium', '4');
        expect(again.status).toBe(429);
        expect((await again.json()).message).toBe('PRACTICE_DAILY_LIMIT');
    });

    it('答对即通关并解锁下一关；通关后不能重做刷奖励', async () => {
        const ok = await attempt('medium', '4');
        const body = await ok.json();
        expect(body).toMatchObject({ isCorrect: true, rewarded: true });
        expect(body.progress.levels.hard.unlocked).toBe(true);

        const replay = await attempt('medium', '4');
        expect(replay.status).toBe(409);
        expect((await replay.json()).message).toBe('PRACTICE_ALREADY_CLEARED');
        expect(await fixture.client.practiceRecord.count({ where: { errorItemId: itemId, isCorrect: true } })).toBe(1);
    });

    it('连点两次提交只记一次', async () => {
        const [a, b] = await Promise.all([attempt('medium', '4'), attempt('medium', '4')]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        expect(await fixture.client.practiceRecord.count({ where: { errorItemId: itemId } })).toBe(1);
    });

    it('三关全部通关后自动标记已掌握', async () => {
        await attempt('medium', '4');
        await attempt('hard', '8');
        const last = await (await attempt('harder', '16')).json();
        expect(last).toMatchObject({ isCorrect: true, mastered: true });
        expect((await fixture.client.errorItem.findUniqueOrThrow({ where: { id: itemId } })).masteryLevel).toBe(2);
    });

    it('不能操作别人的错题', async () => {
        state.session = { user: { id: 'other', email: 'other@lottery.test' }, expires: '2099-01-01T00:00:00.000Z' } as Session;
        expect((await attempt('medium', '4')).status).toBe(404);
        const res = await progressApi.GET(new Request(`http://test/api/practice/progress?errorItemId=${itemId}`));
        expect(res.status).toBe(404);
    });
});
