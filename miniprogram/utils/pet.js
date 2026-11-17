// 伴学宠物精灵系统（小程序端持久化与养成逻辑）
// 5 只性格与特征鲜明的伴学精灵 + 投喂升级 + 心愿抽奖 + 家长核销卡包

const PET_STORAGE_KEY = 'mp.studyPet.v2';

const PET_SPECIES = [
  {
    type: 'cat',
    name: '算算喵',
    tag: '运算小管家',
    emoji: '🐱',
    avatar: '/assets/pets/cat.jpg',
    bgGrad: 'linear-gradient(135deg, #FFFBEB 0%, #FFEDD5 100%)',
    borderColor: '#FED7AA',
    accentColor: '#EA580C',
    accentBg: '#FFF7ED',
    appearance: '圆脸橘白小猫，架着浅蓝圆框眼镜，左耳戴金色小数点耳饰，胸前挂迷你金算盘铃铛；Lv.2 起解锁小博士帽荣耀徽章。',
    personality: '细心敏锐、最讨厌抄错符号与进位马虎，一旦发现粗心苗头就会轻摇算盘铃铛提醒你。',
    traitTitle: '🐟 细心复核加成',
    traitDesc: '投喂「智慧小鱼干」时，心情额外 +8。',
    titles: ['算术见习小幼喵', '粗心克星小萌新', '四则运算小巧匠', '全科满分喵大师'],
    dialogs: [
      '铃铃~ 抄题时先把负号和小数点圈出来，肯定不丢分！',
      '算算喵刚才数了数，你已经累计消灭了好多错题啦，真棒！',
      '给我吃条智慧小鱼干吧~ 吃完陪你再核对一遍计算过程！',
      '粗心不是坏毛病，只是还没养成“顺手验算”的小习惯哦~',
    ],
  },
  {
    type: 'fox',
    name: '智多狐',
    tag: '审题大侦探',
    emoji: '🦊',
    avatar: '/assets/pets/fox.jpg',
    bgGrad: 'linear-gradient(135deg, #FFF7ED 0%, #FEF3C7 100%)',
    borderColor: '#FDE68A',
    accentColor: '#D97706',
    accentBg: '#FFFBEB',
    appearance: '拥有灵动大耳朵的赤琥珀小狐，脖间系薄荷绿小披肩，蓬松雪白尾尖别着迷你羽毛笔。',
    personality: '鬼灵精怪、观察力超群，最擅长一眼抓出题干里的「隐藏条件」与设坑陷阱。',
    traitTitle: '🔍 洞察陷阱加成',
    traitDesc: '每次在错题详情标记「已掌握」时，额外获得 +5 经验值。',
    titles: ['审题灵狐小侦探', '陷阱识破小机灵', '举一反三小军师', '思路开挂九尾狐'],
    dialogs: [
      '嘘——仔细读最后一句话！出题人是不是偷偷换了单位？',
      '一道题不会没关系，能找到题眼，下次整类题都能秒杀！',
      '羽毛笔记下来啦：遇到这种条件，先画草图最清楚！',
      '每攻克一道错题我都能多涨 5 点侦探经验哦，快去刷题吧~',
    ],
  },
  {
    type: 'dragon',
    name: '逻辑龙',
    tag: '压轴破壁龙',
    emoji: '🐲',
    avatar: '/assets/pets/dragon.jpg',
    bgGrad: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
    borderColor: '#A7F3D0',
    accentColor: '#059669',
    accentBg: '#ECFDF5',
    appearance: '圆润薄荷翡翠小飞龙，头顶一对暖金色龙角，肚皮印着几何三角星纹，尾尖燃着蓝色思维火花。',
    personality: '沉稳执着、不服输，越是复杂的几何证明和大题压轴就越兴奋。',
    traitTitle: '✨ 硬核攻坚加成',
    traitDesc: '投喂「金色能量果」时，额外获得 +5 经验值（单颗 +30 EXP）。',
    titles: ['龙蛋孵化小勇士', '几何推演小骑士', '逻辑链条领航员', '奥数压轴破壁龙'],
    dialogs: [
      '嗷呜！大题其实不可怕，把它拆成 3 个小步骤逐个击破就行！',
      '金色能量果里满是思维火花，吃一颗我就感觉能推导十道压轴题！',
      '卡住的时候别硬想，先看已知条件能推导出哪两个新结论。',
      '坚持把薄弱点啃下来，你比昨天更强一点点啦！',
    ],
  },
  {
    type: 'owl',
    name: '星夜鸮',
    tag: '复盘博学者',
    emoji: '🦉',
    avatar: '/assets/pets/owl.jpg',
    bgGrad: 'linear-gradient(135deg, #EFF6FF 0%, #E0E7FF 100%)',
    borderColor: '#BFDBFE',
    accentColor: '#2563EB',
    accentBg: '#EFF6FF',
    appearance: '靛蓝羽毛奶油肚皮的夜读小猫头鹰，头顶金色月牙耳羽，左眼戴单片金色放大镜，爪捧牛皮错题手账。',
    personality: '沉静博学、过目不忘，最擅长在考前把零散错题归纳成知识规律。',
    traitTitle: '📖 每日复盘礼遇',
    traitDesc: '每日首次进入小窝自动赠送「🐟 智慧小鱼干 ×1」补给。',
    titles: ['星光夜读小雏鸮', '规律整理记事官', '知识图谱守护者', '博闻强识大贤鸮'],
    dialogs: [
      '咕咕~ 我把今天的小鱼干补给放在口袋里了，考前翻一翻错题本最管用！',
      '别只背答案，用我放大镜看清“当初为什么会想歪”才是真掌握。',
      '每天攻克 2 道旧错题，一个学期就能甩开粗心一大截。',
      '星夜陪你一起把每一块知识盲区都点亮~',
    ],
  },
  {
    type: 'bunny',
    name: '棉花兔',
    tag: '治愈打气官',
    emoji: '🐰',
    avatar: '/assets/pets/bunny.jpg',
    bgGrad: 'linear-gradient(135deg, #FDF2F8 0%, #FCE7F3 100%)',
    borderColor: '#FBCFE8',
    accentColor: '#DB2777',
    accentBg: '#FDF2F8',
    appearance: '长垂耳软云白兔，右耳别着幸运四叶草发卡，粉扑扑腮红，怀里抱着胡萝卜造型荧光记号笔。',
    personality: '温柔治愈、共情力满分，孩子卡壳疲惫时总能用软萌鼓励帮他稳住心态。',
    traitTitle: '🍀 元气治愈加成',
    traitDesc: '每次投喂任意零食，心情额外 +10、饱食度额外 +5。',
    titles: ['软萌打气小云兔', '稳心态小甜心', '耐心刷题小能手', '元气满满守护兔'],
    dialogs: [
      '摸摸耳朵别灰心呀，错题本记下来，说明你又提前排掉一颗考试地雷！',
      '深呼吸一口气，我们先把最容易看懂的那一步解决掉~',
      '幸运四叶草保佑你，今天看过的解题思路考试全都稳稳拿下！',
      '累了就来戳戳棉花兔，充好电再继续出发吧！',
    ],
  },
];

