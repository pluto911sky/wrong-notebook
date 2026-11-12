"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Gift, CheckCircle, RotateCcw, Award, Heart, Trophy, ChevronRight, X, Eye, BookOpen, Layers } from "lucide-react";
import { PetState, getPetState, consumeLotteryTicket, toggleLotteryRedeem } from "@/lib/pet-system";
import { BLANK_PRIZE_NAME, DEFAULT_BLANK_RATE, rollBlank } from "@/lib/lottery-odds";

interface PetLotteryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export interface PrizeInfo {
    id: string;
    name: string;
    shortTitle: string;
    category: string;
    categoryColor: string;
    icon: string;
    image: string;
    badge: string;
    benefit: string; // 核心特权说明（大字醒目）
    rule: string;    // 兑换与使用规则
    color: string;
}

export const PRIZE_CATALOG: PrizeInfo[] = [
    {
        id: "p1",
        name: "🍦 自选美味零食券",
        shortTitle: "美味零食券",
        category: "美食犒劳",
        categoryColor: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-300",
        icon: "🍦",
        image: "/prizes/snack.svg",
        badge: "人气爆款",
        benefit: "由爸爸妈妈买单！自主挑选一份平时限制的冰淇淋、奶茶或膨化零食！",
        rule: "出示本卡给爸爸妈妈，买完零食后由家长点击核销兑现。",
        color: "#fb923c",
    },
    {
        id: "p2",
        name: "🍔 豪华大餐任选卡",
        shortTitle: "豪华大餐卡",
        category: "家庭盛宴",
        categoryColor: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-300",
        icon: "🍔",
        image: "/prizes/feast.svg",
        badge: "SSR 大奖",
        benefit: "周末由你全权指定吃什么（汉堡披萨、自助餐、火锅或烤肉），全家一起去！",
        rule: "周末兑现，提前一天与家长约定好餐厅，全家无条件陪同！",
        color: "#f59e0b",
    },
    {
        id: "p3",
        name: "💰 自由零花钱基金",
        shortTitle: "零花钱基金",
        category: "财富奖励",
        categoryColor: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-300",
        icon: "💰",
        image: "/prizes/money.svg",
        badge: "自主支配",
        benefit: "获得 20 元自由支配零花钱现金或红包，存入个人小金库购买喜欢的小物！",
        rule: "直接由家长发放给孩子，自由支配，不予干涉。",
        color: "#10b981",
    },
    {
        id: "p4",
        name: "👑 霸气愿望特权卡",
        shortTitle: "愿望特权卡",
        category: "至尊特权",
        categoryColor: "bg-purple-500/15 text-purple-800 dark:text-purple-300 border-purple-300",
        icon: "👑",
        image: "/prizes/privilege.svg",
        badge: "终极指令",
        benefit: "家长无条件答应你一个合理要求（如今天晚睡半小时、多看一集动画片等）！",
        rule: "愿望需安全合理，提出后家长不可无故拒绝。",
        color: "#8b5cf6",
    },
    {
        id: "p5",
        name: "🎁 心愿礼物兑换券",
        shortTitle: "心愿礼物券",
        category: "梦想成真",
        categoryColor: "bg-pink-500/15 text-pink-800 dark:text-pink-300 border-pink-300",
        icon: "🎁",
        image: "/prizes/gift.svg",
        badge: "实物心愿",
        benefit: "挑选一个心仪已久的文具盒、玩具盲盒、小手办或乐高拼装积木！",
        rule: "50元以内礼物，由家长协助在网店或实体商场购买下单。",
        color: "#ec4899",
    },
    {
        id: "p6",
        name: "🏖️ 周末出行游乐日",
        shortTitle: "出游游乐卡",
        category: "户外假日",
        categoryColor: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-300",
        icon: "🏖️",
        image: "/prizes/trip.svg",
        badge: "家庭日",
        benefit: "周末全家去一次你最想去的游乐园、动物园、科技馆或户外露营野餐！",
        rule: "适合周末或节假日全家成行，尽情游玩一整天。",
        color: "#06b6d4",
    },
    {
        id: "p7",
        name: "🎮 畅玩游戏时间卡",
        shortTitle: "游戏时间卡",
        category: "自由时光",
        categoryColor: "bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-300",
        icon: "🎮",
        image: "/prizes/game.svg",
        badge: "快乐加倍",
        benefit: "额外奖励 30 分钟周末平板、电脑或游戏主机自由体验畅玩时间！",
        rule: "可在完成当天学习任务后使用，单次享受30分钟。",
        color: "#3b82f6",
    }
];

