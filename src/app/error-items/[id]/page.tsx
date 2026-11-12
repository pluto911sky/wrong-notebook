"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    ArrowLeft,
    CheckCircle,
    XCircle,
    RefreshCw,
    Trash2,
    Edit,
    Save,
    X,
    Box,
    Loader2,
    Eye,
    EyeOff,
    ImageIcon,
    Lightbulb,
    BookOpen,
    ChevronDown,
    ChevronUp,
    Flame,
    Zap,
    Award,
    Send,
    Sparkles,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TagInput } from "@/components/tag-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { UserProfile } from "@/types/api";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { NotebookSelector } from "@/components/notebook-selector";
import { GeogebraDemo } from "@/components/geogebra-demo";
import { parseStoredVariants, VariantMap } from "@/lib/practice-variants";
import { recordPetErrorReviewed, recordPetPracticeSuccess } from "@/lib/pet-system";
import { PetFeedbackDialog } from "@/components/digital-pet/pet-feedback-dialog";

interface KnowledgeTag {
    id: string;
    name: string;
}

interface ErrorItemDetail {
    id: string;
    questionText: string;
    answerText: string;
    analysis: string;
    wrongAnswerText?: string | null;
    mistakeAnalysis?: string | null;
    mistakeStatus?: string | null;
    knowledgePoints: string;
    tags: KnowledgeTag[];
    masteryLevel: number;
    originalImageUrl: string;
    referenceImageUrl?: string | null;
    wrongAnswerImageUrl?: string | null;
    userNotes: string | null;
    subjectId?: string | null;
    subject?: {
        id: string;
        name: string;
    } | null;
    gradeSemester?: string | null;
    paperLevel?: string | null;
    geogebraCommands?: string | null;
    ocrText?: string | null;
}

