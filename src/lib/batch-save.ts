import { apiClient } from "./api-client";
import type { BatchQuestionItem } from "@/components/batch-review-editor";

export interface BatchSaveResult {
    savedIds: string[];
    failedIds: string[];
}

/**
 * 逐条保存批量核对后的错题。
 * 单条失败不中断后续保存，调用方根据 failedIds 把未保存的题目留在页面上，
 * 而不是像之前那样提示后直接跳走、丢掉未保存的题目。
 */
export async function saveBatchQuestions(
    items: BatchQuestionItem[],
    /** 题目自身没有指定错题本时使用的默认错题本 */
    fallbackNotebookId: string | undefined,
    onProgress?: (current: number, total: number) => void
): Promise<BatchSaveResult> {
    const savedIds: string[] = [];
    const failedIds: string[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress?.(i + 1, items.length);
        const notebookId = item.notebookId || fallbackNotebookId;
        if (!notebookId) {
            failedIds.push(item.id);
            continue;
        }
        try {
            await apiClient.post<{ id: string }>("/api/error-items", {
                questionText: item.questionText,
                answerText: item.answerText,
                analysis: item.analysis,
                knowledgePoints: item.knowledgePoints,
                wrongAnswerText: item.wrongAnswerText || "",
                mistakeAnalysis: item.mistakeAnalysis || "",
                // 由后端按 wrongAnswerText 归一化；之前固定传 "wrong" 这个非法值，结果全部变成「未判断」
                mistakeStatus: item.mistakeStatus,
                originalImageUrl: item.originalImageUrl || "",
                subjectId: notebookId,
            });
            savedIds.push(item.id);
        } catch {
            failedIds.push(item.id);
        }
    }

    return { savedIds, failedIds };
}

/** 按单个学科匹配错题本（名称互相包含即可，如「英语」匹配「初二英语错题本」） */
export function matchNotebookBySubject(
    notebooks: { id: string; name: string }[],
    subject: string | undefined
): string | undefined {
    if (!subject || subject === "其他") return undefined;
    return notebooks.find((n) => n.name.includes(subject) || subject.includes(n.name))?.id;
}

/** 按 AI 识别出的学科匹配最合适的错题本（取出现次数最多的学科） */
export function pickNotebookForSubjects(
    notebooks: { id: string; name: string }[],
    subjects: (string | undefined)[]
): string | undefined {
    const counts = new Map<string, number>();
    subjects.forEach((s) => {
        if (s && s !== "其他") counts.set(s, (counts.get(s) || 0) + 1);
    });
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [subject] of ranked) {
        const matched = notebooks.find((n) => n.name.includes(subject) || subject.includes(n.name));
        if (matched) return matched.id;
    }
    return undefined;
}
