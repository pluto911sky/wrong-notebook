"use client";

import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, RotateCcw, Heart, Trophy, Award, Gift } from "lucide-react";

interface PetFeedbackDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isCorrect: boolean;
    difficulty: "medium" | "hard" | "harder" | string;
    userAnswer: string;
    correctAnswer: string;
    onRetry?: () => void;
    onViewDetail?: () => void;
    expGained?: number;
    fruitGained?: number;
    leveledUp?: boolean;
    newLevel?: number;
    onOpenLottery?: () => void;
}

const CORRECT_PRAISES = [
    "喵呜！主人你的思维太敏锐啦，连这么隐蔽的考点陷阱都被你一眼识破！",
    "太牛了！算算喵为你疯狂拍爪鼓掌！举一反三能力满分，这就是未来的数学大学霸吧！",
    "步步为营，逻辑严密！你成功攻克了这道题，算算喵感觉浑身充满了智慧能量喵~",
    "太棒啦！吃了你赢取的金色能量果，算算喵离下一级大宗师又近了一大步！",
];

const WRONG_ENCOURAGEMENTS = [
    "呜呜，这道题藏着一个特别狡猾的思维弯道，连好多学霸都容易中招呢，不要灰心！",
    "算算喵吸了吸鼻子：错题不可怕，它正好暴露了考点陷阱！我们看下点拨，马上就能战胜它！",
    "摸摸头！真正的数学高手都是在草稿纸上跌倒又爬起来的，算算喵陪你再仔细推导一次好不好？",
    "别难过！吸一口气，看看下方的思路拆解，把这个盲区吃透，下次考试遇到就是送分题啦！",
];