const PRIZE_CATALOG = [
  {
    id: 'p1',
    name: '🍦 自选美味零食券',
    shortTitle: '美味零食券',
    icon: '🍦',
    color: '#FFF7ED',
    benefit: '由爸爸妈妈买单，自主挑选一份冰淇淋、奶茶或喜欢的小零食！',
    rule: '向家长出示本卡，买完零食后由家长点击核销兑现。',
  },
  {
    id: 'p2',
    name: '🍔 豪华大餐任选卡',
    shortTitle: '豪华大餐卡',
    icon: '🍔',
    color: '#FEF3C7',
    benefit: '周末由你全权指定全家吃什么（汉堡披萨、火锅或烤肉）！',
    rule: '提前一天与家长约定餐厅，周末无条件兑现。',
  },
  {
    id: 'p3',
    name: '💰 自由零花钱基金',
    shortTitle: '零花钱基金',
    icon: '💰',
    color: '#ECFDF5',
    benefit: '获得 20 元自由支配零花钱现金或红包，购买喜欢的小物件！',
    rule: '由家长直接发放给孩子自由支配，核销后完成记录。',
  },
  {
    id: 'p4',
    name: '👑 霸气愿望特权卡',
    shortTitle: '愿望特权卡',
    icon: '👑',
    color: '#F5F3FF',
    benefit: '家长无条件答应一个安全合理的小要求（如晚睡半小时等）！',
    rule: '提出安全合理的愿望后，由家长配合兑现并点击核销。',
  },
  {
    id: 'p5',
    name: '🎁 心愿礼物兑换券',
    shortTitle: '心愿礼物券',
    icon: '🎁',
    color: '#FDF2F8',
    benefit: '挑选一个 50 元以内心仪已久的文具、盲盒或拼装积木！',
    rule: '与家长确认礼物清单后下单兑换。',
  },
  {
    id: 'p6',
    name: '🏖️ 周末出行游乐日',
    shortTitle: '出游游乐卡',
    icon: '🏖️',
    color: '#ECFEFF',
    benefit: '周末全家一起去你想去的游乐园、动物园、科技馆或野餐！',
    rule: '适合周末或节假日全家成行，尽情游玩一天。',
  },
  {
    id: 'p7',
    name: '🎮 畅玩游戏时间卡',
    shortTitle: '游戏时间卡',
    icon: '🎮',
    color: '#EFF6FF',
    benefit: '完成当日学习任务后，额外奖励 30 分钟自由游戏/娱乐时光！',
    rule: '单次享受 30 分钟，兑现后由家长点击核销。',
  },
];

