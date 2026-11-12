"use client";

import React, { useState, useEffect } from "react";
import {
    PetState,
    getPetState,
    feedPet,
    getPetDialog,
} from "@/lib/pet-system";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Heart, Trophy, Cookie, Fish, X, Flame, Gift } from "lucide-react";
import { PetLotteryDialog } from "./pet-lottery-dialog";

export function PetWidget() {
    const [pet, setPet] = useState<PetState | null>(null);
    const [dialogText, setDialogText] = useState("");
    const [showBubble, setShowBubble] = useState(false);
    const [isBouncing, setIsBouncing] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [feedFeedback, setFeedFeedback] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isLotteryOpen, setIsLotteryOpen] = useState(false);

    useEffect(() => {
        setPet(getPetState());

        const handleUpdate = (e: any) => {
            if (e.detail) {
                setPet(e.detail);
            }
        };

        window.addEventListener("pet_state_changed", handleUpdate);

        const handleOpenLottery = () => {
            setIsLotteryOpen(true);
        };
        window.addEventListener("open_pet_lottery", handleOpenLottery);

        return () => {
            window.removeEventListener("pet_state_changed", handleUpdate);
            window.removeEventListener("open_pet_lottery", handleOpenLottery);
        };
    }, []);

    // 随机蹦出鼓励台词
    const handlePetClick = () => {
        if (!pet) return;
        setIsBouncing(true);
        setTimeout(() => setIsBouncing(false), 500);

        setDialogText(getPetDialog(pet));
        setShowBubble(true);
        setTimeout(() => setShowBubble(false), 4500);
    };

    const handleFeed = (type: "fishCan" | "energyFruit") => {
        const res = feedPet(type);
        setFeedFeedback(res.message);
        setTimeout(() => setFeedFeedback(null), 3000);
    };

    if (!pet) return null;

    const expPercent = Math.min(100, Math.round((pet.currentExp / pet.maxExp) * 100));

    return (
        <>
            {/* 常驻桌面右下角的伴学宠物悬浮岛 */}
            <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end select-none">
                {/* 宠物气泡对白 */}
                {showBubble && !isCollapsed && (
                    <div className="mb-2 max-w-[240px] bg-white dark:bg-slate-900 border-2 border-primary/40 rounded-2xl p-3 shadow-2xl text-xs leading-relaxed text-foreground animate-in fade-in slide-in-from-bottom-2">
                        <div className="font-bold text-primary mb-1 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                                <span>{pet.name}</span>
                                <Sparkles className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                            </span>
                            <span className="text-[10px] text-muted-foreground font-normal">点击小猫对话</span>
                        </div>
                        <p className="font-medium text-slate-800 dark:text-slate-200">{dialogText}</p>
                    </div>
                )}

                {/* 宠物卡片本体（大尺寸，精致立绘） */}
                {!isCollapsed ? (
                    <div className="relative group">
                        {/* 顶部最小化小按钮 */}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsCollapsed(true);
                            }}
                            className="absolute -top-2.5 -left-2.5 z-10 w-6 h-6 rounded-full bg-muted border text-muted-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-white shadow"
                            title="最小化伴学宠物"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>

                        <div
                            onClick={handlePetClick}
                            className={`flex items-center gap-3.5 bg-gradient-to-br from-amber-50 via-orange-50 to-orange-100/60 dark:from-slate-900 dark:via-slate-800 dark:to-slate-800 border-2 border-orange-300 dark:border-orange-800/80 rounded-3xl p-3.5 shadow-xl hover:shadow-2xl transition-all cursor-pointer ${
                                isBouncing ? "scale-105 -translate-y-1.5" : "hover:-translate-y-1"
                            }`}
                        >
                            {/* 大尺寸矢量小猫形象 */}
                            <div className="relative w-20 h-20 flex-shrink-0">
                                <svg
                                    viewBox="0 0 100 100"
                                    className="w-full h-full drop-shadow-md transition-transform group-hover:scale-105"
                                >
                                    {/* 耳朵 */}
                                    <polygon points="18,42 8,10 40,24" fill="#f97316" />
                                    <polygon points="22,38 14,16 38,25" fill="#fed7aa" />
                                    <polygon points="82,42 92,10 60,24" fill="#f97316" />
                                    <polygon points="78,38 86,16 62,25" fill="#fed7aa" />

                                    {/* 脸部轮廓 */}
                                    <ellipse cx="50" cy="56" rx="40" ry="35" fill="#fb923c" />
                                    <ellipse cx="50" cy="63" rx="28" ry="23" fill="#fff7ed" />

                                    {/* 腮红 */}
                                    <circle cx="26" cy="65" r="5.5" fill="#f43f5e" opacity="0.45" />
                                    <circle cx="74" cy="65" r="5.5" fill="#f43f5e" opacity="0.45" />

                                    {/* 灵动大眼睛 */}
                                    <ellipse cx="35" cy="53" rx="5" ry="7" fill="#1e293b" />
                                    <circle cx="37" cy="51" r="2.2" fill="#ffffff" />
                                    <circle cx="33" cy="55" r="1.2" fill="#ffffff" />

                                    <ellipse cx="65" cy="53" rx="5" ry="7" fill="#1e293b" />
                                    <circle cx="67" cy="51" r="2.2" fill="#ffffff" />
                                    <circle cx="63" cy="55" r="1.2" fill="#ffffff" />

                                    {/* 胡须 */}
                                    <line x1="14" y1="62" x2="25" y2="64" stroke="#fed7aa" strokeWidth="1.8" strokeLinecap="round" />
                                    <line x1="12" y1="68" x2="25" y2="68" stroke="#fed7aa" strokeWidth="1.8" strokeLinecap="round" />
                                    <line x1="75" y1="64" x2="86" y2="62" stroke="#fed7aa" strokeWidth="1.8" strokeLinecap="round" />
                                    <line x1="75" y1="68" x2="88" y2="68" stroke="#fed7aa" strokeWidth="1.8" strokeLinecap="round" />

                                    {/* 小巧鼻子和小猫嘴巴 */}
                                    <polygon points="50,61 47,58 53,58" fill="#f43f5e" />
                                    <path
                                        d="M45,64 Q50,69 55,64"
                                        stroke="#1e293b"
                                        strokeWidth="2.2"
                                        fill="none"
                                        strokeLinecap="round"
                                    />

                                    {/* 乖巧前爪爪 */}
                                    <ellipse cx="40" cy="85" rx="6" ry="4.5" fill="#fed7aa" />
                                    <ellipse cx="60" cy="85" rx="6" ry="4.5" fill="#fed7aa" />

                                    {/* 博士小萌帽（Lv.2+ 荣耀穿戴） */}
                                    {pet.level >= 2 && (
                                        <g>
                                            <polygon points="50,11 24,22 50,33 76,22" fill="#2563eb" />
                                            <line
                                                x1="50"
                                                y1="22"
                                                x2="72"
                                                y2="34"
                                                stroke="#f59e0b"
                                                strokeWidth="2.5"
                                            />
                                            <circle cx="72" cy="34" r="2.8" fill="#f59e0b" />
                                        </g>
                                    )}
                                </svg>

                                {/* 等级 Badge（默认从 Lv.0 开始） */}
                                <span className="absolute -bottom-1 -right-1 bg-gradient-to-r from-orange-600 to-amber-600 text-white text-[11px] font-black px-2 py-0.5 rounded-full shadow border-2 border-white">
                                    Lv.{pet.level}
                                </span>
                            </div>

                            {/* 宠物状态与小信息 */}
                            <div className="flex flex-col justify-center gap-1.5 min-w-[135px]">
                                <div className="flex items-center justify-between gap-1.5">
                                    <span className="text-sm font-black text-foreground tracking-tight">{pet.name}</span>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsDrawerOpen(true);
                                        }}
                                        className="text-xs text-orange-600 dark:text-orange-400 font-bold hover:underline bg-orange-100/70 dark:bg-orange-950/60 px-2 py-0.5 rounded-md"
                                    >
                                        伴学屋 ❯
                                    </button>
                                </div>

                                <div className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold truncate max-w-[135px]">
                                    {pet.currentTitle}
                                </div>

                                {/* 经验条 */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                                        <span>成长度</span>
                                        <span>
                                            {pet.currentExp}/{pet.maxExp}
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden p-0.5">
                                        <div
                                            className="bg-gradient-to-r from-amber-500 to-orange-500 h-full rounded-full transition-all duration-300"
                                            style={{ width: `${expPercent}%` }}
                                        />
                                    </div>
                                </div>

                                {/* 升级抽奖入口胶囊按钮 */}
                                {pet.lotteryTickets > 0 ? (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsLotteryOpen(true);
                                        }}
                                        className="mt-0.5 flex items-center justify-center gap-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg py-1 px-2 text-[11px] font-extrabold shadow animate-bounce cursor-pointer"
                                    >
                                        <Gift className="w-3.5 h-3.5 fill-white" />
                                        <span>心愿抽奖 x {pet.lotteryTickets} 次!</span>
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsLotteryOpen(true);
                                        }}
                                        className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-orange-600 hover:underline"
                                    >
                                        <Gift className="w-3 h-3" />
                                        <span>升级抽心愿大奖 ❯</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* 折叠后的大号浮球，显示算算喵小头像 */
                    <button
                        type="button"
                        onClick={() => setIsCollapsed(false)}
                        className="w-14 h-14 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 text-white shadow-2xl flex items-center justify-center hover:scale-110 transition-transform cursor-pointer border-3 border-white p-2"
                        title="唤出伴学宠物"
                    >
                        <div className="relative w-full h-full">
                            <svg viewBox="0 0 100 100" className="w-full h-full">
                                <polygon points="20,40 10,12 40,25" fill="#f97316" />
                                <polygon points="80,40 90,12 60,25" fill="#f97316" />
                                <ellipse cx="50" cy="55" rx="38" ry="34" fill="#fb923c" />
                                <ellipse cx="50" cy="62" rx="26" ry="22" fill="#fff7ed" />
                                <ellipse cx="36" cy="52" rx="4.5" ry="6.5" fill="#1e293b" />
                                <circle cx="38" cy="50" r="2" fill="#ffffff" />
                                <ellipse cx="64" cy="52" rx="4.5" ry="6.5" fill="#1e293b" />
                                <circle cx="66" cy="50" r="2" fill="#ffffff" />
                                <polygon points="50,60 47,57 53,57" fill="#f43f5e" />
                            </svg>
                            {pet.lotteryTickets > 0 ? (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border border-white text-[9px] font-bold flex items-center justify-center text-white">
                                    {pet.lotteryTickets}
                                </span>
                            ) : null}
                        </div>
                    </button>
                )}
            </div>

            {/* 伴学小窝弹窗 (Pet House Dialog) */}
            <Dialog open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                <DialogContent className="max-w-md sm:rounded-3xl p-6">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-lg">
                                <span>🐾 {pet.name}的伴学小窝</span>
                                <Badge variant="secondary" className="text-xs font-bold text-amber-700 bg-amber-100">
                                    {pet.currentTitle}
                                </Badge>
                            </span>
                        </DialogTitle>
                    </DialogHeader>

                    {feedFeedback && (
                        <div className="p-3 rounded-xl bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-200 text-xs font-bold animate-in fade-in">
                            {feedFeedback}
                        </div>
                    )}

                    <div className="space-y-4 pt-2">
                        {/* 宠物立绘与主要指标 */}
                        <div className="flex items-center gap-5 p-4 rounded-2xl bg-gradient-to-br from-amber-50/80 via-orange-50 to-orange-100/50 dark:from-slate-900 dark:to-slate-800 border-2 border-orange-200 dark:border-orange-900/50">
                            <div className="w-28 h-28 flex-shrink-0 animate-bounce duration-1000">
                                <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
                                    <polygon points="18,42 8,10 40,24" fill="#f97316" />
                                    <polygon points="22,38 14,16 38,25" fill="#fed7aa" />
                                    <polygon points="82,42 92,10 60,24" fill="#f97316" />
                                    <polygon points="78,38 86,16 62,25" fill="#fed7aa" />
                                    <ellipse cx="50" cy="56" rx="40" ry="35" fill="#fb923c" />
                                    <ellipse cx="50" cy="63" rx="28" ry="23" fill="#fff7ed" />
                                    <circle cx="26" cy="65" r="5.5" fill="#f43f5e" opacity="0.45" />
                                    <circle cx="74" cy="65" r="5.5" fill="#f43f5e" opacity="0.45" />
                                    <ellipse cx="35" cy="53" rx="5" ry="7" fill="#1e293b" />
                                    <circle cx="37" cy="51" r="2.2" fill="#ffffff" />
                                    <circle cx="33" cy="55" r="1.2" fill="#ffffff" />
                                    <ellipse cx="65" cy="53" rx="5" ry="7" fill="#1e293b" />
                                    <circle cx="67" cy="51" r="2.2" fill="#ffffff" />
                                    <circle cx="63" cy="55" r="1.2" fill="#ffffff" />
                                    <polygon points="50,61 47,58 53,58" fill="#f43f5e" />
                                    <path
                                        d="M45,64 Q50,69 55,64"
                                        stroke="#1e293b"
                                        strokeWidth="2.2"
                                        fill="none"
                                        strokeLinecap="round"
                                    />
                                    <ellipse cx="40" cy="85" rx="6" ry="4.5" fill="#fed7aa" />
                                    <ellipse cx="60" cy="85" rx="6" ry="4.5" fill="#fed7aa" />
                                    {pet.level >= 2 && (
                                        <g>
                                            <polygon points="50,11 24,22 50,33 76,22" fill="#2563eb" />
                                            <line
                                                x1="50"
                                                y1="22"
                                                x2="72"
                                                y2="34"
                                                stroke="#f59e0b"
                                                strokeWidth="2.5"
                                            />
                                            <circle cx="72" cy="34" r="2.8" fill="#f59e0b" />
                                        </g>
                                    )}
                                </svg>
                            </div>

                            <div className="flex-1 space-y-2 text-sm">
                                <div className="flex justify-between items-center">
                                    <span className="font-extrabold text-base text-foreground">
                                        Lv.{pet.level} 成长中
                                    </span>
                                    <span className="text-xs text-muted-foreground font-semibold">
                                        经验 {pet.currentExp} / {pet.maxExp}
                                    </span>
                                </div>
                                <Progress value={expPercent} className="h-2.5" />

                                <div className="grid grid-cols-2 gap-2 pt-1 text-xs text-muted-foreground font-medium">
                                    <div>饱食度: {pet.hunger}/100</div>
                                    <div>心情值: {pet.mood}/100</div>
                                    <div>消灭错题: {pet.conqueredErrors} 道</div>
                                    <div>攻克高难变式: {pet.hardChallengesWon} 道</div>
                                </div>
                            </div>
                        </div>

                        {/* 升级心愿大抽奖卡片 */}
                        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-rose-500/10 border-2 border-amber-400/40 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2.5 rounded-xl bg-amber-500 text-white shadow-md">
                                    <Gift className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-extrabold text-xs text-foreground flex items-center gap-1.5">
                                        <span>升级心愿大抽奖</span>
                                        <Badge className="text-[10px] bg-amber-500 text-white font-black px-1.5 py-0">
                                            剩余 {pet.lotteryTickets} 次
                                        </Badge>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                        每升1级可抽零食、大餐、特权卡
                                    </div>
                                </div>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => {
                                    setIsDrawerOpen(false);
                                    setIsLotteryOpen(true);
                                }}
                                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-8 px-3 shadow"
                            >
                                去抽心愿 ❯
                            </Button>
                        </div>

                        {/* 宠物互动投喂区 */}
                        <div className="space-y-2.5">
                            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                投喂零食（做对变式题即可获取）
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                                {/* 智慧小鱼干 */}
                                <div className="border rounded-2xl p-3.5 flex flex-col justify-between space-y-2.5 bg-card shadow-sm">
                                    <div className="flex items-center gap-2.5">
                                        <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600">
                                            <Fish className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold">智慧小鱼干</div>
                                            <div className="text-[11px] text-muted-foreground">
                                                库存: {pet.inventory.fishCan} 包
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={pet.inventory.fishCan <= 0}
                                        onClick={() => handleFeed("fishCan")}
                                        className="w-full text-xs h-8 font-semibold"
                                    >
                                        喂食 (+10 EXP)
                                    </Button>
                                </div>

                                {/* 金色能量果 */}
                                <div className="border rounded-2xl p-3.5 flex flex-col justify-between space-y-2.5 bg-card shadow-sm">
                                    <div className="flex items-center gap-2.5">
                                        <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-600">
                                            <Sparkles className="h-5 w-5 fill-amber-500" />
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold">金色能量果</div>
                                            <div className="text-[11px] text-muted-foreground">
                                                库存: {pet.inventory.energyFruit} 颗
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="default"
                                        disabled={pet.inventory.energyFruit <= 0}
                                        onClick={() => handleFeed("energyFruit")}
                                        className="w-full text-xs h-8 bg-amber-600 hover:bg-amber-700 text-white font-bold"
                                    >
                                        喂食 (+25 EXP)
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* 赚取口粮提示 */}
                        <div className="rounded-2xl border border-dashed p-3.5 bg-muted/20 text-xs space-y-1.5 text-muted-foreground leading-relaxed">
                            <div className="font-bold text-foreground flex items-center gap-1.5">
                                <Flame className="h-4 w-4 text-orange-500" />
                                <span>如何让 {pet.name} 快速升级？</span>
                            </div>
                            <p>• 类似题型：获得 1 包智慧小鱼干 + 15 经验值</p>
                            <p>• 困难变式：获得 2 颗金色能量果 + 35 经验值</p>
                            <p>• 挑战压轴：获得 3 颗金色能量果 + 60 经验值！</p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 心愿大转盘抽奖弹窗 */}
            <PetLotteryDialog
                isOpen={isLotteryOpen}
                onClose={() => setIsLotteryOpen(false)}
            />
        </>
    );
}
