/**
 * AI 标签式响应的公共解析逻辑（原先在三个 Provider 中各复制一份）
 */
import type { ParsedQuestion } from './types';
import { safeParseParsedQuestion } from './schema';
import { normalizeMistakeStatusForSave } from '../mistake-status';
import { AIError } from './errors';

const VALID_SUBJECTS: ParsedQuestion['subject'][] = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"];

/**
 * 提取 <tag>...</tag> 的内容。
 * 取「第一个开标签」到「其后第一个闭标签」，避免模型重复输出同名标签时把中间内容全部吞进来。
 * allowUnclosed：闭标签缺失时读到文本末尾（输出被截断时最后一个标签通常不闭合）。
 */
export function extractTag(text: string, tagName: string, allowUnclosed = false): string | null {
    const startTag = `<${tagName}>`;
    const endTag = `</${tagName}>`;
    const startIndex = text.indexOf(startTag);
    if (startIndex === -1) return null;

    const contentStart = startIndex + startTag.length;
    const endIndex = text.indexOf(endTag, contentStart);
    if (endIndex === -1) {
        return allowUnclosed ? text.substring(contentStart).trim() : null;
    }
    return text.substring(contentStart, endIndex).trim();
}

export function parseKnowledgePoints(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw.split(/[,，、\n]/).map(k => k.trim()).filter(k => k.length > 0);
}

export function normalizeSubject(raw: string | null | undefined): ParsedQuestion['subject'] {
    const value = (raw || '').trim();
    return (VALID_SUBJECTS as string[]).includes(value) ? value as ParsedQuestion['subject'] : '其他';
}

/**
 * 解析识别 / 举一反三的标签式输出。
 * 缺少关键标签时抛 AI_RESPONSE_ERROR；truncated=true（模型因输出上限被截断）时抛 AI_RESPONSE_TRUNCATED，
 * 便于前端给出准确提示。
 */
export function parseQuestionResponse(text: string, options: { truncated?: boolean } = {}): ParsedQuestion {
    // 模型按提示词声明图片里没有题目（空白图、无关图片），不能当作识别成功
    if (extractTag(text, 'no_question')?.toLowerCase() === 'true') {
        throw new AIError('AI_NO_QUESTION_FOUND', 'model reported no question in image');
    }
    const questionText = extractTag(text, 'question_text');
    const answerText = extractTag(text, 'answer_text');
    // analysis 是最后一个标签，被截断时可能不闭合，允许读到末尾
    const analysis = extractTag(text, 'analysis', true);
    const wrongAnswerText = extractTag(text, 'wrong_answer_text') || '';
    const mistakeAnalysis = extractTag(text, 'mistake_analysis') || '';

    if (!questionText || !answerText || !analysis) {
        throw new AIError(
            options.truncated ? 'AI_RESPONSE_TRUNCATED' : 'AI_RESPONSE_ERROR',
            `Missing critical tags. sample=${text.substring(0, 300)}`
        );
    }

    const result: ParsedQuestion = {
        questionText,
        answerText,
        analysis,
        wrongAnswerText,
        mistakeAnalysis,
        mistakeStatus: normalizeMistakeStatusForSave(extractTag(text, 'mistake_status'), wrongAnswerText),
        subject: normalizeSubject(extractTag(text, 'subject')),
        // 超过 5 个时截断，而不是让 schema 校验失败
        knowledgePoints: parseKnowledgePoints(extractTag(text, 'knowledge_points')).slice(0, 5),
        requiresImage: extractTag(text, 'requires_image')?.toLowerCase().trim() === 'true',
    };

    const validation = safeParseParsedQuestion(result);
    return validation.success ? validation.data : result;
}
