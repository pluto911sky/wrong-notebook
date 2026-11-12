import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '@/components/markdown-renderer';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures-table-math.txt'), 'utf-8');

describe('表格里的公式与换行', () => {
    it('真实题目：竖式 array 的 | 不应把单元格切断，<br> 渲染为换行', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={fixture} />);
        // 三列表格：每行 3 个单元格
        expect(html.match(/<td/g)?.length).toBe(3);
        expect(html).not.toContain('&lt;br&gt;');
        expect(html).not.toContain('katex-error');
        // 公式源码只应出现在 KaTeX 的隐藏 annotation 里，不应作为普通文字漏出来
        const visible = html.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
        expect(visible).not.toContain('ccc}');
        expect(visible).not.toContain('\\begin{array}');
        // 第三列的竖式没有丢
        expect(html).toContain('2394');
        expect(html.match(/<br\/?>/g)?.length).toBeGreaterThanOrEqual(4);
    });
});

describe('表格公式修正的边界', () => {
    it('表格外的 \\| （范数）不受影响', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={'$\\|x\\|$'} />);
        // 源码保持 \|x\|（不在表格里，不做还原）
        expect(html).toContain('\\|x\\|</annotation>');
        expect(html).not.toContain('katex-error');
    });

    it('表格里的绝对值 |x| 不再切断单元格', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={'| a | b |\n|---|---|\n| $|x|$ | 2 |'} />);
        expect(html.match(/<td/g)?.length).toBe(2);
        expect(html).not.toContain('katex-error');
    });

    it('段落里的 <br> 也转成换行，其他 HTML 仍不渲染', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={'a<br>b <script>x</script>'} />);
        expect(html).toContain('<br/>');
        expect(html).not.toContain('<script>');
    });
});