const BLANK_SEGMENT = {
  id: 'blank',
  name: '谢谢惠顾',
  shortTitle: '再接再厉',
  icon: '🍀',
  color: '#F1F5F9',
  isBlank: true,
};

const WHEEL_SEGMENTS = [...PRIZE_CATALOG, BLANK_SEGMENT];

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getPetSpecies(type) {
  return PET_SPECIES.find((item) => item.type === type) || PET_SPECIES[0];
}

function resolveTitle(species, level) {
  const titles = species.titles;
  if (level >= 10) return titles[3];
  if (level >= 6) return titles[2];
  if (level >= 1) return titles[1];
  return titles[0];
}

function createDefaultPet(type = 'cat', hasChosenPet = false) {
  const species = getPetSpecies(type);
  return {
    type: species.type,
    name: species.name,
    hasChosenPet,
    level: 0,
    currentExp: 0,
    maxExp: 40, // 0级升1级仅需40经验，快速体验首次升级抽奖
    hunger: 65,
    mood: 80,
    conqueredErrors: 0,
    capturedErrors: 0,
    inventory: {
      fishCan: 2,
      energyFruit: 1,
    },
    currentTitle: species.titles[0],
    unlockedTitles: [species.titles[0]],
    lotteryTickets: 1, // 首次领养赠送 1 张新手见面抽奖券，立刻可体验！
    lotteryHistory: [],
    rewardedMasteryIds: [],
    rewardedCaptureIds: [],
    lastDailyBonusDate: '',
    lastActiveDate: getTodayStr(),
  };
}

let _cloudSyncTimer = null;

function serializePetForCloud(state) {
  const inv = state.inventory || {};
  return {
    type: state.type,
    name: state.name,
    hasChosenPet: Boolean(state.hasChosenPet),
    level: state.level || 0,
    currentExp: state.currentExp || 0,
    maxExp: state.maxExp || 40,
    hunger: typeof state.hunger === 'number' ? state.hunger : 65,
    mood: typeof state.mood === 'number' ? state.mood : 80,
    conqueredErrors: state.conqueredErrors || 0,
    capturedErrors: state.capturedErrors || 0,
    fishCan: typeof inv.fishCan === 'number' ? inv.fishCan : 2,
    energyFruit: typeof inv.energyFruit === 'number' ? inv.energyFruit : 1,
    lotteryTickets: state.lotteryTickets || 0,
    lotteryHistory: Array.isArray(state.lotteryHistory) ? state.lotteryHistory : [],
    rewardedMasteryIds: Array.isArray(state.rewardedMasteryIds) ? state.rewardedMasteryIds : [],
    rewardedCaptureIds: Array.isArray(state.rewardedCaptureIds) ? state.rewardedCaptureIds : [],
    practiceExperienceApplied: state.practiceExperienceApplied || 0,
    lastDailyBonusDate: state.lastDailyBonusDate || '',
  };
}

