"use client";

import { useCallback, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { processImageFile } from "@/lib/image-utils";
import { runWithConcurrency } from "@/lib/concurrency";
import { getAIErrorMessage, isCancelledError } from "@/lib/ai-error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import type { AnalyzeResponse } from "@/types/api";
import type { BatchQuestionItem } from "@/components/batch-review-editor";

export type BatchTaskStatus = "queued" | "compressing" | "analyzing" | "done" | "failed" | "cancelled";

export interface BatchTask {
    id: string;
    file: File;
    name: string;
    status: BatchTaskStatus;
    error?: string;
    result?: BatchQuestionItem;
}

interface Options {
    /** 识别时传给后端的错题本 id（决定学科与标签范围） */
    subjectId?: string;
    language: "zh" | "en";
    timeoutMs: number;
    errors: Record<string, unknown> | undefined;
    /**
     * 并发度。两张同时识别：比串行快一倍，又不至于触发免费额度的每分钟限流。
     * 之前是串行 for 循环，一张卡住时后面全部排队等待。
     */
    concurrency?: number;
}

let taskSeq = 0;

export function useBatchImageAnalysis({ subjectId, language, timeoutMs, errors, concurrency = 2 }: Options) {
    const [tasks, setTasks] = useState<BatchTask[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    // 同步副本：run 结束后需要立即拿到最终结果，不能依赖异步的 state
    const tasksRef = useRef<BatchTask[]>([]);
    const controllerRef = useRef<AbortController | null>(null);

    const update = useCallback((id: string, patch: Partial<BatchTask>) => {
        tasksRef.current = tasksRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t));
        setTasks(tasksRef.current);
    }, []);

    const analyzeOne = useCallback(async (task: BatchTask, signal: AbortSignal) => {
        try {
            update(task.id, { status: "compressing", error: undefined });
            const base64Image = await processImageFile(task.file);
            if (signal.aborted) {
                update(task.id, { status: "cancelled" });
                return;
            }

            update(task.id, { status: "analyzing" });
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language,
                subjectId,
            }, { timeout: timeoutMs, signal });

            if (!data?.questionText) {
                throw new Error("AI_RESPONSE_ERROR");
            }

            update(task.id, {
                status: "done",
                result: {
                    id: task.id,
                    questionText: data.questionText,
                    answerText: data.answerText || "",
                    analysis: data.analysis || "",
                    knowledgePoints: Array.isArray(data.knowledgePoints) ? data.knowledgePoints : [],
                    wrongAnswerText: data.wrongAnswerText || "",
                    mistakeAnalysis: data.mistakeAnalysis || "",
                    mistakeStatus: data.mistakeStatus,
                    subject: data.subject,
                    originalImageUrl: base64Image,
                    selected: true,
                },
            });
        } catch (error) {
            if (signal.aborted || isCancelledError(error)) {
                update(task.id, { status: "cancelled" });
                return;
            }
            const message = getAIErrorMessage(error, errors, "识别失败，请重试");
            frontendLogger.warn("[BatchAnalyze]", "Image analysis failed", {
                file: task.name,
                status: (error as { status?: number })?.status,
                code: (error as { data?: { message?: string } })?.data?.message,
            });
            update(task.id, { status: "failed", error: message });
        }
    }, [errors, language, subjectId, timeoutMs, update]);

    const run = useCallback(async (targets: BatchTask[]) => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setIsRunning(true);
        try {
            await runWithConcurrency(targets, concurrency, (task) => analyzeOne(task, controller.signal), controller.signal);
            // 被取消时还在排队的任务标记为已取消
            tasksRef.current
                .filter((t) => t.status === "queued")
                .forEach((t) => update(t.id, { status: "cancelled" }));
        } finally {
            controllerRef.current = null;
            setIsRunning(false);
        }
        return tasksRef.current;
    }, [analyzeOne, concurrency, update]);

    /** 开始识别一批新图片（会清空上一批） */
    const start = useCallback((files: File[]) => {
        const created: BatchTask[] = files.map((file) => ({
            id: `img-${Date.now()}-${taskSeq++}`,
            file,
            name: file.name,
            status: "queued",
        }));
        tasksRef.current = created;
        setTasks(created);
        return run(created);
    }, [run]);

    /** 只重试失败 / 被取消的图片，已成功的保留 */
    const retryFailed = useCallback(() => {
        const targets = tasksRef.current.filter((t) => t.status === "failed" || t.status === "cancelled");
        if (targets.length === 0) return Promise.resolve(tasksRef.current);
        targets.forEach((t) => update(t.id, { status: "queued", error: undefined }));
        return run(tasksRef.current.filter((t) => targets.some((x) => x.id === t.id)));
    }, [run, update]);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    const removeTask = useCallback((id: string) => {
        tasksRef.current = tasksRef.current.filter((t) => t.id !== id);
        setTasks(tasksRef.current);
    }, []);

    const reset = useCallback(() => {
        controllerRef.current?.abort();
        tasksRef.current = [];
        setTasks([]);
    }, []);

    return { tasks, isRunning, start, retryFailed, cancel, removeTask, reset };
}
