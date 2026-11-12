"use client";

import { Check, Lock, Clock, Target, Flame, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    PRACTICE_LEVELS,
    PRACTICE_LEVEL_LABELS,
    type PracticeLevel,
    type PracticeProgress,
} from "@/lib/practice-progress";

const LEVEL_ICONS = { medium: Target, hard: Flame, harder: Zap } as const;

interface Props {
    progress: PracticeProgress | null;
    active: PracticeLevel;
    onSelect: (level: PracticeLevel) => void;
    disabled?: boolean;
}

/** 闯关进度条：类似题型 → 困难模式 → 挑战压轴，未解锁的关卡不可点击 */
export function PracticeLevelTabs({ progress, active, onSelect, disabled }: Props) {
    return (
        <div className="flex flex-wrap items-center justify-center gap-1.5" role="tablist" aria-label="闯关关卡">
            {PRACTICE_LEVELS.map((level, idx) => {
                const state = progress?.levels[level];
                const locked = !state?.unlocked;
                const Icon = LEVEL_ICONS[level];
                const prevLabel = idx > 0 ? PRACTICE_LEVEL_LABELS[PRACTICE_LEVELS[idx - 1]] : "";
                const hint = locked
                    ? `先通过「${prevLabel}」才能解锁`
                    : state?.cleared
                        ? "已通关，可查看"
                        : state?.attemptedToday
                            ? "今天已作答，明天再来"
                            : "可以挑战";

                return (
                    <div key={level} className="flex items-center gap-1.5">
                        {idx > 0 && <span aria-hidden className="text-muted-foreground">→</span>}
                        <button
                            type="button"
                            role="tab"
                            aria-selected={active === level}
                            disabled={locked || disabled}
                            title={hint}
                            onClick={() => onSelect(level)}
                            className={cn(
                                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all md:text-sm",
                                active === level ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:bg-muted",
                                locked && "cursor-not-allowed opacity-50 hover:bg-background"
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            <span>第{idx + 1}关 {PRACTICE_LEVEL_LABELS[level]}</span>
                            {locked ? (
                                <Lock className="h-3.5 w-3.5" aria-label="未解锁" />
                            ) : state?.cleared ? (
                                <Check className="h-3.5 w-3.5" aria-label="已通关" />
                            ) : state?.attemptedToday ? (
                                <Clock className="h-3.5 w-3.5" aria-label="明天再来" />
                            ) : null}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