function hydratePetFromCloud(cloudPet) {
  const base = createDefaultPet(cloudPet.type || 'cat', Boolean(cloudPet.hasChosenPet));
  const species = getPetSpecies(base.type);
  const level = typeof cloudPet.level === 'number' ? cloudPet.level : 0;
  return {
    ...base,
    type: species.type,
    name: cloudPet.name || species.name,
    hasChosenPet: Boolean(cloudPet.hasChosenPet),
    level,
    currentExp: typeof cloudPet.currentExp === 'number' ? cloudPet.currentExp : 0,
    maxExp: typeof cloudPet.maxExp === 'number' ? cloudPet.maxExp : 40,
    hunger: typeof cloudPet.hunger === 'number' ? cloudPet.hunger : 65,
    mood: typeof cloudPet.mood === 'number' ? cloudPet.mood : 80,
    conqueredErrors: cloudPet.conqueredErrors || 0,
    capturedErrors: cloudPet.capturedErrors || 0,
    inventory: {
      fishCan: typeof cloudPet.fishCan === 'number' ? cloudPet.fishCan : 2,
      energyFruit: typeof cloudPet.energyFruit === 'number' ? cloudPet.energyFruit : 1,
    },
    currentTitle: resolveTitle(species, level),
    unlockedTitles: base.unlockedTitles,
    lotteryTickets: typeof cloudPet.lotteryTickets === 'number' ? cloudPet.lotteryTickets : 1,
    lotteryHistory: (cloudPet.lotteryHistory || []).map((record) => {
      const prize = PRIZE_CATALOG.find((entry) => entry.id === record.prizeId);
      if (!prize || record.prizeName) return record;
      const date = new Date(record.time);
      return { ...record, prizeName: prize.name, icon: prize.icon, benefit: prize.benefit,
        rule: prize.rule, time: (date.getMonth() + 1) + '月' + date.getDate() + '日' };
    }),
    rewardedMasteryIds: Array.isArray(cloudPet.rewardedMasteryIds) ? cloudPet.rewardedMasteryIds : [],
    rewardedCaptureIds: Array.isArray(cloudPet.rewardedCaptureIds) ? cloudPet.rewardedCaptureIds : [],
    practiceExperienceApplied: cloudPet.practiceExperienceApplied || 0,
    lastDailyBonusDate: cloudPet.lastDailyBonusDate || '',
  };
}

function getLocalPetKey() {
  const scope = require('./api').getAccountScope();
  return scope ? PET_STORAGE_KEY + '.' + encodeURIComponent(scope) : '';
}

function pauseCloudPetSync() {
  clearTimeout(_cloudSyncTimer);
  _cloudSyncTimer = null;
}

function clearLocalPetState(discardPending = false) {
  pauseCloudPetSync();
  const key = getLocalPetKey();
  if (key) {
    wx.removeStorageSync(key);
    if (discardPending) wx.removeStorageSync(key + '.pending');
  }
  wx.removeStorageSync(PET_STORAGE_KEY);
}

const cloudPushes = new Map();

function pushPendingPet(key) {
  if (cloudPushes.has(key)) return cloudPushes.get(key);
  const api = require('./api');
  const pending = wx.getStorageSync(key + '.pending');
  if (!pending || getLocalPetKey() !== key) return Promise.resolve();
  if (pending.accountVersion !== api.getStoredUser?.()?.accountVersion) {
    wx.removeStorageSync(key + '.pending');
    return Promise.resolve();
  }
  const task = api.saveCloudPet(serializePetForCloud(pending.state), {
    revision: pending.state.cloudRevision || 0,
    mutationId: pending.id,
  }).then((response) => {
    if (getLocalPetKey() !== key) return;
    const next = wx.getStorageSync(key + '.pending');
    if (next?.accountVersion !== pending.accountVersion || !next) return;
    const cloudRevision = response?.revision;
    if (Number.isSafeInteger(cloudRevision)) {
      const local = wx.getStorageSync(key);
      if (local) wx.setStorageSync(key, { ...local, cloudRevision });
      if (next.id !== pending.id) {
        wx.setStorageSync(key + '.pending', { ...next, state: { ...next.state, cloudRevision } });
      }
    }
    if (next.id === pending.id) wx.removeStorageSync(key + '.pending');
  }).catch((error) => {
    if (error?.code === 'PET_CONFLICT' && getLocalPetKey() === key) return { conflict: true };
  })
    .finally(() => {
      cloudPushes.delete(key);
      const next = wx.getStorageSync(key + '.pending');
      if (next && next.id !== pending.id && getLocalPetKey() === key) scheduleCloudPush(key);
    });
  cloudPushes.set(key, task);
  return task;
}

