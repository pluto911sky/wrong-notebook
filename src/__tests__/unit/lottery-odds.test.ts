import { describe, it, expect } from 'vitest';
import { DEFAULT_BLANK_RATE, normalizeBlankRate, rollBlank } from '@/lib/lottery-odds';

describe('lottery odds', () => {
    it('配置兜底', () => {
        expect(normalizeBlankRate(undefined)).toBe(DEFAULT_BLANK_RATE);
        expect(normalizeBlankRate('0.5')).toBe(DEFAULT_BLANK_RATE);
        expect(normalizeBlankRate(1)).toBe(DEFAULT_BLANK_RATE);
        expect(normalizeBlankRate(0)).toBe(0);
        expect(normalizeBlankRate(0.25)).toBe(0.25);
    });

    it('模拟 1 万次，谢谢惠顾约占 30%', () => {
        let blank = 0;
        for (let i = 0; i < 10_000; i++) if (rollBlank(DEFAULT_BLANK_RATE)) blank++;
        // 标准差约 0.46%，±2% 足够稳定
        expect(blank / 10_000).toBeGreaterThan(0.28);
        expect(blank / 10_000).toBeLessThan(0.32);
    });
});
