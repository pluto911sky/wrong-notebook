"use client";

/**
 * 轻量级全局提示（替代阻塞式 alert）。
 * 不引入第三方依赖：用一个模块级 store + useSyncExternalStore 订阅，
 * 任何地方（包括非组件代码）都可以直接调用 toast.success / error / info。
 */
import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
    id: number;
    message: string;
    variant: ToastVariant;
}

const MAX_VISIBLE = 4;
const DURATION: Record<ToastVariant, number> = {
    success: 3500,
    info: 4000,
    // 错误提示往往需要读完原因，停留更久
    error: 7000,
};

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
    listeners.forEach((l) => l());
}

function dismiss(id: number) {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

function push(message: string, variant: ToastVariant) {
    if (typeof window === "undefined" || !message) return;
    const id = nextId++;
    toasts = [...toasts, { id, message, variant }].slice(-MAX_VISIBLE);
    timers.set(id, setTimeout(() => dismiss(id), DURATION[variant]));
    emit();
}

export const toast = {
    success: (message: string) => push(message, "success"),
    error: (message: string) => push(message, "error"),
    info: (message: string) => push(message, "info"),
    dismiss,
};

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const EMPTY: ToastItem[] = [];

const ICONS = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
};

export function Toaster() {
    const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);

    return (
        <div
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
        >
            {items.map((item) => {
                const Icon = ICONS[item.variant];
                return (
                    <div
                        key={item.id}
                        role={item.variant === "error" ? "alert" : "status"}
                        className={cn(
                            "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-card p-3 pr-2 text-sm shadow-lg animate-in fade-in slide-in-from-top-2",
                            item.variant === "error" && "border-destructive/40",
                            item.variant === "success" && "border-emerald-500/40"
                        )}
                    >
                        <Icon
                            className={cn(
                                "mt-0.5 h-4 w-4 shrink-0",
                                item.variant === "error" && "text-destructive",
                                item.variant === "success" && "text-emerald-600",
                                item.variant === "info" && "text-primary"
                            )}
                        />
                        <p className="flex-1 whitespace-pre-line leading-relaxed text-foreground">{item.message}</p>
                        <button
                            type="button"
                            onClick={() => dismiss(item.id)}
                            aria-label="关闭提示"
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
