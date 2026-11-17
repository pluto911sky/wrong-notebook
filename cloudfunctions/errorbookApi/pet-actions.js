"use strict";

const { randomInt } = require("node:crypto");

const PET_NAMES = { cat: "算算喵", fox: "智多狐", dragon: "逻辑龙", owl: "星夜鸮", bunny: "棉花兔" };

function applyExperience(pet, amount) {
  let exp = pet.currentExp + amount;
  let { level, maxExp } = pet;
  while (exp >= maxExp && level < 999) {
    exp -= maxExp;
    level += 1;
    maxExp = Math.min(100000, Math.round(50 * 1.22 ** level));
  }
  const newTickets = level - pet.level;
  Object.assign(pet, {
    level, maxExp, currentExp: Math.min(exp, maxExp - 1),
    lotteryTickets: Math.min(999, pet.lotteryTickets + newTickets),
  });
  return { expGained: amount, leveledUp: newTickets > 0, newLevel: level, newTickets };
}

function preparePet(pet, practiceExperience, now = new Date()) {
  const delta = practiceExperience - pet.practiceExperienceApplied;
  if (delta > 0) {
    applyExperience(pet, delta);
    pet.practiceExperienceApplied = practiceExperience;
  }
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  if (pet.hasChosenPet && pet.type === "owl" && pet.lastDailyBonusDate !== day) {
    pet.fishCan = Math.min(9999, pet.fishCan + 1);
    pet.lastDailyBonusDate = day;
  }
  return pet;
}

function applyPetAction(pet, body, { item, defaults, receiptId, practiceExperience }) {
  switch (body.action) {
    case "adopt": {
      if (!Object.hasOwn(PET_NAMES, body.type)) return { error: "请选择精灵" };
      const defaultName = pet.name === PET_NAMES[pet.type] ? PET_NAMES[body.type] : pet.name;
      Object.assign(pet, { type: body.type, hasChosenPet: true, name: body.name || defaultName });
      return {};
    }
    case "rename":
      if (!body.name) return { error: "请输入精灵昵称" };
      pet.name = body.name;
      return {};
    case "reset":
      Object.assign(pet, defaults, {
        type: pet.type, name: PET_NAMES[pet.type], hasChosenPet: true,
        practiceExperienceApplied: practiceExperience, lastDailyBonusDate: pet.lastDailyBonusDate,
        lotteryTickets: 0, rewardedMasteryIds: pet.rewardedMasteryIds, rewardedCaptureIds: pet.rewardedCaptureIds,
      });
      return {};
    case "feed": {
      const { food } = body;
      if (food !== "fishCan" && food !== "energyFruit") return { error: "请选择零食" };
      if (pet[food] <= 0) return { error: "零食库存不足" };
      const fruit = food === "energyFruit";
      const exp = fruit ? 25 + (pet.type === "dragon" ? 5 : 0) : 10;
      pet[food] -= 1;
      pet.hunger = Math.min(100, pet.hunger + (fruit ? 30 : 15) + (pet.type === "bunny" ? 5 : 0));
      pet.mood = Math.min(100, pet.mood + (fruit ? 25 : 10) +
        (pet.type === "bunny" ? 10 : pet.type === "cat" && !fruit ? 8 : 0));
      return { ...applyExperience(pet, exp), message: `${pet.name} 的经验 +${exp}！` };
    }
    case "capture":
    case "mastery": {
      const mastery = body.action === "mastery";
      const flag = mastery ? "petMasteryRewarded" : "petCaptureRewarded";
      const legacyIds = mastery ? pet.rewardedMasteryIds : pet.rewardedCaptureIds;
      if (item[flag] || legacyIds.includes(body.itemId)) return { alreadyRewarded: true };
      if (mastery && !(item.masteryLevel > 0)) return { error: "请先标记掌握" };
      if (mastery) {
        pet.conqueredErrors += 1;
        pet.fishCan = Math.min(9999, pet.fishCan + 1);
        pet.hunger = Math.min(100, pet.hunger + 6);
      } else {
        pet.capturedErrors += 1;
      }
      pet.mood = Math.min(100, pet.mood + (mastery ? 10 : 5));
      return { ...applyExperience(pet, mastery ? (pet.type === "fox" ? 25 : 20) : 5), flag };
    }
    case "draw": {
      if (!pet.hasChosenPet || pet.lotteryTickets <= 0) return { error: "暂无心愿抽奖券" };
      const roll = randomInt(10);
      const isBlank = roll >= 7;
      pet.lotteryTickets -= 1;
      if (!isBlank) {
        const record = { id: receiptId, prizeId: "p" + (roll + 1), time: new Date().toISOString(), redeemed: false };
        pet.lotteryHistory = [record, ...pet.lotteryHistory].slice(0, 60);
      }
      return { wonIndex: isBlank ? 7 : roll, isBlank };
    }
    case "redeem": {
      const entry = pet.lotteryHistory.find((record) => record?.id === body.recordId);
      if (!entry || typeof body.redeemed !== "boolean") return { error: "找不到心愿卡或核销状态无效" };
      pet.lotteryHistory = pet.lotteryHistory.map((record) => record === entry ? { ...entry, redeemed: body.redeemed } : record);
      return {};
    }
    default:
      return { error: "未知的精灵操作" };
  }
}

module.exports = { preparePet, applyPetAction };
