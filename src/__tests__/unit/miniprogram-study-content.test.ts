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

it('接受用两把三角尺相减的等价描述，拒绝只写结果或用了没有的角', () => {
    const { setSquareAnswerMatches } = require('../../../cloudfunctions/errorbookApi/practice');
    const question = '用一副三角尺画一个15°的角，可以怎样操作？请描述画法。';
    expect(setSquareAnswerMatches(question, '用等腰直角三角形的 45 度角减去普通直角三角形的 30 度角。这样就可以得到 15 度的角。')).toBe(true);
    expect(setSquareAnswerMatches(question, '15°')).toBe(false);
    expect(setSquareAnswerMatches(question, '45°加30°')).toBe(false);
    expect(setSquareAnswerMatches(question, '50°减35°')).toBe(false);
    expect(setSquareAnswerMatches('计算 15° 的角度', '45°减30°')).toBe(false);
});
