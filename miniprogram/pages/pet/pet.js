const petApi = require('../../utils/pet');
const { syncUiPreferences, showToast } = require('../../utils/ui');

Page({
  data: {
    activeTab: 'home', // 'home' | 'wheel' | 'bag'
    bagFilter: 'all', // 'all' | 'pending' | 'redeemed'
    pet: null,
    species: null,
    speciesList: petApi.PET_SPECIES,
    expPercent: 0,
    bubbleText: '',
    isBouncing: false,
    // 5 选 1 领养/切换抽屉状态
    showSpeciesPicker: false,
    previewSpecies: petApi.PET_SPECIES[0],
    customNameInput: '',
    // 转盘抽奖状态
    wheelItems: petApi.WHEEL_SEGMENTS,
    activeWheelIdx: -1,
    isSpinning: false,
    inspectedPrize: petApi.WHEEL_SEGMENTS[0],
    // 卡包列表
    filteredHistory: [],
    pendingWishCount: 0,
    feedNotice: '',
    reduceTransparency: false,
    islandToast: null,
  },

  onLoad(options) {
    syncUiPreferences(this);
    const mode = options && options.captureMode;
    this.captureMode = mode === 'photo' || mode === 'text' ? mode : '';
    if (options && (options.tab === 'wheel' || options.tab === 'bag' || options.tab === 'home')) {
      this.setData({ activeTab: options.tab });
    }
  },

  onShow() {
    this._audioHidden = false;
    syncUiPreferences(this);
    this.syncPetState(true);
    petApi.syncPetFromCloud().then(() => {
      this.syncPetState(false);
    });
  },

  onHide() {
    this._audioHidden = true;
    this.releasePetAudio();
  },

  onUnload() {
    this.releasePetAudio();
    if (this._spinTimer) {
      clearTimeout(this._spinTimer);
    }
    if (this._bounceTimer) {
      clearTimeout(this._bounceTimer);
    }
  },

  playPetAudio(clip, loop = false) {
    if (this._audioHidden || typeof wx.createInnerAudioContext !== 'function') return;
    try {
      if (!this._petAudio) this._petAudio = wx.createInnerAudioContext();
      const audio = this._petAudio;
      audio.stop();
      audio.obeyMuteSwitch = true;
      audio.loop = loop;
      audio.volume = loop ? 0.55 : 0.85;
      audio.src = '/assets/pet-audio/' + clip + '.mp3';
      audio.play();
    } catch {
      // 音频不可用时仍正常展示互动和抽奖结果。
    }
  },

  releasePetAudio() {
    if (!this._petAudio) return;
    const audio = this._petAudio;
    this._petAudio = null;
    audio.destroy();
  },

  syncPetState(checkFirstOnboarding) {
    const pet = petApi.getPetState();
    const species = petApi.getPetSpecies(pet.type);
    const maxExp = pet.maxExp || 40;
    const expPercent = Math.min(100, Math.round(((pet.currentExp || 0) / maxExp) * 100));
    const history = Array.isArray(pet.lotteryHistory) ? pet.lotteryHistory : [];
    const pendingWishCount = history.filter((item) => !item.redeemed).length;

    const updates = {
      pet,
      species,
      expPercent,
      pendingWishCount,
      filteredHistory: this.filterHistory(history, this.data.bagFilter),
    };

    if (!this.data.bubbleText) {
      updates.bubbleText = petApi.getPetDialog(pet);
    }

    // 首次进入宠物页面：自动展开「5 选 1」精灵领养面板
    if (checkFirstOnboarding && !pet.hasChosenPet) {
      updates.showSpeciesPicker = true;
      updates.previewSpecies = species;
      updates.customNameInput = '';
    }

    this.setData(updates);
  },

  filterHistory(history, filter) {
    if (filter === 'pending') return history.filter((item) => !item.redeemed);
    if (filter === 'redeemed') return history.filter((item) => item.redeemed);
    return history;
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab });
    }
  },

  setBagFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    const history = (this.data.pet && this.data.pet.lotteryHistory) || [];
    this.setData({
      bagFilter: filter,
      filteredHistory: this.filterHistory(history, filter),
    });
  },

  handleTapPet() {
    const { pet } = this.data;
    if (!pet) return;
    if (this._bounceTimer) clearTimeout(this._bounceTimer);
    const greeting = this._greeted ? '' : '嗨，我是你的伴学精灵！今天一起复习吧。';
    if (greeting) {
      this._greeted = true;
      this.playPetAudio('hello');
    }
    this.setData({
      isBouncing: true,
      bubbleText: greeting || petApi.getPetDialog(pet),
    });
    this._bounceTimer = setTimeout(() => {
      this.setData({ isBouncing: false });
    }, 500);
  },

  async performPetAction(action) {
    if (this.petActionPending) return null;
    this.petActionPending = true;
    try {
      return await action();
    } catch (error) {
      this.syncPetState(false);
      showToast(this, { title: error?.message || '操作失败，请重试', type: 'warn' });
      return null;
    } finally {
      this.petActionPending = false;
    }
  },

  async handleFeed(event) {
    const food = event.currentTarget.dataset.food;
    if (!food) return;
    const res = await this.performPetAction(() => petApi.feedPet(food));
    if (!res) return;
    if (!res.success) {
      showToast(this, { title: res.message, type: 'warn' });
      this.setData({ bubbleText: res.message });
      return;
    }

    this.setData({
      bubbleText: res.message,
      feedNotice: res.message,
      isBouncing: true,
    });
    if (this._bounceTimer) clearTimeout(this._bounceTimer);
    this._bounceTimer = setTimeout(() => {
      this.setData({ isBouncing: false });
    }, 600);

    this.syncPetState(false);

    if (res.leveledUp) {
      wx.showModal({
        title: `🎉 恭喜升级 Lv.${res.newLevel}！`,
        content: `${res.state.name} 解锁称号「${res.state.currentTitle}」，并赠送了 ${res.newTickets} 张心愿抽奖券！`,
        confirmText: '去抽心愿',
        cancelText: '太棒了',
        confirmColor: '#EA580C',
        success: (modalRes) => {
          if (modalRes.confirm) {
            this.setData({ activeTab: 'wheel' });
          }
        },
      });
    }
  },

  // 打开 5 选 1 伴学宠物领养/切换面板
  openSpeciesPicker() {
    const currentSpecies = this.data.species || petApi.PET_SPECIES[0];
    this.setData({
      showSpeciesPicker: true,
      previewSpecies: currentSpecies,
      customNameInput: '',
    });
  },

  closeSpeciesPicker() {
    this.setData({ showSpeciesPicker: false });
  },

  selectPreviewSpecies(event) {
    const type = event.currentTarget.dataset.type;
    const found = petApi.getPetSpecies(type);
    this.setData({ previewSpecies: found });
  },

  handleNicknameInput(event) {
    this.setData({ customNameInput: event.detail.value });
  },

  async confirmSelectSpecies() {
    const { previewSpecies, customNameInput } = this.data;
    if (!previewSpecies) return;
    const nextState = await this.performPetAction(() => petApi.switchPetSpecies(previewSpecies.type, customNameInput));
    if (!nextState) return;
    if (this.captureMode) {
      if (!petApi.getPetState().hasChosenPet) {
        showToast(this, { title: '无法保存领养结果，请重试', type: 'warn' });
        return;
      }
      wx.redirectTo({ url: '/pages/capture/capture?mode=' + this.captureMode });
      return;
    }
    this.setData({
      showSpeciesPicker: false,
      bubbleText: `你好呀！我是你的伴学伙伴「${nextState.name}」，${previewSpecies.traitDesc}`,
    });
    this.syncPetState(false);
    showToast(this, {
      title: `已切换为 ${nextState.name}`,
      type: 'success',
    });
  },

  openMoreActions() {
    const { pet } = this.data;
    if (!pet) return;
    wx.showActionSheet({
      itemList: ['🐾 切换其他精灵 (5选1)', '✏️ 修改宠物昵称', '🔄 重新领养（重置回 Lv.0）'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.openSpeciesPicker();
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '修改宠物昵称',
            editable: true,
            placeholderText: pet.name,
            success: async (mRes) => {
              if (mRes.confirm && mRes.content && mRes.content.trim()) {
                const updated = await this.performPetAction(() => petApi.renamePet(mRes.content));
                if (!updated) return;
                this.setData({ bubbleText: `我以后就叫「${updated.name}」啦！` });
                this.syncPetState(false);
              }
            },
          });
        } else if (res.tapIndex === 2) {
          wx.showModal({
            title: '重新领养（重置进度）',
            content: `确定要将「${pet.name}」的等级、经验、零食库存、抽奖券与心愿卡包全部清零，从 Lv.0 重新开始吗？`,
            confirmText: '确认重置',
            confirmColor: '#DC2626',
            success: async (confirmRes) => {
              if (!confirmRes.confirm) return;
              if (!await this.performPetAction(() => petApi.resetPetState(pet.type))) return;
              this.setData({
                bubbleText: `重新从 Lv.0 出发啦！`,
              });
              this.syncPetState(false);
              showToast(this, { title: '已重新领养', type: 'success' });
            },
          });
        }
      },
    });
  },

  inspectWheelPrize(event) {
    const idx = Number(event.currentTarget.dataset.index);
    const prize = this.data.wheelItems[idx];
    if (prize) {
      this.setData({ inspectedPrize: prize });
    }
  },

  async handleDrawWish() {
    const { isSpinning, pet } = this.data;
    if (isSpinning || this.data.drawPending) return;
    if (!pet || (pet.lotteryTickets || 0) <= 0) {
      wx.showModal({
        title: '暂无心愿抽奖券',
        content: '在「错题详情页」点击标记掌握（+20 EXP），或投喂小零食帮精灵升 1 级即可获得 1 张抽奖券！',
        confirmText: '去刷错题',
        cancelText: '知道了',
        confirmColor: '#2563EB',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/list/list?mastery=0' });
          }
        },
      });
      return;
    }

    this.setData({ drawPending: true });
    const drawResult = await this.performPetAction(() => petApi.drawWish());
    this.setData({ drawPending: false });
    if (!drawResult) return;
    if (!drawResult.success) {
      showToast(this, { title: drawResult.message, type: 'warn' });
      return;
    }

    const targetIndex = drawResult.wonIndex;
    const totalGrid = this.data.wheelItems.length; // 8
    const totalSteps = totalGrid * 2 + targetIndex; // 转 2 整圈后停在目标格
    let step = 0;

    this.setData({ isSpinning: true });
    this.playPetAudio('spin', true);

    const runStep = () => {
      const currentIdx = step % totalGrid;
      this.setData({ activeWheelIdx: currentIdx });

      if (step >= totalSteps) {
        this.playPetAudio(drawResult.isBlank ? 'blank' : 'won');
        this.setData({
          isSpinning: false,
          inspectedPrize: drawResult.prize,
          bubbleText: drawResult.isBlank
            ? '差一点点就中大奖啦，再复习几道错题升级就有新券哦！'
            : `🎊 太棒啦！抽中「${drawResult.prize.name}」！`,
        });
        this.syncPetState(false);

        if (drawResult.isBlank) {
          wx.showModal({
            title: '🍀 再接再厉',
            content: '这次抽到了幸运草祝福！多攻克几道错题，升级后就能继续抽心愿卡啦~',
            showCancel: false,
            confirmText: '继续加油',
          });
        } else {
          wx.showModal({
            title: '🎊 恭喜抽中心愿卡！',
            content: `${drawResult.prize.name}\n\n${drawResult.prize.benefit}\n（已放入「心愿卡包」，可随时出示给爸爸妈妈核销兑现）`,
            confirmText: '去卡包查看',
            cancelText: '太开心了',
            confirmColor: '#EA580C',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.setData({ activeTab: 'bag' });
              }
            },
          });
        }
        return;
      }

      step += 1;
      // 渐慢节奏，最后 5 步更有悬念
      const remain = totalSteps - step;
      const delay = remain < 5 ? 160 + (5 - remain) * 55 : 75;
      this._spinTimer = setTimeout(runStep, delay);
    };

    runStep();
  },

  handleToggleRedeem(event) {
    const id = event.currentTarget.dataset.id;
    const item = (this.data.filteredHistory || []).find((x) => x.id === id);
    if (!item) return;

    const actionText = item.redeemed ? '恢复为待兑现' : '核销兑现';
    wx.showModal({
      title: item.redeemed ? '取消核销' : '家长核销确认',
      content: item.redeemed
        ? `确定要将「${item.prizeName}」恢复为待兑现状态吗？`
        : `家长确认已为孩子兑现「${item.prizeName}」吗？`,
      confirmText: actionText,
      confirmColor: item.redeemed ? '#475569' : '#059669',
      success: async (res) => {
        if (!res.confirm) return;
        if (!await this.performPetAction(() => petApi.toggleWishRedeem(id, !item.redeemed))) return;
        this.syncPetState(false);
        showToast(this, {
          title: item.redeemed ? '已恢复待兑现' : '已核销兑现',
          type: 'success',
        });
      },
    });
  },

  goToStudyList() {
    wx.navigateTo({ url: '/pages/list/list?mastery=0' });
  },

  goToWheelTab() {
    this.setData({ activeTab: 'wheel' });
  },

  noop() {},
});