/**
 * 已下架的心愿卡：不再出现在转盘和卡片图鉴里，
 * 只用于正确显示孩子卡包里以前抽到、还没兑换的旧卡片。
 */
const RETIRED_PRIZES: PrizeInfo[] = [
    {
        id: "p8",
        name: "🌟 免做家务偷懒券",
        shortTitle: "免家务偷懒券",
        category: "偷懒特权",
        categoryColor: "bg-yellow-500/15 text-yellow-900 dark:text-yellow-300 border-yellow-300",
        icon: "🌟",
        image: "/prizes/chore.svg",
        badge: "幽默免责",
        benefit: "光明正大地把一次扫地、洗碗、擦桌子或扔垃圾任务转交给爸爸妈妈！",
        rule: "出示卡片并呼叫爸妈，家长需面带微笑代替孩子完成！",
        color: "#eab308",
    },
];

/** 转盘上的「谢谢惠顾」格子：落空时指针停在这里，不发卡片 */
export const BLANK_SEGMENT: PrizeInfo = {
    id: "blank",
    name: BLANK_PRIZE_NAME,
    shortTitle: BLANK_PRIZE_NAME,
    category: "",
    categoryColor: "",
    icon: "🍀",
    image: "",
    badge: "",
    benefit: "",
    rule: "",
    color: "#94a3b8",
};

/** 转盘格子 = 全部心愿卡 + 1 格谢谢惠顾 */
const WHEEL_SEGMENTS: PrizeInfo[] = [...PRIZE_CATALOG, BLANK_SEGMENT];

export function findPrizeInfo(nameOrId: string = ""): PrizeInfo {
    const all = [...PRIZE_CATALOG, ...RETIRED_PRIZES];
    const found = all.find(
        (p) => p.id === nameOrId || p.name === nameOrId || (nameOrId && nameOrId.includes(p.shortTitle))
    );
    if (found) return found;
    // 兼容旧记录里名称略有差异的情况：按关键词映射到卡片 id
    const keywordToId: [string[], string][] = [
        [["零食"], "p1"],
        [["大餐"], "p2"],
        [["零花钱"], "p3"],
        [["特权", "愿望"], "p4"],
        [["礼物"], "p5"],
        [["出行", "游玩", "游乐"], "p6"],
        [["游戏"], "p7"],
        [["家务", "偷懒"], "p8"],
    ];
    const hit = keywordToId.find(([words]) => words.some((w) => nameOrId.includes(w)));
    return (hit && all.find((p) => p.id === hit[1])) || PRIZE_CATALOG[0];
}

export function getPrizeImage(name: string = ""): string {
    return findPrizeInfo(name).image;
}

