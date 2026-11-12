"use client";

import { useState, Suspense, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, CheckCircle, Eye, Send, XCircle, ArrowLeft, House, Flame, Zap, Award } from "lucide-react";
import { ParsedQuestion, DifficultyLevel } from "@/lib/ai/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { apiClient } from "@/lib/api-client";
import { parseStoredVariants, VariantMap } from "@/lib/practice-variants";
import { recordPetPracticeSuccess } from "@/lib/pet-system";
import { PetFeedbackDialog } from "@/components/digital-pet/pet-feedback-dialog";

export const dynamic = 'force-dynamic';

function PracticeContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const errorItemId = searchParams.get("id");
    const initialDifficulty = (searchParams.get("difficulty") as DifficultyLevel) || "hard";
    const { t, language } = useLanguage();

    const [allVariants, setAllVariants] = useState<VariantMap>({});
    const [difficulty, setDifficulty] = useState<DifficultyLevel>(initialDifficulty);
    const [question, setQuestion] = useState<ParsedQuestion | null>(null);
    const [loading, setLoading] = useState(false);
    const [showAnswer, setShowAnswer] = useState(false);
    const [userAnswer, setUserAnswer] = useState("");
    const [notes, setNotes] = useState("");
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rewardToast, setRewardToast] = useState<string | null>(null);
    const [showPetFeedback, setShowPetFeedback] = useState(false);
    const [petLevelUpInfo, setPetLevelUpInfo] = useState<{ leveledUp: boolean; newLevel?: number } | null>(null);

    // 加载错题及其预置变式题
    const loadItemAndVariants = useCallback(async () => {
        if (!errorItemId) return;
        setLoading(true);
        setError(null);
        try {
            const item = await apiClient.get<any>(`/api/error-items/${errorItemId}`);
            if (item) {
                const stored = parseStoredVariants(item.ocrText);
                setAllVariants(stored);

                // 优先展示当前选择的难度，若没有则优先 hard -> harder -> medium
                const target =
                    stored[difficulty] ||
                    stored.hard ||
                    stored.harder ||
                    stored.medium;

                if (target?.questionText) {
                    setQuestion(target);
                    setLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("Could not load pre-generated variants from item cache, falling back to generate", e);
        }

        // 如果数据库没有缓存，则请求生成
        try {
            const data = await apiClient.post<ParsedQuestion>("/api/practice/generate", {
                errorItemId,
                language,
                difficulty,
            });
            if (data?.questionText) {
                setQuestion(data);
                setAllVariants((prev) => ({ ...prev, [difficulty]: data }));
            }
        } catch (err: any) {
            setError(err?.data?.message || err?.message || "生成变式题遇到网络波动，请稍后再试");
        } finally {
            setLoading(false);
        }
    }, [errorItemId, difficulty, language]);

    useEffect(() => {
        loadItemAndVariants();
    }, [loadItemAndVariants]);

    // 切换难度：如果有预生成的题目则毫秒级直切，无需重新调用 AI 等待
    const handleSwitchDifficulty = async (targetLevel: DifficultyLevel) => {
        setDifficulty(targetLevel);
        setUserAnswer("");
        setNotes("");
        setIsSubmitted(false);
        setIsCorrect(null);
        setShowAnswer(false);
        setError(null);

        if (allVariants[targetLevel]?.questionText) {
            setQuestion(allVariants[targetLevel]!);
            return;
        }

        setLoading(true);
        try {
            const data = await apiClient.post<ParsedQuestion>("/api/practice/generate", {
                errorItemId,
                language,
                difficulty: targetLevel,
            });
            if (data?.questionText) {
                setQuestion(data);
                setAllVariants((prev) => ({ ...prev, [targetLevel]: data }));
            }
        } catch (err: any) {
            setError(err?.data?.message || err?.message || "生成变式题失败");
        } finally {
            setLoading(false);
        }
    };

    const submitAnswer = () => {
        if (!userAnswer.trim() || !question) return;

        setIsSubmitted(true);

        const normalize = (str: string) => str.trim().toLowerCase().replace(/[.,;!元箱本个]/g, '');
        const user = normalize(userAnswer);
        const correct = normalize(question.answerText);

        let isMatch = user === correct;
        if (!isMatch && /^[a-d]$/.test(user)) {
            isMatch = correct.startsWith(user);
        }
        if (!isMatch && correct.includes(user) && user.length > 0) {
            isMatch = true;
        }

        setIsCorrect(isMatch);
        setShowAnswer(true);

        // 联动电子宠物伴学系统：做对题目奖励宠物经验和小鱼干能量果！
        if (isMatch) {
            const reward = recordPetPracticeSuccess(difficulty);
            if (reward.leveledUp) {
                setPetLevelUpInfo({ leveledUp: true, newLevel: reward.newLevel });
                setRewardToast(`🎊 升级啦！算算喵升至 Lv.${reward.newLevel}，获得 1 次升级抽奖机会！`);
            } else {
                setPetLevelUpInfo({ leveledUp: false });
                setRewardToast(`🎉 答对啦！算算喵获得 +${reward.exp} 经验值，能量果 +${reward.fish}！`);
            }
            setTimeout(() => setRewardToast(null), 5000);
        } else {
            setPetLevelUpInfo(null);
        }

        // 触发全屏宠物即时反馈弹窗（做对赞美加持 / 做错哭泣鼓励）
        setShowPetFeedback(true);

        // 保存练习记录
        apiClient.post("/api/practice/record", {
            subject: question.subject || "数学",
            difficulty,
            isCorrect: isMatch,
        }).catch((err) => console.warn("Failed to save practice record:", err));
    };

    if (!errorItemId) {
        return <div className="p-8 text-center">{t.practice.invalidRequest || "Invalid Request"}</div>;
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6 pb-16">
            <div className="flex justify-between items-center mb-2">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t.common?.back || "返回错题"}
                </Button>
                <Button asChild variant="ghost" size="icon">
                    <Link href="/" aria-label="返回首页">
                        <House className="h-5 w-5" />
                    </Link>
                </Button>
            </div>

            <div className="text-center space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    <Award className="h-3.5 w-3.5" />
                    <span>举一反三</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-bold">举一反三</h1>
                <p className="text-sm text-muted-foreground">
                    重点攻克【困难变式】与【挑战压轴】，彻底吃透考点核心本质
                </p>

                {rewardToast && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-lg text-sm font-medium animate-in fade-in">
                        {rewardToast}
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm">
                        <strong className="font-bold">提示：</strong>
                        <span>{error}</span>
                    </div>
                )}

                {/* 难度切换栏：三种难度（默认【困难变式】） */}
                <div className="flex justify-center pt-2">
                    <div className="inline-flex p-1 bg-muted rounded-xl gap-1.5 border">
                        <button
                            type="button"
                            onClick={() => handleSwitchDifficulty("hard")}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all cursor-pointer ${
                                difficulty === "hard"
                                    ? "bg-orange-500 text-white shadow-sm ring-2 ring-orange-400/30"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Flame className="h-4 w-4" />
                            <span>困难变式</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleSwitchDifficulty("harder")}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all cursor-pointer ${
                                difficulty === "harder"
                                    ? "bg-red-600 text-white shadow-sm ring-2 ring-red-500/30"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Zap className="h-4 w-4" />
                            <span>挑战压轴</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleSwitchDifficulty("medium")}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all cursor-pointer ${
                                difficulty === "medium"
                                    ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <span>类似题型</span>
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">正在极速载入变式题...</p>
                </div>
            ) : question ? (
                <div className="space-y-6">
                    {/* 变式题题目卡片 */}
                    <Card className="border-2 border-primary/30 shadow-md">
                        <CardHeader className="py-3.5 border-b bg-muted/20">
                            <CardTitle className="text-base md:text-lg flex justify-between items-center">
                                <span className="flex items-center gap-2">
                                    <span className="w-1.5 h-4 bg-primary rounded-full inline-block" />
                                    <span>
                                        {difficulty === "hard" && "🔥 困难变式"}
                                        {difficulty === "harder" && "⚡ 挑战压轴"}
                                        {difficulty === "medium" && "🎯 类似题型"}
                                    </span>
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSwitchDifficulty(difficulty)}
                                    disabled={loading}
                                    className="text-xs"
                                >
                                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                    换一道同难度变式
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-5 text-base md:text-lg leading-relaxed">
                            <MarkdownRenderer content={question.questionText} />
                        </CardContent>
                    </Card>

                    {/* 答题区域 */}
                    <Card className="border">
                        <CardHeader className="py-3 border-b">
                            <CardTitle className="text-sm font-semibold">填写作答与思路</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 space-y-4">
                            <Input
                                placeholder="输入你的答案（如：21箱、840元）..."
                                value={userAnswer}
                                onChange={(e) => setUserAnswer(e.target.value)}
                                disabled={isSubmitted}
                                className="text-base h-11"
                            />
                            <Textarea
                                placeholder="草稿思考与推导步骤（可选）..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                disabled={isSubmitted}
                                rows={3}
                                className="text-sm"
                            />

                            {!isSubmitted ? (
                                <Button
                                    size="lg"
                                    onClick={submitAnswer}
                                    disabled={!userAnswer.trim()}
                                    className="w-full text-sm font-semibold"
                                >
                                    <Send className="mr-2 h-4 w-4" />
                                    核对答案并喂养算算喵 🐾
                                </Button>
                            ) : (
                                <div className="space-y-4 pt-1">
                                    <div
                                        className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                                            isCorrect
                                                ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300"
                                                : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            {isCorrect ? (
                                                <CheckCircle className="h-6 w-6 flex-shrink-0" />
                                            ) : (
                                                <XCircle className="h-6 w-6 flex-shrink-0" />
                                            )}
                                            <div>
                                                <div className="font-bold text-sm">
                                                    {isCorrect ? "答对啦！算算喵获得了能量果！" : "结果不一致，快看看思路解析！"}
                                                </div>
                                                <div className="text-xs opacity-90">
                                                    {isCorrect ? "本题陷阱已攻克，算算喵为你点赞！" : "别灰心，整理思路后再做一次！"}
                                                </div>
                                            </div>
                                        </div>

                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setIsSubmitted(false);
                                                setUserAnswer("");
                                                setIsCorrect(null);
                                                setShowAnswer(false);
                                            }}
                                            className="text-xs"
                                        >
                                            重做此题
                                        </Button>
                                    </div>

                                    {/* 简单点拨与参考答案 */}
                                    <div className="grid gap-3 md:grid-cols-2 text-xs">
                                        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3.5">
                                            <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">
                                                💡 解题关键点拨
                                            </div>
                                            <p className="text-foreground leading-relaxed">
                                                {question.mistakeAnalysis || "考查原题变种考点与逻辑推导。"}
                                            </p>
                                        </div>
                                        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3.5">
                                            <div className="font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                                                🎯 参考答案
                                            </div>
                                            <div className="font-extrabold text-sm text-foreground">
                                                <MarkdownRenderer content={question.answerText} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* 详细分步解析 */}
                                    <Card className="border bg-muted/30">
                                        <CardHeader className="py-3 border-b">
                                            <CardTitle className="text-sm font-semibold">详细分步解析</CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-4 text-sm leading-relaxed">
                                            <MarkdownRenderer content={question.analysis} />
                                        </CardContent>
                                    </Card>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            ) : null}

            {/* 伴学电子宠物做题全页面反馈弹窗（做对赞美加持 / 做错哭泣鼓励） */}
            <PetFeedbackDialog
                isOpen={showPetFeedback}
                onClose={() => setShowPetFeedback(false)}
                isCorrect={Boolean(isCorrect)}
                difficulty={difficulty}
                userAnswer={userAnswer}
                correctAnswer={question?.answerText || ""}
                onRetry={() => {
                    setIsSubmitted(false);
                    setUserAnswer("");
                    setIsCorrect(null);
                    setShowAnswer(false);
                }}
                onViewDetail={() => {
                    setShowAnswer(true);
                }}
                expGained={difficulty === "harder" ? 60 : difficulty === "hard" ? 35 : 15}
                fruitGained={difficulty === "harder" ? 3 : difficulty === "hard" ? 2 : 1}
                leveledUp={petLevelUpInfo?.leveledUp}
                newLevel={petLevelUpInfo?.newLevel}
            />
        </div>
    );
}

export default function PracticePage() {
    return (
        <main className="min-h-screen p-4 md:p-8 bg-background">
            <Suspense
                fallback={
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                }
            >
                <PracticeContent />
            </Suspense>
        </main>
    );
}
