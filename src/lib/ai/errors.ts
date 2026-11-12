/**
 * AI 错误码与统一错误分类
 *
 * 三个 Provider（Gemini / OpenAI / Azure）以及直接调用 AI 的路由都通过这里
 * 把底层异常映射成前端可翻译的错误码（见 translations.ts 的 errors 段）。
 */

export const AI_ERROR_CODES = [
    'AI_CONNECTION_FAILED',
    'AI_TIMEOUT_ERROR',
    'AI_QUOTA_EXCEEDED',
    'AI_PERMISSION_DENIED',
    'AI_NOT_FOUND',
    'AI_SERVICE_UNAVAILABLE',
    'AI_RESPONSE_ERROR',
    'AI_RESPONSE_TRUNCATED',
    'AI_CONTENT_BLOCKED',
    'AI_NO_QUESTION_FOUND',
    'AI_AUTH_ERROR',
    'AI_UNKNOWN_ERROR',
] as const;

export type AIErrorCode = typeof AI_ERROR_CODES[number];

/** 字符串本身是错误码，或以 "错误码:" 开头（如 "AI_AUTH_ERROR: key missing"）时返回该错误码 */
export function extractAIErrorCode(message: unknown): AIErrorCode | null {
    if (typeof message !== 'string') return null;
    return AI_ERROR_CODES.find(code => message === code || message.startsWith(`${code}:`)) || null;
}

/** 抛出带错误码的异常；detail 只用于日志，不会展示给用户 */
export class AIError extends Error {
    constructor(public code: AIErrorCode, public detail?: string) {
        super(code);
        this.name = 'AIError';
    }
}

function statusOf(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : null;
}

function codeFromStatus(status: number): AIErrorCode | null {
    if (status === 401) return 'AI_AUTH_ERROR';
    if (status === 403) return 'AI_PERMISSION_DENIED';
    if (status === 404) return 'AI_NOT_FOUND';
    if (status === 408) return 'AI_TIMEOUT_ERROR';
    if (status === 429) return 'AI_QUOTA_EXCEEDED';
    if (status >= 500) return 'AI_SERVICE_UNAVAILABLE';
    return null;
}

/**
 * 把任意异常归类为 AI 错误码。
 * 优先级：已是错误码 > SDK 提供的 HTTP status > 消息关键词。
 * 数字状态码用单词边界匹配，避免请求 ID 里出现 "500" 之类造成误判。
 */
export function classifyAIError(error: unknown): AIErrorCode {
    if (error instanceof AIError) return error.code;

    const rawMessage = error instanceof Error ? error.message : String(error ?? '');
    const existing = extractAIErrorCode(rawMessage);
    if (existing) return existing;

    const byStatus = statusOf(error);
    if (byStatus !== null) {
        const code = codeFromStatus(byStatus);
        if (code) return code;
    }

    const msg = rawMessage.toLowerCase();
    const hasCode = (n: number) => new RegExp(`\\b${n}\\b`).test(msg);

    // 超时判断放最前：SDK 超时的消息通常是 "This operation was aborted"
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort') || hasCode(408)) {
        return 'AI_TIMEOUT_ERROR';
    }
    if (msg.includes('quota') || msg.includes('额度') || msg.includes('rate limit') || msg.includes('too many') || msg.includes('resource_exhausted') || hasCode(429)) {
        return 'AI_QUOTA_EXCEEDED';
    }
    if (msg.includes('api key') || msg.includes('api_key') || msg.includes('unauthorized') || hasCode(401)) {
        return 'AI_AUTH_ERROR';
    }
    if (hasCode(403) || msg.includes('forbidden') || msg.includes('permission_denied') || msg.includes('permission denied')) {
        return 'AI_PERMISSION_DENIED';
    }
    if (hasCode(404) || msg.includes('not found') || msg.includes('does not exist')) {
        return 'AI_NOT_FOUND';
    }
    if ([500, 502, 503, 504].some(hasCode) || msg.includes('无可用') || msg.includes('overloaded') || msg.includes('unavailable') || msg.includes('high demand')) {
        return 'AI_SERVICE_UNAVAILABLE';
    }
    if (msg.includes('fetch failed') || msg.includes('network') || /\b(connect|connection)\b/.test(msg) || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('socket')) {
        return 'AI_CONNECTION_FAILED';
    }
    if (msg.includes('invalid json') || msg.includes('parse') || msg.includes('invalid ai response') || msg.includes('empty response') || msg.includes('zod') || msg.includes('validat')) {
        return 'AI_RESPONSE_ERROR';
    }
    return 'AI_UNKNOWN_ERROR';
}

/** 值得自动重试的错误：服务繁忙、网络抖动。超时与配额不重试（重试只会更慢，或更快耗尽额度） */
export function isRetryableAIError(code: AIErrorCode): boolean {
    return code === 'AI_SERVICE_UNAVAILABLE' || code === 'AI_CONNECTION_FAILED';
}