export function PetLotteryDialog({ isOpen, onClose }: PetLotteryDialogProps) {
    const [pet, setPet] = useState<PetState | null>(null);
    const [isSpinning, setIsSpinning] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [wonPrize, setWonPrize] = useState<PrizeInfo | null>(null);
    const [showRewardModal, setShowRewardModal] = useState(false);
    const [activeTab, setActiveTab] = useState<"history" | "wheel" | "catalog">("history");
    const [historyFilter, setHistoryFilter] = useState<"all" | "pending" | "redeemed">("all");
    const [inspectingPrize, setInspectingPrize] = useState<{
        prize: PrizeInfo;
        recordId?: string;
        redeemed?: boolean;
        time?: string;
    } | null>(null);

    useEffect(() => {
        setPet(getPetState());
        const handleUpdate = (e: any) => {
            if (e.detail) setPet(e.detail);
        };
        window.addEventListener("pet_state_changed", handleUpdate);
        return () => window.removeEventListener("pet_state_changed", handleUpdate);
    }, [isOpen]);

    const handleSpin = () => {
        if (!pet || pet.lotteryTickets <= 0 || isSpinning) return;

        // 先判定是否落空（30% 谢谢惠顾），未落空再从心愿卡里等概率抽一张
        const isBlank = rollBlank(DEFAULT_BLANK_RATE);
        const selectedIndex = isBlank
            ? WHEEL_SEGMENTS.length - 1
            : Math.floor(Math.random() * PRIZE_CATALOG.length);
        const selected = WHEEL_SEGMENTS[selectedIndex];

        // 开转的同时就扣券（之前要等 3.6 秒动画结束才扣，期间关掉弹窗可以不扣券白抽）
        if (!consumeLotteryTicket(isBlank ? null : selected.name)) return;
        setPet(getPetState());

        setIsSpinning(true);
        setWonPrize(null);

        // 转盘旋转角度计算（6圈 + 扇区角度）
        const segmentAngle = 360 / WHEEL_SEGMENTS.length;
        const targetAngle = 360 * 6 - (selectedIndex * segmentAngle + segmentAngle / 2);
        const newRotation = rotation + targetAngle + (Math.random() * 16 - 8);

        setRotation(newRotation);

        setTimeout(() => {
            setIsSpinning(false);
            setWonPrize(selected);
            setShowRewardModal(true);
        }, 3600);
    };

    if (!pet) return null;

    // 过滤后的卡包历史
    const filteredHistory = pet.lotteryHistory.filter((item) => {
        if (historyFilter === "pending") return !item.redeemed;
        if (historyFilter === "redeemed") return item.redeemed;
        return true;
    });

    const pendingCount = pet.lotteryHistory.filter((i) => !i.redeemed).length;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent aria-describedby={undefined} className="w-[94vw] max-w-5xl h-[88vh] max-h-[820px] sm:rounded-3xl p-0 flex flex-col gap-0 overflow-hidden shadow-2xl border-2 border-amber-300/60 bg-gradient-to-b from-amber-50/40 via-background to-background">
                {/* 无障碍标题：Radix 要求每个弹窗都有 DialogTitle，缺失时会 console.error（即开发模式左下角的错误角标） */}
                <DialogTitle className="sr-only">心愿卡包</DialogTitle>
                {/* 顶栏：大号游戏质感标题栏 */}
                <div className="px-6 py-4 border-b bg-white/70 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-md">
                            <Gift className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-black text-foreground tracking-tight">
                                    算算喵心愿大卡包
                                </h2>
                                <Badge className="bg-gradient-to-r from-orange-500 to-amber-500 text-white font-black text-[11px] px-2 py-0.5 border-0 shadow-sm">
                                    Lv.{pet.level} 伴学奖励
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                攻克错题与变式升级，抽取属于你的实体心愿特权卡！
                            </p>
                        </div>
                    </div>

                    {/* 右侧数据胶囊与快捷切换 */}
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-amber-500/10 border border-amber-300/60 text-amber-800 dark:text-amber-200 text-xs font-black shadow-sm">
                            <span className="text-sm">🎟️</span>
                            <span>抽奖券: <strong className="text-sm text-orange-600 dark:text-orange-400">{pet.lotteryTickets}</strong> 次</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-orange-500/10 border border-orange-300/60 text-orange-800 dark:text-orange-200 text-xs font-black shadow-sm">
                            <span className="text-sm">🎒</span>
                            <span>已收集: <strong className="text-sm text-orange-600 dark:text-orange-400">{pet.lotteryHistory.length}</strong> 张</span>
                        </div>
                    </div>
                </div>

                {/* 导航标签切换 */}
                <div className="px-6 pt-3 pb-2 border-b bg-muted/20 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setActiveTab("history")}
                            className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "history"
                                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md scale-[1.02]"
                                    : "bg-background hover:bg-muted text-muted-foreground hover:text-foreground border"
                            }`}
                        >
                            <span>🎒 我的心愿卡包</span>
                            {pet.lotteryHistory.length > 0 && (
                                <span className="bg-white/90 text-orange-600 text-[10px] font-black px-1.5 py-0.2 rounded-full shadow-sm">
                                    {pet.lotteryHistory.length}
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("wheel")}
                            className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "wheel"
                                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md scale-[1.02]"
                                    : "bg-background hover:bg-muted text-muted-foreground hover:text-foreground border"
                            }`}
                        >
                            <span>🎡 幸运心愿大转盘</span>
                            {pet.lotteryTickets > 0 && (
                                <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full animate-pulse">
                                    可抽!
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("catalog")}
                            className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "catalog"
                                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md scale-[1.02]"
                                    : "bg-background hover:bg-muted text-muted-foreground hover:text-foreground border"
                            }`}
                        >
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>📖 {PRIZE_CATALOG.length}大心愿卡全图鉴</span>
                        </button>
                    </div>

                    {/* 状态快捷过滤（仅在我的卡包标签显示） */}
                    {activeTab === "history" && pet.lotteryHistory.length > 0 && (
                        <div className="flex items-center gap-1 text-xs">
                            <span className="text-muted-foreground text-[11px] mr-1">筛选：</span>
                            <button
                                type="button"
                                onClick={() => setHistoryFilter("all")}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs cursor-pointer ${
                                    historyFilter === "all" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                全部 ({pet.lotteryHistory.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setHistoryFilter("pending")}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs cursor-pointer ${
                                    historyFilter === "pending" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                待兑奖 ({pendingCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setHistoryFilter("redeemed")}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs cursor-pointer ${
                                    historyFilter === "redeemed" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                已兑现 ({pet.lotteryHistory.length - pendingCount})
                            </button>
                        </div>
                    )}
                </div>

                {/* 主视口区域 */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* TAB 1: 我的心愿卡包 */}
                    {activeTab === "history" && (
                        <div>
                            {pet.lotteryHistory.length === 0 ? (
                                /* 卡包空状态：生动的引导与大卡片预览 */
                                <div className="flex flex-col items-center justify-center py-8 text-center space-y-5">
                                    <div className="relative w-28 h-28">
                                        <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
                                        <div className="w-full h-full rounded-3xl bg-gradient-to-tr from-amber-100 to-orange-100 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center text-5xl shadow-inner border-2 border-amber-300">
                                            🎒
                                        </div>
                                    </div>

                                    <div className="space-y-1.5 max-w-md">
                                        <h3 className="text-lg font-black text-foreground">
                                            你的心愿卡包还是空的哦！
                                        </h3>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            算算喵每升一级就会赠送 <strong className="text-orange-600">1 次心愿抽奖机会</strong>！做对变式题立即获得经验，去抽取心愿卡吧！
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <Button
                                            onClick={() => setActiveTab("wheel")}
                                            className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-black text-xs px-6 h-10 rounded-2xl shadow-lg cursor-pointer"
                                        >
                                            <Gift className="w-4 h-4 mr-1.5" />
                                            前往转盘抽奖 ❯
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => setActiveTab("catalog")}
                                            className="text-xs h-10 px-5 rounded-2xl font-bold cursor-pointer"
                                        >
                                            <BookOpen className="w-4 h-4 mr-1.5 text-orange-500" />
                                            查看可抽取的全部心愿图鉴
                                        </Button>
                                    </div>

                                    {/* 预览下方可抽取的心愿卡片 */}
                                    <div className="w-full pt-6 mt-4 border-t">
                                        <div className="flex items-center justify-between mb-3 px-1">
                                            <span className="text-xs font-black text-foreground flex items-center gap-1.5">
                                                <span>✨ 你即将可以抽取的梦幻心愿卡预览：</span>
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">点击任意卡片查看大图与特权详情</span>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                                            {PRIZE_CATALOG.slice(0, 4).map((p) => (
                                                <div
                                                    key={p.id}
                                                    onClick={() => setInspectingPrize({ prize: p })}
                                                    className="p-3 rounded-2xl border-2 border-dashed border-amber-300/70 bg-white/60 dark:bg-slate-900/50 hover:border-orange-400 hover:shadow-md transition-all cursor-pointer flex flex-col items-center text-center space-y-2 group"
                                                >
                                                    <div className="w-16 h-16 rounded-xl bg-amber-50 dark:bg-slate-800 p-1.5 group-hover:scale-105 transition-transform">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={p.image} alt={p.name} className="w-full h-full object-contain" />
                                                    </div>
                                                    <div className="font-extrabold text-xs text-foreground">{p.name}</div>
                                                    <div className="text-[10px] text-muted-foreground line-clamp-1">{p.benefit}</div>
                                                    <Badge variant="secondary" className="text-[9px] px-2 py-0 bg-amber-100 text-amber-800">
                                                        待抽取 🔒
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* 拥有卡片时的收藏级实体卡网格 */
                                <div>
                                    <div className="flex items-center justify-between pb-3 px-1">
                                        <div className="text-xs text-muted-foreground">
                                            共有 <strong className="text-foreground">{pet.lotteryHistory.length}</strong> 张心愿卡，其中 <strong className="text-orange-600">{pendingCount}</strong> 张等待找爸爸妈妈兑现！
                                        </div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Eye className="w-3.5 h-3.5 text-orange-500" />
                                            <span>点击任意卡片可放大查看高清大图与完整规则</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {filteredHistory.map((item) => {
                                            const info = findPrizeInfo(item.prizeName);
                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() =>
                                                        setInspectingPrize({
                                                            prize: info,
                                                            recordId: item.id,
                                                            redeemed: item.redeemed,
                                                            time: item.time,
                                                        })
                                                    }
                                                    className={`relative rounded-3xl border-2 p-4 transition-all duration-200 cursor-pointer flex flex-col justify-between group overflow-hidden ${
                                                        item.redeemed
                                                            ? "bg-slate-50/80 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-70"
                                                            : "bg-gradient-to-br from-white via-amber-50/40 to-orange-50/60 dark:from-slate-900 dark:via-slate-800 dark:to-orange-950/20 border-orange-300 dark:border-orange-800 shadow-md hover:shadow-xl hover:-translate-y-1"
                                                    }`}
                                                >
                                                    {/* 卡片头部：分类与状态印章 */}
                                                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                                                        <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${info.categoryColor}`}>
                                                            {info.category}
                                                        </Badge>

                                                        {item.redeemed ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                                                                <CheckCircle className="w-3 h-3 text-emerald-600" />
                                                                已兑现 ✓
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm animate-pulse">
                                                                <Gift className="w-3 h-3" />
                                                                待兑现 🎁
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* 卡片核心展示区：高清插画 + 醒目标题 */}
                                                    <div className="py-3 flex items-center gap-4">
                                                        {/* 大号高清插画展台 */}
                                                        <div className="w-24 h-24 rounded-2xl flex-shrink-0 bg-gradient-to-tr from-amber-100/60 to-white dark:from-slate-800 dark:to-slate-700 p-2 shadow-inner border border-amber-200/80 dark:border-slate-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={info.image}
                                                                alt={info.name}
                                                                className={`w-full h-full object-contain drop-shadow ${item.redeemed ? "grayscale opacity-50" : ""}`}
                                                            />
                                                        </div>

                                                        {/* 右侧标题与核心特权摘要 */}
                                                        <div className="flex-1 space-y-1.5 min-w-0">
                                                            <h4 className={`text-base font-black truncate leading-tight ${item.redeemed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                                                                {info.name}
                                                            </h4>

                                                            {/* 特权高亮内容框（醒目大字，一眼看懂） */}
                                                            <div className="p-2 rounded-xl bg-amber-500/10 dark:bg-slate-800/80 border border-amber-300/40 text-[11px] font-bold text-amber-900 dark:text-amber-200 leading-snug">
                                                                {info.benefit}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* 卡片底部操作与兑换入口 */}
                                                    <div className="pt-2.5 border-t border-border/40 flex items-center justify-between gap-2">
                                                        <div className="text-[10px] text-muted-foreground truncate">
                                                            获得时间：{item.time}
                                                        </div>

                                                        <div className="flex items-center gap-1.5">
                                                            <Button
                                                                size="sm"
                                                                variant={item.redeemed ? "outline" : "default"}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleLotteryRedeem(item.id);
                                                                }}
                                                                className={`h-8 px-3 text-xs font-black rounded-xl cursor-pointer ${
                                                                    item.redeemed
                                                                        ? "text-muted-foreground hover:bg-muted"
                                                                        : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-md active:scale-95"
                                                                }`}
                                                            >
                                                                {item.redeemed ? "已兑现 ✓" : "找爸妈兑现 🎁"}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: 心愿大转盘（双栏大号界面） */}
                    {activeTab === "wheel" && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-2">
                            {/* 左侧大号转盘 (5列) */}
                            <div className="lg:col-span-5 flex flex-col items-center justify-center space-y-4">
                                <div className="relative w-80 h-80 my-2 select-none flex items-center justify-center">
                                    {/* 顶部指针 */}
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 -mt-3.5 drop-shadow-xl">
                                        <div className="w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[26px] border-t-red-600" />
                                    </div>

                                    {/* 旋转圆盘主体 */}
                                    <div
                                        className="w-full h-full rounded-full border-6 border-amber-400 shadow-2xl relative overflow-hidden transition-transform ease-out bg-gradient-to-tr from-amber-200 to-orange-100"
                                        style={{
                                            transform: `rotate(${rotation}deg)`,
                                            transitionDuration: isSpinning ? "3.6s" : "0s",
                                        }}
                                    >
                                        {WHEEL_SEGMENTS.map((item, idx) => {
                                            const count = WHEEL_SEGMENTS.length;
                                            const rotate = (360 / count) * idx;
                                            const isEven = idx % 2 === 0;

                                            return (
                                                <div
                                                    key={item.id}
                                                    className="absolute w-full h-full top-0 left-0"
                                                    style={{
                                                        transform: `rotate(${rotate}deg)`,
                                                        transformOrigin: "center center",
                                                    }}
                                                >
                                                    <div
                                                        className={`absolute top-0 left-1/2 -translate-x-1/2 w-32 h-40 pt-2 text-center flex flex-col items-center ${
                                                            isEven ? "text-amber-950" : "text-orange-950"
                                                        }`}
                                                    >
                                                        <div className="w-10 h-10 mb-1 rounded-xl overflow-hidden flex items-center justify-center p-1 shadow-sm bg-white/85 border border-amber-200">
                                                            {item.image ? (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img
                                                                    src={item.image}
                                                                    alt={item.name}
                                                                    className="w-full h-full object-contain"
                                                                />
                                                            ) : (
                                                                <span className="text-xl" aria-hidden>{item.icon}</span>
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] font-black truncate max-w-[100px] px-1 drop-shadow-sm">
                                                            {item.shortTitle}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* 扇区分隔线 */}
                                        <svg viewBox="0 0 100 100" className="w-full h-full absolute inset-0 opacity-25 pointer-events-none">
                                            <circle cx="50" cy="50" r="48" fill="none" stroke="#f59e0b" strokeWidth="2" />
                                            {WHEEL_SEGMENTS.map((_, i) => {
                                                const angle = (i * 360) / WHEEL_SEGMENTS.length;
                                                return (
                                                    <line
                                                        key={i}
                                                        x1="50"
                                                        y1="50"
                                                        x2={50 + 48 * Math.cos((angle * Math.PI) / 180)}
                                                        y2={50 + 48 * Math.sin((angle * Math.PI) / 180)}
                                                        stroke="#d97706"
                                                        strokeWidth="1.8"
                                                    />
                                                );
                                            })}
                                        </svg>
                                    </div>

                                    {/* 中心大号抽奖按钮 */}
                                    <button
                                        type="button"
                                        onClick={handleSpin}
                                        disabled={pet.lotteryTickets <= 0 || isSpinning}
                                        className={`absolute z-10 w-20 h-20 rounded-full bg-gradient-to-tr from-orange-500 via-amber-500 to-yellow-400 text-white font-black text-sm shadow-2xl border-4 border-white flex flex-col items-center justify-center cursor-pointer transition-transform ${
                                            isSpinning ? "scale-95 opacity-80" : "hover:scale-110 active:scale-95 animate-pulse"
                                        }`}
                                    >
                                        <Sparkles className="w-5 h-5 mb-0.5" />
                                        <span>{isSpinning ? "抽取中" : "抽 奖"}</span>
                                    </button>
                                </div>

                                {/* 抽奖状态与激励提示 */}
                                <div className="text-center space-y-1">
                                    {pet.lotteryTickets > 0 ? (
                                        <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-300 font-black text-xs">
                                            <span>🎉 剩余</span>
                                            <strong className="text-sm underline">{pet.lotteryTickets}</strong>
                                            <span>次抽奖机会，点击转盘中心开抽！</span>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            抽奖券已用完。攻克错题或做【困难变式】，算算喵<strong>每升一级立赠 1 次抽奖机会</strong>！
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* 右侧：本期心愿大奖卡片展架 */}
                            <div className="lg:col-span-7 space-y-3 bg-white/70 dark:bg-slate-900/60 p-5 rounded-3xl border shadow-sm">
                                <div className="flex items-center justify-between pb-2 border-b">
                                    <div className="flex items-center gap-2">
                                        <Trophy className="w-4 h-4 text-amber-500" />
                                        <h3 className="font-black text-sm text-foreground">
                                            转盘可抽中的 {PRIZE_CATALOG.length} 大梦幻心愿卡
                                        </h3>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground">点击卡片查看特权规则</span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
                                    {PRIZE_CATALOG.map((p) => (
                                        <div
                                            key={p.id}
                                            onClick={() => setInspectingPrize({ prize: p })}
                                            className="p-3 rounded-2xl border bg-gradient-to-r from-amber-50/50 to-white dark:from-slate-800 dark:to-slate-800/50 hover:border-orange-400 hover:shadow-md transition-all cursor-pointer flex items-center gap-3 group"
                                        >
                                            <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-700 border p-1 flex-shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={p.image} alt={p.name} className="w-full h-full object-contain" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1">
                                                    <span className="font-black text-xs text-foreground truncate">
                                                        {p.name}
                                                    </span>
                                                </div>
                                                <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                                                    {p.benefit}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-300/40 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                                    💡 <strong>家长提示</strong>：抽中心愿卡后会自动存入左上角「我的心愿卡包」，随时可以向爸爸妈妈出示卡片进行真实兑现核销！
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 3: 全套心愿卡图鉴 */}
                    {activeTab === "catalog" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between pb-2 border-b">
                                <div className="space-y-0.5">
                                    <h3 className="text-base font-black text-foreground">
                                        心愿卡官方珍藏图鉴 (8/8)
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        展示所有精心设计的小学霸奖励心愿卡，每一张都能成为你努力钻研数学的动力！
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={() => setActiveTab("wheel")}
                                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded-xl h-8 cursor-pointer"
                                >
                                    <Gift className="w-3.5 h-3.5 mr-1" />
                                    去抽卡 ❯
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {PRIZE_CATALOG.map((p) => {
                                    const ownedCount = pet.lotteryHistory.filter((h) => h.prizeName === p.name).length;
                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => setInspectingPrize({ prize: p })}
                                            className="p-4 rounded-3xl border-2 bg-gradient-to-b from-white via-amber-50/30 to-orange-50/40 dark:from-slate-900 dark:to-slate-800 border-amber-200 dark:border-slate-700 hover:border-orange-400 hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between group"
                                        >
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <Badge variant="outline" className={`text-[10px] font-bold ${p.categoryColor}`}>
                                                        {p.category}
                                                    </Badge>
                                                    <span className="text-[10px] font-black text-amber-700 dark:text-amber-300">
                                                        {p.badge}
                                                    </span>
                                                </div>

                                                <div className="w-28 h-28 mx-auto rounded-2xl bg-white dark:bg-slate-700 p-2 shadow-sm border flex items-center justify-center group-hover:scale-105 transition-transform">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={p.image} alt={p.name} className="w-full h-full object-contain drop-shadow" />
                                                </div>

                                                <div className="text-center space-y-1">
                                                    <h4 className="font-black text-sm text-foreground">{p.name}</h4>
                                                    <div className="p-2 rounded-xl bg-muted/60 text-[10px] text-muted-foreground font-medium line-clamp-2 leading-relaxed">
                                                        {p.benefit}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="pt-3 mt-3 border-t flex items-center justify-between text-xs">
                                                <span className="text-[10px] text-muted-foreground">
                                                    持有: <strong className="text-orange-600 font-bold">{ownedCount}</strong> 张
                                                </span>
                                                <span className="text-[10px] text-orange-600 font-bold group-hover:underline">
                                                    查看特权 ❯
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>

            {/* 巨型大卡片沉浸式详情弹窗 (Card Detail Inspector) */}
            <Dialog open={!!inspectingPrize} onOpenChange={(open) => !open && setInspectingPrize(null)}>
                <DialogContent aria-describedby={undefined} className="max-w-md sm:rounded-3xl p-6 text-center space-y-4 border-2 border-amber-300 shadow-2xl bg-gradient-to-b from-amber-50/70 via-background to-background">
                    {/* 无障碍标题：Radix 要求每个弹窗都有 DialogTitle，缺失时会 console.error（即开发模式左下角的错误角标） */}
                    <DialogTitle className="sr-only">{inspectingPrize?.prize.name || '心愿卡详情'}</DialogTitle>
                    {inspectingPrize && (
                        <>
                            {/* 顶部标签 */}
                            <div className="flex items-center justify-between pt-1">
                                <Badge variant="outline" className={`text-xs font-bold px-2.5 py-1 ${inspectingPrize.prize.categoryColor}`}>
                                    {inspectingPrize.prize.category}
                                </Badge>
                                <span className="text-xs font-black text-orange-600 bg-orange-100 dark:bg-orange-950 px-2.5 py-0.5 rounded-full">
                                    {inspectingPrize.prize.badge}
                                </span>
                            </div>

                            {/* 巨幅高清插画大卡片展台 */}
                            <div className="relative mx-auto w-44 h-44 rounded-3xl overflow-hidden shadow-2xl border-4 border-amber-300 bg-gradient-to-tr from-amber-100 via-orange-50 to-white dark:from-slate-800 dark:to-slate-700 p-4 flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={inspectingPrize.prize.image}
                                    alt={inspectingPrize.prize.name}
                                    className="w-full h-full object-contain drop-shadow-xl"
                                />
                            </div>

                            {/* 卡片大标题 */}
                            <div className="space-y-1">
                                <h3 className="text-2xl font-black text-foreground tracking-tight">
                                    {inspectingPrize.prize.name}
                                </h3>
                                {inspectingPrize.time && (
                                    <p className="text-[11px] text-muted-foreground">
                                        中奖时间：{inspectingPrize.time}
                                    </p>
                                )}
                            </div>

                            {/* 醒目特权内容与规则说明卡 */}
                            <div className="space-y-2 text-left">
                                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-orange-500/15 to-amber-500/15 border-2 border-orange-300/60 dark:border-orange-800">
                                    <div className="font-black text-xs text-orange-900 dark:text-orange-200 mb-1 flex items-center gap-1.5">
                                        <span>🎁 特权内容：</span>
                                    </div>
                                    <p className="text-xs font-bold text-foreground leading-relaxed">
                                        {inspectingPrize.prize.benefit}
                                    </p>
                                </div>

                                <div className="p-3 rounded-2xl bg-muted/50 border text-[11px] text-muted-foreground leading-relaxed">
                                    <div className="font-bold text-foreground mb-0.5">📜 兑换规则：</div>
                                    <p>{inspectingPrize.prize.rule}</p>
                                </div>
                            </div>

                            {/* 家长兑现操作区 */}
                            <div className="pt-2 space-y-2">
                                {inspectingPrize.recordId && (
                                    <Button
                                        onClick={() => {
                                            if (inspectingPrize.recordId) {
                                                toggleLotteryRedeem(inspectingPrize.recordId);
                                                setInspectingPrize({
                                                    ...inspectingPrize,
                                                    redeemed: !inspectingPrize.redeemed,
                                                });
                                            }
                                        }}
                                        className={`w-full font-black text-xs h-10 rounded-2xl shadow cursor-pointer ${
                                            inspectingPrize.redeemed
                                                ? "bg-muted text-muted-foreground hover:bg-muted/80"
                                                : "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white"
                                        }`}
                                    >
                                        {inspectingPrize.redeemed ? "已兑现（点击可重置为待兑现）" : "👨‍👩‍👧 家长确认帮孩子兑现 🎁"}
                                    </Button>
                                )}

                                <Button
                                    variant="outline"
                                    onClick={() => setInspectingPrize(null)}
                                    className="w-full text-xs h-9 rounded-2xl cursor-pointer"
                                >
                                    收起卡片
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* 中奖揭晓庆贺弹窗 */}
            <Dialog open={showRewardModal} onOpenChange={setShowRewardModal}>
                <DialogContent aria-describedby={undefined} className="max-w-md sm:rounded-3xl p-6 text-center space-y-4 border-4 border-amber-400 shadow-2xl bg-gradient-to-b from-amber-100/60 via-background to-background">
                    {/* 无障碍标题：Radix 要求每个弹窗都有 DialogTitle，缺失时会 console.error（即开发模式左下角的错误角标） */}
                    <DialogTitle className="sr-only">{wonPrize?.id === BLANK_SEGMENT.id ? '谢谢惠顾' : wonPrize?.name ? `抽中：${wonPrize.name}` : '抽奖结果'}</DialogTitle>
                    {wonPrize?.id === BLANK_SEGMENT.id ? (
                        <div className="space-y-2 py-4">
                            <div className="text-5xl" aria-hidden>🍀</div>
                            <h3 className="text-2xl font-black text-foreground">谢谢惠顾</h3>
                            <p className="text-sm text-muted-foreground">这次没有抽中心愿卡，继续闯关攒抽奖机会吧！</p>
                        </div>
                    ) : (
                        <>
                        {/* 巨幅高清心愿卡插画展台 */}
                        <div className="relative mx-auto w-36 h-36 rounded-3xl overflow-hidden shadow-2xl border-4 border-amber-300 bg-gradient-to-b from-amber-100 to-white p-3 flex items-center justify-center animate-bounce">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={wonPrize ? wonPrize.image : "/prizes/gift.svg"}
                                alt={wonPrize?.name}
                                className="w-full h-full object-contain drop-shadow"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Badge className="bg-gradient-to-r from-orange-500 to-amber-500 text-white font-black text-xs px-3 py-1 shadow-sm">
                                🎊 恭喜抽中心愿大奖！
                            </Badge>
                            <h3 className="text-2xl font-black text-foreground pt-1 tracking-tight">
                                {wonPrize?.name}
                            </h3>
                            <div className="p-3 rounded-2xl bg-orange-500/10 border border-orange-300 text-xs font-bold text-orange-950 dark:text-orange-200 leading-relaxed text-left mx-2">
                                🎁 <strong>特权内容</strong>：{wonPrize?.benefit}
                            </div>
                        </div>

                        <div className="p-3 bg-muted/40 rounded-2xl text-xs text-muted-foreground">
                            已存入你的<strong>「我的心愿卡包」</strong>，随时可以向爸爸妈妈出示卡片进行真实兑现！
                        </div>
                        </>
                    )}

                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowRewardModal(false);
                            }}
                            className="flex-1 text-xs h-10 rounded-2xl font-bold cursor-pointer"
                        >
                            继续抽奖 🎡
                        </Button>
                        <Button
                            onClick={() => {
                                setShowRewardModal(false);
                                setActiveTab("history");
                            }}
                            className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-black text-xs h-10 rounded-2xl shadow cursor-pointer"
                        >
                            查看我的心愿卡包 ❯
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}
