"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, CheckCircle, Send, XCircle, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { PetFeedbackDialog } from "@/components/digital-pet/pet-feedback-dialog";
import { PracticeLevelTabs } from "@/components/practice-level-tabs";
import { toast } from "@/components/ui/toast";
import { apiClient } from "@/lib/api-client";
import type { ParsedQuestion } from "@/lib/ai/types";
import type { VariantMap } from "@/lib/practice-variants";
import {
    PRACTICE_LEVELS,
    PRACTICE_LEVEL_LABELS,
    isPracticeLevel,
    type PracticeLevel,
    type PracticeProgress,
} from "@/lib/practice-progress";
import { fetchPracticeProgress, grantPracticeReward, submitPracticeAttempt } from "@/lib/practice-client";
import { getAIErrorMessage } from "@/lib/ai-error-message";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

const LEVEL_REWARD = {
    medium: { exp: 15, fruit: 1 },
    hard: { exp: 35, fruit: 2 },
    harder: { exp: 60, fruit: 3 },
} as const;

/** 默认打开的关卡：指定且已解锁的优先，否则是下一个待攻克的关卡 */
function pickInitialLevel(requested: string | null | undefined, progress: PracticeProgress): PracticeLevel {
    if (isPracticeLevel(requested) && progress.levels[requested].unlocked) return requested;
    return progress.currentLevel ?? "harder";
}

interface Props {
    errorItemId: string;
    /** 已缓存的变式题（来自错题的 ocrText），没有的关卡会按需生成 */
    initialVariants: VariantMap;
    requestedLevel?: string | null;
    /** 紧凑模式：嵌在错题详情页里使用 */
    compact?: boolean;
    /** 三关全部通关、错题被自动标记掌握时通知父组件刷新 */
    onMastered?: () => void;
}

/**
 * 举一反三闯关（练习页与错题详情页共用）。
 * 规则由服务端执行：未解锁不能做、每关每天一次、答对即通关只读；奖励只在首次通关时发放。
 */
