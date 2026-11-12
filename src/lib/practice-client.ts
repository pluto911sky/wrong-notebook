"use client";

import { apiClient, ApiError } from "./api-client";
import type { PracticeLevel, PracticeProgress } from "./practice-progress";
import { recordPetErrorReviewed, recordPetPracticeSuccess } from "./pet-system";

export interface AttemptResult {
    isCorrect: boolean;
    rewarded: boolean;
    correctAnswer: string;
    mastered: boolean;
    progress: PracticeProgress;
}

export type AttemptOutcome =
    | { ok: true; result: AttemptResult }
    | { ok: false; message: string; progress?: PracticeProgress };

const REJECT_MESSAGES: Record<string, string> = {
    PRACTICE_LOCKED: "这一关还没解锁，先通过上一关吧",
    PRACTICE_ALREADY_CLEARED: "这一关已经通关了，只能查看，不能重做",
    PRACTICE_DAILY_LIMIT: "这一关今天已经做过了，明天再来挑战吧",
};

export function fetchPracticeProgress(errorItemId: string) {
    return apiClient.get<PracticeProgress>(`/api/practice/progress?errorItemId=${encodeURIComponent(errorItemId)}`);
}

/** 提交作答；被规则拒绝时返回原因与最新进度，不抛异常 */
export async function submitPracticeAttempt(errorItemId: string, difficulty: PracticeLevel, userAnswer: string): Promise<AttemptOutcome> {
    try {
        const result = await apiClient.post<AttemptResult>("/api/practice/attempt", { errorItemId, difficulty, userAnswer });
        return { ok: true, result };
    } catch (error) {
        if (error instanceof ApiError) {
            const data = error.data as { message?: string; progress?: PracticeProgress } | undefined;
            const code = data?.message || "";
            return { ok: false, message: REJECT_MESSAGES[code] || "提交失败，请稍后再试", progress: data?.progress };
        }
        return { ok: false, message: "网络异常，提交失败，请稍后再试" };
    }
}

/**
 * 按服务端结果发放宠物奖励：只有「首次通关」才发；三关全通时额外发一次掌握奖励。
 * 返回值用于展示升级提示；没有发奖励时返回 null。
 */
export function grantPracticeReward(errorItemId: string, difficulty: PracticeLevel, result: AttemptResult) {
    if (!result.rewarded) return null;
    const reward = recordPetPracticeSuccess(difficulty, `${errorItemId}:${difficulty}`);
    if (result.mastered) {
        recordPetErrorReviewed(errorItemId);
    }
    return reward;
}