export function PetFeedbackDialog({
    isOpen,
    onClose,
    isCorrect,
    difficulty,
    userAnswer,
    correctAnswer,
    onRetry,
    onViewDetail,
    expGained = 35,
    fruitGained = 2,
    leveledUp = false,
    newLevel,
    onOpenLottery,
}: PetFeedbackDialogProps) {
    const praiseText = React.useMemo(() => {
        return CORRECT_PRAISES[Math.floor(Math.random() * CORRECT_PRAISES.length)];
    }, [isOpen]);

    const comfortText = React.useMemo(() => {
        return WRONG_ENCOURAGEMENTS[Math.floor(Math.random() * WRONG_ENCOURAGEMENTS.length)];
    }, [isOpen]);

    const difficultyLabel = {
        medium: "类似题型",
        hard: "困难变式",
        harder: "挑战压轴",
    }[difficulty] || "举一反三";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md sm:rounded-3xl p-6 overflow-hidden border-2 shadow-2xl">
                {isCorrect ? (
                    /* 做对题：欢呼雀跃、戴博士帽、撒花赞美的小猫 */
                    <div className="flex flex-col items-center text-center space-y-4 pt-2 animate-in zoom-in-95 duration-300">
                        {/* 庆贺徽章 */}
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-extrabold text-xs tracking-wide">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            <span>攻克【{difficultyLabel}】！</span>
                        </div>

                        {/* 开心大笑 + 举双手欢呼的小猫矢量插画 */}
                        <div className="relative w-36 h-36 my-1">
                            <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-xl scale-90 animate-pulse" />
                            <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-lg">
                                {/* 庆贺星星与彩花 */}
                                <path d="M15,25 L18,32 L25,35 L18,38 L15,45 L12,38 L5,35 L12,32 Z" fill="#fbbf24" />
                                <path d="M105,20 L107,26 L113,28 L107,30 L105,36 L103,30 L97,28 L103,26 Z" fill="#f59e0b" />
                                <circle cx="20" cy="85" r="3" fill="#ec4899" />
                                <circle cx="102" cy="80" r="3.5" fill="#3b82f6" />

                                {/* 向上挥舞的欢呼小爪爪 */}
                                <ellipse cx="22" cy="46" rx="8" ry="6" fill="#fb923c" transform="rotate(-30 22 46)" />
                                <circle cx="19" cy="43" r="2.5" fill="#fed7aa" />
                                <ellipse cx="98" cy="46" rx="8" ry="6" fill="#fb923c" transform="rotate(30 98 46)" />
                                <circle cx="101" cy="43" r="2.5" fill="#fed7aa" />

                                {/* 猫猫耳朵 */}
                                <polygon points="26,45 16,14 50,28" fill="#f97316" />
                                <polygon points="30,40 22,22 47,30" fill="#fed7aa" />
                                <polygon points="94,45 104,14 70,28" fill="#f97316" />
                                <polygon points="90,40 98,22 73,30" fill="#fed7aa" />

                                {/* 脸蛋 */}
                                <ellipse cx="60" cy="62" rx="42" ry="36" fill="#fb923c" />
                                <ellipse cx="60" cy="69" rx="30" ry="24" fill="#fff7ed" />

                                {/* 喜悦腮红 */}
                                <circle cx="34" cy="71" r="7" fill="#f43f5e" opacity="0.45" />
                                <circle cx="86" cy="71" r="7" fill="#f43f5e" opacity="0.45" />

                                {/* 开心弯弯笑眼 ( ^ ^ ) */}
                                <path
                                    d="M40,58 Q47,49 54,58"
                                    stroke="#1e293b"
                                    strokeWidth="3.5"
                                    fill="none"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M66,58 Q73,49 80,58"
                                    stroke="#1e293b"
                                    strokeWidth="3.5"
                                    fill="none"
                                    strokeLinecap="round"
                                />

                                {/* 小鼻子与张口大笑的嘴巴 */}
                                <polygon points="60,67 56,63 64,63" fill="#f43f5e" />
                                <path
                                    d="M52,70 Q60,84 68,70"
                                    stroke="#1e293b"
                                    strokeWidth="2.5"
                                    fill="#f43f5e"
                                    strokeLinecap="round"
                                />
                                <ellipse cx="60" cy="75" rx="4" ry="2.5" fill="#fecdd3" />

                                {/* 萌萌胡须 */}
                                <line x1="22" y1="67" x2="35" y2="69" stroke="#fed7aa" strokeWidth="2" strokeLinecap="round" />
                                <line x1="20" y1="73" x2="35" y2="73" stroke="#fed7aa" strokeWidth="2" strokeLinecap="round" />
                                <line x1="85" y1="69" x2="98" y2="67" stroke="#fed7aa" strokeWidth="2" strokeLinecap="round" />
                                <line x1="85" y1="73" x2="100" y2="73" stroke="#fed7aa" strokeWidth="2" strokeLinecap="round" />

                                {/* 博士帽 */}
                                <polygon points="60,16 32,27 60,38 88,27" fill="#2563eb" />
                                <line x1="60" y1="27" x2="82" y2="40" stroke="#f59e0b" strokeWidth="2.5" />
                                <circle cx="82" cy="40" r="3" fill="#f59e0b" />
                            </svg>
                        </div>

                        <div className="space-y-1">
                            <h3 className="text-xl font-black text-amber-600 dark:text-amber-400">
                                太棒啦！完全正确！🌟
                            </h3>
                            <p className="text-xs text-muted-foreground">思维敏锐 · 举一反三 · 攻克考点</p>
                        </div>

                        {/* 算算喵的赞美对白气泡 */}
                        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 p-3.5 text-xs text-foreground leading-relaxed relative">
                            <span className="font-bold text-amber-600 dark:text-amber-400 block mb-1">
                                🐾 算算喵为你点赞：
                            </span>
                            <p className="font-medium">{praiseText}</p>
                        </div>

                        {/* 升级大喜报与抽奖激励 */}
                        {leveledUp && (
                            <div className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-xl space-y-2 animate-bounce duration-1000">
                                <div className="font-black text-sm flex items-center justify-center gap-1.5">
                                    <Trophy className="w-4 h-4 fill-white" />
                                    <span>🎉 算算喵成功升级到 Lv.{newLevel}！</span>
                                </div>
                                <p className="text-xs opacity-95">
                                    获得 1 次心愿大转盘抽奖机会（零食、大餐、特权卡）！
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        if (onOpenLottery) {
                                            onOpenLottery();
                                        } else {
                                            window.dispatchEvent(new CustomEvent("open_pet_lottery"));
                                        }
                                    }}
                                    className="w-full bg-white text-orange-600 hover:bg-orange-50 font-black text-xs py-2 rounded-xl shadow transition-transform active:scale-95 flex items-center justify-center gap-1 cursor-pointer"
                                >
                                    <Gift className="w-4 h-4 fill-orange-500 text-orange-500" />
                                    <span>立即抽取心愿大奖 🎁</span>
                                </button>
                            </div>
                        )}

                        {/* 宠物能量掉落卡 */}
                        <div className="w-full flex items-center justify-around p-3 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-emerald-500/10 rounded-xl border border-amber-300/30 text-xs font-semibold">
                            <span className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                                <Trophy className="w-4 h-4" />
                                经验值 +{expGained}
                            </span>
                            <span className="h-4 w-px bg-border" />
                            <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                <Sparkles className="w-4 h-4 fill-amber-500" />
                                金色能量果 +{fruitGained}
                            </span>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex gap-2.5 w-full pt-1">
                            {onViewDetail && (
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        onClose();
                                        onViewDetail();
                                    }}
                                    className="flex-1 text-xs h-9"
                                >
                                    查看详细解析
                                </Button>
                            )}
                            <Button
                                onClick={onClose}
                                className="flex-1 text-xs h-9 bg-amber-600 hover:bg-amber-700 text-white font-bold"
                            >
                                棒呆啦，继续挑战 ❯
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* 做错题：眼角含泪、委屈又温柔鼓励的小猫 */
                    <div className="flex flex-col items-center text-center space-y-4 pt-2 animate-in zoom-in-95 duration-300">
                        {/* 提示徽章 */}
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-extrabold text-xs tracking-wide">
                            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                            <span>差一点点就对啦，不要灰心！</span>
                        </div>

                        {/* 委屈抹眼泪的可爱小猫矢量插画 */}
                        <div className="relative w-36 h-36 my-1">
                            <div className="absolute inset-0 bg-blue-400/15 rounded-full blur-xl scale-90" />
                            <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-md">
                                {/* 猫猫耳朵（微垂，委屈感） */}
                                <polygon points="26,48 14,24 46,34" fill="#f97316" />
                                <polygon points="28,44 19,30 43,36" fill="#fed7aa" />
                                <polygon points="94,48 106,24 74,34" fill="#f97316" />
                                <polygon points="92,44 101,30 77,36" fill="#fed7aa" />

                                {/* 脸蛋 */}
                                <ellipse cx="60" cy="64" rx="42" ry="36" fill="#fb923c" />
                                <ellipse cx="60" cy="71" rx="30" ry="24" fill="#fff7ed" />

                                {/* 腮红 */}
                                <circle cx="34" cy="74" r="6" fill="#fca5a5" opacity="0.6" />
                                <circle cx="86" cy="74" r="6" fill="#fca5a5" opacity="0.6" />

                                {/* 泪汪汪大眼睛 (带着水润泪光) */}
                                <ellipse cx="44" cy="62" rx="7" ry="9" fill="#1e293b" />
                                <circle cx="42" cy="58" r="3" fill="#ffffff" />
                                <circle cx="47" cy="64" r="1.5" fill="#ffffff" />

                                <ellipse cx="76" cy="62" rx="7" ry="9" fill="#1e293b" />
                                <circle cx="74" cy="58" r="3" fill="#ffffff" />
                                <circle cx="79" cy="64" r="1.5" fill="#ffffff" />

                                {/* 晶莹剔透的小泪滴 */}
                                <path
                                    d="M36,70 C34,75 32,78 36,82 C40,82 39,78 37,74 Z"
                                    fill="#38bdf8"
                                    opacity="0.9"
                                />
                                <path
                                    d="M84,72 C82,77 80,80 84,84 C88,84 87,80 85,76 Z"
                                    fill="#38bdf8"
                                    opacity="0.9"
                                />

                                {/* 小鼻子与微微撇起的委屈波浪小嘴巴 */}
                                <polygon points="60,68 57,65 63,65" fill="#f43f5e" />
                                <path
                                    d="M52,75 Q60,70 68,75"
                                    stroke="#1e293b"
                                    strokeWidth="2.5"
                                    fill="none"
                                    strokeLinecap="round"
                                />

                                {/* 抱在一起互相打气的前爪爪 */}
                                <ellipse cx="50" cy="88" rx="7" ry="6" fill="#fed7aa" />
                                <ellipse cx="70" cy="88" rx="7" ry="6" fill="#fed7aa" />
                            </svg>
                        </div>

                        <div className="space-y-1">
                            <h3 className="text-xl font-black text-foreground">
                                呜呜，遇到了思维小陷阱... 🥺
                            </h3>
                            <p className="text-xs text-muted-foreground">错题是最好的升级矿石 · 找到陷阱就能破解！</p>
                        </div>

                        {/* 算算喵的温暖安慰对白气泡 */}
                        <div className="rounded-2xl bg-blue-50/70 dark:bg-slate-900 border border-blue-200/60 dark:border-blue-900/40 p-3.5 text-xs text-foreground leading-relaxed relative">
                            <span className="font-bold text-blue-600 dark:text-blue-400 block mb-1">
                                🐾 算算喵摸摸头鼓励你：
                            </span>
                            <p className="font-medium text-slate-700 dark:text-slate-300">{comfortText}</p>
                        </div>

                        {/* 答案对比 */}
                        <div className="w-full grid grid-cols-2 gap-2 text-xs text-left">
                            <div className="p-2.5 rounded-xl bg-muted/60 border">
                                <div className="text-[11px] text-muted-foreground mb-0.5">你的答案</div>
                                <div className="font-bold text-foreground truncate">{userAnswer || "（未填）"}</div>
                            </div>
                            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-0.5">参考答案</div>
                                <div className="font-bold text-emerald-700 dark:text-emerald-300 truncate">
                                    {correctAnswer}
                                </div>
                            </div>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex gap-2.5 w-full pt-1">
                            {onRetry && (
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        onClose();
                                        onRetry();
                                    }}
                                    className="flex-1 text-xs h-9"
                                >
                                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                    重新做这题
                                </Button>
                            )}
                            {onViewDetail && (
                                <Button
                                    onClick={() => {
                                        onClose();
                                        onViewDetail();
                                    }}
                                    className="flex-1 text-xs h-9 bg-primary hover:bg-primary/90 text-white font-bold"
                                >
                                    看解题关键 💡
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
