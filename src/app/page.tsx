"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImageCropper } from "@/components/image-cropper";
import { ParsedQuestion } from "@/lib/ai";
import { UserWelcome } from "@/components/user-welcome";
import { apiClient } from "@/lib/api-client";
import { AnalyzeResponse, Notebook, RuntimeConfig } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { processImageFile } from "@/lib/image-utils";
import { Upload, BookOpen, Tags, LogOut, BarChart3, PenLine, Gift } from "lucide-react";
import { SettingsDialog } from "@/components/settings-dialog";
import { BroadcastNotification } from "@/components/broadcast-notification";
import { signOut } from "next-auth/react";

import { ProgressFeedback, ProgressStatus } from "@/components/ui/progress-feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { TextInputZone } from "@/components/text-input-zone";
import { DirectTextEditor } from "@/components/direct-text-editor";
import { BatchReviewEditor, BatchQuestionItem } from "@/components/batch-review-editor";
import { BatchAnalyzeProgress } from "@/components/batch-analyze-progress";
import { toast } from "@/components/ui/toast";
import { getAIErrorMessage } from "@/lib/ai-error-message";
import { saveBatchQuestions, pickNotebookForSubjects } from "@/lib/batch-save";
import { useBatchImageAnalysis } from "@/hooks/use-batch-image-analysis";

interface BatchTextResponse {
    success: boolean;
    count: number;
    questions: Array<{
        questionText: string;
        answerText: string;
        analysis: string;
        knowledgePoints: string[];
        wrongAnswerText?: string;
        mistakeAnalysis?: string;
        mistakeStatus?: ParsedQuestion["mistakeStatus"];
    }>;
}

