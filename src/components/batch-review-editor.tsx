"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Save, Trash2, CheckCircle2, Circle, ArrowLeft, Loader2, Image as ImageIcon, CheckSquare, Square, RotateCcw, AlertCircle, X } from "lucide-react";
import type { MistakeStatus } from "@/lib/ai/types";
import { matchNotebookBySubject } from "@/lib/batch-save";

export interface BatchQuestionItem {
    id: string;
    questionText: string;
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText?: string;
    mistakeAnalysis?: string;
    mistakeStatus?: MistakeStatus;
    /** AI 识别出的学科，用于自动匹配错题本 */
    subject?: string;
    /** 该题要保存到的错题本（混合学科批量上传时每题可不同） */
    notebookId?: string;
    originalImageUrl?: string | null;
    selected: boolean;
}

export interface BatchFailedItem {
    id: string;
    name: string;
    error?: string;
}

interface BatchReviewEditorProps {
    questions: BatchQuestionItem[];
    /** 固定错题本时只显示名称；传入 notebooks 时显示可切换的错题本选择 */
    notebookName?: string;
    notebooks?: { id: string; name: string }[];
    defaultNotebookId?: string;
    /** 返回成功保存的题目 id，编辑器会把它们从列表移除，未保存的题目留在页面上 */
    onSaveAll: (questions: BatchQuestionItem[]) => Promise<string[]>;
    onCancel: () => void;
    isSaving?: boolean;
    savingProgress?: { current: number; total: number };
    failedItems?: BatchFailedItem[];
    onRetryFailed?: () => void;
    onRemoveFailed?: (id: string) => void;
    isRetrying?: boolean;
}

