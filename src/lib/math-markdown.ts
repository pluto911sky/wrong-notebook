import type { Root } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';

/** Normalize legacy delimiters without modifying LaTeX commands or code. */
export function normalizeMathMarkdown(content: string): string {
    const normalized = content.replace(
        /(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[ \t]*$|(`+)[\s\S]*?\3|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])+\$)|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/gm,
        (match, protectedContent, _fence, _inlineCode, displayMath, inlineMath) => {
            if (protectedContent) return match;
            if (displayMath !== undefined) return `\n\n$$\n${displayMath.trim()}\n$$\n\n`;
            return `$${inlineMath.trim()}$`;
        },
    );
    return escapePipesInTableMath(normalized);
}

/**
 * 表格行里公式中的 `|`（如竖式 `\begin{array}{c|ccc}`、绝对值）会被 GFM 当成单元格分隔符，
 * 导致公式被切断、后面的内容错位到下一格。这里先转义成 `\|`，
 * 渲染时再由 remarkTableCellFixes 在公式节点里还原成 `|`（与 GFM 对行内代码的处理一致）。
 */
function escapePipesInTableMath(content: string): string {
    return content
        .split('\n')
        .map((line) => {
            if (!/^\s*\|/.test(line)) return line;
            return line.replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$/g, (math) => math.replace(/(?<!\\)\|/g, '\\|'));
        })
        .join('\n');
}

/**
 * KaTeX 不支持 array 列格式里的 `@{...}` / `!{...}`（AI 写竖式时常用 `{r@{\quad}l}`），
 * 会整段报错显示成红色源码。去掉这两种间距说明，保留 l/c/r/| 列定义。
 */
function stripUnsupportedArrayColumnSpecs(latex: string): string {
    return latex.replace(/\\begin\{array\}\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_m, spec: string) =>
        `\\begin{array}{${spec.replace(/[@!]\{(?:[^{}]|\{[^{}]*\})*\}/g, '')}}`
    );
}

/**
 * 渲染期修正（remark 插件）：
 * 1. `<br>`：AI 常在表格单元格里用它换行。我们不渲染原始 HTML（防注入），
 *    只把单独的 `<br>` 标签转成 Markdown 换行节点，避免把「<br>」原样显示出来；
 * 2. 表格单元格内公式里的 `\|` 还原为 `|`（见 escapePipesInTableMath）；
 * 3. 公式内部误写的 `<br>` 改为 LaTeX 换行 `\\`。
 */
export function remarkTableCellFixes() {
    return (tree: Root) => {
        visit(tree, (node, index, parent) => {
            if (node.type === 'html' && /^<br\s*\/?>$/i.test(node.value.trim()) && parent && index !== undefined) {
                parent.children.splice(index, 1, { type: 'break' } as never);
                return [SKIP, index + 1];
            }
            if (node.type === 'inlineMath' || node.type === 'math') {
                const mathNode = node as unknown as {
                    value: string;
                    data?: { hChildren?: Array<{ type: string; value?: string }> };
                };
                let value = mathNode.value.replace(/<br\s*\/?>/gi, ' \\\\ ');
                if (parent?.type === 'tableCell') value = value.replace(/(?<!\\)\\\|/g, '|');
                value = stripUnsupportedArrayColumnSpecs(value);
                mathNode.value = value;
                // remark-math 在解析时就把公式文本缓存到 data.hChildren，渲染用的是它，必须同步更新
                const cached = mathNode.data?.hChildren?.[0];
                if (cached?.type === 'text') cached.value = value;
            }
            return undefined;
        });
    };
}
