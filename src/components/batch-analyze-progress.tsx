"use client";

import { CheckCircle2, AlertCircle, Loader2, Clock, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { BatchTask, BatchTaskStatus } from "@/hooks/use-batch-image-analysis";

const STATUS_TEXT: Record<BatchTaskStatus, string> = {
    queued: "排队中",
    compressing: "压缩中",
    analyzing: "识别中",
    done: "已完成",
    failed: "失败",
    cancelled: "已取消",
};

function StatusIcon({ status }: { status: BatchTaskStatus }) {
    switch (status) {
        case "done":
            return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
        case "failed":
            return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
        case "cancelled":
            return <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />;
        case "queued":
            return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />;
        default:
            return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
    }
}

interface Props {
    tasks: BatchTask[];
    onCancel: () => void;
}

/**
 * 批量识别进度面板：逐张显示状态与失败原因，可随时取消。
 * 取代原先只有一个模拟进度条、到点自动消失的全屏遮罩。
 */
export function BatchAnalyzeProgress({ tasks, onCancel }: Props) {
    const finished = tasks.filter((t) => t.status === "done" || t.status === "failed" || t.status === "cancelled").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const percent = tasks.length > 0 ? Math.round((finished / tasks.length) * 100) : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="batch-progress-title"
                className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-lg"
            >
                <div className="space-y-1">
                    <h2 id="batch-progress-title" className="text-base font-semibold">
                        正在识别 {tasks.length} 张图片
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        已完成 {finished} / {tasks.length}
                        {failed > 0 ? `，其中 ${failed} 张失败（完成后可单独重试）` : ""}
                    </p>
                </div>

                <Progress value={percent} className="h-2" />

                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
                    {tasks.map((task, idx) => (
                        <li key={task.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                            <StatusIcon status={task.status} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate">#{idx + 1} {task.name}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground">{STATUS_TEXT[task.status]}</span>
                                </div>
                                {task.error && <p className="mt-0.5 text-xs text-destructive">{task.error}</p>}
                            </div>
                        </li>
                    ))}
                </ul>

                <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        取消识别
                    </Button>
                </div>
            </div>
        </div>
    );
}
