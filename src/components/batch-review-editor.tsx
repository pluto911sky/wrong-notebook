"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Save, Trash2, CheckCircle2, Circle, ArrowLeft, Loader2, Sparkles, Plus, Image as ImageIcon, CheckSquare, Square } from "lucide-react";

export interface BatchQuestionItem {
    id: string;
    questionText: string;
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText?: string;
    mistakeAnalysis?: string;
    originalImageUrl?: string | null;
    selected: boolean;
}

interface BatchReviewEditorProps {
    questions: BatchQuestionItem[];
    subjectId?: string;
    notebookName?: string;
    onSaveAll: (questions: BatchQuestionItem[]) => Promise<void>;
    onCancel: () => void;
    isSaving?: boolean;
    savingProgress?: { current: number; total: number; message: string };
}

export function BatchReviewEditor({
    questions: initialQuestions,
    subjectId,
    notebookName,
    onSaveAll,
    onCancel,
    isSaving = false,
    savingProgress,
}: BatchReviewEditorProps) {
    const [items, setItems] = useState<BatchQuestionItem[]>(initialQuestions);
    const [activeTabMap, setActiveTabMap] = useState<Record<string, "edit" | "preview">>({});

    const selectedCount = items.filter((it) => it.selected).length;
    const isAllSelected = items.length > 0 && selectedCount === items.length;

    const toggleSelectAll = () => {
        const nextVal = !isAllSelected;
        setItems(items.map((it) => ({ ...it, selected: nextVal })));
    };

    const toggleSelect = (id: string) => {
        setItems(
            items.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it))
        );
    };

    const updateItem = (id: string, patch: Partial<BatchQuestionItem>) => {
        setItems(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    };

    const removeItem = (id: string) => {
        setItems(items.filter((it) => it.id !== id));
    };

    const handleSave = async () => {
        const toSave = items.filter((it) => it.selected && it.questionText.trim());
        if (toSave.length === 0) return;
        await onSaveAll(toSave);
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-20">
            {/* 顶栏控制卡 */}
            <div className="sticky top-4 z-30 bg-background/90 backdrop-blur-md p-4 rounded-3xl border-2 border-orange-200 shadow-xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        disabled={isSaving}
                        className="rounded-xl text-xs font-bold"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        返回
                    </Button>

                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-black text-foreground">
                                批量错题核对与录入
                            </h2>
                            <Badge className="bg-orange-500 text-white font-black text-xs px-2.5 py-0.5">
                                共 {items.length} 道题目
                            </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            已智能识别并完成标准解答，可勾选要入库的题目或进行微调修改
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleSelectAll}
                        disabled={isSaving}
                        className="rounded-xl text-xs font-bold cursor-pointer"
                    >
                        {isAllSelected ? (
                            <>
                                <CheckSquare className="w-3.5 h-3.5 mr-1.5 text-orange-500" />
                                取消全选
                            </>
                        ) : (
                            <>
                                <Square className="w-3.5 h-3.5 mr-1.5" />
                                全选所有 ({items.length})
                            </>
                        )}
                    </Button>

                    <Button
                        onClick={handleSave}
                        disabled={selectedCount === 0 || isSaving}
                        className="bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:from-orange-600 hover:to-amber-600 text-white font-black text-xs px-6 h-10 rounded-2xl shadow-lg cursor-pointer"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                正在批量保存 ({savingProgress ? `${savingProgress.current}/${savingProgress.total}` : `${selectedCount}道题`})...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-1.5" />
                                一键全部保存入库 ({selectedCount} 道题) 💾
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* 题目卡片列表 */}
            <div className="space-y-6">
                {items.map((item, idx) => {
                    const tab = activeTabMap[item.id] || "edit";
                    return (
                        <Card
                            key={item.id}
                            className={`rounded-3xl border-2 transition-all duration-200 overflow-hidden ${
                                item.selected
                                    ? "border-orange-300 dark:border-orange-900 bg-gradient-to-b from-white to-amber-50/20 dark:from-slate-900 dark:to-slate-900/60 shadow-md"
                                    : "border-muted bg-muted/20 opacity-60"
                            }`}
                        >
                            {/* 卡片标题栏 */}
                            <div className="p-4 bg-muted/30 border-b flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => toggleSelect(item.id)}
                                        className="cursor-pointer text-orange-500 hover:scale-110 transition-transform"
                                    >
                                        {item.selected ? (
                                            <CheckCircle2 className="w-6 h-6 fill-orange-500 text-white" />
                                        ) : (
                                            <Circle className="w-6 h-6 text-muted-foreground" />
                                        )}
                                    </button>

                                    <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-300 font-black text-xs px-2.5 py-0.5">
                                        第 {idx + 1} 题
                                    </Badge>

                                    {item.knowledgePoints.map((tag, tIdx) => (
                                        <Badge
                                            key={tIdx}
                                            variant="secondary"
                                            className="text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-slate-800 dark:text-orange-300"
                                        >
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className="flex bg-muted rounded-xl p-0.5 text-[11px] font-bold">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setActiveTabMap({ ...activeTabMap, [item.id]: "edit" })
                                            }
                                            className={`px-3 py-1 rounded-lg transition-all ${
                                                tab === "edit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                                            }`}
                                        >
                                            编辑模式
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setActiveTabMap({ ...activeTabMap, [item.id]: "preview" })
                                            }
                                            className={`px-3 py-1 rounded-lg transition-all ${
                                                tab === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                                            }`}
                                        >
                                            公式预览
                                        </button>
                                    </div>

                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeItem(item.id)}
                                        className="text-red-500 hover:bg-red-50 hover:text-red-600 rounded-xl h-8 px-2.5 text-xs font-bold"
                                    >
                                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                                        删除此题
                                    </Button>
                                </div>
                            </div>

                            {/* 卡片主体内容 */}
                            <CardContent className="p-6 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                    {/* 如果有原图，左侧显示原图缩略图 */}
                                    {item.originalImageUrl && (
                                        <div className="md:col-span-4 space-y-2">
                                            <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                                                <ImageIcon className="w-3.5 h-3.5" />
                                                <span>错题原图</span>
                                            </span>
                                            <div className="aspect-square w-full rounded-2xl overflow-hidden border bg-black/5 dark:bg-slate-800 flex items-center justify-center p-2">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={item.originalImageUrl}
                                                    alt={`第 ${idx + 1} 题`}
                                                    className="w-full h-full object-contain"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 题目题干、答案与解析编辑区域 */}
                                    <div className={item.originalImageUrl ? "md:col-span-8 space-y-4" : "md:col-span-12 space-y-4"}>
                                        {/* 题干部分 */}
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-black text-foreground">
                                                题目内容：
                                            </label>
                                            {tab === "edit" ? (
                                                <Textarea
                                                    value={item.questionText}
                                                    onChange={(e) =>
                                                        updateItem(item.id, { questionText: e.target.value })
                                                    }
                                                    rows={3}
                                                    className="font-mono text-xs rounded-2xl border-2"
                                                    placeholder="输入题目文本..."
                                                />
                                            ) : (
                                                <div className="p-3.5 rounded-2xl bg-muted/40 border text-xs leading-relaxed">
                                                    <MarkdownRenderer content={item.questionText} />
                                                </div>
                                            )}
                                        </div>

                                        {/* 参考答案与解析 */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                                                    参考答案：
                                                </label>
                                                <Input
                                                    value={item.answerText}
                                                    onChange={(e) =>
                                                        updateItem(item.id, { answerText: e.target.value })
                                                    }
                                                    className="text-xs font-bold rounded-xl border-emerald-300 dark:border-emerald-800"
                                                    placeholder="简明答案..."
                                                />
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-xs font-black text-muted-foreground">
                                                    知识点标签（以逗号分隔）：
                                                </label>
                                                <Input
                                                    value={item.knowledgePoints.join("，")}
                                                    onChange={(e) =>
                                                        updateItem(item.id, {
                                                            knowledgePoints: e.target.value
                                                                .split(/[，,]/)
                                                                .map((s) => s.trim())
                                                                .filter(Boolean),
                                                        })
                                                    }
                                                    className="text-xs rounded-xl"
                                                    placeholder="如：一元一次方程，去分母"
                                                />
                                            </div>
                                        </div>

                                        {/* 详细步骤解析 */}
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-black text-foreground">
                                                解题步骤与详细解析：
                                            </label>
                                            {tab === "edit" ? (
                                                <Textarea
                                                    value={item.analysis}
                                                    onChange={(e) =>
                                                        updateItem(item.id, { analysis: e.target.value })
                                                    }
                                                    rows={3}
                                                    className="font-mono text-xs rounded-2xl border"
                                                    placeholder="详细解题推导..."
                                                />
                                            ) : (
                                                <div className="p-3.5 rounded-2xl bg-muted/30 border text-xs leading-relaxed">
                                                    <MarkdownRenderer content={item.analysis} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
