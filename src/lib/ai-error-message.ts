/**
 * 把接口异常转换成给用户看的提示文案（首页、录入页、批量识别共用）。
 * 后端统一返回 AI_* 错误码（error.data.message），这里按当前语言翻译；
 * 未知错误一律用兜底文案，不把英文原文直接弹给用户。
 */

export const CANCELLED_ERROR = "REQUEST_CANCELLED";

interface ErrorLike {
    status?: number;
    message?: string;
    data?: unknown;
}

type ErrorDict = Record<string, unknown> | undefined;

export function getAIErrorCode(error: unknown): string | null {
    const e = error as ErrorLike | null;
    const data = e?.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") return data.message;
    if (typeof e?.message === "string" && /^AI_[A-Z_]+$/.test(e.message)) return e.message;
    return null;
}

export function isCancelledError(error: unknown): boolean {
    return getAIErrorCode(error) === CANCELLED_ERROR;
}

export function getAIErrorMessage(error: unknown, errors: ErrorDict, fallback: string): string {
    const code = getAIErrorCode(error);
    if (code && errors && typeof errors[code] === "string") {
        return errors[code] as string;
    }

    const message = (error as ErrorLike | null)?.message || "";
    if (/failed to fetch|networkerror|network|load failed/i.test(message)) {
        const connection = errors?.AI_CONNECTION_FAILED;
        if (typeof connection === "string") return connection;
    }
    return fallback;
}
