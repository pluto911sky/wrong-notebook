/**
 * 伴学电子宠物系统 (Study Pet Companion System)
 * 专为中小学生错题复习设计：把无聊枯燥的错题订正，变成“打怪升级喂宠物 + 升级抽取愿望大奖”的沉浸式养成游戏。
 */

export type PetType = "cat" | "fox" | "dragon";

export interface LotteryRecord {
    id: string;
    prizeName: string;
    time: string;
    redeemed: boolean; // 是否已兑现（家长点击核销）
}

export interface PetState {
    name: string;
    type: PetType;
    level: number; // 默认 0 级
    currentExp: number;
    maxExp: number; // 0级升到1级经验
    hunger: number; // 饱食度 0~100
    mood: number; // 心情 0~100
    conqueredErrors: number; // 累计消灭错题数
    hardChallengesWon: number; // 攻克困难/挑战变式题数
    inventory: {
        fishCan: number; // 智慧小鱼干（答对类似题型获得）
        energyFruit: number; // 金色能量果（攻克困难/挑战变式题获得）
    };
    unlockedTitles: string[];
    currentTitle: string;
    lotteryTickets: number; // 剩余抽奖次数（每升一级 +1 次）
    lotteryHistory: LotteryRecord[]; // 中奖愿望卡包历史
    lastActiveDate: string;
}

const STORAGE_KEY = "wrong_notebook_study_pet_v2";

const DEFAULT_PET: PetState = {
    name: "算算喵",
    type: "cat",
    level: 0, // 默认 0 级起步！
    currentExp: 0,
    maxExp: 40, // 0级升到1级只需 40 经验（做对1道困难变式题即可升级并体验首次抽奖！）
    hunger: 60,
    mood: 80,
    conqueredErrors: 0,
    hardChallengesWon: 0,
    inventory: {
        fishCan: 1,
        energyFruit: 0,
    },
    unlockedTitles: ["算术见习小幼喵"],
    currentTitle: "算术见习小幼喵",
    lotteryTickets: 0,
    lotteryHistory: [],
    lastActiveDate: new Date().toISOString().slice(0, 10),
};

export function getPetState(): PetState {
    if (typeof window === "undefined") return DEFAULT_PET;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_PET, ...parsed };
        }
    } catch (e) {
        console.warn("Failed to load pet state:", e);
    }
    return DEFAULT_PET;
}

export function savePetState(state: PetState): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        window.dispatchEvent(new CustomEvent("pet_state_changed", { detail: state }));
    } catch (e) {
        console.warn("Failed to save pet state:", e);
    }
}

/**
 * 经验值结算与升级逻辑：每升一级，奖励 1 次心愿抽奖！
 */
export function addExpToPet(
    state: PetState,
    expGained: number
): { state: PetState; leveledUp: boolean; newTickets: number; newLevel: number } {
    let nextExp = state.currentExp + expGained;
    let nextLevel = state.level;
    let maxExp = state.maxExp;
    let leveledUp = false;
    let newTickets = 0;

    while (nextExp >= maxExp) {
        nextExp -= maxExp;
        nextLevel += 1;
        newTickets += 1; // 每升一级奖励 1 次抽奖机会！
        maxExp = Math.round(50 * Math.pow(1.22, nextLevel));
        leveledUp = true;
    }

    // 达成特定等级解锁新称号
    const titles = [...state.unlockedTitles];
    if (nextLevel >= 1 && !titles.includes("粗心克星小萌新")) {
        titles.push("粗心克星小萌新");
    }
    if (nextLevel >= 3 && !titles.includes("四则运算小巧匠")) {
        titles.push("四则运算小巧匠");
    }
    if (nextLevel >= 6 && !titles.includes("几何空间大探长")) {
        titles.push("几何空间大探长");
    }
    if (nextLevel >= 10 && !titles.includes("奥数挑战小宗师")) {
        titles.push("奥数挑战小宗师");
    }

    const updated: PetState = {
        ...state,
        level: nextLevel,
        currentExp: nextExp,
        maxExp,
        lotteryTickets: (state.lotteryTickets || 0) + newTickets,
        unlockedTitles: titles,
        currentTitle: titles[titles.length - 1],
    };

    return { state: updated, leveledUp, newTickets, newLevel: nextLevel };
}

/**
 * 孩子完成并做对一道变式题时调用：奖励经验与食物，触发升级与抽奖券发放
 */