function scheduleCloudPush(key) {
  if (_cloudSyncTimer) clearTimeout(_cloudSyncTimer);
  _cloudSyncTimer = setTimeout(() => {
    _cloudSyncTimer = null;
    pushPendingPet(key);
  }, 350);
}

function savePetState(state, skipCloudPush) {
  const key = getLocalPetKey();
  if (!key) return;
  try {
    wx.setStorageSync(key, state);
    if (!skipCloudPush && !require('./api').isCloudMode?.()) {
      const id = Date.now() + '-' + Math.random().toString(36).slice(2);
      wx.setStorageSync(key + '.pending', { id, state, accountVersion: require('./api').getStoredUser?.()?.accountVersion });
      scheduleCloudPush(key);
    }
  } catch (e) {
    console.warn('savePetState error', e);
  }
}

async function syncPetFromCloud() {
  const api = require('./api');
  const key = getLocalPetKey();
  if (!key) return getPetState();
  try {
    // A local edit can happen during the fetch, including one that has already uploaded.
    const before = wx.getStorageSync(key);
    const pending = wx.getStorageSync(key + '.pending');
    if (!api.isCloudMode?.() && pending && pending.accountVersion === api.getStoredUser?.()?.accountVersion) {
      if (!before) savePetState(pending.state, true);
      const outcome = await pushPendingPet(key);
      if (outcome?.conflict && typeof wx.showModal === 'function') {
        wx.showModal({
          title: '精灵进度冲突',
          content: '另一台设备已经更新。使用云端进度会放弃本机尚未同步的精灵改动。',
          confirmText: '使用云端',
          cancelText: '保留本机',
          success: async ({ confirm }) => {
            if (!confirm || getLocalPetKey() !== key) return;
            if (wx.getStorageSync(key + '.pending')?.id !== pending.id) return;
            try {
              const latest = await api.fetchCloudPet();
              if (getLocalPetKey() !== key || !latest?.pet ||
                  wx.getStorageSync(key + '.pending')?.id !== pending.id) return;
              savePetState({ ...withPracticeExperience(hydratePetFromCloud(latest.pet), latest.practiceExperience),
                cloudRevision: latest.revision || 0 }, true);
              wx.removeStorageSync(key + '.pending');
              wx.showToast?.({ title: '已加载云端进度', icon: 'none' });
            } catch {
              wx.showToast?.({ title: '读取云端进度失败', icon: 'none' });
            }
          },
        });
      }
      return getPetState();
    }
    if (pending && !api.isCloudMode?.()) wx.removeStorageSync(key + '.pending');
    const res = await api.fetchCloudPet();
    if (getLocalPetKey() !== key) return getPetState();
    if ((!api.isCloudMode?.() && wx.getStorageSync(key + '.pending')) ||
        JSON.stringify(wx.getStorageSync(key)) !== JSON.stringify(before)) return getPetState();
    if (res?.pet) {
      const cloud = withPracticeExperience(hydratePetFromCloud(res.pet), res.practiceExperience);
      savePetState({ ...cloud, cloudRevision: res.revision || 0 }, true);
    }
  } catch {
    // Keep the local copy and any pending edit for the next sync.
  }
  return getPetState();
}

