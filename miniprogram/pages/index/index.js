const api = require('../../utils/api');
const petApi = require('../../utils/pet');
const { syncUiPreferences, showToast } = require('../../utils/ui');

function formatQuotaSummary(quota) {
  if (!quota || typeof quota !== 'object') return '';
  if (quota.accessMode === 'vip') return '特权生效 · 不限次解析';
  if (quota.accessMode === 'admin') return '管理员 · 不限次解析';
  if (quota.accessMode === 'paid_quota') return '剩余 ' + (quota.paidQuota || 0) + ' 次解析额度';
  if (quota.paidQuota > 0 && quota.accessMode === 'trial') {
    return '剩余 ' + (quota.trialRemaining + quota.paidQuota) + ' 次解析';
  }
  if (quota.accessMode === 'custom_key') return '已绑定自有模型';
  if (quota.accessMode === 'exhausted') return '解析额度已用完（可继续录题复习）';
  if (typeof quota.trialRemaining === 'number' && typeof quota.trialLimit === 'number') {
    return '免费解析 ' + quota.trialRemaining + '/' + quota.trialLimit + ' 次';
  }
  return '';
}

Page({
  data: {
    loggedIn: false,
    userName: '',
    quotaSummary: '',
    quotaExhausted: false,
    pet: null,
    petSpecies: null,
    petExpPercent: 0,
    recentItems: [],
    totalCount: null,
    unmasteredCount: null,
    masteredCount: null,
    masteryState: 'loading', // loading | ready | error
    viewState: 'loading', // loading | ready | error
    errorMessage: '',
    reduceTransparency: false,
    islandToast: null,
  },

  onShow() {
    syncUiPreferences(this);
    const loggedIn = api.isLoggedIn();
    const user = loggedIn ? api.getStoredUser() : null;
    if (loggedIn && this.redirectIfProfileMissing(user)) return;
    const cachedQuota = loggedIn && typeof api.getCachedQuota === 'function' ? api.getCachedQuota() : null;
    this.setData({
      loggedIn,
      userName: (user && (user.name || user.email)) || '同学',
      quotaSummary: formatQuotaSummary(cachedQuota),
      quotaExhausted: Boolean(cachedQuota && cachedQuota.accessMode === 'exhausted'),
    });
    this.refreshPetView();

    if (loggedIn) {
      this.loadRecent();
      if (typeof petApi.syncPetFromCloud === 'function') {
        petApi.syncPetFromCloud().then(() => {
          if (api.isLoggedIn()) this.refreshPetView();
        });
      }
      if (typeof api.getQuota === 'function') {
        api.getQuota()
          .then((res) => {
            if (!api.isLoggedIn()) return;
            if (this.redirectIfProfileMissing(res && res.user)) return;
            const quota = (res && res.quota) || res;
            this.setData({
              userName: (res && res.user && res.user.name) || this.data.userName,
              quotaSummary: formatQuotaSummary(quota),
              quotaExhausted: Boolean(quota && quota.accessMode === 'exhausted'),
            });
          })
          .catch(() => {});
      }
    } else {
      this.clearRecent();
    }
  },

  onPullDownRefresh() {
    if (!api.isLoggedIn()) {
      wx.stopPullDownRefresh();
      return;
    }
    Promise.resolve(this.loadRecent()).finally(() => {
      if (typeof wx.stopPullDownRefresh === 'function') {
        wx.stopPullDownRefresh();
      }
    });
  },

  onUnload() {
    this.recentRequestId = (this.recentRequestId || 0) + 1;
  },

  // 已登录但还没填写学习台名字：先去完善信息
  redirectIfProfileMissing(user) {
    if (typeof api.needsProfile !== 'function' || !api.needsProfile(user)) return false;
    wx.redirectTo({ url: '/pages/onboarding/onboarding' });
    return true;
  },

  refreshPetView() {
    const pet = petApi.getPetState();
    const petSpecies = petApi.getPetSpecies(pet.type);
    const petExpPercent = Math.min(100, Math.round(((pet.currentExp || 0) / (pet.maxExp || 40)) * 100));
    this.setData({ pet, petSpecies, petExpPercent });
  },

  clearRecent() {
    this.recentRequestId = (this.recentRequestId || 0) + 1;
    this.setData({
      loggedIn: false,
      quotaSummary: '',
      quotaExhausted: false,
      recentItems: [],
      totalCount: null,
      unmasteredCount: null,
      masteredCount: null,
      viewState: 'ready',
      masteryState: 'loading',
      errorMessage: '',
    });
  },

  loadRecent() {
    const requestId = (this.recentRequestId || 0) + 1;
    this.recentRequestId = requestId;
    this.setData({ viewState: 'loading', masteryState: 'loading', errorMessage: '' });
    const requests = api.isCloudMode?.() && api.getHomeSummary
      ? api.getHomeSummary()
      : Promise.all([
      api.request({ path: '/api/error-items/list?page=1&pageSize=5' }),
      api
        .request({ path: '/api/error-items/list?page=1&pageSize=1&mastery=0' })
        .catch((err) => {
          if (err && err.code === 'UNAUTHORIZED') throw err;
          return null;
        }),
    ]);
    return requests
      .then(([res, unmasteredRes]) => {
        if (requestId !== this.recentRequestId) return;
        if (!res || !Number.isInteger(res.total) || res.total < 0) {
          throw new Error('错题数量暂不可用');
        }
        const totalCount = res.total;
        const masteryReady = Boolean(
          unmasteredRes && Number.isInteger(unmasteredRes.total) &&
          unmasteredRes.total >= 0 && unmasteredRes.total <= totalCount
        );
        const unmasteredCount = masteryReady ? unmasteredRes.total : null;
        const masteredCount = masteryReady ? totalCount - unmasteredCount : null;
        const recentItems = (res.items || []).slice(0, 5).map((item) => ({
          id: item.id,
          subjectName: (item.subject && item.subject.name) || '未分类',
          brief: this.briefOf(item.questionText),
          createdText: this.timeText(item.createdAt),
          hasAiAnalysis: item.hasAiAnalysis ?? Boolean(item.answerText || item.analysis),
          hasImage: item.hasImage ?? Boolean(item.originalImageUrl),
          mastered: (item.masteryLevel || 0) > 0,
        }));
        this.setData({
          recentItems,
          totalCount,
          unmasteredCount,
          masteredCount,
          masteryState: masteryReady ? 'ready' : 'error',
          viewState: 'ready',
        });
      })
      .catch((err) => {
        if (requestId !== this.recentRequestId) return;
        if (err && err.code === 'UNAUTHORIZED') {
          this.clearRecent();
          return;
        }
        this.setData({
          viewState: 'error',
          masteryState: 'error',
          errorMessage: (err && err.message) || '加载失败',
        });
      });
  },

  briefOf(text) {
    if (!text) return '（图片错题，点击查看原图与详情）';
    const clean = String(text).replace(/\s+/g, ' ').trim();
    return clean.length > 48 ? clean.slice(0, 48) + '…' : clean;
  },

  timeText(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return month + '月' + day + '日';
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goCapture() {
    const url = api.isLoggedIn()
      ? '/pages/capture/capture'
      : '/pages/login/login?captureMode=photo';
    wx.navigateTo({ url });
  },

  goList() {
    wx.navigateTo({ url: '/pages/list/list' });
  },

  goHome() {
    wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goPet() {
    wx.navigateTo({ url: api.isLoggedIn() ? '/pages/pet/pet' : '/pages/login/login' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goDetail(event) {
    this.openDetail(event.currentTarget.dataset.id);
  },

  openDetail(id) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出本机登录后，错题和伴学记录会继续保存在云端。',
      success: (res) => {
        if (!res.confirm) return;
        api.logout();
        this.clearRecent();
        showToast(this, { title: '已退出登录', type: 'success' });
      },
    });
  },
});
