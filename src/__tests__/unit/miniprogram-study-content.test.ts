import { describe, expect, it } from 'vitest';

const { formatBlocks } = require('../../../miniprogram/components/study-content/format');
const { practiceAnswerMatches } = require('../../../cloudfunctions/errorbookApi/practice');

describe('小程序内容和练习答案格式', () => {
    it('显示表格、常见公式，并保留无法识别的公式原文', () => {
        const text = String.raw`求 $x^{2} \times 3$，保留 $\begin{matrix}x$。
| 项目 | 值 |
| --- | --- |
| A | $\frac{1}{2}$ |`;
        const [paragraph, table] = formatBlocks(text);
        expect(paragraph.text).toBe(String.raw`求 x² × 3，保留 $\begin{matrix}x$。`);
        expect(table.rows[1].cells).toEqual(['A', '(1)⁄(2)']);
    });

    it('准确比较有限小数和分数，拒绝不同变量与不同单位', () => {
        expect(practiceAnswerMatches('x=1/2', '0.50')).toBe(true);
        expect(practiceAnswerMatches('x=1/2', 'y=0.50')).toBe(false);
        expect(practiceAnswerMatches('1/2', '0.5kg')).toBe(false);
        expect(practiceAnswerMatches('1/2', '1/0')).toBe(false);
    });
});