function getPetState() {
  let state = null;
  const key = getLocalPetKey();
  try {
    const cached = key ? wx.getStorageSync(key) : null;
    if (cached && typeof cached === 'object' && cached.type) {
      const base = createDefaultPet(cached.type, cached.hasChosenPet !== false);
      state = {
        ...base,
        ...cached,
        inventory: {
          ...base.inventory,
          ...(cached.inventory || {}),
        },
        lotteryHistory: Array.isArray(cached.lotteryHistory) ? cached.lotteryHistory : [],
        rewardedMasteryIds: Array.isArray(cached.rewardedMasteryIds) ? cached.rewardedMasteryIds : [],
        rewardedCaptureIds: Array.isArray(cached.rewardedCaptureIds) ? cached.rewardedCaptureIds : [],
      };
    }
  } catch (e) {
    console.warn('getPetState error', e);
  }

  if (!state) {
    state = createDefaultPet('cat', false);
    savePetState(state, true);
  }

  // 星夜鸮每日首次唤醒礼遇：赠送 1 包智慧小鱼干
  const today = getTodayStr();
  if (!require('./api').isCloudMode?.() && state.type === 'owl' && state.hasChosenPet && state.lastDailyBonusDate !== today) {
    state = {
      ...state,
      lastDailyBonusDate: today,
      lastActiveDate: today,
      inventory: {
        ...state.inventory,
        fishCan: (state.inventory.fishCan || 0) + 1,
      },
    };
    savePetState(state);
  }

  return state;
}

function addExpToPet(state, expGained) {
  let nextExp = (state.currentExp || 0) + expGained;
  let nextLevel = state.level || 0;
  let maxExp = state.maxExp || 40;
  let leveledUp = false;
  let newTickets = 0;

  while (nextExp >= maxExp) {
    nextExp -= maxExp;
    nextLevel += 1;
    newTickets += 1;
    maxExp = Math.round(50 * Math.pow(1.22, nextLevel));
    leveledUp = true;
  }

  const species = getPetSpecies(state.type);
  const currentTitle = resolveTitle(species, nextLevel);
  const unlockedTitles = Array.isArray(state.unlockedTitles) ? [...state.unlockedTitles] : [];
  if (!unlockedTitles.includes(currentTitle)) {
    unlockedTitles.push(currentTitle);
  }

  return {
    state: {
      ...state,
      level: nextLevel,
      currentExp: nextExp,
      maxExp,
      lotteryTickets: (state.lotteryTickets || 0) + newTickets,
      unlockedTitles,
      currentTitle,
      lastActiveDate: getTodayStr(),
    },
    leveledUp,
    newTickets,
    newLevel: nextLevel,
  };
}

function withPracticeExperience(state, total) {
  const previous = state.practiceExperienceApplied || 0;
  if (!Number.isSafeInteger(total) || total <= previous) return state;
  const { state: nextState } = addExpToPet(state, total - previous);
  return { ...nextState, practiceExperienceApplied: total };
}

function syncPracticeExperience(total) {
  const current = getPetState();
  const next = withPracticeExperience(current, total);
  if (next !== current) savePetState(next);
}

// 切换当前伴学精灵（保留成长等级、零食与心愿卡包进度）
function switchPetSpecies(type, customName) {
  const current = getPetState();
  const species = getPetSpecies(type);
  const prevSpecies = getPetSpecies(current.type);
  // 若用户未改过昵称或使用旧物种默认名，自动切换为新宠物名
  const shouldUseDefaultName = !current.name || current.name === prevSpecies.name;
  const nextName = (customName && String(customName).trim()) || (shouldUseDefaultName ? species.name : current.name);
  const nextTitle = resolveTitle(species, current.level || 0);
  const unlocked = Array.isArray(current.unlockedTitles) ? [...current.unlockedTitles] : [];
  if (!unlocked.includes(nextTitle)) unlocked.push(nextTitle);

  const nextState = {
    ...current,
    type: species.type,
    name: nextName,
    hasChosenPet: true,
    currentTitle: nextTitle,
    unlockedTitles: unlocked,
    lastActiveDate: getTodayStr(),
  };
  savePetState(nextState);
  return nextState;
}

function renamePet(newName) {
  const trimmed = String(newName || '').trim().slice(0, 12);
  if (!trimmed) return getPetState();
  const current = getPetState();
  const nextState = { ...current, name: trimmed };
  savePetState(nextState);
  return nextState;
}

function resetPetState(type) {
  const current = getPetState();
  const fresh = { ...createDefaultPet(type || current.type || 'cat', true), cloudRevision: current.cloudRevision };
  savePetState(fresh);
  return fresh;
}