export function PracticeChallenge({ errorItemId, initialVariants, requestedLevel, compact = false, onMastered }: Props) {
    const { t, language } = useLanguage();
    const [variants, setVariants] = useState<VariantMap>(initialVariants);
    const [progress, setProgress] = useState<PracticeProgress | null>(null);
    const [level, setLevel] = useState<PracticeLevel | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [userAnswer, setUserAnswer] = useState("");
    const [notes, setNotes] = useState("");
    // 本次会话刚提交的结果；刷新后由 progress 决定显示「已通关」或「明天再来」
    const [lastResult, setLastResult] = useState<{ level: PracticeLevel; isCorrect: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showPetFeedback, setShowPetFeedback] = useState(false);
    const [petLevelUpInfo, setPetLevelUpInfo] = useState<{ leveledUp: boolean; newLevel?: number } | null>(null);

    const question: ParsedQuestion | null = level ? variants[level] ?? null : null;
    const levelState = level && progress ? progress.levels[level] : null;

    // 某一关的题目：已缓存直接用，否则请求生成（服务端会校验是否解锁）
    const loadQuestion = useCallback(async (target: PracticeLevel, known: VariantMap) => {
        if (known[target]?.questionText) return;
        setLoading(true);
        setError(null);
        try {
            const data = await apiClient.post<ParsedQuestion>("/api/practice/generate", {
                errorItemId,
                language,
                difficulty: target,
            }, { timeout: 180000 });
            if (data?.questionText) {
                setVariants((prev) => ({ ...prev, [target]: data }));
            }
        } catch (err) {
            setError(getAIErrorMessage(err, t.errors as Record<string, unknown> | undefined, "生成变式题失败，请稍后再试"));
        } finally {
            setLoading(false);
        }
    }, [errorItemId, language, t.errors]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const prog = await fetchPracticeProgress(errorItemId);
                if (cancelled) return;
                const initial = pickInitialLevel(requestedLevel, prog);
                setProgress(prog);
                setLevel(initial);
                setLoading(false);
                await loadQuestion(initial, initialVariants);
            } catch (err) {
                if (cancelled) return;
                console.warn("Failed to load practice progress", err);
                setError("加载闯关进度失败，请刷新重试");
                setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // 只在错题切换时重新加载
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorItemId]);

    const switchLevel = async (target: PracticeLevel) => {
        if (!progress?.levels[target].unlocked) return;
        setLevel(target);
        setUserAnswer("");
        setNotes("");
        setError(null);
        await loadQuestion(target, variants);
    };

    const submitAnswer = async () => {
        if (!level || !userAnswer.trim() || submitting) return;
        setSubmitting(true);
        const outcome = await submitPracticeAttempt(errorItemId, level, userAnswer);
        setSubmitting(false);

        if (!outcome.ok) {
            toast.error(outcome.message);
            if (outcome.progress) setProgress(outcome.progress);
            return;
        }

        const { result } = outcome;
        setProgress(result.progress);
        setLastResult({ level, isCorrect: result.isCorrect });

        const reward = grantPracticeReward(errorItemId, level, result);
        setPetLevelUpInfo(reward ? { leveledUp: reward.leveledUp, newLevel: reward.newLevel } : null);
        if (reward?.leveledUp) {
            toast.success(`升级啦！算算喵升至 Lv.${reward.newLevel}，获得 1 次心愿抽奖机会`);
        }
        if (result.mastered) {
            toast.success("三关全部通关，这道错题已自动标记为「已掌握」");
            onMastered?.();
        }
        setShowPetFeedback(true);
    };

    const nextLevel = level ? PRACTICE_LEVELS[PRACTICE_LEVELS.indexOf(level) + 1] : undefined;
    const canGoNext = !!nextLevel && !!progress?.levels[nextLevel].unlocked;
    const justAnswered = lastResult && lastResult.level === level ? lastResult : null;
    // 作答区三种状态：可作答 / 已通关（只读）/ 今天已答过（只读，明天再来）
    const mode: "answer" | "cleared" | "tomorrow" = levelState?.cleared
        ? "cleared"
        : levelState?.canAttempt
            ? "answer"
            : "tomorrow";

    return (
        <div className={cn("space-y-5", compact && "space-y-4")}>
            {level && (
                <PracticeLevelTabs progress={progress} active={level} onSelect={switchLevel} disabled={loading || submitting} />
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center space-y-3 py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">正在载入题目...</p>
                </div>
            ) : question && level ? (
                <div className="space-y-5">
                    <Card className={cn("border-2 border-primary/30", !compact && "shadow-md")}>
                        <CardHeader className="border-b bg-muted/20 py-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <span className="inline-block h-4 w-1.5 rounded-full bg-primary" />
                                <span>第{PRACTICE_LEVELS.indexOf(level) + 1}关 · {PRACTICE_LEVEL_LABELS[level]}</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className={cn("pt-5 leading-relaxed", compact ? "text-sm md:text-base" : "text-base md:text-lg")}>
                            <MarkdownRenderer content={question.questionText} />
                        </CardContent>
                    </Card>

                    {mode === "answer" ? (
                        <div className="space-y-3">
                            <Input
                                placeholder="输入你的答案（如：21箱、840元）..."
                                value={userAnswer}
                                onChange={(e) => setUserAnswer(e.target.value)}
                                disabled={submitting}
                                className="h-11 text-base"
                                aria-label="你的答案"
                            />
                            {!compact && (
                                <Textarea
                                    placeholder="草稿思考与推导步骤（可选）..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    disabled={submitting}
                                    rows={3}
                                    className="text-sm"
                                />
                            )}
                            <p className="text-xs text-muted-foreground">提醒：每关每天只有一次提交机会，想清楚再提交。</p>
                            <Button onClick={submitAnswer} disabled={!userAnswer.trim() || submitting} className="w-full font-semibold">
                                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                提交答案
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div
                                className={cn(
                                    "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4",
                                    mode === "cleared"
                                        ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
                                        : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                                )}
                            >
                                <div className="flex items-center gap-2.5">
                                    {mode === "cleared" ? (
                                        <CheckCircle className="h-6 w-6 shrink-0" />
                                    ) : justAnswered && !justAnswered.isCorrect ? (
                                        <XCircle className="h-6 w-6 shrink-0" />
                                    ) : (
                                        <Clock className="h-6 w-6 shrink-0" />
                                    )}
                                    <div>
                                        <div className="text-sm font-bold">
                                            {mode === "cleared"
                                                ? justAnswered?.isCorrect ? "答对啦，本关通关！" : "本关已通关"
                                                : justAnswered && !justAnswered.isCorrect ? "这次没答对" : "今天已经挑战过这一关"}
                                        </div>
                                        <div className="text-xs opacity-90">
                                            {mode === "cleared"
                                                ? progress?.allCleared
                                                    ? "三关全部通关，这道题已掌握。通关后只能查看，不能重做"
                                                    : "通关后只能查看题目和解析，不能重做"
                                                : "先看看下面的解析，明天再来挑战这一关"}
                                        </div>
                                    </div>
                                </div>
                                {mode === "cleared" && canGoNext && nextLevel && (
                                    <Button size="sm" onClick={() => switchLevel(nextLevel)}>
                                        挑战下一关：{PRACTICE_LEVEL_LABELS[nextLevel]}
                                        <ArrowRight className="ml-1 h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            <div className="grid gap-3 text-xs md:grid-cols-2">
                                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5">
                                    <div className="mb-1 font-bold text-amber-700 dark:text-amber-400">解题关键点拨</div>
                                    <p className="leading-relaxed text-foreground">
                                        {question.mistakeAnalysis || "考查原题变种考点与逻辑推导。"}
                                    </p>
                                </div>
                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5">
                                    <div className="mb-1 font-bold text-emerald-700 dark:text-emerald-400">参考答案</div>
                                    <div className="text-sm font-extrabold text-foreground">
                                        <MarkdownRenderer content={question.answerText} />
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
                                <div className="mb-2 font-semibold">详细分步解析</div>
                                <MarkdownRenderer content={question.analysis} />
                            </div>
                        </div>
                    )}
                </div>
            ) : level && !error ? (
                <p className="py-6 text-center text-sm text-muted-foreground">这一关的题目还没准备好，请稍后再试</p>
            ) : null}

            {/* 宠物做题反馈：只在本次提交后弹出；没有「重做」入口 */}
            {level && (
                <PetFeedbackDialog
                    isOpen={showPetFeedback}
                    onClose={() => setShowPetFeedback(false)}
                    isCorrect={Boolean(justAnswered?.isCorrect)}
                    difficulty={level}
                    userAnswer={userAnswer}
                    correctAnswer={question?.answerText || ""}
                    onViewDetail={() => setShowPetFeedback(false)}
                    expGained={LEVEL_REWARD[level].exp}
                    fruitGained={LEVEL_REWARD[level].fruit}
                    leveledUp={petLevelUpInfo?.leveledUp}
                    newLevel={petLevelUpInfo?.newLevel}
                />
            )}
        </div>
    );
}