function getFallbackBriefAnalysis(mistakeAnalysis?: string | null, detailedAnalysis?: string | null): string {
    if (mistakeAnalysis && mistakeAnalysis.trim().length > 0) {
        return mistakeAnalysis.trim();
    }
    if (!detailedAnalysis || !detailedAnalysis.trim()) {
        return "暂无简单解析，可点击右侧「编辑」补充一句话易错点或解题关键。";
    }
    const cleaned = detailedAnalysis
        .replace(/^#+\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 4)[0] || detailedAnalysis.trim();

    const firstSentence = cleaned.split(/[。！？；\n]/)[0];
    return firstSentence ? `${firstSentence}。` : cleaned.slice(0, 80);
}

export default function ErrorDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { t } = useLanguage();
    const [item, setItem] = useState<ErrorItemDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [notesInput, setNotesInput] = useState("");
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [tagsInput, setTagsInput] = useState<string[]>([]);
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [gradeSemesterInput, setGradeSemesterInput] = useState("");
    const [paperLevelInput, setPaperLevelInput] = useState("a");
    const [notebookInput, setNotebookInput] = useState<string | null>(null);

    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);

    const [isAnalyzingGeogebra, setIsAnalyzingGeogebra] = useState(false);
    const [geogebraError, setGeogebraError] = useState<string | null>(null);
    const [showQuestionImage, setShowQuestionImage] = useState(false);
    const [showReferenceImage, setShowReferenceImage] = useState(false);
    const questionRef = useRef<HTMLDivElement>(null);

    // 渐进式解析展开状态：默认进入页面只看题目，不直接剧透答案
    const [showSimpleSection, setShowSimpleSection] = useState(false);
    const [showDetailedSection, setShowDetailedSection] = useState(false);

    // 举一反三变式题挑战状态：默认选中【困难变式】
    const [activeVariantTab, setActiveVariantTab] = useState<"hard" | "harder" | "medium">("hard");
    const [variantUserAnswer, setVariantUserAnswer] = useState("");
    const [variantSubmitted, setVariantSubmitted] = useState(false);
    const [variantCorrect, setVariantCorrect] = useState<boolean | null>(null);
    const [variantRewardToast, setVariantRewardToast] = useState<string | null>(null);
    const [isPregeneratingVariants, setIsPregeneratingVariants] = useState(false);
    const [showPetFeedback, setShowPetFeedback] = useState(false);
    const [petLevelUpInfo, setPetLevelUpInfo] = useState<{ leveledUp: boolean; newLevel?: number } | null>(null);

    useEffect(() => {
        apiClient.get<UserProfile>("/api/user")
            .then((user) => {
                if (user && user.educationStage) {
                    setEducationStage(user.educationStage);
                }
            })
            .catch((err) => console.warn("Failed to fetch user info:", err));

        if (params.id) {
            fetchItem(params.id as string);
        }
    }, [params.id]);

    const fetchItem = async (id: string) => {
        try {
            const data = await apiClient.get<ErrorItemDetail>(`/api/error-items/${id}`);
            setItem(data);
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.loadFailed || "Failed to load item");
            router.push("/notebooks");
        } finally {
            setLoading(false);
        }
    };

    const handleAnalyzeGeogebra = async () => {
        if (!item) return;
        setIsAnalyzingGeogebra(true);
        setGeogebraError(null);
        try {
            const result = await apiClient.post<{
                suitable: boolean;
                commands: string[];
                description: string;
            }>(`/api/error-items/${item.id}/geogebra`, {});

            if (result.suitable && result.commands.length > 0) {
                setItem({ ...item, geogebraCommands: JSON.stringify(result.commands) });
            } else {
                setGeogebraError(result.description || "该题目不适合用 GeoGebra 演示");
            }
        } catch (error: any) {
            console.warn("GeoGebra analysis failed:", error);
            const msg = error?.data?.message || error?.message || "";
            if (msg.includes("AI_AUTH_ERROR")) {
                setGeogebraError("AI 认证失败，请检查设置");
            } else if (msg.includes("AI_CONNECTION")) {
                setGeogebraError("AI 连接失败，请检查网络");
            } else {
                setGeogebraError("分析失败，请稍后重试");
            }
        } finally {
            setIsAnalyzingGeogebra(false);
        }
    };

    const handleSaveGeogebraCommands = async (commands: string) => {
        if (!item) return;
        await apiClient.put(`/api/error-items/${item.id}`, { geogebraCommands: commands });
        setItem({ ...item, geogebraCommands: commands });
    };

    const toggleMastery = async () => {
        if (!item) return;

        const newLevel = item.masteryLevel > 0 ? 0 : 1;

        try {
            await apiClient.patch(`/api/error-items/${item.id}/mastery`, { masteryLevel: newLevel });
            setItem({ ...item, masteryLevel: newLevel });
            if (newLevel > 0) {
                recordPetErrorReviewed();
            }
            alert(
                newLevel > 0
                    ? t.common?.messages?.markMastered || "已标记掌握！算算喵获得了能量与小鱼干！"
                    : t.common?.messages?.unmarkMastered || "已取消掌握"
            );
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.updateFailed || "Update failed");
        }
    };

    const deleteItem = async () => {
        if (!item) return;

        const confirmMessage = t.common?.messages?.confirmDelete || "Are you sure you want to delete this error item?";
        if (!confirm(confirmMessage)) return;

        try {
            await apiClient.delete(`/api/error-items/${item.id}/delete`);
            alert(t.common?.messages?.deleteSuccess || "Deleted successfully");
            if (item.subjectId) {
                router.push(`/notebooks/${item.subjectId}`);
            } else {
                router.push("/notebooks");
            }
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.deleteFailed || "Delete failed");
        }
    };

    const startEditingNotes = () => {
        setNotesInput(item?.userNotes || "");
        setIsEditingNotes(true);
    };

    const cancelEditingNotes = () => {
        setIsEditingNotes(false);
        setNotesInput("");
    };

    const startEditingTags = () => {
        if (item) {
            if (item.tags && item.tags.length > 0) {
                setTagsInput(item.tags.map((t) => t.name));
            } else if (item.knowledgePoints) {
                try {
                    const tags = JSON.parse(item.knowledgePoints);
                    setTagsInput(tags);
                } catch {
                    setTagsInput([]);
                }
            } else {
                setTagsInput([]);
            }
            setIsEditingTags(true);
        }
    };

    const saveTagsHandler = async () => {
        try {
            await apiClient.put(`/api/error-items/${item?.id}`, {
                knowledgePoints: tagsInput,
            });

            setIsEditingTags(false);
            await fetchItem(params.id as string);
            alert(t.common?.messages?.tagUpdateSuccess || "Tags updated successfully!");
        } catch (error) {
            console.warn("[Frontend] Error updating:", error);
            alert(t.common?.messages?.updateFailed || "Update failed");
        }
    };

    const cancelEditingTags = () => {
        setIsEditingTags(false);
        setTagsInput([]);
    };

    const startEditingMetadata = () => {
        if (item) {
            setNotebookInput(item.subjectId || null);
            setGradeSemesterInput(item.gradeSemester || "");
            setPaperLevelInput(item.paperLevel || "a");
            setIsEditingMetadata(true);
        }
    };

    const saveMetadataHandler = async () => {
        try {
            await apiClient.put(`/api/error-items/${item?.id}`, {
                subjectId: notebookInput || null,
                gradeSemester: gradeSemesterInput,
                paperLevel: paperLevelInput,
            });

            setIsEditingMetadata(false);
            fetchItem(params.id as string);
            alert(t.common?.messages?.metaUpdateSuccess || "Metadata updated successfully!");
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.updateFailed || "Update failed");
        }
    };

    const cancelEditingMetadata = () => {
        setIsEditingMetadata(false);
        setNotebookInput(null);
        setGradeSemesterInput("");
        setPaperLevelInput("a");
    };

    const [isEditingQuestion, setIsEditingQuestion] = useState(false);
    const [questionInput, setQuestionInput] = useState("");

    const [isEditingSimpleAndAnswer, setIsEditingSimpleAndAnswer] = useState(false);
    const [simpleAnalysisInput, setSimpleAnalysisInput] = useState("");
    const [answerInput, setAnswerInput] = useState("");

    const [isEditingAnalysis, setIsEditingAnalysis] = useState(false);
    const [analysisInput, setAnalysisInput] = useState("");

    const startEditingQuestion = () => {
        if (item) {
            setQuestionInput(item.questionText);
            setIsEditingQuestion(true);
        }
    };

    const saveQuestionHandler = async () => {
        try {
            await apiClient.put(`/api/error-items/${item?.id}`, { questionText: questionInput });
            setIsEditingQuestion(false);
            if (item) setItem({ ...item, questionText: questionInput });
            alert(t.common?.messages?.saveSuccess || "Saved successfully");
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.saveFailed || "Save failed");
        }
    };

    const cancelEditingQuestion = () => {
        setIsEditingQuestion(false);
        setQuestionInput("");
    };

    const startEditingSimpleAndAnswer = () => {
        if (item) {
            setSimpleAnalysisInput(getFallbackBriefAnalysis(item.mistakeAnalysis, item.analysis));
            setAnswerInput(item.answerText);
            setIsEditingSimpleAndAnswer(true);
        }
    };

    const saveSimpleAndAnswerHandler = async () => {
        try {
            await apiClient.put(`/api/error-items/${item?.id}`, {
                mistakeAnalysis: simpleAnalysisInput,
                answerText: answerInput,
            });
            setIsEditingSimpleAndAnswer(false);
            if (item) {
                setItem({
                    ...item,
                    mistakeAnalysis: simpleAnalysisInput,
                    answerText: answerInput,
                });
            }
            alert(t.common?.messages?.saveSuccess || "Saved successfully");
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.saveFailed || "Save failed");
        }
    };

    const cancelEditingSimpleAndAnswer = () => {
        setIsEditingSimpleAndAnswer(false);
        setSimpleAnalysisInput("");
        setAnswerInput("");
    };

    const startEditingAnalysis = () => {
        if (item) {
            setAnalysisInput(item.analysis);
            setIsEditingAnalysis(true);
        }
    };

    const saveAnalysisHandler = async () => {
        try {
            await apiClient.put(`/api/error-items/${item?.id}`, { analysis: analysisInput });
            setIsEditingAnalysis(false);
            if (item) setItem({ ...item, analysis: analysisInput });
            alert(t.common?.messages?.saveSuccess || "Saved successfully");
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.saveFailed || "Save failed");
        }
    };

    const cancelEditingAnalysis = () => {
        setIsEditingAnalysis(false);
        setAnalysisInput("");
    };

    const saveNotes = async () => {
        if (!item) return;

        try {
            await apiClient.patch(`/api/error-items/${item.id}/notes`, { userNotes: notesInput });
            setItem({ ...item, userNotes: notesInput });
            setIsEditingNotes(false);
            alert(t.common?.messages?.noteSaveSuccess || "Notes saved successfully");
        } catch (error) {
            console.warn(error);
            alert(t.common?.messages?.saveFailed || "Save failed");
        }
    };

    if (loading) return <div className="p-8 text-center">{t.common.loading}</div>;
    if (!item) return <div className="p-8 text-center">{t.detail.notFound || "Item not found"}</div>;

    let tags: string[] = [];
    if (item.tags && item.tags.length > 0) {
        tags = item.tags.map((t) => t.name);
    } else if (item.knowledgePoints) {
        try {
            const parsed = JSON.parse(item.knowledgePoints);
            tags = Array.isArray(parsed) ? parsed : [];
        } catch {
            tags = [];
        }
    }

    const briefSummary = getFallbackBriefAnalysis(item.mistakeAnalysis, item.analysis);
    const variants: VariantMap = parseStoredVariants(item.ocrText);
    const currentVariant =
        variants[activeVariantTab] ||
        variants.hard ||
        variants.harder ||
        variants.medium;

    return (
        <main className="min-h-screen bg-background">
            <div className="container mx-auto p-4 space-y-6 pb-20 max-w-4xl md:px-6 md:py-8">
                {/* 顶部导航与操作栏 */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <Link href={item.subjectId ? `/notebooks/${item.subjectId}` : "/notebooks"}>
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                        </Link>
                        <h1 className="text-2xl font-bold">{t.detail.title}</h1>
                        {item.subject?.name && (
                            <Badge variant="outline" className="text-sm font-medium">
                                {item.subject.name}
                            </Badge>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <Link href={`/practice?id=${item.id}&difficulty=hard`}>
                            <Button variant="outline" size="sm">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                举一反三自测
                            </Button>
                        </Link>
                        <Button
                            size="sm"
                            variant="default"
                            className={item.masteryLevel > 0 ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                            onClick={toggleMastery}
                        >
                            {item.masteryLevel > 0 ? (
                                <>
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    {t.detail.mastered}
                                </>
                            ) : (
                                <>
                                    <XCircle className="mr-2 h-4 w-4" />
                                    {t.detail.markMastered}
                                </>
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={deleteItem}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t.detail.delete || "Delete"}
                        </Button>
                    </div>
                </div>

                {/* 第一部分：醒目展示【题目】、【知识点】与【试题信息】 */}
                <Card ref={questionRef} className="border-2 border-primary/20 shadow-sm">
                    <CardHeader className="pb-3 bg-muted/20 border-b">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <span className="inline-block w-1.5 h-5 rounded-full bg-primary" />
                                <CardTitle className="text-lg md:text-xl">{t.detail.question}</CardTitle>
                            </div>
                            {!isEditingQuestion && (
                                <Button variant="ghost" size="sm" onClick={startEditingQuestion}>
                                    <Edit className="h-4 w-4 mr-1" />
                                    {t.common?.edit || "编辑"}
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-5">
                        {isEditingQuestion ? (
                            <div className="space-y-3">
                                <Textarea
                                    value={questionInput}
                                    onChange={(e) => setQuestionInput(e.target.value)}
                                    placeholder="输入题目内容..."
                                    rows={8}
                                    className="w-full font-mono text-sm"
                                />
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={saveQuestionHandler}>
                                        <Save className="h-4 w-4 mr-1" />
                                        {t.common?.save || "保存"}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={cancelEditingQuestion}>
                                        <X className="h-4 w-4 mr-1" />
                                        {t.common?.cancel || "取消"}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg bg-card p-3 md:p-4 text-base md:text-lg leading-relaxed">
                                <MarkdownRenderer content={item.questionText} />
                            </div>
                        )}

                        {/* 知识点标签 */}
                        <div className="space-y-2 pt-3 border-t border-dashed">
                            <div className="flex justify-between items-center">
                                <h4 className="text-sm font-semibold text-muted-foreground">
                                    {t.editor?.tags || "知识点标签"}
                                </h4>
                                {!isEditingTags && (
                                    <Button variant="ghost" size="sm" onClick={startEditingTags}>
                                        <Edit className="h-3.5 w-3.5 mr-1" />
                                        {t.common?.edit || "编辑"}
                                    </Button>
                                )}
                            </div>
                            {isEditingTags ? (
                                <div className="space-y-3">
                                    <TagInput
                                        value={tagsInput}
                                        onChange={setTagsInput}
                                        placeholder={t.editor?.tagsPlaceholder || "输入或选择知识点标签..."}
                                        subject={inferSubjectFromName(item.subject?.name || null) || undefined}
                                        gradeStage={educationStage}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t.editor?.tagsHint || "可从标准标签中选择或直接输入自定义标签"}
                                    </p>
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={saveTagsHandler}>
                                            <Save className="h-4 w-4 mr-1" />
                                            {t.common?.save || "保存"}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={cancelEditingTags}>
                                            <X className="h-4 w-4 mr-1" />
                                            {t.common?.cancel || "取消"}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {tags.length > 0 ? (
                                        tags.map((tag) => (
                                            <Badge key={tag} variant="secondary" className="px-2.5 py-0.5 text-xs md:text-sm">
                                                {tag}
                                            </Badge>
                                        ))
                                    ) : (
                                        <span className="text-xs text-muted-foreground italic">暂无知识点标签</span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 试题信息 */}
                        <div className="space-y-2 pt-3 border-t">
                            <div className="flex justify-between items-center">
                                <h4 className="text-sm font-semibold text-muted-foreground">
                                    {t.detail?.questionInfo || "试题信息"}
                                </h4>
                                {!isEditingMetadata && (
                                    <Button variant="ghost" size="sm" onClick={startEditingMetadata}>
                                        <Edit className="h-3.5 w-3.5 mr-1" />
                                        {t.common?.edit || "编辑"}
                                    </Button>
                                )}
                            </div>
                            {isEditingMetadata ? (
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <label className="text-sm text-muted-foreground">{t.notebooks?.title || "错题本"}</label>
                                        <NotebookSelector value={notebookInput || undefined} onChange={setNotebookInput} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm text-muted-foreground">{t.filter.grade}</label>
                                        <Input
                                            value={gradeSemesterInput}
                                            onChange={(e) => setGradeSemesterInput(e.target.value)}
                                            placeholder={t.notebook?.gradeSemesterPlaceholder || "例如：四年级上"}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm text-muted-foreground">{t.filter.paperLevel}</label>
                                        <Select value={paperLevelInput} onValueChange={setPaperLevelInput}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="a">{t.editor.paperLevels?.a || "A卷"}</SelectItem>
                                                <SelectItem value="b">{t.editor.paperLevels?.b || "B卷"}</SelectItem>
                                                <SelectItem value="other">{t.editor.paperLevels?.other || "其他"}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={saveMetadataHandler}>
                                            <Save className="h-4 w-4 mr-1" />
                                            {t.common?.save || "保存"}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={cancelEditingMetadata}>
                                            <X className="h-4 w-4 mr-1" />
                                            {t.common?.cancel || "取消"}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                                    <div>
                                        <span>{t.notebooks?.title || "错题本"}：</span>
                                        <span className="font-medium text-foreground">{item.subject?.name || (t.common?.notSet || "未设置")}</span>
                                    </div>
                                    <div>
                                        <span>{t.filter.grade}：</span>
                                        <span className="font-medium text-foreground">{item.gradeSemester || (t.common?.notSet || "未设置")}</span>
                                    </div>
                                    <div>
                                        <span>{t.filter.paperLevel}：</span>
                                        <span className="font-medium text-foreground">
                                            {item.paperLevel ? (t.editor.paperLevels?.[item.paperLevel as "a" | "b" | "other"] || item.paperLevel) : (t.common?.notSet || "未设置")}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {item.originalImageUrl && (
                            <div className="pt-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowQuestionImage(!showQuestionImage)}
                                    className="flex items-center gap-2"
                                >
                                    {showQuestionImage ? (
                                        <>
                                            <EyeOff className="h-4 w-4" />
                                            隐藏原题图片
                                        </>
                                    ) : (
                                        <>
                                            <ImageIcon className="h-4 w-4" />
                                            查看原题图片
                                        </>
                                    )}
                                </Button>
                                {showQuestionImage && (
                                    <div className="mt-4">
                                        <img
                                            src={item.originalImageUrl}
                                            alt={t.detail.originalProblem || "Original Problem"}
                                            className="w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                                            onClick={() => setIsImageViewerOpen(true)}
                                        />
                                        <p className="text-xs text-muted-foreground mt-1 text-center">
                                            {t.detail?.clickToEnlarge || "点击图片可放大查看"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* 第二部分：渐进式【解析】入口 -> 先看「简单解析 + 参考答案」 -> 再按需展开「详细解析」 */}
                <div className="space-y-4">
                    {!showSimpleSection ? (
                        <button
                            type="button"
                            onClick={() => setShowSimpleSection(true)}
                            className="w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all p-4 flex items-center justify-between group cursor-pointer text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-full bg-primary/15 p-2.5 text-primary group-hover:scale-105 transition-transform">
                                    <Lightbulb className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="font-semibold text-base text-primary flex items-center gap-2">
                                        <span>解析</span>
                                        <span className="text-xs font-normal text-muted-foreground">
                                            （点击查看简单解析与参考答案）
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        建议先在草稿纸上独立思考或重做一遍，再点开核对答案
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-sm font-medium text-primary">
                                <span>展开解析</span>
                                <ChevronDown className="h-4 w-4" />
                            </div>
                        </button>
                    ) : (
                        <Card className="border-primary/25 shadow-sm">
                            <CardHeader className="pb-3 border-b bg-primary/5">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <Lightbulb className="h-5 w-5 text-primary" />
                                        <CardTitle className="text-base md:text-lg">简单解析与参考答案</CardTitle>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!isEditingSimpleAndAnswer && (
                                            <Button variant="ghost" size="sm" onClick={startEditingSimpleAndAnswer}>
                                                <Edit className="h-4 w-4 mr-1" />
                                                {t.common?.edit || "编辑"}
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setShowSimpleSection(false);
                                                setShowDetailedSection(false);
                                            }}
                                            className="text-muted-foreground"
                                        >
                                            <ChevronUp className="h-4 w-4 mr-1" />
                                            收起
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-5 space-y-5">
                                {isEditingSimpleAndAnswer ? (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">简单解析（一句话说明这道题的易错点或关键思路）</label>
                                            <Textarea
                                                value={simpleAnalysisInput}
                                                onChange={(e) => setSimpleAnalysisInput(e.target.value)}
                                                placeholder="用一句话说明这道题容易错在哪里、或者解题突破口..."
                                                rows={3}
                                                className="w-full text-sm"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">参考答案</label>
                                            <Textarea
                                                value={answerInput}
                                                onChange={(e) => setAnswerInput(e.target.value)}
                                                placeholder="输入单纯的参考答案..."
                                                rows={3}
                                                className="w-full font-mono text-sm"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={saveSimpleAndAnswerHandler}>
                                                <Save className="h-4 w-4 mr-1" />
                                                {t.common?.save || "保存"}
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelEditingSimpleAndAnswer}>
                                                <X className="h-4 w-4 mr-1" />
                                                {t.common?.cancel || "取消"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-4 space-y-1.5">
                                            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                                                简单解析（易错点拨）
                                            </div>
                                            <div className="text-sm md:text-base leading-relaxed">
                                                <MarkdownRenderer content={briefSummary} />
                                            </div>
                                        </div>

                                        <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-4 space-y-1.5">
                                            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                                                参考答案
                                            </div>
                                            <div className="text-sm md:text-base font-semibold leading-relaxed">
                                                <MarkdownRenderer content={item.answerText} />
                                            </div>
                                            {item.referenceImageUrl && (
                                                <div className="pt-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setShowReferenceImage(!showReferenceImage)}
                                                        className="flex items-center gap-1.5 text-xs text-muted-foreground h-7 px-2"
                                                    >
                                                        {showReferenceImage ? <><EyeOff className="h-3.5 w-3.5" />隐藏答案附图</> : <><ImageIcon className="h-3.5 w-3.5" />查看答案附图</>}
                                                    </Button>
                                                    {showReferenceImage && (
                                                        <div className="mt-2">
                                                            <img
                                                                src={item.referenceImageUrl}
                                                                alt="参考图片"
                                                                className="w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                                                                onClick={() => setIsImageViewerOpen(true)}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* 二级入口：如果学生还不懂，进一步展开「详细解析」 */}
                                <div className="pt-3 border-t border-dashed">
                                    {!showDetailedSection ? (
                                        <button
                                            type="button"
                                            onClick={() => setShowDetailedSection(true)}
                                            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline cursor-pointer py-1"
                                        >
                                            <BookOpen className="h-4 w-4" />
                                            <span>还没看懂？查看详细解析</span>
                                            <ChevronDown className="h-4 w-4" />
                                        </button>
                                    ) : (
                                        <div className="space-y-3 pt-2">
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                                    <BookOpen className="h-4 w-4" />
                                                    <span>详细解析</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {!isEditingAnalysis && (
                                                        <Button variant="ghost" size="sm" onClick={startEditingAnalysis}>
                                                            <Edit className="h-3.5 w-3.5 mr-1" />
                                                            {t.common?.edit || "编辑"}
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setShowDetailedSection(false)}
                                                        className="text-muted-foreground"
                                                    >
                                                        <ChevronUp className="h-3.5 w-3.5 mr-1" />
                                                        收起详细解析
                                                    </Button>
                                                </div>
                                            </div>

                                            {isEditingAnalysis ? (
                                                <div className="space-y-3">
                                                    <Textarea
                                                        value={analysisInput}
                                                        onChange={(e) => setAnalysisInput(e.target.value)}
                                                        placeholder="输入详细分步解析..."
                                                        rows={10}
                                                        className="w-full font-mono text-sm"
                                                    />
                                                    <div className="flex gap-2">
                                                        <Button size="sm" onClick={saveAnalysisHandler}>
                                                            <Save className="h-4 w-4 mr-1" />
                                                            {t.common?.save || "保存"}
                                                        </Button>
                                                        <Button size="sm" variant="outline" onClick={cancelEditingAnalysis}>
                                                            <X className="h-4 w-4 mr-1" />
                                                            {t.common?.cancel || "取消"}
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="rounded-lg bg-muted/30 border p-4 leading-relaxed">
                                                    <MarkdownRenderer content={item.analysis} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* 核心亮点：举一反三变式挑战（困难、挑战、类似题型，已直接备好，即点即出） */}
                {(() => {
                    const variants: VariantMap = parseStoredVariants(item.ocrText);
                    const currentVariant =
                        variants[activeVariantTab] ||
                        variants.hard ||
                        variants.harder ||
                        variants.medium;

                    return (
                        <Card className="border-2 border-orange-400/40 dark:border-orange-900/50 shadow-sm bg-gradient-to-b from-orange-50/20 to-transparent">
                            <CardHeader className="py-3 px-4 border-b bg-orange-50/40 dark:bg-orange-950/20">
                                <div className="flex flex-row items-center justify-between gap-3 overflow-x-auto flex-nowrap">
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <Award className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                                        <CardTitle className="text-base md:text-lg font-bold">
                                            举一反三
                                        </CardTitle>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActiveVariantTab("hard");
                                                setVariantUserAnswer("");
                                                setVariantSubmitted(false);
                                                setVariantCorrect(null);
                                            }}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                activeVariantTab === "hard"
                                                    ? "bg-orange-500 text-white shadow-sm ring-2 ring-orange-400/30"
                                                    : "bg-muted text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            <Flame className="h-3.5 w-3.5" />
                                            <span>困难变式</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActiveVariantTab("harder");
                                                setVariantUserAnswer("");
                                                setVariantSubmitted(false);
                                                setVariantCorrect(null);
                                            }}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                activeVariantTab === "harder"
                                                    ? "bg-red-600 text-white shadow-sm ring-2 ring-red-500/30"
                                                    : "bg-muted text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            <Zap className="h-3.5 w-3.5" />
                                            <span>挑战压轴</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActiveVariantTab("medium");
                                                setVariantUserAnswer("");
                                                setVariantSubmitted(false);
                                                setVariantCorrect(null);
                                            }}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                activeVariantTab === "medium"
                                                    ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30"
                                                    : "bg-muted text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            <span>类似题型</span>
                                        </button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-5 space-y-4">
                                {variantRewardToast && (
                                    <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-semibold animate-in fade-in">
                                        {variantRewardToast}
                                    </div>
                                )}

                                {currentVariant?.questionText ? (
                                    <div className="space-y-4">
                                        <div className="rounded-lg bg-card p-4 border leading-relaxed text-sm md:text-base">
                                            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center justify-between">
                                                <span>
                                                    {activeVariantTab === "hard" && "🔥 困难变式："}
                                                    {activeVariantTab === "harder" && "⚡ 挑战压轴："}
                                                    {activeVariantTab === "medium" && "🎯 类似题型："}
                                                </span>
                                                <Link
                                                    href={`/practice?id=${item.id}&difficulty=${activeVariantTab}`}
                                                    className="text-primary hover:underline font-normal"
                                                >
                                                    全屏闯关练习 ❯
                                                </Link>
                                            </div>
                                            <MarkdownRenderer content={currentVariant.questionText} />
                                        </div>

                                        {/* 做题输入框 */}
                                        <div className="space-y-3">
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="输入你的解答结果（如：21箱、840元）..."
                                                    value={variantUserAnswer}
                                                    onChange={(e) => setVariantUserAnswer(e.target.value)}
                                                    disabled={variantSubmitted}
                                                    className="text-sm h-10"
                                                />
                                                {!variantSubmitted ? (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => {
                                                            if (!variantUserAnswer.trim() || !currentVariant) return;
                                                            setVariantSubmitted(true);
                                                            const norm = (s: string) => s.trim().toLowerCase().replace(/[.,;!元箱本个]/g, "");
                                                            const u = norm(variantUserAnswer);
                                                            const c = norm(currentVariant.answerText);
                                                            const isMatch = u === c || (c.includes(u) && u.length > 0);
                                                            setVariantCorrect(isMatch);
                                                            if (isMatch) {
                                                                const reward = recordPetPracticeSuccess(activeVariantTab);
                                                                if (reward.leveledUp) {
                                                                    setPetLevelUpInfo({ leveledUp: true, newLevel: reward.newLevel });
                                                                    setVariantRewardToast(`🎊 升级啦！算算喵升至 Lv.${reward.newLevel}，获得 1 次升级抽奖机会！`);
                                                                } else {
                                                                    setPetLevelUpInfo({ leveledUp: false });
                                                                    setVariantRewardToast(`🎉 答对啦！算算喵获得 +${reward.exp} 经验值，金色能量果 +${reward.fish}！`);
                                                                }
                                                                setTimeout(() => setVariantRewardToast(null), 5000);
                                                            } else {
                                                                setPetLevelUpInfo(null);
                                                            }
                                                            setShowPetFeedback(true);
                                                        }}
                                                        disabled={!variantUserAnswer.trim()}
                                                        className="px-4 text-xs font-semibold"
                                                    >
                                                        <Send className="mr-1 h-3.5 w-3.5" />
                                                        核对并喂养
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => {
                                                            setVariantSubmitted(false);
                                                            setVariantUserAnswer("");
                                                            setVariantCorrect(null);
                                                        }}
                                                        className="text-xs"
                                                    >
                                                        重做本题
                                                    </Button>
                                                )}
                                            </div>

                                            {variantSubmitted && (
                                                <div className="space-y-3 pt-1 animate-in fade-in">
                                                    <div
                                                        className={`p-3 rounded-lg border text-xs font-semibold flex items-center gap-2 ${
                                                            variantCorrect
                                                                ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300"
                                                                : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
                                                        }`}
                                                    >
                                                        {variantCorrect ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                                        <span>
                                                            {variantCorrect ? "完全正确！本考点的陷阱已经被你攻克！" : "结果不一致，快看看下方的关键思路与步骤："}
                                                        </span>
                                                    </div>

                                                    <div className="grid gap-3 md:grid-cols-2 text-xs">
                                                        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                                                            <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
                                                                简单点拨（解题关键）
                                                            </div>
                                                            <div>{currentVariant.mistakeAnalysis || "考查买送优惠周期计算与余数处理。"}</div>
                                                        </div>
                                                        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                                                            <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                                                                参考答案
                                                            </div>
                                                            <div className="font-bold text-sm">
                                                                <MarkdownRenderer content={currentVariant.answerText} />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-lg bg-muted/40 border p-3 text-xs leading-relaxed">
                                                        <div className="font-semibold mb-1 text-muted-foreground">详细步骤解析</div>
                                                        <MarkdownRenderer content={currentVariant.analysis} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-6 space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            {isPregeneratingVariants ? "正在为本题预生成【困难】与【挑战】变式题..." : "本题变式题正在排队生成中，也可以点击立即生成："}
                                        </p>
                                        <Button
                                            size="sm"
                                            onClick={async () => {
                                                setIsPregeneratingVariants(true);
                                                try {
                                                    const res = await apiClient.post<any>("/api/practice/pregenerate", {
                                                        errorItemId: item.id,
                                                        questionText: item.questionText,
                                                        subjectName: item.subject?.name || "数学",
                                                        gradeSemester: item.gradeSemester,
                                                    });
                                                    if (res?.variants) {
                                                        await fetchItem(item.id);
                                                    }
                                                } catch {
                                                    alert("生成变式题遇到网络波动，请稍后再试");
                                                } finally {
                                                    setIsPregeneratingVariants(false);
                                                }
                                            }}
                                            disabled={isPregeneratingVariants}
                                            className="text-xs"
                                        >
                                            {isPregeneratingVariants ? (
                                                <>
                                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                                    正在极速生成中...
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles className="mr-1 h-3.5 w-3.5 text-amber-300" />
                                                    ⚡ 一键备好变式题（困难 & 挑战）
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })()}

                {/* 第三部分：保留【GeoGebra 动态演示】与【笔记答案】 */}
                <div className="space-y-6">
                    {item.geogebraCommands ? (
                        <GeogebraDemo
                            commands={item.geogebraCommands}
                            height={700}
                            showToolBar={true}
                            showAlgebraInput={false}
                            showMenuBar={false}
                            onRegenerate={handleAnalyzeGeogebra}
                            onSaveCommands={handleSaveGeogebraCommands}
                        />
                    ) : (
                        <div className="rounded-lg border border-dashed p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Box className="h-4 w-4 md:h-5 md:w-5" />
                                    <span>动态演示（GeoGebra）</span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleAnalyzeGeogebra()}
                                    disabled={isAnalyzingGeogebra}
                                >
                                    {isAnalyzingGeogebra ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            AI 分析中...
                                        </>
                                    ) : (
                                        <>
                                            <Box className="mr-2 h-4 w-4" />
                                            生成演示
                                        </>
                                    )}
                                </Button>
                            </div>
                            {geogebraError && <p className="text-xs text-muted-foreground mt-2">{geogebraError}</p>}
                            <p className="text-xs text-muted-foreground mt-2">
                                AI 将判断本题是否可以用 GeoGebra 进行动态几何/函数演示，如适合则自动生成交互式图形
                            </p>
                        </div>
                    )}

                    <Card>
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle>笔记答案</CardTitle>
                                {!isEditingNotes && (
                                    <Button variant="ghost" size="sm" onClick={startEditingNotes}>
                                        <Edit className="h-4 w-4 mr-1" />
                                        {t.detail.editNotes || "编辑"}
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {isEditingNotes ? (
                                <div className="space-y-3">
                                    <Textarea
                                        value={notesInput}
                                        onChange={(e) => setNotesInput(e.target.value)}
                                        placeholder="记录自己的重做答案、解题心得或需要注意的地方..."
                                        rows={5}
                                        className="w-full"
                                    />
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={saveNotes}>
                                            <Save className="h-4 w-4 mr-1" />
                                            {t.common.save || "保存"}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={cancelEditingNotes}>
                                            <X className="h-4 w-4 mr-1" />
                                            {t.common.cancel || "取消"}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="whitespace-pre-wrap">
                                    {item.userNotes ? (
                                        <p className="text-foreground">{item.userNotes}</p>
                                    ) : (
                                        <p className="text-muted-foreground italic">{t.detail.noNotes}</p>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Image Viewer Modal */}
            {isImageViewerOpen && item?.originalImageUrl && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setIsImageViewerOpen(false)}
                >
                    <div className="relative max-w-7xl max-h-full">
                        <button
                            className="absolute -top-12 right-0 text-white hover:text-gray-300 text-lg font-semibold bg-black/50 px-4 py-2 rounded"
                            onClick={() => setIsImageViewerOpen(false)}
                        >
                            {t.detail?.close || "✕ Close"}
                        </button>
                        <img
                            src={item.originalImageUrl}
                            alt="Full size"
                            className="max-w-full max-h-[90vh] object-contain rounded-lg"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <p className="text-center text-white/70 text-sm mt-4">
                            {t.detail?.clickOutside || "Click outside to close"}
                        </p>
                    </div>
                </div>
            )}
            {/* 伴学电子宠物做题全页面反馈弹窗（做对赞美加持 / 做错哭泣鼓励） */}
            <PetFeedbackDialog
                isOpen={showPetFeedback}
                onClose={() => setShowPetFeedback(false)}
                isCorrect={Boolean(variantCorrect)}
                difficulty={activeVariantTab}
                userAnswer={variantUserAnswer}
                correctAnswer={currentVariant?.answerText || ""}
                onRetry={() => {
                    setVariantSubmitted(false);
                    setVariantUserAnswer("");
                    setVariantCorrect(null);
                }}
                onViewDetail={() => {
                    setVariantSubmitted(true);
                }}
                expGained={activeVariantTab === "harder" ? 60 : activeVariantTab === "hard" ? 35 : 15}
                fruitGained={activeVariantTab === "harder" ? 3 : activeVariantTab === "hard" ? 2 : 1}
                leveledUp={petLevelUpInfo?.leveledUp}
                newLevel={petLevelUpInfo?.newLevel}
            />
        </main>
    );
}