function feedPet(foodType) {
  const current = getPetState();
  const stock = (current.inventory && current.inventory[foodType]) || 0;
  if (stock <= 0) {
    return {
      success: false,
      message: '零食库存不足，去错题详情点击「标记掌握」就能补货哦！',
      state: current,
    };
  }

  let expGained = foodType === 'energyFruit' ? 25 : 10;
  let hungerGain = foodType === 'energyFruit' ? 30 : 15;
  let moodGain = foodType === 'energyFruit' ? 25 : 10;

  // 各宠物专属特性加成
  if (current.type === 'cat' && foodType === 'fishCan') {
    moodGain += 8;
  } else if (current.type === 'dragon' && foodType === 'energyFruit') {
    expGained += 5;
  } else if (current.type === 'bunny') {
    moodGain += 10;
    hungerGain += 5;
  }

  const { state: leveledState, leveledUp, newTickets, newLevel } = addExpToPet(current, expGained);
  const finalState = {
    ...leveledState,
    hunger: Math.min(100, (leveledState.hunger || 0) + hungerGain),
    mood: Math.min(100, (leveledState.mood || 0) + moodGain),
    inventory: {
      ...leveledState.inventory,
      [foodType]: stock - 1,
    },
  };
  savePetState(finalState);

  const foodLabel = foodType === 'energyFruit' ? '金色能量果' : '智慧小鱼干';
  const msg = leveledUp
    ? `🎉 升级到 Lv.${newLevel}！送你 ${newTickets} 张心愿抽奖券！`
    : `${finalState.name} 吃掉了${foodLabel}，经验 +${expGained}！`;

  return {
    success: true,
    expGained,
    leveledUp,
    newLevel,
    newTickets,
    message: msg,
    state: finalState,
  };
}

// 在错题详情点击「标记为已攻克」时奖励宠物经验与小鱼干（同一题仅奖励一次）
function recordPetErrorConquered(errorItemId) {
  if (!errorItemId) return null;
  const current = getPetState();
  if (current.rewardedMasteryIds.includes(errorItemId)) {
    return null;
  }

  const expGained = current.type === 'fox' ? 25 : 20;
  const { state: leveledState, leveledUp, newTickets, newLevel } = addExpToPet(current, expGained);
  const finalState = {
    ...leveledState,
    conqueredErrors: (leveledState.conqueredErrors || 0) + 1,
    hunger: Math.min(100, (leveledState.hunger || 0) + 6),
    mood: Math.min(100, (leveledState.mood || 0) + 10),
    inventory: {
      ...leveledState.inventory,
      fishCan: (leveledState.inventory.fishCan || 0) + 1,
    },
    rewardedMasteryIds: [...leveledState.rewardedMasteryIds, errorItemId],
  };
  savePetState(finalState);

  return {
    expGained,
    fishGained: 1,
    leveledUp,
    newLevel,
    newTickets,
    state: finalState,
  };
}

// 新录入错题时奖励少量经验，鼓励坚持记录
function recordPetErrorCaptured(errorItemId) {
  const key = errorItemId || 'cap_' + Date.now();
  const current = getPetState();
  if (current.rewardedCaptureIds.includes(key)) {
    return null;
  }
  const expGained = 5;
  const { state: leveledState, leveledUp, newTickets, newLevel } = addExpToPet(current, expGained);
  const finalState = {
    ...leveledState,
    capturedErrors: (leveledState.capturedErrors || 0) + 1,
    mood: Math.min(100, (leveledState.mood || 0) + 5),
    rewardedCaptureIds: [...leveledState.rewardedCaptureIds, key].slice(-200),
  };
  savePetState(finalState);

  return {
    expGained,
    leveledUp,
    newLevel,
    newTickets,
    state: finalState,
  };
}

