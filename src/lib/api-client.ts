import { CANCELLED_ERROR } from "./ai-error-message";

type RequestOptions = RequestInit & {
    params?: Record<string, string>;
    timeout?: number; // 超时时间（毫秒），默认 60000
};

export class ApiError extends Error {
    constructor(public status: number, public statusText: string, public data: unknown) {
        super(`API Error: ${status} ${statusText}`);
        this.name = 'ApiError';
    }
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers, timeout = 60000, signal: externalSignal, ...rest } = options;

    let finalUrl = url;
    if (params) {
        const searchParams = new URLSearchParams(params);
        finalUrl += `?${searchParams.toString()}`;
    }

    const defaultHeaders: HeadersInit = {
        'Content-Type': 'application/json',
    };

    // 内部 AbortController 同时负责超时和调用方取消（如批量识别中点「取消」）
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
        const res = await fetch(finalUrl, {
            headers: {
                ...defaultHeaders,
                ...headers,
            },
            ...rest,
            signal: controller.signal,
        });

        if (!res.ok) {
            // body 只能读取一次：先取文本再尝试解析 JSON
            const raw = await res.text();
            let errorData: unknown = raw;
            try {
                errorData = JSON.parse(raw);
            } catch {
                // 非 JSON 响应，保留原文
            }
            throw new ApiError(res.status, res.statusText, errorData);
        }

        // Handle empty responses (e.g. 204 No Content)
        if (res.status === 204) {
            return {} as T;
        }

        try {
            return await res.json();
        } catch {
            return {} as T;
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            if (!timedOut) {
                throw new ApiError(499, 'Request Cancelled', { message: CANCELLED_ERROR });
            }
            throw new ApiError(408, 'Request Timeout', {
                message: 'AI_TIMEOUT_ERROR'
            });
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', onExternalAbort);
    }
}

export const apiClient = {
    get: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'GET' }),
    post: <TResponse, TBody = any>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <TResponse, TBody = any>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    patch: <TResponse, TBody = any>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
};