export function BatchReviewEditor({
    questions,
    notebookName,
    notebooks,
    defaultNotebookId,
    onSaveAll,
    onCancel,
    isSaving = false,
    savingProgress,
    failedItems = [],
    onRetryFailed,
    onRemoveFailed,
    isRetrying = false,
}: BatchReviewEditorProps) {
    // 每题默认错题本：已指定 > 按识别学科匹配 > 批量默认
    const withNotebook = (q: BatchQuestionItem): BatchQuestionItem =>
        notebooks && !q.notebookId
            ? { ...q, notebookId: matchNotebookBySubject(notebooks, q.subject) || defaultNotebookId }
            : q;
    const [items, setItems] = useState<BatchQuestionItem[]>(() => questions.map(withNotebook));
    const [activeTabMap, setActiveTabMap] = useState<Record<string, "edit" | "preview">>({});
    // 错题本列表晚于题目加载完成时，为还没有分配错题本的题目补上默认值
    const [notebooksSeen, setNotebooksSeen] = useState(notebooks?.length ?? 0);
    if (notebooks && notebooks.length !== notebooksSeen) {
        setNotebooksSeen(notebooks.length);
        setItems((prev) => prev.map(withNotebook));
    }

    // 重试失败图片后，新识别出的题目追加到列表（保留用户已做的编辑）。
    // 用「见过的 id」而不是当前列表判断新增，否则用户删掉或已保存的题目会在父组件重渲染时又冒出来。
    // 在渲染期间按条件更新 state（React 推荐的派生写法），只在确有新增时触发，不会循环。
    const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set(questions.map((q) => q.id)));
    const added = questions.filter((q) => !seenIds.has(q.id));
    if (added.length > 0) {
        setSeenIds(new Set([...seenIds, ...added.map((q) => q.id)]));
        setItems((prev) => [...prev, ...added.map(withNotebook)]);
    }

    const selectedCount = items.filter((it) => it.selected).length;
    const isAllSelected = items.length > 0 && selectedCount === items.length;
    const needsNotebook = !!notebooks && items.some((it) => it.selected && !it.notebookId);

    const setAllNotebooks = (id: string) => {
        if (!id) return;
        setItems((prev) => prev.map((it) => ({ ...it, notebookId: id })));
    };

    const toggleSelectAll = () => {
        const nextVal = !isAllSelected;
        setItems((prev) => prev.map((it) => ({ ...it, selected: nextVal })));
    };

    const updateItem = (id: string, patch: Partial<BatchQuestionItem>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    };

    const removeItem = (id: string) => {
        setItems((prev) => prev.filter((it) => it.id !== id));
    };

    const handleSave = async () => {
        const toSave = items.filter((it) => it.selected && it.questionText.trim());
        if (toSave.length === 0 || needsNotebook) return;
        const savedIds = await onSaveAll(toSave);
        if (savedIds.length > 0) {
            const saved = new Set(savedIds);
            setItems((prev) => prev.filter((it) => !saved.has(it.id)));
        }
    };

    return (
        <div className="mx-auto max-w-5xl space-y-6 pb-20">
            {/* 顶栏控制卡 */}
            <div className="sticky top-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background/95 p-4 shadow-md backdrop-blur-md">
                <div className="flex min-w-0 items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving} className="rounded-xl">
                        <ArrowLeft className="mr-1 h-4 w-4" />
                        返回
                    </Button>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-bold">批量核对与录入</h2>
                            <Badge variant="secondary">共 {items.length} 道</Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {notebookName ? `保存到「${notebookName}」，` : notebooks ? "已按学科自动分配错题本，" : ""}可勾选要入库的题目，或直接修改内容
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {notebooks && (
                        <select
                            aria-label="把所有题目都存到同一个错题本"
                            value=""
                            onChange={(e) => setAllNotebooks(e.target.value)}
                            disabled={isSaving}
                            className="h-9 rounded-xl border bg-background px-3 text-sm"
                        >
                            <option value="">全部存到…</option>
                            {notebooks.map((n) => (
                                <option key={n.id} value={n.id}>{n.name}</option>
                            ))}
                        </select>
                    )}
                    <Button variant="outline" size="sm" onClick={toggleSelectAll} disabled={isSaving || items.length === 0} className="rounded-xl">
                        {isAllSelected ? (
                            <><CheckSquare className="mr-1.5 h-3.5 w-3.5" />取消全选</>
                        ) : (
                            <><Square className="mr-1.5 h-3.5 w-3.5" />全选 ({items.length})</>
                        )}
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={selectedCount === 0 || isSaving || needsNotebook}
                        title={needsNotebook ? "还有题目没有选择错题本" : undefined}
                        className="h-9 rounded-xl px-5"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                正在保存 {savingProgress ? `${savingProgress.current}/${savingProgress.total}` : ""}
                            </>
                        ) : (
                            <>
                                <Save className="mr-1.5 h-4 w-4" />
                                保存选中的 {selectedCount} 道
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* 识别失败的图片：说明原因并支持一键重试 */}
            {failedItems.length > 0 && (
                <Card className="border-destructive/40">
                    <CardContent className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <AlertCircle className="h-4 w-4 text-destructive" />
                                {failedItems.length} 张图片未识别成功
                            </div>
                            {onRetryFailed && (
                                <Button size="sm" variant="outline" onClick={onRetryFailed} disabled={isRetrying || isSaving}>
                                    {isRetrying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                                    重试失败的图片
                                </Button>
                            )}
                        </div>
                        <ul className="space-y-1 text-sm">
                            {failedItems.map((f) => (
                                <li key={f.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                                    <div className="min-w-0">
                                        <span className="block truncate">{f.name}</span>
                                        {f.error && <span className="text-xs text-destructive">{f.error}</span>}
                                    </div>
                                    {onRemoveFailed && (
                                        <button
                                            type="button"
                                            aria-label={`忽略 ${f.name}`}
                                            onClick={() => onRemoveFailed(f.id)}
                                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}

            {items.length === 0 && failedItems.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">没有待核对的题目了</p>
            )}

            {/* 题目卡片列表 */}
            <div className="space-y-6">
                {items.map((item, idx) => {
                    const tab = activeTabMap[item.id] || "edit";
                    return (
                        <Card
                            key={item.id}
                            className={`overflow-hidden rounded-2xl border-2 transition-all duration-200 ${item.selected ? "border-primary/30 shadow-sm" : "border-muted bg-muted/20 opacity-60"}`}
                        >
                            {/* 卡片标题栏 */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 p-4">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        role="checkbox"
                                        aria-checked={item.selected}
                                        aria-label={`选择第 ${idx + 1} 题`}
                                        onClick={() => updateItem(item.id, { selected: !item.selected })}
                                        className="text-primary transition-transform hover:scale-110"
                                    >
                                        {item.selected ? (
                                            <CheckCircle2 className="h-6 w-6" />
                                        ) : (
                                            <Circle className="h-6 w-6 text-muted-foreground" />
                                        )}
                                    </button>
                                    <Badge variant="outline">第 {idx + 1} 题</Badge>
                                    {item.subject && item.subject !== "其他" && <Badge variant="secondary">{item.subject}</Badge>}
                                    {item.knowledgePoints.map((tag, tIdx) => (
                                        // 知识点可能重复，key 带上序号避免 React 重复 key 警告
                                        <Badge key={`${tag}-${tIdx}`} variant="secondary" className="text-[11px]">{tag}</Badge>
                                    ))}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {notebooks && (
                                        <select
                                            aria-label={`第 ${idx + 1} 题保存到的错题本`}
                                            value={item.notebookId || ""}
                                            onChange={(e) => updateItem(item.id, { notebookId: e.target.value || undefined })}
                                            disabled={isSaving}
                                            className={`h-8 rounded-lg border bg-background px-2 text-xs ${item.selected && !item.notebookId ? "border-destructive" : ""}`}
                                        >
                                            <option value="">选择错题本…</option>
                                            {notebooks.map((n) => (
                                                <option key={n.id} value={n.id}>{n.name}</option>
                                            ))}
                                        </select>
                                    )}
                                    <div className="flex rounded-xl bg-muted p-0.5 text-xs font-medium" role="tablist">
                                        {(["edit", "preview"] as const).map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                role="tab"
                                                aria-selected={tab === mode}
                                                onClick={() => setActiveTabMap((prev) => ({ ...prev, [item.id]: mode }))}
                                                className={`rounded-lg px-3 py-1 transition-all ${tab === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                                            >
                                                {mode === "edit" ? "编辑" : "公式预览"}
                                            </button>
                                        ))}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeItem(item.id)}
                                        className="h-8 rounded-xl px-2.5 text-xs text-destructive hover:text-destructive"
                                    >
                                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                                        删除
                                    </Button>
                                </div>
                            </div>

                            {/* 卡片主体内容 */}
                            <CardContent className="space-y-4 p-4 sm:p-6">
                                <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
                                    {item.originalImageUrl && (
                                        <div className="space-y-2 md:col-span-4">
                                            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                                <ImageIcon className="h-3.5 w-3.5" />
                                                原图
                                            </span>
                                            <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border bg-muted/30 p-2">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={item.originalImageUrl} alt={`第 ${idx + 1} 题原图`} className="h-full w-full object-contain" />
                                            </div>
                                        </div>
                                    )}

                                    <div className={item.originalImageUrl ? "space-y-4 md:col-span-8" : "space-y-4 md:col-span-12"}>
                                        <div className="space-y-1.5">
                                            <label htmlFor={`q-${item.id}`} className="text-xs font-semibold">题目内容</label>
                                            {tab === "edit" ? (
                                                <Textarea
                                                    id={`q-${item.id}`}
                                                    value={item.questionText}
                                                    onChange={(e) => updateItem(item.id, { questionText: e.target.value })}
                                                    rows={4}
                                                    className="rounded-xl font-mono text-xs"
                                                />
                                            ) : (
                                                <div className="rounded-xl border bg-muted/30 p-3.5 text-sm leading-relaxed">
                                                    <MarkdownRenderer content={item.questionText} />
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div className="space-y-1.5">
                                                <label htmlFor={`a-${item.id}`} className="text-xs font-semibold">参考答案</label>
                                                <Input
                                                    id={`a-${item.id}`}
                                                    value={item.answerText}
                                                    onChange={(e) => updateItem(item.id, { answerText: e.target.value })}
                                                    className="rounded-xl text-sm"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label htmlFor={`k-${item.id}`} className="text-xs font-semibold">知识点（逗号分隔）</label>
                                                <Input
                                                    id={`k-${item.id}`}
                                                    value={item.knowledgePoints.join("，")}
                                                    onChange={(e) =>
                                                        updateItem(item.id, {
                                                            knowledgePoints: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean),
                                                        })
                                                    }
                                                    className="rounded-xl text-sm"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label htmlFor={`an-${item.id}`} className="text-xs font-semibold">解析</label>
                                            {tab === "edit" ? (
                                                <Textarea
                                                    id={`an-${item.id}`}
                                                    value={item.analysis}
                                                    onChange={(e) => updateItem(item.id, { analysis: e.target.value })}
                                                    rows={4}
                                                    className="rounded-xl font-mono text-xs"
                                                />
                                            ) : (
                                                <div className="rounded-xl border bg-muted/30 p-3.5 text-sm leading-relaxed">
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
