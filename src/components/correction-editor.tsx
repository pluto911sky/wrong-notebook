"use client";

import { useState, useEffect } from "react";
import { ParsedQuestion } from "@/lib/ai";
import { calculateGrade } from "@/lib/grade-calculator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, RefreshCw, Loader2, Box } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TagInput } from "@/components/tag-input";
import { NotebookSelector } from "@/components/notebook-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { UserProfile, Notebook } from "@/types/api";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { normalizeMistakeStatusForSave, type MistakeStatus } from "@/lib/mistake-status";
import type { ReanswerQuestionResult } from "@/lib/ai/types";
import { buildReanswerRequestBody } from "@/lib/reanswer-request";
import { GeogebraDemo } from "@/components/geogebra-demo";
import { toast } from "@/components/ui/toast";

interface ParsedQuestionWithSubject extends ParsedQuestion {
    subjectId?: string;
    gradeSemester?: string;
    paperLevel?: string;
    geogebraCommands?: string;
}

interface CorrectionEditorProps {
    initialData: ParsedQuestion;
    onSave: (data: ParsedQuestionWithSubject) => Promise<void>;
    onCancel: () => void;
    imagePreview?: string | null;
    initialSubjectId?: string;
    aiTimeout?: number;
}

type ReanswerErrorMessages = {
    default?: string;
    authError?: string;
    connectionFailed?: string;
    responseError?: string;
};

