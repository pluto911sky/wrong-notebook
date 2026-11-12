import { describe, it, expect } from 'vitest';
import { computePracticeProgress, isAnswerCorrect } from '@/lib/practice-progress';

const now = new Date('2026-11-12T15:00:00');
const today = new Date('2026-11-12T09:00:00');
const yesterday = new Date('2026-11-11T20:00:00');

describe('computePracticeProgress', () => {
    it('新题只开放第一关「类似题型」', () => {
        const p = computePracticeProgress([], now);
        expect(p.currentLevel).toBe('medium');
        expect(p.levels.medium).toMatchObject({ unlocked: true, canAttempt: true, cleared: false });
        expect(p.levels.hard.unlocked).toBe(false);
        expect(p.levels.harder.unlocked).toBe(false);
    });

    it('答错的关卡当天不能再答，第二天可以', () => {
        const wrongToday = computePracticeProgress([{ difficulty: 'medium', isCorrect: false, createdAt: today }], now);
        expect(wrongToday.levels.medium).toMatchObject({ attemptedToday: true, canAttempt: false, cleared: false });
        expect(wrongToday.levels.hard.unlocked).toBe(false);

        const wrongYesterday = computePracticeProgress([{ difficulty: 'medium', isCorrect: false, createdAt: yesterday }], now);
        expect(wrongYesterday.levels.medium.canAttempt).toBe(true);
    });

    it('答对后通关只读，并解锁下一关；必须按顺序解锁', () => {
        const p = computePracticeProgress([{ difficulty: 'medium', isCorrect: true, createdAt: yesterday }], now);
        expect(p.levels.medium).toMatchObject({ cleared: true, canAttempt: false });
        expect(p.levels.hard).toMatchObject({ unlocked: true, canAttempt: true });
        expect(p.levels.harder.unlocked).toBe(false);
        expect(p.currentLevel).toBe('hard');
    });

    it('跳关的旧记录不会解锁后续关卡', () => {
        const p = computePracticeProgress([{ difficulty: 'hard', isCorrect: true, createdAt: yesterday }], now);
        expect(p.levels.hard.unlocked).toBe(false);
        expect(p.levels.harder.unlocked).toBe(false);
        expect(p.currentLevel).toBe('medium');
    });

    it('三关全部通关', () => {
        const p = computePracticeProgress([
            { difficulty: 'medium', isCorrect: true, createdAt: yesterday },
            { difficulty: 'hard', isCorrect: true, createdAt: today },
            { difficulty: 'harder', isCorrect: true, createdAt: today },
        ], now);
        expect(p.allCleared).toBe(true);
        expect(p.currentLevel).toBeNull();
    });
});

describe('isAnswerCorrect', () => {
    it('沿用原有宽松匹配规则', () => {
        expect(isAnswerCorrect('B', 'B. goes')).toBe(true);
        expect(isAnswerCorrect('21箱', '21')).toBe(true);
        expect(isAnswerCorrect('4', '$4$')).toBe(true);
        expect(isAnswerCorrect('  ', '4')).toBe(false);
        expect(isAnswerCorrect('5', '4')).toBe(false);
    });
});