function formatWishTime() {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}月${day}日 ${hh}:${mm}`;
}

function drawWish() {
  const current = getPetState();
  if ((current.lotteryTickets || 0) <= 0) {
    return {
      success: false,
      message: '暂无抽奖券，喂食或攻克错题升级就能拿到抽奖券啦！',
      state: current,
    };
  }

  // 30% 谢谢惠顾，70% 等概率抽中 7 种心愿卡之一
  const isBlank = Math.random() < 0.3;
  const wonIndex = isBlank
    ? WHEEL_SEGMENTS.length - 1
    : Math.floor(Math.random() * PRIZE_CATALOG.length);
  const selected = WHEEL_SEGMENTS[wonIndex];

  let nextHistory = current.lotteryHistory || [];
  if (!isBlank) {
    const newRecord = {
      id: 'wish_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      prizeId: selected.id,
      prizeName: selected.name,
      icon: selected.icon,
      benefit: selected.benefit,
      rule: selected.rule,
      time: formatWishTime(),
      redeemed: false,
    };
    nextHistory = [newRecord, ...nextHistory];
  }

  const nextState = {
    ...current,
    lotteryTickets: Math.max(0, (current.lotteryTickets || 0) - 1),
    lotteryHistory: nextHistory,
  };
  savePetState(nextState);

  return {
    success: true,
    isBlank,
    wonIndex,
    prize: selected,
    state: nextState,
  };
}

function toggleWishRedeem(recordId) {
  const current = getPetState();
  const nextHistory = (current.lotteryHistory || []).map((item) => {
    if (item.id === recordId) {
      return { ...item, redeemed: !item.redeemed };
    }
    return item;
  });
  const nextState = {
    ...current,
    lotteryHistory: nextHistory,
  };
  savePetState(nextState);
  return nextState;
}

async function performCloudPetAction(action, fields) {
  const api = require('./api');
  const key = getLocalPetKey();
  if (!key) throw new Error('请先登录');
  const data = {
    action, ...fields, revision: getPetState().cloudRevision || 0,
    requestId: require('./draft').newRequestId(),
  };
  let response;
  try {
    response = await api.request({ path: '/api/pet/action', method: 'POST', data });
  } catch (error) {
    if (error.code === 'PET_CONFLICT') await syncPetFromCloud();
    if (error.code !== 'NETWORK' && error.code !== 'CLOUD_ERROR' && !/^-?\d+$/.test(error.code || '')) throw error;
    response = await api.request({ path: '/api/pet/action', method: 'POST', data });
  }
  const state = { ...hydratePetFromCloud(response.pet), cloudRevision: response.revision };
  if (getLocalPetKey() === key && (getPetState().cloudRevision || 0) <= response.revision) {
    savePetState(state, true);
  }
  return { ...response.result, state, success: true };
}

function petAction(fallback, action, payload, result = (response) => response.state) {
  return (...args) => require('./api').isCloudMode?.()
    ? performCloudPetAction(action, payload(...args)).then(result)
    : fallback(...args);
}

const rewardResult = (response) => response.alreadyRewarded ? null : response;

function getPetDialog(pet) {
  const species = getPetSpecies(pet.type);
  if ((pet.lotteryTickets || 0) > 0) {
    return `哇！你有 ${pet.lotteryTickets} 张心愿抽奖券，快切换到「抽心愿」看看手气吧！`;
  }
  const remain = Math.max(0, (pet.maxExp || 40) - (pet.currentExp || 0));
  const list = [
    `还差 ${remain} 点经验就能升级啦，去复习 1 道错题或喂份小零食吧~`,
    ...species.dialogs,
  ];
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = {
  PET_SPECIES,
  PRIZE_CATALOG,
  WHEEL_SEGMENTS,
  getPetSpecies,
  getPetState,
  switchPetSpecies: petAction(switchPetSpecies, 'adopt', (type, name) => ({ type, name })),
  renamePet: petAction(renamePet, 'rename', (name) => ({ name })),
  resetPetState: petAction(resetPetState, 'reset', () => ({})),
  feedPet: petAction(feedPet, 'feed', (food) => ({ food }), (response) => response),
  recordPetErrorConquered: petAction(recordPetErrorConquered, 'mastery', (itemId) => ({ itemId }), rewardResult),
  recordPetErrorCaptured: petAction(recordPetErrorCaptured, 'capture', (itemId) => ({ itemId }), rewardResult),
  drawWish: petAction(drawWish, 'draw', () => ({}), (response) => ({ ...response, prize: WHEEL_SEGMENTS[response.wonIndex] })),
  toggleWishRedeem: petAction(toggleWishRedeem, 'redeem', (recordId, redeemed) => ({ recordId, redeemed })),
  getPetDialog,
  syncPetFromCloud,
  syncPracticeExperience,
  clearLocalPetState,
  pauseCloudPetSync,
};
