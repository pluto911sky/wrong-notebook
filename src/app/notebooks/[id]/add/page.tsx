"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { BatchReviewEditor, BatchQuestionItem } from "@/components/batch-review-editor";
import { ImageCropper } from "@/components/image-cropper";
import { ParsedQuestion } from "@/lib/ai";
import { apiClient } from "@/lib/api-client";
import { AnalyzeResponse, Notebook, RuntimeConfig } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { processImageFile } from "@/lib/image-utils";
import { ArrowLeft, Upload, PenLine, Layers } from "lucide-react";
import { ProgressFeedback, ProgressStatus } from "@/components/ui/progress-feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { TextInputZone } from "@/components/text-input-zone";

export default function AddErrorPage() {
    const params = useParams();
    const router = useRouter();
    const notebookId = params.id as string;
    const [step, setStep] = useState<"upload" | "review" | "batch-review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [batchQuestions, setBatchQuestions] = useState<BatchQuestionItem[]>([]);
    const [isBatchSaving, setIsBatchSaving] = useState(false);
    const [savingProgress, setSavingProgress] = useState<{ current: number; total: number; message: string }>({ current: 0, total: 0, message: "" });
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const { t, language } = useLanguage();
    const [notebook, setNotebook] = useState<Notebook | null>(null);
    const [config, setConfig] = useState<RuntimeConfig | null>(null);

    // Input mode: "image" for photo upload, "text" for manual text input
    const [inputMode, setInputMode] = useState<"image" | "text">("image");

    // Cropper state
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);

    // Timeout Config
    const aiTimeout = config?.timeouts?.analyze || 180000;
    const safetyTimeout = aiTimeout + 10000;

    // Cleanup Blob URL to prevent memory leak
    useEffect(() => {
        return () => {
            if (croppingImage) {
                URL.revokeObjectURL(croppingImage);
            }
        };
    }, [croppingImage]);

    useEffect(() => {
        // Fetch notebook info
        apiClient.get<Notebook>(`/api/notebooks/${notebookId}`)
            .then(data => setNotebook(data))
            .catch(err => {
                console.error("Failed to fetch notebook:", err);
                router.push("/notebooks");
            });

        apiClient.get<RuntimeConfig>("/api/runtime-config")
            .then(data => {
                setConfig(data);
                if (data.timeouts?.analyze) {
                    frontendLogger.info('[Config]', 'Loaded timeout settings', {
                        analyze: data.timeouts.analyze
                    });
                }
            })
            .catch(err => console.error("Failed to fetch config:", err));
    }, [notebookId, router]);

    const onImageSelect = (file: File) => {
        const imageUrl = URL.createObjectURL(file);
        setCroppingImage(imageUrl);
        setIsCropperOpen(true);
    };

    const handleCropComplete = async (croppedBlob: Blob) => {
        setIsCropperOpen(false);
        const file = new File([croppedBlob], "cropped-image.jpg", { type: "image/jpeg" });
        handleAnalyze(file);
    };

    // 单张图片分析流程
    const handleAnalyze = async (file: File) => {
        const startTime = Date.now();
        frontendLogger.info('[AddAnalyze]', 'Starting single image analysis');

        try {
            setAnalysisStep('compressing');
            setProgressMessage("正在优化与压缩图片...");
            const base64Image = await processImageFile(file);
            setCurrentImage(base64Image);

            setAnalysisStep('analyzing');
            setProgressMessage("AI 正在深度分析题目与考点...");
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language: language,
                subjectId: notebookId
            }, { timeout: aiTimeout });

            if (!data || typeof data !== 'object') {
                throw new Error('Invalid API response');
            }

            setParsedData(data);
            setStep("review");
        } catch (error: any) {
            console.error('Analysis failed:', error);
            alert(error?.data?.message || error?.message || '分析失败，请重试');
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 多张图片批量分析流程
    const handleBatchImagesSelect = async (files: File[]) => {
        if (!files || files.length === 0) return;
        if (files.length === 1) {
            onImageSelect(files[0]);
            return;
        }

        frontendLogger.info('[AddBatchAnalyze]', 'Starting batch images analysis', { count: files.length });
        setAnalysisStep('analyzing');
        const results: BatchQuestionItem[] = [];

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setProgressMessage(`正在批量识别第 ${i + 1} / ${files.length} 张错题图片...`);
                setProgress(Math.round(((i + 0.3) / files.length) * 100));

                try {
                    const base64Image = await processImageFile(file);
                    const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                        imageBase64: base64Image,
                        language: language,
                        subjectId: notebookId
                    }, { timeout: aiTimeout });

                    if (data && typeof data === 'object') {
                        results.push({
                            id: `img-${Date.now()}-${i}`,
                            questionText: data.questionText || "未识别到题干",
                            answerText: data.answerText || "",
                            analysis: data.analysis || "",
                            knowledgePoints: Array.isArray(data.knowledgePoints) ? data.knowledgePoints : ["综合题"],
                            wrongAnswerText: data.wrongAnswerText || "",
                            mistakeAnalysis: data.mistakeAnalysis || "",
                            originalImageUrl: base64Image,
                            selected: true,
                        });
                    }
                } catch (singleErr) {
                    console.warn(`第 ${i + 1} 张图片分析出错，跳过继续处理剩余图片:`, singleErr);
                }
                setProgress(Math.round(((i + 1) / files.length) * 100));
            }

            if (results.length === 0) {
                alert("未成功识别出题目，请检查图片是否清晰！");
                return;
            }

            setBatchQuestions(results);
            setStep("batch-review");
        } catch (error: any) {
            console.error('Batch analysis error:', error);
            alert('批量识别出现问题，请重试！');
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 手动文本输入（支持单道题或多道题批量粘贴）
    const handleTextSubmit = async (questionText: string) => {
        frontendLogger.info('[AddTextSubmit]', 'Starting text analysis (batch aware)');
        setAnalysisStep('analyzing');
        setProgressMessage("AI 正在智能识别并解答题目（支持多题自动拆分）...");

        try {
            const result = await apiClient.post<{
                success: boolean;
                count: number;
                questions: Array<{
                    questionText: string;
                    answerText: string;
                    analysis: string;
                    knowledgePoints: string[];
                    wrongAnswerText?: string;
                    mistakeAnalysis?: string;
                    mistakeStatus?: string;
                }>;
            }>("/api/batch-text-analyze", {
                text: questionText,
                subjectId: notebookId,
                language,
            }, { timeout: aiTimeout });

            const questions = result?.questions || [];

            if (questions.length > 1) {
                // 多道题模式：进入批量核对编辑器
                const formatted: BatchQuestionItem[] = questions.map((q, idx) => ({
                    id: `text-${Date.now()}-${idx}`,
                    questionText: q.questionText,
                    answerText: q.answerText,
                    analysis: q.analysis,
                    knowledgePoints: q.knowledgePoints || ["综合题"],
                    wrongAnswerText: q.wrongAnswerText || "",
                    mistakeAnalysis: q.mistakeAnalysis || "",
                    originalImageUrl: null,
                    selected: true,
                }));

                setBatchQuestions(formatted);
                setStep("batch-review");
            } else if (questions.length === 1) {
                // 单道题模式：进入单题编辑器
                const q = questions[0];
                const parsed: ParsedQuestion = {
                    questionText: q.questionText,
                    answerText: q.answerText,
                    analysis: q.analysis,
                    knowledgePoints: q.knowledgePoints || [],
                    wrongAnswerText: q.wrongAnswerText || "",
                    mistakeAnalysis: q.mistakeAnalysis || "",
                    mistakeStatus: (q.mistakeStatus as any) || "unknown",
                    subject: (notebook?.name as any) || "数学",
                    requiresImage: false,
                };
                setCurrentImage(null);
                setParsedData(parsed);
                setStep("review");
            } else {
                throw new Error("未能解析出题目内容");
            }
        } catch (error: any) {
            console.error('Text analysis error:', error);
            alert(error?.data?.message || error?.message || '解题分析失败，请重试');
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 单题保存逻辑
    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string; gradeSemester?: string; paperLevel?: string }): Promise<void> => {
        try {
            await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage || "",
                subjectId: notebookId,
            });

            alert(t.common.messages?.saveSuccess || '错题保存成功！已自动预生成所有难度的举一反三变式题！');
            router.push(`/notebooks/${notebookId}`);
        } catch (error) {
            console.error(error);
            alert(t.common.messages?.saveFailed || '保存失败，请重试');
        }
    };

    // 多题批量保存逻辑
    const handleBatchSaveAll = async (toSave: BatchQuestionItem[]): Promise<void> => {
        if (!toSave || toSave.length === 0) return;
        setIsBatchSaving(true);
        let savedCount = 0;

        try {
            for (let i = 0; i < toSave.length; i++) {
                const item = toSave[i];
                setSavingProgress({
                    current: i + 1,
                    total: toSave.length,
                    message: `正在保存第 ${i + 1} / ${toSave.length} 道错题...`,
                });

                await apiClient.post<{ id: string }>("/api/error-items", {
                    questionText: item.questionText,
                    answerText: item.answerText,
                    analysis: item.analysis,
                    knowledgePoints: item.knowledgePoints,
                    wrongAnswerText: item.wrongAnswerText || "",
                    mistakeAnalysis: item.mistakeAnalysis || "",
                    mistakeStatus: "wrong",
                    originalImageUrl: item.originalImageUrl || "",
                    subjectId: notebookId,
                });
                savedCount++;
            }

            alert(`🎉 恭喜！已成功批量录入 ${savedCount} 道错题！\n所有题目已自动生成好举一反三变式题，算算喵也获得了大量经验！`);
            router.push(`/notebooks/${notebookId}`);
        } catch (error: any) {
            console.error("Batch save error:", error);
            alert(`部分题目保存出错，已成功保存 ${savedCount} 道题。`);
            router.push(`/notebooks/${notebookId}`);
        } finally {
            setIsBatchSaving(false);
        }
    };

    if (!notebook) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback
                status={analysisStep}
                progress={progress}
                message={progressMessage || "正在处理中..."}
            />

            <div className="container mx-auto p-4 space-y-6 pb-20 max-w-5xl md:px-6 md:py-8">
                {/* 页面顶栏 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href={`/notebooks/${notebookId}`}>
                            <Button variant="ghost" size="icon" className="rounded-2xl">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-black flex items-center gap-2">
                                <span>录入错题</span>
                                <span className="text-sm font-normal text-muted-foreground">
                                    ({notebook.name})
                                </span>
                            </h1>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                支持单题/多题批量录入：直接粘贴多题或多选多张图片，AI 自动解答
                            </p>
                        </div>
                    </div>
                </div>

                {/* 模式 1：上传或输入 */}
                {step === "upload" && (
                    <div className="space-y-4">
                        <div className="flex gap-2 border-b">
                            <button
                                className={`flex min-h-11 items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
                                    inputMode === "image"
                                        ? "border-orange-500 text-orange-600 dark:text-orange-400"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setInputMode("image")}
                            >
                                <Upload className="h-4 w-4" />
                                <span>拍照 / 图片上传 (支持多图)</span>
                            </button>
                            <button
                                className={`flex min-h-11 items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
                                    inputMode === "text"
                                        ? "border-orange-500 text-orange-600 dark:text-orange-400"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setInputMode("text")}
                            >
                                <PenLine className="h-4 w-4" />
                                <span>手动输入 (支持粘贴多道题)</span>
                            </button>
                        </div>

                        {inputMode === "image" ? (
                            <UploadZone
                                onImageSelect={onImageSelect}
                                onBatchImagesSelect={handleBatchImagesSelect}
                                isAnalyzing={analysisStep !== 'idle'}
                            />
                        ) : (
                            <TextInputZone
                                onSubmit={handleTextSubmit}
                                isAnalyzing={analysisStep !== 'idle'}
                                defaultNotebookName={notebook?.name}
                            />
                        )}
                    </div>
                )}

                {/* 模式 2：单题核对模式 */}
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

                {/* 模式 3：多题批量核对模式 */}
                {step === "batch-review" && (
                    <BatchReviewEditor
                        questions={batchQuestions}
                        subjectId={notebookId}
                        notebookName={notebook.name}
                        onSaveAll={handleBatchSaveAll}
                        onCancel={() => setStep("upload")}
                        isSaving={isBatchSaving}
                        savingProgress={savingProgress}
                    />
                )}
            </div>

            <ImageCropper
                imageSrc={croppingImage || ""}
                open={isCropperOpen}
                onClose={() => setIsCropperOpen(false)}
                onCropComplete={handleCropComplete}
            />
        </main>
    );
}
