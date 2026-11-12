"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { BatchReviewEditor, BatchQuestionItem } from "@/components/batch-review-editor";
import { BatchAnalyzeProgress } from "@/components/batch-analyze-progress";
import { ImageCropper } from "@/components/image-cropper";
import { ParsedQuestion } from "@/lib/ai";
import { apiClient } from "@/lib/api-client";
import { AnalyzeResponse, Notebook, RuntimeConfig } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { processImageFile } from "@/lib/image-utils";
import { ArrowLeft, Upload, PenLine } from "lucide-react";
import { ProgressFeedback, ProgressStatus } from "@/components/ui/progress-feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { TextInputZone } from "@/components/text-input-zone";
import { toast } from "@/components/ui/toast";
import { getAIErrorMessage } from "@/lib/ai-error-message";
import { saveBatchQuestions } from "@/lib/batch-save";
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

export default function AddErrorPage() {
    const params = useParams();
    const router = useRouter();
    const notebookId = params.id as string;
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
    const [notebook, setNotebook] = useState<Notebook | null>(null);
    const [config, setConfig] = useState<RuntimeConfig | null>(null);

    const [inputMode, setInputMode] = useState<"image" | "text">("image");

    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);

    const aiTimeout = config?.timeouts?.analyze || 180000;
    const errorDict = t.errors as Record<string, unknown> | undefined;

    const batch = useBatchImageAnalysis({
        subjectId: notebookId,
        language,
        timeoutMs: aiTimeout,
        errors: errorDict,
    });

    // 裁剪图的 Blob URL：替换或卸载时释放
    useEffect(() => {
        return () => {
            if (croppingImage) URL.revokeObjectURL(croppingImage);
        };
    }, [croppingImage]);

    useEffect(() => {
        apiClient.get<Notebook>(`/api/notebooks/${notebookId}`)
            .then(data => setNotebook(data))
            .catch(err => {
                // 预期内的失败（错题本不存在/网络抖动）用 warn，避免触发开发模式错误角标
                console.warn("Failed to fetch notebook:", err);
                router.push("/notebooks");
            });

        apiClient.get<RuntimeConfig>("/api/runtime-config")
            .then(data => setConfig(data))
            .catch(err => console.warn("Failed to fetch config:", err));
    }, [notebookId, router]);

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

    // 单张图片分析流程
    const handleAnalyze = async (file: File) => {
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
                subjectId: notebookId
            }, { timeout: aiTimeout });

            if (!data?.questionText) {
                throw new Error('AI_RESPONSE_ERROR');
            }

            setParsedData(data);
            setStep("review");
        } catch (error) {
            frontendLogger.warn('[AddAnalyze]', 'Analysis failed', { error: String(error) });
            toast.error(getAIErrorMessage(error, errorDict, t.common.messages?.analysisFailed || '分析失败，请重试'));
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 多张图片批量分析：并发识别，逐张显示状态，失败的在核对页可单独重试
    const handleBatchImagesSelect = async (files: File[]) => {
        if (files.length === 0) return;
        if (files.length === 1) {
            onImageSelect(files[0]);
            return;
        }
        frontendLogger.info('[AddBatchAnalyze]', 'Starting batch images analysis', { count: files.length });
        setTextBatchQuestions([]);
        const finalTasks = await batch.start(files);
        const okCount = finalTasks.filter(task => task.status === "done").length;
        const failCount = finalTasks.filter(task => task.status === "failed").length;

        if (okCount === 0 && failCount === 0) {
            // 用户在任何一张完成前取消了
            batch.reset();
            return;
        }
        if (failCount > 0) {
            toast.error(`${failCount} 张图片未识别成功，可在下方查看原因并重试`);
        }
        setStep("batch-review");
    };

    // 手动文本输入（支持单道题或多道题批量粘贴）
    const handleTextSubmit = async (questionText: string) => {
        setAnalysisStep('analyzing');
        setProgressMessage("AI 正在识别并解答题目（多题会自动拆分）…");

        try {
            const result = await apiClient.post<BatchTextResponse>("/api/batch-text-analyze", {
                text: questionText,
                subjectId: notebookId,
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
                    subject: "其他",
                    requiresImage: false,
                });
                setStep("review");
            } else {
                throw new Error("AI_RESPONSE_ERROR");
            }
        } catch (error) {
            frontendLogger.warn('[AddTextSubmit]', 'Text analysis failed', { error: String(error) });
            toast.error(getAIErrorMessage(error, errorDict, '解题分析失败，请重试'));
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 单题保存
    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string; gradeSemester?: string; paperLevel?: string }): Promise<void> => {
        try {
            await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage || "",
                subjectId: notebookId,
            });
            toast.success(t.common.messages?.saveSuccess || '保存成功，举一反三变式题正在后台生成');
            router.push(`/notebooks/${notebookId}`);
        } catch (error) {
            frontendLogger.warn('[AddSave]', 'Save failed', { error: String(error) });
            toast.error(t.common.messages?.saveFailed || '保存失败，请重试');
        }
    };

    // 批量保存：失败的题目留在页面上，全部成功才跳转
    const handleBatchSaveAll = async (toSave: BatchQuestionItem[]): Promise<string[]> => {
        setIsBatchSaving(true);
        try {
            const { savedIds, failedIds } = await saveBatchQuestions(toSave, notebookId, (current, total) => {
                setSavingProgress({ current, total });
            });
            if (failedIds.length === 0) {
                toast.success(`已录入 ${savedIds.length} 道错题，举一反三变式题正在后台生成`);
                router.push(`/notebooks/${notebookId}`);
            } else {
                toast.error(`已保存 ${savedIds.length} 道，${failedIds.length} 道保存失败，已留在页面上，可再次保存`);
            }
            return savedIds;
        } finally {
            setIsBatchSaving(false);
        }
    };

    const backToUpload = () => {
        batch.reset();
        setTextBatchQuestions([]);
        setStep("upload");
    };

    if (!notebook) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    const imageBatchQuestions = batch.tasks
        .filter(task => task.status === "done" && task.result)
        .map(task => task.result as BatchQuestionItem);
    const failedItems = batch.tasks
        .filter(task => task.status === "failed" || task.status === "cancelled")
        .map(task => ({ id: task.id, name: task.name, error: task.error || (task.status === "cancelled" ? "已取消" : undefined) }));
    const isImageBatch = batch.tasks.length > 0;

    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback status={analysisStep} message={progressMessage || "正在处理中…"} />
            {batch.isRunning && step === "upload" && (
                <BatchAnalyzeProgress tasks={batch.tasks} onCancel={batch.cancel} />
            )}

            <div className="container mx-auto p-4 space-y-6 pb-20 max-w-5xl md:px-6 md:py-8">
                <div className="flex items-center gap-3">
                    <Button asChild variant="ghost" size="icon" className="rounded-2xl">
                        <Link href={`/notebooks/${notebookId}`} aria-label="返回错题本">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold flex flex-wrap items-center gap-2">
                            <span>录入错题</span>
                            <span className="text-sm font-normal text-muted-foreground">({notebook.name})</span>
                        </h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            可一次选择多张图片，或粘贴多道题，AI 会逐题解答
                        </p>
                    </div>
                </div>

                {step === "upload" && (
                    <div className="space-y-4">
                        <div className="flex gap-2 border-b" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={inputMode === "image"}
                                className={`flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${inputMode === "image" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                onClick={() => setInputMode("image")}
                            >
                                <Upload className="h-4 w-4" />
                                <span>图片上传</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={inputMode === "text"}
                                className={`flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${inputMode === "text" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                onClick={() => setInputMode("text")}
                            >
                                <PenLine className="h-4 w-4" />
                                <span>文字输入</span>
                            </button>
                        </div>

                        {inputMode === "image" ? (
                            <UploadZone
                                onImageSelect={onImageSelect}
                                onBatchImagesSelect={handleBatchImagesSelect}
                                isAnalyzing={analysisStep !== 'idle' || batch.isRunning}
                            />
                        ) : (
                            <TextInputZone
                                onSubmit={handleTextSubmit}
                                isAnalyzing={analysisStep !== 'idle'}
                                defaultNotebookName={notebook.name}
                            />
                        )}
                    </div>
                )}

                {step === "review" && parsedData && (
                    <CorrectionEditor
                        initialData={parsedData}
                        imagePreview={currentImage}
                        onSave={handleSave}
                        onCancel={() => setStep("upload")}
                        initialSubjectId={notebookId}
                        aiTimeout={aiTimeout}
                    />
                )}

                {step === "batch-review" && (
                    <BatchReviewEditor
                        questions={isImageBatch ? imageBatchQuestions : textBatchQuestions}
                        notebookName={notebook.name}
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

            <ImageCropper
                imageSrc={croppingImage || ""}
                open={isCropperOpen}
                onClose={closeCropper}
                onCropComplete={handleCropComplete}
            />
        </main>
    );
}