export function recordPetPracticeSuccess(difficulty: string): {
    exp: number;
    fish: number;
    leveledUp: boolean;
    newLevel: number;
    newTickets: number;
    lotteryTickets: number;
} {
    const current = getPetState();
    let expGained = 15;
    let fruitGained = 1;

    if (difficulty === "hard") {
        expGained = 35; // 0级只需 40 经验，做对一道即可接近升级
        fruitGained = 2;
    } else if (difficulty === "harder") {
        expGained = 60; // 做对一道挑战压轴直接连升！
        fruitGained = 3;
    }

    const { state: updatedState, leveledUp, newTickets, newLevel } = addExpToPet(current, expGained);
    const finalState: PetState = {
        ...updatedState,
        hunger: Math.min(100, updatedState.hunger + 10),
        mood: Math.min(100, updatedState.mood + 15),
        hardChallengesWon:
            difficulty === "hard" || difficulty === "harder"
                ? updatedState.hardChallengesWon + 1
                : updatedState.hardChallengesWon,
        inventory: {
            ...updatedState.inventory,
            energyFruit: updatedState.inventory.energyFruit + fruitGained,
        },
    };

    savePetState(finalState);
    return {
        exp: expGained,
        fish: fruitGained,
        leveledUp,
        newLevel,
        newTickets,
        lotteryTickets: finalState.lotteryTickets,
    };
}

/**
 * 孩子复习或标记错题已掌握时调用
 */
export function recordPetErrorReviewed(): { leveledUp: boolean; newLevel: number; newTickets: number } {
    const current = getPetState();
    const { state: updatedState, leveledUp, newTickets, newLevel } = addExpToPet(current, 20);
    const finalState: PetState = {
        ...updatedState,
        conqueredErrors: updatedState.conqueredErrors + 1,
        hunger: Math.min(100, updatedState.hunger + 5),
        mood: Math.min(100, updatedState.mood + 10),
        inventory: {
            ...updatedState.inventory,
            fishCan: updatedState.inventory.fishCan + 1,
        },
    };
    savePetState(finalState);
    return { leveledUp, newLevel, newTickets };
}

/**
 * 消耗 1 次抽奖机会，并将中奖愿望存入历史记录
 */
export function consumeLotteryTicket(prizeName: string): boolean {
    const current = getPetState();
    if (current.lotteryTickets <= 0) return false;

    const newRecord: LotteryRecord = {
        id: "draw_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        prizeName,
        time: new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        redeemed: false,
    };

    const updated: PetState = {
        ...current,
        lotteryTickets: Math.max(0, current.lotteryTickets - 1),
        lotteryHistory: [newRecord, ...current.lotteryHistory],
    };

    savePetState(updated);
    return true;
}

/**
 * 家长核销兑现愿望卡（点击切换兑换状态）
 */
export function toggleLotteryRedeem(recordId: string): void {
    const current = getPetState();
    const updatedHistory = current.lotteryHistory.map((item) => {
        if (item.id === recordId) {
            return { ...item, redeemed: !item.redeemed };
        }
        return item;
    });

    savePetState({
        ...current,
        lotteryHistory: updatedHistory,
    });
}

/**
 * 喂食宠物
 */
export function feedPet(foodType: "fishCan" | "energyFruit"): { success: boolean; message: string } {
    const current = getPetState();
    if (current.inventory[foodType] <= 0) {
        return { success: false, message: "该零食库存不足，快去攻克错题或挑战变式题赚取吧！" };
    }

    const expGained = foodType === "energyFruit" ? 25 : 10;
    const hungerGain = foodType === "energyFruit" ? 30 : 15;
    const moodGain = foodType === "energyFruit" ? 25 : 10;

    const { state: updatedState } = addExpToPet(current, expGained);
    const finalState: PetState = {
        ...updatedState,
        hunger: Math.min(100, updatedState.hunger + hungerGain),
        mood: Math.min(100, updatedState.mood + moodGain),
        inventory: {
            ...updatedState.inventory,
            [foodType]: updatedState.inventory[foodType] - 1,
        },
    };

    savePetState(finalState);
    return {
        success: true,
        message:
            foodType === "energyFruit"
                ? "🌟 算算喵吃了金色能量果，力量充沛！经验 +25！"
                : "🐟 算算喵津津有味地吃掉了小鱼干，饱食度上升！经验 +10！",
    };
}

/**
 * 随机获取宠物对孩子说的温暖/打气语录
 */
export function getPetDialog(pet: PetState): string {
    if (pet.lotteryTickets > 0) {
        return `哇！主人你有 ${pet.lotteryTickets} 次升级抽奖机会，快去心愿转盘抽大奖吧！`;
    }
    const dialogs = [
        `主人，今天你已经攻克了 ${pet.conqueredErrors} 道错题，继续加油鸭！`,
        "遇到难题先别急，我们先看「简单解析」，再动笔推导一遍！",
        "只要把错题的原因找出来，考试就不会再踩坑啦！",
        "我想吃金色能量果~ 去做一道【困难变式】挑战自己，升到下一级就能抽大奖啦！",
        "错题不可怕，消灭它我就能升级啦，喵呜~",
        "摸摸头！细心一点，今天的数学题目难不倒你！",
    ];
    return dialogs[Math.floor(Math.random() * dialogs.length)];
}
