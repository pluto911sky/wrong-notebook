const api = require('../../utils/api');
const petApi = require('../../utils/pet');
const { newRequestId } = require('../../utils/draft');
const { syncUiPreferences, showToast, queueToast, haptic } = require('../../utils/ui');

function paragraphs(text) {
  return String(text || '').split(/\r?\n+/).map((line) => line.trim()).filter(Boolean)
    .map((text, index) => ({ id: index, text }));
}

Page({
  data: {
    id: '',
    viewState: 'loading', // loading | ready | error
    errorMessage: '',
    item: null,
    subjectName: '',
    tags: [],
    hasAiAnalysis: false,
    analyzingNow: false,
    detailsExpanded: false,
    solutionSteps: [],
    mistakePoints: [],
    canPractice: false,
    quota: null,
    userNotesDraft: '',
    savingNotes: false,
    questionText: '',
    showSupportingImage: false,
    reduceTransparency: false,
    islandToast: null,
  },

  onLoad(query) {
    syncUiPreferences(this);
    const id = query.id || '';
    this.setData({
      id,
      quota: api.getCachedQuota(),
    });
    this.loadItem(id);
  },

  onShow() {
    syncUiPreferences(this);
    if (api.isLoggedIn()) {
      api.getQuota()
        .then((res) => {
          if (res && res.quota) {
            this.setData({ quota: res.quota });
          }
        })
        .catch(() => {});
    }
  },

  loadItem(id) {
    this.setData({ viewState: 'loading' });
    api.request({ path: '/api/error-items/' + encodeURIComponent(id) })
      .then((item) => {
        if (!item || !item.id) {
          this.setData({ viewState: 'error', errorMessage: '错题不存在或已被删除' });
          return;
        }
        this.applyItemData(item);
      })
      .catch((err) => {
        this.setData({ viewState: 'error', errorMessage: err.message || '加载失败' });
      });
  },

  applyItemData(item, preserveNotes = false) {
    let tags = (item.tags || []).map((tag) => tag.name);
    if (tags.length === 0 && item.knowledgePoints) {
      try {
        const parsed = JSON.parse(item.knowledgePoints);
        if (Array.isArray(parsed)) tags = parsed;
      } catch {}
    }
    const hasAiAnalysis = Boolean(
      (item.answerText && String(item.answerText).trim()) ||
      (item.analysis && String(item.analysis).trim())
    );
    const questionText = String(item.questionText || '').trim();
    const showSupportingImage = Boolean(item.originalImageUrl);
    this.setData({
      item,
      questionText,
      showSupportingImage,
      subjectName: (item.subject && item.subject.name) || '未分类',
      tags,
      hasAiAnalysis,
      canPractice: api.isCloudMode() && Boolean(questionText),
      solutionSteps: paragraphs(item.analysis),
      mistakePoints: paragraphs(item.mistakeAnalysis),
      userNotesDraft: preserveNotes ? this.data.userNotesDraft : item.userNotes || '',
      viewState: 'ready',
    });
  },

  toggleDetails() {
    this.setData({ detailsExpanded: !this.data.detailsExpanded });
  },

  startPractice() {
    if (!this.data.canPractice || !this.data.id) return;
    wx.navigateTo({ url: '/pages/practice/practice?id=' + encodeURIComponent(this.data.id) });
  },

  // 上传后触发或重新运行 AI 深度分析
  triggerAiAnalyze() {
    if (this.data.analyzingNow) return;
    const { id, quota } = this.data;

    if (!this.analysisRequestId && quota && !quota.canAnalyze) {
      api.showQuotaExhaustedModal();
      return;
    }

    this.analysisRequestId ||= newRequestId();
    this.setData({ analyzingNow: true });
    api.analyzeErrorItem(id, { requestId: this.analysisRequestId })
      .then((res) => {
        this.analysisRequestId = null;
        this.setData({ analyzingNow: false });
        if (res && res.quota) {
          this.setData({ quota: res.quota });
        }
        if (res && res.item) {
          this.applyItemData(res.item, true);
          this.setData({ detailsExpanded: false });
        }
        showToast(this, { title: '解析完成', type: 'success' });
      })
      .catch((err) => {
        this.setData({ analyzingNow: false });
        if (err && err.code === 'AI_TRIAL_EXHAUSTED') {
          this.analysisRequestId = null;
          if (err.quota) this.setData({ quota: err.quota });
          api.showQuotaExhaustedModal();
          return;
        }
        showToast(this, {
          title: (err && err.message) || '解析失败，请重试',
          type: 'error',
        });
      });
  },

  previewImage() {
    const item = this.data.item;
    if (item && item.originalImageUrl) {
      wx.previewImage({ urls: [item.originalImageUrl] });
    }
  },

  toggleMastery() {
    const item = this.data.item;
    if (!item) return;
    const nextLevel = (item.masteryLevel || 0) > 0 ? 0 : 2;
    api.request({
      path: '/api/error-items/' + encodeURIComponent(item.id) + '/mastery',
      method: 'PATCH',
      data: { masteryLevel: nextLevel },
    })
      .then(async (updated) => {
        const merged = Object.assign({}, this.data.item, {
          masteryLevel:
            updated && typeof updated.masteryLevel === 'number'
              ? updated.masteryLevel
              : nextLevel,
        });
        this.setData({ item: merged });
        if (nextLevel > 0) {
          const reward = await Promise.resolve().then(() => petApi.recordPetErrorConquered(item.id)).catch(() => null);
          if (reward) {
            const toastText = reward.leveledUp
              ? `攻克！${reward.state.name} 升至 Lv.${reward.newLevel} 送抽奖券`
              : `已攻克！${reward.state.name} 经验+${reward.expGained} 小鱼干×1`;
            showToast(this, { title: toastText, type: 'success', duration: 2600 });
            return;
          }
        }
        showToast(this, {
          title: nextLevel > 0 ? '已标记为已攻克' : '已移回待攻克',
          type: nextLevel > 0 ? 'success' : 'info',
        });
      })
      .catch((err) => {
        showToast(this, { title: (err && err.message) || '更新失败', type: 'error' });
      });
  },

  onNotesInput(event) {
    this.setData({ userNotesDraft: event.detail.value });
  },

  saveNotes() {
    const { item, userNotesDraft, savingNotes } = this.data;
    if (!item || savingNotes) return;
    this.setData({ savingNotes: true });
    api.request({
      path: '/api/error-items/' + encodeURIComponent(item.id) + '/notes',
      method: 'PATCH',
      data: { userNotes: userNotesDraft },
    })
      .then(() => {
        this.setData({
          savingNotes: false,
          item: Object.assign({}, this.data.item, { userNotes: userNotesDraft }),
        });
        showToast(this, { title: '笔记已保存', type: 'success' });
      })
      .catch((err) => {
        this.setData({ savingNotes: false });
        showToast(this, { title: (err && err.message) || '保存失败', type: 'error' });
      });
  },

  openMoreActions() {
    const { hasAiAnalysis } = this.data;
    const aiLabel = hasAiAnalysis ? '重新解析' : '解析本题';
    wx.showActionSheet({
      itemList: [aiLabel, '🗑️ 删除这道错题'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.triggerAiAnalyze();
        } else if (res.tapIndex === 1) {
          this.deleteItem();
        }
      },
    });
  },

  deleteItem() {
    const item = this.data.item;
    if (!item) return;
    wx.showModal({
      title: '确认删除',
      content: '确定要从错题本中删除这道错题吗？',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        api.request({
          path: '/api/error-items/' + encodeURIComponent(item.id) + '/delete',
          method: 'DELETE',
        })
          .then(() => {
            haptic('light');
            queueToast({ title: '已删除错题', type: 'success' });
            wx.navigateBack();
          })
          .catch((err) => {
            showToast(this, { title: (err && err.message) || '删除失败', type: 'error' });
          });
      },
    });
  },
});