function HomeContent() {
    const [step, setStep] = useState<"upload" | "review" | "batch-review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [progressMessage, setProgressMessage] = useState("");
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    // 文本批量拆题的结果（图片批量的结果来自 batch hook）
    const [textBatchQuestions, setTextBatchQuestions] = useState<BatchQuestionItem[]>([]);
    const [isBatchSaving, setIsBatchSaving] = useState(false);
    const [savingProgress, setSavingProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const { t, language } = useLanguage();
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialNotebookId = searchParams.get("notebook");
    const [notebooks, setNotebooks] = useState<{ id: string; name: string }[]>([]);
    const [autoSelectedNotebookId, setAutoSelectedNotebookId] = useState<string | null>(null);

    const [config, setConfig] = useState<RuntimeConfig | null>(null);

    // Input mode: "image" for photo upload, "text" for AI solve, "direct" for manual entry
    const [inputMode, setInputMode] = useState<"image" | "text" | "direct">("image");

    // Cropper state
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);

    const aiTimeout = config?.timeouts?.analyze || 180000;
    const errorDict = t.errors as Record<string, unknown> | undefined;
    const targetNotebookId = initialNotebookId || autoSelectedNotebookId || undefined;
    const targetNotebookName = targetNotebookId ? notebooks.find(n => n.id === targetNotebookId)?.name : undefined;

    const batch = useBatchImageAnalysis({
        subjectId: targetNotebookId,
        language,
        timeoutMs: aiTimeout,
        errors: errorDict,
    });

    const imageBatchQuestions = batch.tasks
        .filter(task => task.status === "done" && task.result)
        .map(task => task.result as BatchQuestionItem);
    const failedItems = batch.tasks
        .filter(task => task.status === "failed" || task.status === "cancelled")
        .map(task => ({ id: task.id, name: task.name, error: task.error || (task.status === "cancelled" ? "已取消" : undefined) }));
    const isImageBatch = batch.tasks.length > 0;
    const batchQuestions = isImageBatch ? imageBatchQuestions : textBatchQuestions;
    // 批量核对默认保存位置：URL 指定的错题本 > 按识别学科匹配 > 最近一次自动匹配
    const defaultBatchNotebookId = initialNotebookId
        || pickNotebookForSubjects(notebooks, batchQuestions.map(q => q.subject))
        || autoSelectedNotebookId
        || undefined;

    // 裁剪图的 Blob URL：替换或卸载时释放
    useEffect(() => {
        return () => {
            if (croppingImage) URL.revokeObjectURL(croppingImage);
        };
    }, [croppingImage]);

    useEffect(() => {
        // 预期内的失败（网络抖动、服务重启）用 warn，避免触发开发模式的错误角标
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(data => setNotebooks(data))
            .catch(err => console.warn("Failed to fetch notebooks:", err));

        // Fetch only non-secret runtime settings; full AI settings are admin-only.
        apiClient.get<RuntimeConfig>("/api/runtime-config")
            .then(data => setConfig(data))
            .catch(err => console.warn("Failed to fetch config:", err));
    }, []);

    const onImageSelect = (file: File) => {
        setCroppingImage(URL.createObjectURL(file));
        setIsCropperOpen(true);
    };

    const closeCropper = () => {
        setIsCropperOpen(false);
        setCroppingImage(null);
    };

    const handleCropComplete = async (croppedBlob: Blob) => {
        closeCropper();
        const file = new File([croppedBlob], "cropped-image.jpg", { type: "image/jpeg" });
        await handleAnalyze(file);
    };

    /**
     * 单张图片识别。
     * 之前用「模拟进度条 + 定时自动关闭遮罩」兜底，遮罩可能在请求仍在进行时消失；
     * 现在 apiClient 自带超时，请求必然在 aiTimeout 内结束，遮罩随请求结束关闭。
     */
    const handleAnalyze = async (file: File) => {
        const startTime = Date.now();
        try {
            setAnalysisStep('compressing');
            setProgressMessage(t.common.progress?.compressing || "正在压缩图片…");
            const base64Image = await processImageFile(file);
            setCurrentImage(base64Image);

            setAnalysisStep('analyzing');
            setProgressMessage(t.common.progress?.analyzing || "AI 正在分析题目…");
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language,
                subjectId: targetNotebookId,
            }, { timeout: aiTimeout });

            if (!data?.questionText) {
                throw new Error('AI_RESPONSE_ERROR');
            }

            // 根据识别出的学科自动选择错题本
            if (data.subject && !initialNotebookId) {
                const matched = notebooks.find(n => n.name.includes(data.subject!) || data.subject!.includes(n.name));
                if (matched) setAutoSelectedNotebookId(matched.id);
            }

            setParsedData(data);
            setStep("review");
            frontendLogger.info('[HomeAnalyze]', 'Analysis completed', { durationMs: Date.now() - startTime });
        } catch (error) {
            frontendLogger.warn('[HomeAnalyze]', 'Analysis failed', {
                durationMs: Date.now() - startTime,
                status: (error as { status?: number })?.status,
                code: (error as { data?: { message?: string } })?.data?.message,
            });
            toast.error(getAIErrorMessage(error, errorDict, t.common?.messages?.analysisFailed || '分析失败，请重试'));
        } finally {
            setAnalysisStep('idle');
        }
    };

    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string }): Promise<void> => {
        try {
            await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage || "",
            });
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
            toast.success(t.common?.messages?.saveSuccess || '保存成功');

            if (finalData.subjectId) {
                router.push(`/notebooks/${finalData.subjectId}`);
            }
        } catch (error) {
            frontendLogger.warn('[HomeSave]', 'Save failed', { status: (error as { status?: number })?.status });
            toast.error(t.common?.messages?.saveFailed || '保存失败，请重试');
        }
    };

    // 多图批量识别：并发处理，逐张显示状态，失败的可在核对页单独重试
    const handleBatchImagesSelect = async (files: File[]) => {
        if (files.length === 0) return;
        if (files.length === 1) {
            onImageSelect(files[0]);
            return;
        }
        frontendLogger.info('[HomeBatchAnalyze]', 'Starting batch images analysis', { count: files.length });
        setTextBatchQuestions([]);
        const finalTasks = await batch.start(files);
        const okCount = finalTasks.filter(task => task.status === "done").length;
        const failCount = finalTasks.filter(task => task.status === "failed").length;

        if (okCount === 0 && failCount === 0) {
            batch.reset();
            return;
        }
        if (failCount > 0) {
            toast.error(`${failCount} 张图片未识别成功，可在下方查看原因并重试`);
        }
        setStep("batch-review");
    };

    const handleTextSubmit = async (questionText: string) => {
        const startTime = Date.now();
        try {
            setAnalysisStep('analyzing');
            setProgressMessage("AI 正在识别并解答题目（多题会自动拆分）…");

            const result = await apiClient.post<BatchTextResponse>("/api/batch-text-analyze", {
                text: questionText,
                subjectId: targetNotebookId,
                language,
            }, { timeout: aiTimeout });

            const questions = result?.questions || [];

            if (questions.length > 1) {
                batch.reset();
                setTextBatchQuestions(questions.map((q, idx) => ({
                    id: `text-${Date.now()}-${idx}`,
                    questionText: q.questionText,
                    answerText: q.answerText,
                    analysis: q.analysis,
                    knowledgePoints: q.knowledgePoints || [],
                    wrongAnswerText: q.wrongAnswerText || "",
                    mistakeAnalysis: q.mistakeAnalysis || "",
                    mistakeStatus: q.mistakeStatus,
                    originalImageUrl: null,
                    selected: true,
                })));
                setStep("batch-review");
            } else if (questions.length === 1) {
                const q = questions[0];
                setCurrentImage(null);
                setParsedData({
                    questionText: q.questionText,
                    answerText: q.answerText,
                    analysis: q.analysis,
                    knowledgePoints: q.knowledgePoints || [],
                    wrongAnswerText: q.wrongAnswerText || "",
                    mistakeAnalysis: q.mistakeAnalysis || "",
                    mistakeStatus: q.mistakeStatus || "unknown",
                    // 学科由用户在核对页选择的错题本决定
                    subject: "其他",
                    requiresImage: false,
                });
                setStep("review");
            } else {
                throw new Error("AI_RESPONSE_ERROR");
            }
            frontendLogger.info('[HomeTextSubmit]', 'Text analysis completed', { durationMs: Date.now() - startTime });
        } catch (error) {
            frontendLogger.warn('[HomeTextSubmit]', 'Analysis failed', { durationMs: Date.now() - startTime });
            toast.error(getAIErrorMessage(error, errorDict, '解题分析失败，请重试'));
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 批量保存：失败的题目留在页面上，全部成功才跳转
    const handleBatchSaveAll = async (toSave: BatchQuestionItem[]): Promise<string[]> => {
        setIsBatchSaving(true);
        try {
            const { savedIds, failedIds } = await saveBatchQuestions(toSave, defaultBatchNotebookId, (current, total) => {
                setSavingProgress({ current, total });
            });
            if (failedIds.length === 0) {
                toast.success(`已录入 ${savedIds.length} 道错题，举一反三变式题正在后台生成`);
                batch.reset();
                setTextBatchQuestions([]);
                setStep("upload");
                // 全部存进同一个错题本时直接打开它，否则回到错题本列表
                const targets = new Set(toSave.map(q => q.notebookId || defaultBatchNotebookId));
                const only = targets.size === 1 ? [...targets][0] : undefined;
                router.push(only ? `/notebooks/${only}` : "/notebooks");
            } else {
                toast.error(`已保存 ${savedIds.length} 道，${failedIds.length} 道保存失败，已留在页面上，可再次保存`);
            }
            return savedIds;
        } finally {
            setIsBatchSaving(false);
        }
    };

    const handleDirectSave = async (data: {
        questionText: string;
        answerText: string;
        analysis: string;
        wrongAnswerText: string;
        mistakeAnalysis: string;
        mistakeStatus: string;
        knowledgePoints: string[];
        subjectId: string;
        gradeSemester?: string;
        paperLevel?: string;
    }): Promise<void> => {
        try {
            setAnalysisStep('saving');
            setProgressMessage(t.common?.saving || "保存中…");
            await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                questionText: data.questionText,
                answerText: data.answerText,
                analysis: data.analysis,
                wrongAnswerText: data.wrongAnswerText || null,
                mistakeAnalysis: data.mistakeAnalysis || null,
                mistakeStatus: data.mistakeStatus || "unknown",
                knowledgePoints: data.knowledgePoints,
                subjectId: data.subjectId,
                gradeSemester: data.gradeSemester,
                paperLevel: data.paperLevel,
                originalImageUrl: "",
            });
            toast.success(t.common?.messages?.saveSuccess || '保存成功');
            if (data.subjectId) {
                router.push(`/notebooks/${data.subjectId}`);
            }
        } catch (error) {
            frontendLogger.warn('[HomeDirectSave]', 'Save failed', { status: (error as { status?: number })?.status });
            toast.error(t.common?.messages?.saveFailed || '保存失败，请重试');
        } finally {
            setAnalysisStep('idle');
        }
    };

    const backToUpload = () => {
        batch.reset();
        setTextBatchQuestions([]);
        setStep("upload");
    };


    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback status={analysisStep} message={progressMessage} />
            {batch.isRunning && step === "upload" && (
                <BatchAnalyzeProgress tasks={batch.tasks} onCancel={batch.cancel} />
            )}

            <div className="container mx-auto p-4 space-y-8 pb-20 max-w-5xl md:px-6 md:py-8">
                {/* Header Section */}
                <div className="flex justify-between items-start gap-4">
                    <UserWelcome />

                    <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm shrink-0">
                        <BroadcastNotification />
                        <SettingsDialog />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full text-muted-foreground hover:text-destructive"
                            onClick={() => signOut({ callbackUrl: '/login' })}
                            title={t.app?.logout || 'Logout'}
                            aria-label={t.app?.logout || 'Logout'}
                        >
                            <LogOut className="h-5 w-5 md:h-6 md:w-6" />
                        </Button>
                    </div>
                </div>

                {/* Action Center */}
                <div className={initialNotebookId ? "flex justify-center mb-6" : "grid grid-cols-2 md:grid-cols-4 gap-4"}>
                    <Button
                        size="lg"
                        className={`h-auto py-4 text-base shadow-sm hover:shadow-md transition-all ${initialNotebookId ? "w-full max-w-md" : ""}`}
                        variant={step === "upload" ? "default" : "secondary"}
                        onClick={() => { setStep("upload"); setInputMode("image"); }}
                    >
                        <div className="flex items-center gap-2">
                            <Upload className="h-5 w-5 md:h-6 md:w-6" />
                            <span>{t.app.uploadNew}</span>
                        </div>
                    </Button>

                    {!initialNotebookId && (
                        <>
                            <Button
                                asChild
                                variant="outline"
                                size="lg"
                                className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                            >
                                <Link href="/notebooks">
                                    <BookOpen className="h-5 w-5 md:h-6 md:w-6" />
                                    <span>{t.app.viewNotebook}</span>
                                </Link>
                            </Button>

                            <Button
                                asChild
                                variant="outline"
                                size="lg"
                                className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                            >
                                <Link href="/tags">
                                    <Tags className="h-5 w-5 md:h-6 md:w-6" />
                                    <span>{t.app?.tags || 'Tags'}</span>
                                </Link>
                            </Button>

                            <Button
                                asChild
                                variant="outline"
                                size="lg"
                                className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                            >
                                <Link href="/stats">
                                    <BarChart3 className="h-5 w-5 md:h-6 md:w-6" />
                                    <span>{t.app?.stats || 'Stats'}</span>
                                </Link>
                            </Button>

                            <Button
                                asChild
                                variant="outline"
                                size="lg"
                                className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                            >
                                <Link href="/lottery">
                                    <Gift className="h-5 w-5 md:h-6 md:w-6" />
                                    <span>{t.lottery?.title || '抽奖'}</span>
                                </Link>
                            </Button>
                        </>
                    )}
                </div>

                {step === "upload" && (
                    <div className="space-y-4">
                        {/* Input mode tabs */}
                        <div className="flex gap-2 border-b overflow-x-auto" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={inputMode === "image"}
                                className={`flex min-h-11 shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "image"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setInputMode("image")}
                            >
                                <Upload className="h-4 w-4 md:h-6 md:w-6" />
                                {t.app?.uploadImage || "拍照上传"}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={inputMode === "text"}
                                className={`flex min-h-11 shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "text"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setInputMode("text")}
                            >
                                <PenLine className="h-4 w-4 md:h-6 md:w-6" />
                                {t.app?.manualInput || "AI解题"}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={inputMode === "direct"}
                                className={`flex min-h-11 shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "direct"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setInputMode("direct")}
                            >
                                <PenLine className="h-4 w-4 md:h-6 md:w-6" />
                                {t.app?.directInput || "直接录入"}
                            </button>
                        </div>

                        {inputMode === "image" ? (
                            <UploadZone
                                onImageSelect={onImageSelect}
                                onBatchImagesSelect={handleBatchImagesSelect}
                                isAnalyzing={analysisStep !== 'idle' || batch.isRunning}
                            />
                        ) : inputMode === "text" ? (
                            <TextInputZone
                                onSubmit={handleTextSubmit}
                                isAnalyzing={analysisStep !== 'idle'}
                                defaultNotebookName={targetNotebookName}
                            />
                        ) : (
                            <DirectTextEditor
                                onSubmit={handleDirectSave}
                                defaultNotebookId={targetNotebookId}
                                defaultNotebookName={targetNotebookName}
                                isSaving={analysisStep === 'saving'}
                            />
                        )}
                    </div>
                )}

                {croppingImage && (
                    <ImageCropper
                        imageSrc={croppingImage}
                        open={isCropperOpen}
                        onClose={closeCropper}
                        onCropComplete={handleCropComplete}
                    />
                )}

                {step === "review" && parsedData && (
                    <CorrectionEditor
                        initialData={parsedData}
                        onSave={handleSave}
                        onCancel={() => setStep("upload")}
                        imagePreview={currentImage}
                        initialSubjectId={targetNotebookId}
                        aiTimeout={aiTimeout}
                    />
                )}

                {step === "batch-review" && (
                    <BatchReviewEditor
                        questions={batchQuestions}
                        notebooks={notebooks}
                        defaultNotebookId={defaultBatchNotebookId}
                        onSaveAll={handleBatchSaveAll}
                        onCancel={backToUpload}
                        isSaving={isBatchSaving}
                        savingProgress={savingProgress}
                        failedItems={isImageBatch ? failedItems : []}
                        onRetryFailed={() => { void batch.retryFailed(); }}
                        onRemoveFailed={batch.removeTask}
                        isRetrying={batch.isRunning}
                    />
                )}

            </div>
        </main>
    );
}

export default function Home() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <HomeContent />
        </Suspense>
    );
}
