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

function HomeContent() {
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
        // Fetch notebooks for auto-selection
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(data => setNotebooks(data))
            .catch(err => console.error("Failed to fetch notebooks:", err));

        // Fetch only non-secret runtime settings; full AI settings are admin-only.
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
    }, []);

    // Simulate progress for smoother UX with timeout protection
    useEffect(() => {
        let interval: NodeJS.Timeout;
        let timeout: NodeJS.Timeout;
        if (analysisStep !== 'idle') {
            setProgress(0);
            interval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 90) return prev; // Cap at 90% until complete
                    return prev + Math.random() * 10;
                });
            }, 500);

            // Safety timeout: auto-reset after configurable time to prevent stuck overlay
            timeout = setTimeout(() => {
                console.warn('[Progress] Safety timeout triggered - resetting analysisStep');
                setAnalysisStep('idle');
            }, safetyTimeout);
        }
        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [analysisStep, safetyTimeout]);

    const onImageSelect = (file: File) => {
        const imageUrl = URL.createObjectURL(file);
        setCroppingImage(imageUrl);
        setIsCropperOpen(true);
    };

    const handleCropComplete = async (croppedBlob: Blob) => {
        setIsCropperOpen(false);
        // Convert Blob to File
        const file = new File([croppedBlob], "cropped-image.jpg", { type: "image/jpeg" });
        handleAnalyze(file);
    };

    const handleAnalyze = async (file: File) => {
        const startTime = Date.now();
        frontendLogger.info('[HomeAnalyze]', 'Starting analysis flow', {
            timeoutSettings: {
                apiTimeout: aiTimeout,
                safetyTimeout
            }
        });

        try {
            frontendLogger.info('[HomeAnalyze]', 'Step 1/5: Compressing image');
            setAnalysisStep('compressing');
            const base64Image = await processImageFile(file);
            setCurrentImage(base64Image);
            frontendLogger.info('[HomeAnalyze]', 'Image compressed successfully', {
                size: base64Image.length
            });

            frontendLogger.info('[HomeAnalyze]', 'Step 2/5: Calling API endpoint /api/analyze');
            setAnalysisStep('analyzing');
            const apiStartTime = Date.now();
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language: language,
                subjectId: initialNotebookId || autoSelectedNotebookId || undefined
            }, { timeout: aiTimeout }); // Use configured timeout
            const apiDuration = Date.now() - apiStartTime;
            frontendLogger.info('[HomeAnalyze]', 'API response received, validating data', {
                apiDuration
            });

            // Validate response data
            if (!data || typeof data !== 'object') {
                frontendLogger.error('[HomeAnalyze]', 'Validation failed - invalid response data', {
                    data
                });
                throw new Error('Invalid API response: data is null or not an object');
            }
            frontendLogger.info('[HomeAnalyze]', 'Response data validated successfully');

            frontendLogger.info('[HomeAnalyze]', 'Step 3/5: Setting processing state and progress to 100%');
            setAnalysisStep('processing');
            setProgress(100);
            frontendLogger.info('[HomeAnalyze]', 'Progress updated to 100%');

            frontendLogger.info('[HomeAnalyze]', 'Step 4/5: Setting parsed data and auto-selecting notebook');
            const dataSize = JSON.stringify(data).length;
            // Auto-select notebook based on subject
            if (data.subject) {
                const matchedNotebook = notebooks.find(n =>
                    n.name.includes(data.subject!) || data.subject!.includes(n.name)
                );
                if (matchedNotebook) {
                    setAutoSelectedNotebookId(matchedNotebook.id);
                    frontendLogger.info('[HomeAnalyze]', 'Auto-selected notebook', {
                        notebook: matchedNotebook.name,
                        subject: data.subject
                    });
                }
            }
            const setDataStart = Date.now();
            setParsedData(data);
            const setDataDuration = Date.now() - setDataStart;
            frontendLogger.info('[HomeAnalyze]', 'Parsed data set successfully', {
                dataSize,
                setDataDuration
            });

            frontendLogger.info('[HomeAnalyze]', 'Step 5/5: Switching to review page');
            const setStepStart = Date.now();
            setStep("review");
            const setStepDuration = Date.now() - setStepStart;
            frontendLogger.info('[HomeAnalyze]', 'Step switched to review', {
                setStepDuration
            });
            const totalDuration = Date.now() - startTime;
            frontendLogger.info('[HomeAnalyze]', 'Analysis completed successfully', {
                totalDuration
            });
        } catch (error: any) {
            const errorDuration = Date.now() - startTime;
            frontendLogger.error('[HomeError]', 'Analysis failed', {
                errorDuration,
                error: error.message || String(error)
            });

            // 安全的错误处理逻辑，防止在报错时二次报错
            try {
                let errorMessage = t.common?.messages?.analysisFailed || 'Analysis failed, please try again';

                // ApiError 的结构：error.data.message 包含后端返回的错误类型
                const backendErrorType = error?.data?.message;

                if (backendErrorType && typeof backendErrorType === 'string') {
                    // 检查是否是已知的 AI 错误类型
                    if (t.errors && typeof t.errors === 'object' && backendErrorType in t.errors) {
                        const mappedError = (t.errors as any)[backendErrorType];
                        if (typeof mappedError === 'string') {
                            errorMessage = mappedError;
                            frontendLogger.info('[HomeError]', `Matched error type: ${backendErrorType}`, {
                                errorMessage
                            });
                        }
                    } else {
                        // 使用后端返回的具体错误消息
                        errorMessage = backendErrorType;
                        frontendLogger.info('[HomeError]', 'Using backend error message', {
                            errorMessage
                        });
                    }
                } else if (error?.message) {
                    // Fallback：检查 error.message（用于非 API 错误）
                    if (error.message.includes('fetch') || error.message.includes('network')) {
                        errorMessage = t.errors?.AI_CONNECTION_FAILED || '网络连接失败';
                    } else if (typeof error.data === 'string') {
                        frontendLogger.info('[HomeError]', 'Raw error data', {
                            errorDataPreview: error.data.substring(0, 100)
                        });
                        errorMessage += ` (${error.status || 'Error'})`;
                    }
                }

                alert(errorMessage);
            } catch (innerError) {
                frontendLogger.error('[HomeError]', 'Failed to process error message', {
                    innerError: String(innerError)
                });
                alert('Analysis failed. Please try again.');
            }
        } finally {
            // Always reset analysis state, even if setState throws
            frontendLogger.info('[HomeAnalyze]', 'Finally: Resetting analysis state to idle');
            setAnalysisStep('idle');
            frontendLogger.info('[HomeAnalyze]', 'Analysis state reset complete');
        }
    };

    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string }): Promise<void> => {
        frontendLogger.info('[HomeSave]', 'Starting save process', {
            hasQuestionText: !!finalData.questionText,
            hasAnswerText: !!finalData.answerText,
            subjectId: finalData.subjectId,
            knowledgePointsCount: finalData.knowledgePoints?.length || 0,
            hasImage: !!currentImage,
            imageSize: currentImage?.length || 0,
        });

        try {
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage || "",
            });

            // 检查是否是重复提交（后端去重返回）
            if (result.duplicate) {
                frontendLogger.info('[HomeSave]', 'Duplicate submission detected, using existing record');
            }

            frontendLogger.info('[HomeSave]', 'Save successful');
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
            alert(t.common?.messages?.saveSuccess || 'Saved successfully!');

            // Redirect to notebook page if subjectId is present
            if (finalData.subjectId) {
                router.push(`/notebooks/${finalData.subjectId}`);
            }
        } catch (error: any) {
            frontendLogger.error('[HomeSave]', 'Save failed', {
                errorStatus: error?.status,
                errorMessage: error?.data?.message || error?.message || String(error),
                errorData: error?.data,
            });
            alert(t.common?.messages?.saveFailed || 'Failed to save');
        }
    };

    // 多图批量分析
    const handleBatchImagesSelect = async (files: File[]) => {
        if (!files || files.length === 0) return;
        if (files.length === 1) {
            onImageSelect(files[0]);
            return;
        }

        frontendLogger.info('[HomeBatchAnalyze]', 'Starting batch images analysis', { count: files.length });
        setAnalysisStep('analyzing');
        const results: BatchQuestionItem[] = [];

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setProgressMessage(`正在批量识别第 ${i + 1} / ${files.length} 张图片...`);
                setProgress(Math.round(((i + 0.3) / files.length) * 100));

                try {
                    const base64Image = await processImageFile(file);
                    const targetNotebookId = initialNotebookId || autoSelectedNotebookId || undefined;
                    const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                        imageBase64: base64Image,
                        language: language,
                        subjectId: targetNotebookId,
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
                    console.warn(`第 ${i + 1} 张图片分析失败，跳过:`, singleErr);
                }
                setProgress(Math.round(((i + 1) / files.length) * 100));
            }

            if (results.length === 0) {
                alert("未成功识别出题目，请检查图片清晰度！");
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

    const handleTextSubmit = async (questionText: string) => {
        const startTime = Date.now();
        frontendLogger.info('[HomeTextSubmit]', 'Starting text-based analysis (batch aware)', { textLength: questionText.length });

        try {
            setAnalysisStep('analyzing');
            setProgressMessage("AI 正在智能识别并解答多道题...");

            const targetNotebookId = initialNotebookId || autoSelectedNotebookId;

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
                subjectId: targetNotebookId || undefined,
                language,
            }, { timeout: aiTimeout });

            const questions = result?.questions || [];

            if (questions.length > 1) {
                // 多题进入批量核对编辑器
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
                // 单题进入单题核对
                const q = questions[0];
                const parsed: ParsedQuestion = {
                    questionText: q.questionText,
                    answerText: q.answerText,
                    analysis: q.analysis,
                    knowledgePoints: q.knowledgePoints || [],
                    wrongAnswerText: q.wrongAnswerText || "",
                    mistakeAnalysis: q.mistakeAnalysis || "",
                    mistakeStatus: (q.mistakeStatus as any) || "unknown",
                    subject: "数学",
                    requiresImage: false,
                };

                setCurrentImage(null);
                setParsedData(parsed);
                setStep("review");
            } else {
                throw new Error("未能识别出题目");
            }

            const totalDuration = Date.now() - startTime;
            frontendLogger.info('[HomeTextSubmit]', 'Text analysis completed', { totalDuration });
        } catch (error: any) {
            const errorDuration = Date.now() - startTime;
            frontendLogger.error('[HomeTextSubmit]', 'Analysis failed', {
                errorDuration,
                error: error.message || String(error)
            });
            alert('解题分析失败，请重试！');
        } finally {
            setAnalysisStep('idle');
        }
    };

    // 首页批量保存逻辑
    const handleBatchSaveAll = async (toSave: BatchQuestionItem[]): Promise<void> => {
        if (!toSave || toSave.length === 0) return;
        setIsBatchSaving(true);
        let savedCount = 0;
        const targetNotebookId = initialNotebookId || autoSelectedNotebookId || notebooks[0]?.id;

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
                    subjectId: targetNotebookId,
                });
                savedCount++;
            }

            alert(`🎉 恭喜！已成功批量录入 ${savedCount} 道错题！\n系统已自动预生成所有难度的举一反三变式题！`);
            setStep("upload");
            if (targetNotebookId) {
                router.push(`/notebooks/${targetNotebookId}`);
            }
        } catch (error: any) {
            console.error("Home batch save error:", error);
            alert(`部分题目保存出错，已保存 ${savedCount} 道错题。`);
            setStep("upload");
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
        frontendLogger.info('[HomeDirectSave]', 'Starting direct save', {
            hasQuestionText: !!data.questionText,
            hasAnswerText: !!data.answerText,
            subjectId: data.subjectId,
        });

        try {
            setAnalysisStep('saving');
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
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

            if (result.duplicate) {
                frontendLogger.info('[HomeDirectSave]', 'Duplicate detected');
            }

            frontendLogger.info('[HomeDirectSave]', 'Save successful');
            setAnalysisStep('idle');
            alert(t.common?.messages?.saveSuccess || 'Saved successfully!');

            if (data.subjectId) {
                router.push(`/notebooks/${data.subjectId}`);
            }
        } catch (error: any) {
            frontendLogger.error('[HomeDirectSave]', 'Save failed', {
                errorStatus: error?.status,
                errorMessage: error?.data?.message || error?.message || String(error),
            });
            setAnalysisStep('idle');
            alert(t.common?.messages?.saveFailed || 'Failed to save');
        }
    };

    const getProgressMessage = () => {
        switch (analysisStep) {
            case 'compressing': return t.common.progress?.compressing || "Compressing...";
            case 'uploading': return t.common.progress?.uploading || "Uploading...";
            case 'analyzing': return t.common.progress?.analyzing || "Analyzing...";
            case 'processing': return t.common.progress?.processing || "Processing...";
            case 'saving': return "保存中...";
            default: return "";
        }
    };

    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback
                status={analysisStep}
                progress={progress}
                message={progressMessage || getProgressMessage()}
            />

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
                            <Link href="/notebooks" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <BookOpen className="h-5 w-5 md:h-6 md:w-6" />
                                        <span>{t.app.viewNotebook}</span>
                                    </div>
                                </Button>
                            </Link>

                            <Link href="/tags" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <Tags className="h-5 w-5 md:h-6 md:w-6" />
                                        <span>{t.app?.tags || 'Tags'}</span>
                                    </div>
                                </Button>
                            </Link>

                            <Link href="/stats" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <BarChart3 className="h-5 w-5 md:h-6 md:w-6" />
                                        <span>{t.app?.stats || 'Stats'}</span>
                                    </div>
                                </Button>
                            </Link>

                            <Link href="/lottery" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <Gift className="h-5 w-5 md:h-6 md:w-6" />
                                        <span>{t.lottery?.title || '抽奖'}</span>
                                    </div>
                                </Button>
                            </Link>
                        </>
                    )}
                </div>

                {step === "upload" && (
                    <div className="space-y-4">
                        {/* Input mode tabs */}
                        <div className="flex gap-2 border-b">
                            <button
                                className={`flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
                                className={`flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
                                className={`flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "direct"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setInputMode("direct")}
                            >
                                <PenLine className="h-4 w-4 md:h-6 md:w-6" />
                                直接录入
                            </button>
                        </div>

                        {inputMode === "image" ? (
                            <UploadZone
                                onImageSelect={onImageSelect}
                                onBatchImagesSelect={handleBatchImagesSelect}
                                isAnalyzing={analysisStep !== 'idle'}
                            />
                        ) : inputMode === "text" ? (
                            <TextInputZone
                                onSubmit={handleTextSubmit}
                                isAnalyzing={analysisStep !== 'idle'}
                                defaultNotebookName={
                                    (initialNotebookId || autoSelectedNotebookId)
                                        ? notebooks.find(n => n.id === (initialNotebookId || autoSelectedNotebookId))?.name
                                        : undefined
                                }
                            />
                        ) : (
                            <DirectTextEditor
                                onSubmit={handleDirectSave}
                                defaultNotebookId={initialNotebookId || autoSelectedNotebookId || undefined}
                                defaultNotebookName={
                                    (initialNotebookId || autoSelectedNotebookId)
                                        ? notebooks.find(n => n.id === (initialNotebookId || autoSelectedNotebookId))?.name
                                        : undefined
                                }
                                isSaving={analysisStep === 'saving'}
                            />
                        )}
                    </div>
                )}

                {croppingImage && (
                    <ImageCropper
                        imageSrc={croppingImage}
                        open={isCropperOpen}
                        onClose={() => setIsCropperOpen(false)}
                        onCropComplete={handleCropComplete}
                    />
                )}

                {step === "review" && parsedData && (
                    <CorrectionEditor
                        initialData={parsedData}
                        onSave={handleSave}
                        onCancel={() => setStep("upload")}
                        imagePreview={currentImage}
                        initialSubjectId={initialNotebookId || autoSelectedNotebookId || undefined}
                        aiTimeout={aiTimeout}
                    />
                )}

                {step === "batch-review" && (
                    <BatchReviewEditor
                        questions={batchQuestions}
                        subjectId={initialNotebookId || autoSelectedNotebookId || undefined}
                        onSaveAll={handleBatchSaveAll}
                        onCancel={() => setStep("upload")}
                        isSaving={isBatchSaving}
                        savingProgress={savingProgress}
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
