"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PenLine, Sparkles, Layers } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface TextInputZoneProps {
    onSubmit: (questionText: string) => Promise<void>;
    isAnalyzing: boolean;
    defaultNotebookName?: string;
}

export function TextInputZone({ onSubmit, isAnalyzing, defaultNotebookName }: TextInputZoneProps) {
    const { t } = useLanguage();
    const [questionText, setQuestionText] = useState("");

    // 智能检测输入文本中是否包含多道题
    const detectMultiQuestions = (text: string): number => {
        if (!text.trim()) return 0;
        // 匹配类似 "1.", "1、", "（1）", "(1)", "第1题", "一、", "【1】" 等标记
        const matches = text.match(/(?:^|\n)\s*(?:(?:\d+|[一二三四五六七八九十]+)[\.、\s\)]|（\d+）|\(\d+\)|【(?:第?\d+题|\d+)】|第[0-9一二三四五六七八九十]+题)/g);
        if (matches && matches.length >= 2) {
            return matches.length;
        }
        // 或者是多个由两个以上空行隔开的段落
        const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 10);
        if (paragraphs.length >= 2) {
            return paragraphs.length;
        }
        return 1;
    };

    const detectedCount = detectMultiQuestions(questionText);
    const isMulti = detectedCount >= 2;

    const handleSubmit = async () => {
        if (!questionText.trim()) return;
        await onSubmit(questionText.trim());
    };

    // Support Ctrl+Enter / Cmd+Enter to submit
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (questionText.trim() && !isAnalyzing) {
                handleSubmit();
            }
        }
    };

    return (
        <Card className="border-dashed border-2 hover:border-primary/40 transition-colors">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <PenLine className="h-5 w-5 text-orange-500" />
                        <span className="text-sm font-bold text-foreground">
                            手动输入 / 批量粘贴题目
                        </span>
                    </div>

                    {isMulti && (
                        <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-300 font-black text-xs px-2.5 py-0.5 animate-pulse">
                            <Layers className="w-3.5 h-3.5 mr-1" />
                            智能识别到约 {detectedCount} 道题目，支持批量录入！
                        </Badge>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="question-text" className="text-xs font-bold text-muted-foreground">
                            题目内容（支持一次性粘贴单道题或多道题）：
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                            支持 Markdown 和 LaTeX 数学公式（如 $x^2 + y = 3$）
                        </span>
                    </div>

                    <Textarea
                        id="question-text"
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            "在此直接粘贴单道题或多道错题（例如按题号 1. 2. 3.、或空行隔开多题）...\n\n例如：\n1. 某班有学生48人，其中男生比女生多4人，求男生和女生各有多少人？\n2. 解方程：3(x - 2) = 2(x + 1) + 1\n3. 计算：(1/3 - 1/4) × 12 + 5/2\n\n💡 AI 将自动识别多题并拆分，一键批量解答与录入！快捷键：Ctrl+Enter (Cmd+Enter)"
                        }
                        className="min-h-[220px] font-mono text-xs leading-relaxed resize-y rounded-2xl border-2"
                        disabled={isAnalyzing}
                    />
                </div>

                {defaultNotebookName && (
                    <p className="text-xs text-muted-foreground">
                        目标错题本: <strong className="text-foreground">{defaultNotebookName}</strong>
                    </p>
                )}

                <Button
                    onClick={handleSubmit}
                    disabled={!questionText.trim() || isAnalyzing}
                    className="w-full bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:from-orange-600 hover:to-amber-600 text-white font-black text-sm h-11 rounded-2xl shadow-lg transition-transform active:scale-98 cursor-pointer"
                    size="lg"
                >
                    {isAnalyzing ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {isMulti ? "AI 正在批量拆分与解答多道错题..." : "AI 正在智能解题与分析..."}
                        </>
                    ) : (
                        <>
                            <Sparkles className="mr-2 h-4 w-4 fill-white" />
                            {isMulti ? `AI 智能拆分并批量解题 (${detectedCount}道题) 🚀` : "AI 智能解题与录入 🚀"}
                        </>
                    )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                    {isMulti
                        ? "✨ 提交后 AI 将自动将文本拆分成独立错题卡片，可在核对界面批量保存入库"
                        : "✨ 输入题目后，AI 将自动分析解题并生成考点标签"}
                </p>
            </CardContent>
        </Card>
    );
}