export function CorrectionEditor({ initialData, onSave, onCancel, imagePreview, initialSubjectId, aiTimeout }: CorrectionEditorProps) {
    const [data, setData] = useState<ParsedQuestionWithSubject>({
        ...initialData,
        wrongAnswerText: initialData.wrongAnswerText || "",
        mistakeAnalysis: initialData.mistakeAnalysis || "",
        mistakeStatus: initialData.mistakeStatus || "unknown",
        subjectId: initialSubjectId,
        gradeSemester: "",
        paperLevel: "a"
    });
    const { t, language } = useLanguage();
    const [isReanswering, setIsReanswering] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isAnalyzingGeogebra, setIsAnalyzingGeogebra] = useState(false);
    const [geogebraError, setGeogebraError] = useState<string | null>(null);

    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);



    // Fetch user info and calculate grade on mount
    useEffect(() => {
        // Fetch notebooks for mapping
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch(err => console.warn("Failed to fetch notebooks:", err));

        apiClient.get<UserProfile>("/api/user")
            .then(user => {
                if (user && user.educationStage && user.enrollmentYear) {
                    const grade = calculateGrade(user.educationStage, user.enrollmentYear, new Date(), language);
                    setData(prev => ({ ...prev, gradeSemester: grade }));
                    setEducationStage(user.educationStage);
                }
            })
            .catch(err => console.warn("Failed to fetch user info for grade calculation:", err));
    }, [language]);

    // 重新解题函数
    const handleReanswer = async () => {
        if (!data.questionText.trim()) {
            toast.error(t.editor.enterQuestionFirst || 'Please enter question text first');
            return;
        }

        setIsReanswering(true);
        try {
            const requestBody = buildReanswerRequestBody({
                questionText: data.questionText,
                language,
                subject: data.subject,
                imagePreview,
                gradeSemester: data.gradeSemester,
            });

            if (requestBody.imageBase64) {
                console.log("[Reanswer] Sending image + text (Image available for mistake analysis)");
            } else {
                console.log("[Reanswer] Sending text only (No image available)");
            }

            frontendLogger.info('[Reanswer]', 'Sending request', { timeout: aiTimeout });

            const result = await apiClient.post<ReanswerQuestionResult>("/api/reanswer", requestBody, { timeout: aiTimeout || 180000 });

            setData(prev => ({
                ...prev,
                answerText: result.answerText,
                analysis: result.analysis,
                knowledgePoints: result.knowledgePoints,
                wrongAnswerText: result.wrongAnswerText || "",
                mistakeAnalysis: result.mistakeAnalysis || "",
                mistakeStatus: normalizeMistakeStatusForSave(
                    result.mistakeStatus,
                    result.wrongAnswerText
                ),
            }));

            toast.success(t.editor.reanswerSuccess || '✅ Answer and analysis updated!');
        } catch (error: unknown) {
            console.warn("Reanswer failed:", error);
            const apiError = error as { data?: { message?: string } };
            const msg = apiError.data?.message || '';

            const reanswerErrors: ReanswerErrorMessages = t.errors?.reanswer || {};
            let errorText = reanswerErrors.default || 'Reanswer failed';

            if (msg.includes('AI_AUTH_ERROR')) {
                errorText = reanswerErrors.authError || t.errors?.AI_AUTH_ERROR || errorText;
            } else if (msg.includes('AI_CONNECTION_FAILED')) {
                errorText = reanswerErrors.connectionFailed || t.errors?.AI_CONNECTION_FAILED || errorText;
            } else if (msg.includes('AI_RESPONSE_ERROR')) {
                errorText = reanswerErrors.responseError || t.errors?.AI_RESPONSE_ERROR || errorText;
            }

            toast.error(errorText);

        } finally {
            setIsReanswering(false);
        }
    };

    const handleAnalyzeGeogebra = async () => {
        if (!data.questionText.trim()) {
            toast.error(t.editor.enterQuestionFirst || '请先输入题目文本');
            return;
        }
        if (!data.answerText.trim()) {
            toast.error('请先生成或输入答案');
            return;
        }

        setIsAnalyzingGeogebra(true);
        setGeogebraError(null);
        try {
            const response = await fetch("/api/geogebra-analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    questionText: data.questionText,
                    answerText: data.answerText,
                    analysis: data.analysis,
                }),
            });

            if (!response.ok) {
                throw new Error("Analysis failed");
            }

            const result = await response.json();
            if (result.suitable && result.commands?.length > 0) {
                setData(prev => ({
                    ...prev,
                    geogebraCommands: JSON.stringify(result.commands),
                }));
            } else {
                setGeogebraError(result.description || "该题目不适合用 GeoGebra 演示");
            }
        } catch (error: any) {
            console.warn("GeoGebra analysis failed:", error);
            setGeogebraError("分析失败，请稍后重试");
        } finally {
            setIsAnalyzingGeogebra(false);
        }
    };


    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.editor.title}</h2>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        {t.editor.cancel}
                    </Button>
                    <Button
                        onClick={async () => {
                            if (!data.subjectId) {
                                toast.error(t.editor.messages?.selectNotebook || "Please select a notebook");
                                return;
                            }
                            if (isSaving) return; // 防止重复点击
                            setIsSaving(true);
                            try {
                                await onSave({
                                    ...data,
                                    mistakeStatus: normalizeMistakeStatusForSave(
                                        data.mistakeStatus,
                                        data.wrongAnswerText
                                    ),
                                });
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <Loader2 className="mr-2 h-4 w-4 md:h-6 md:w-6 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4 md:h-6 md:w-6" />
                        )}
                        {isSaving ? (t.common?.pleaseWait || "Please wait...") : t.editor.save}
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* 左侧：编辑区 */}
                <div className="space-y-6">
                    {imagePreview && (
                        <Card>
                            <CardContent className="p-4">
                                <img src={imagePreview} alt="Original" className="w-full rounded-md" />
                            </CardContent>
                        </Card>
                    )}

                    <div className="space-y-2">
                        <Label>{t.editor.selectNotebook || "Select Notebook"}</Label>
                        <NotebookSelector
                            value={data.subjectId}
                            onChange={(id) => setData({ ...data, subjectId: id })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{t.editor.gradeSemester || "Grade/Semester"}</Label>
                            <Input
                                value={data.gradeSemester || ""}
                                onChange={(e) => setData({ ...data, gradeSemester: e.target.value })}
                                placeholder="e.g. Junior High Grade 1, 1st Semester"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t.editor.paperLevel || "Paper Level"}</Label>
                            <Select
                                value={data.paperLevel || "a"}
                                onValueChange={(val) => setData({ ...data, paperLevel: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="a">{t.editor.paperLevels?.a || "Paper A"}</SelectItem>
                                    <SelectItem value="b">{t.editor.paperLevels?.b || "Paper B"}</SelectItem>
                                    <SelectItem value="other">{t.editor.paperLevels?.other || "Other"}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.question}</Label>
                        <Textarea
                            value={data.questionText}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({ ...data, questionText: e.target.value })}
                            className="min-h-[150px] font-mono text-sm"
                            placeholder={t.editor.placeholder || "Supports Markdown and LaTeX..."}
                        />
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleReanswer}
                            disabled={isReanswering || !data.questionText.trim()}
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium"
                        >
                            {isReanswering ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 md:h-6 md:w-6 animate-spin" />
                                    {t.editor.reanswering || 'AI solving...'}
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4 md:h-6 md:w-6" />
                                    {t.editor.reanswer || '🔄 Reanswer (based on corrected question)'}
                                </>
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            {t.editor.reanswerHint || '💡 If the question was misrecognized, correct it and click to regenerate answer'}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.tags}</Label>
                        <TagInput
                            value={data.knowledgePoints}
                            onChange={(tags) => setData({ ...data, knowledgePoints: tags })}
                            placeholder={t.editor.tagsPlaceholder || "Enter knowledge tags..."}
                            enterHint={t.editor.createTagHint}
                            subject={inferSubjectFromName(notebooks.find(n => n.id === data.subjectId)?.name || null) || inferSubjectFromName(data.subject || null) || undefined}
                            gradeStage={educationStage}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.editor.tagsHint || "💡 Tag suggestions will appear as you type"}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>简单解析（一句话说明错误内容/解题关键）</Label>
                        <Textarea
                            value={data.mistakeAnalysis || ""}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({
                                ...data,
                                mistakeAnalysis: e.target.value,
                            })}
                            className="min-h-[80px] text-sm"
                            placeholder="用一句话大概说明这道题容易错在哪、或核心解题思路..."
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.answer}</Label>
                        <Textarea
                            value={data.answerText}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({ ...data, answerText: e.target.value })}
                            className="min-h-[80px] font-mono text-sm"
                            placeholder="只填写单纯的参考答案..."
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>详细解析</Label>
                        <Textarea
                            value={data.analysis}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setData({ ...data, analysis: e.target.value })}
                            className="min-h-[200px] font-mono text-sm"
                            placeholder={t.editor.placeholder || "Supports Markdown and LaTeX..."}
                        />
                    </div>
                </div>

                {/* 右侧：预览区 */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.preview?.question || "Question Preview"}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <MarkdownRenderer content={data.questionText} />
                        </CardContent>
                    </Card>

                    {/* GeoGebra Dynamic Demo */}
                    {data.geogebraCommands ? (
                        <GeogebraDemo commands={data.geogebraCommands} height={350} onRegenerate={handleAnalyzeGeogebra} />
                    ) : data.questionText.trim() && data.answerText.trim() ? (
                        <div className="rounded-lg border border-dashed p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Box className="h-4 w-4 md:h-6 md:w-6" />
                                    <span>GeoGebra 动态演示</span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleAnalyzeGeogebra}
                                    disabled={isAnalyzingGeogebra}
                                >
                                    {isAnalyzingGeogebra ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 md:h-6 md:w-6 animate-spin" />
                                            AI 分析中...
                                        </>
                                    ) : (
                                        <>
                                            <Box className="mr-2 h-4 w-4 md:h-6 md:w-6" />
                                            生成演示
                                        </>
                                    )}
                                </Button>
                            </div>
                            {geogebraError && (
                                <p className="text-xs text-muted-foreground mt-2">{geogebraError}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                                AI 将判断本题是否可以用 GeoGebra 进行动态演示
                            </p>
                        </div>
                    ) : null}

                    <Card>
                        <CardHeader>
                            <CardTitle>简单解析与参考答案预览</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {data.mistakeAnalysis && (
                                <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-3 text-sm">
                                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">简单解析</div>
                                    <MarkdownRenderer content={data.mistakeAnalysis} />
                                </div>
                            )}
                            <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-3 text-sm">
                                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1">参考答案</div>
                                <MarkdownRenderer content={data.answerText} />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>详细解析预览</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <MarkdownRenderer content={data.analysis} />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
