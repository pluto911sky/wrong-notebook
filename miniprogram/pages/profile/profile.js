const { getQuota, clearApiKey, clearToken, getStoredUser, healthCheck, isCloudMode, quotaCardAction, resetCloudAccount, updateProfile, validateProfileName } = require('../../utils/api');
const {
  syncUiPreferences,
  setReduceTransparency,
  setHapticEnabled,
  showToast,
} = require('../../utils/ui');

Page({
  data: {
    loading: true,
    user: null,
    quota: null,
    healthChecking: false,
    cloudMode: false,
    redeeming: false,
    resetting: false,
    savingName: false,
    reduceTransparency: false,
    hapticEnabled: true,
    islandToast: null,
  },

  onLoad() {
    this.setData({ user: getStoredUser(), cloudMode: isCloudMode() });
    syncUiPreferences(this);
  },

  onShow() {
    syncUiPreferences(this);
    this.loadQuotaInfo();
  },

  onToggleReduceTransparency(e) {
    const next = setReduceTransparency(e.detail && e.detail.value);
    this.setData({ reduceTransparency: next });
    showToast(this, {
      title: next ? '已开启「减少透明与模糊」' : '已恢复流体毛玻璃效果',
      type: 'info',
    });
  },

  onToggleHaptic(e) {
    const next = setHapticEnabled(e.detail && e.detail.value);
    this.setData({ hapticEnabled: next });
    showToast(this, {
      title: next ? '已开启触感震动反馈' : '已关闭触感震动反馈',
      type: 'info',
    });
  },

  async loadQuotaInfo() {
    this.setData({ loading: true });
    try {
      const { user, quota } = await getQuota();
      this.setData({ user: user || getStoredUser(), quota });
    } catch (error) {
      showToast(this, { title: error.message || '获取额度失败', type: 'error' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 修改学习台名字（首页显示为「名字的学习台」）
  editName() {
    if (!this.data.user || this.data.savingName) return;
    wx.showModal({
      title: '修改学习台名字',
      editable: true,
      placeholderText: '1-12 个字，例如：欣欣',
      content: this.data.user.name || '',
      confirmText: '保存',
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.savingName) return;
        const error = validateProfileName(content);
        if (error) {
          showToast(this, { title: error, type: 'error' });
          return;
        }
        this.setData({ savingName: true });
        try {
          const user = await updateProfile({ name: content });
          this.setData({ user: { ...(this.data.user || {}), ...user } });
          showToast(this, { title: '已改为「' + user.name + '的学习台」', type: 'success' });
        } catch (err) {
          showToast(this, { title: (err && err.message) || '保存失败，请重试', type: 'error' });
        } finally {
          this.setData({ savingName: false });
        }
      },
    });
  },

  enterCardCode() {
    if (this.data.redeeming) return;
    wx.showModal({
      title: '兑换次卡',
      editable: true,
      placeholderText: '粘贴卡密',
      confirmText: '兑换',
      success: async ({ confirm, content }) => {
        if (!confirm || !content?.trim() || this.data.redeeming) return;
        this.setData({ redeeming: true });
        try {
          const { quota, granted } = await quotaCardAction('redeem_code', { code: content.trim() });
          this.setData({ quota });
          showToast(this, { title: granted ? `已增加 ${granted} 次` : '这张次卡已到账', type: 'success' });
        } catch (error) {
          showToast(this, { title: error?.message || '兑换失败，请重试', type: 'error' });
        } finally {
          this.setData({ redeeming: false });
        }
      },
    });
  },

  issueCard() {
    if (this.data.user?.role !== 'admin' || this.issuingCard) return;
    const amounts = [100, 300, 1000];
    wx.showActionSheet({
      itemList: amounts.map((amount) => `${amount} 次卡`),
      success: async ({ tapIndex }) => {
        if (!amounts[tapIndex] || this.issuingCard) return;
        this.issuingCard = true;
        try {
          const { code, amount } = await quotaCardAction('issue_card', { amount: amounts[tapIndex] });
          wx.showModal({
            title: `${amount} 次卡`,
            content: code,
            showCancel: false,
            confirmText: '复制卡密',
            success: ({ confirm }) => { if (confirm) wx.setClipboardData({ data: code }); },
          });
        } catch (error) {
          showToast(this, { title: error?.message || '发卡失败', type: 'error' });
        } finally {
          this.issuingCard = false;
        }
      },
    });
  },

  revokeCard() {
    if (this.data.user?.role !== 'admin') return;
    wx.showModal({
      title: '作废未兑换次卡',
      editable: true,
      placeholderText: '粘贴要作废的卡密',
      confirmText: '作废',
      success: async ({ confirm, content }) => {
        if (!confirm || !content?.trim()) return;
        try {
          await quotaCardAction('revoke_card', { code: content.trim() });
          showToast(this, { title: '次卡已作废', type: 'success' });
        } catch (error) {
          showToast(this, { title: error?.message || '作废失败', type: 'error' });
        }
      },
    });
  },

  confirmAccountReset() {
    if (this.data.resetting || !this.data.cloudMode || !this.data.user) return;
    wx.showModal({
      title: '重置此账号？',
      content: '将永久清空错题、题图、笔记、宠物和闯关进度。已用试用次数和剩余解析额度会保留。',
      cancelText: '取消',
      confirmText: '确认重置',
      confirmColor: '#b42318',
      success: async ({ confirm }) => {
        if (!confirm || this.data.resetting) return;
        this.setData({ resetting: true });
        try {
          await resetCloudAccount();
          wx.reLaunch({ url: '/pages/login/login' });
        } catch (error) {
          showToast(this, { title: error?.message || '重置未完成，请重试', type: 'error' });
        } finally {
          this.setData({ resetting: false });
        }
      },
    });
  },

  handleClearApiKey() {
    if (!this.data.quota?.canClearLegacyKey) return;
    wx.showModal({
      title: '清除以前保存的模型密钥',
      content: '此操作会从小程序账号中移除已保存的模型密钥和相关配置。',
      confirmText: '确认清除',
      confirmColor: '#DC2626',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await clearApiKey();
          this.setData({ quota: result.quota });
          showToast(this, { title: '已清除模型密钥', type: 'success' });
        } catch (error) {
          showToast(this, { title: error.message || '清除失败', type: 'error' });
        }
      },
    });
  },

  openPetPage() {
    wx.navigateTo({ url: '/pages/pet/pet' });
  },

  openPrivacyDoc() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  // 真机排障入口：逐项显示云环境自检结果，可复制完整 JSON 给开发者定位
  async runHealthCheck() {
    if (this.data.healthChecking) return;
    this.setData({ healthChecking: true });
    wx.showLoading({ title: '正在自检…', mask: true });
    try {
      const result = await healthCheck();
      // 便于开发者工具控制台/自动化直接读取完整自检结果
      console.log('[health-check-result]', JSON.stringify(result || {}, null, 2));
      const labels = {
        identity: '微信身份',
        db: '云数据库',
        securityText: '文本审核',
        securityImage: '图片审核',
        ai: 'AI 配置',
      };
      const checks = (result && result.checks) || {};
      const lines = Object.keys(labels).map((key) => {
        const item = checks[key];
        if (!item) return labels[key] + '：未检测';
        const detail = item.ok
          ? (item.ms !== undefined ? item.ms + 'ms' : '')
          : (item.reason || item.message || item.code || '');
        return labels[key] + '：' + (item.ok ? '通过' : '失败') + (detail ? ' · ' + detail : '');
      });
      wx.showModal({
        title: result && result.ok ? '环境自检通过' : '环境自检发现异常',
        content: lines.join('\n'),
        confirmText: '复制详情',
        cancelText: '关闭',
        success: (res) => {
          if (!res.confirm) return;
          wx.setClipboardData({ data: JSON.stringify(result || {}, null, 2) });
        },
      });
    } catch (error) {
      wx.showModal({
        title: '自检请求失败',
        content: (error && (error.message || error.code)) || '云函数不可达，请确认环境共享与云函数已部署',
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ healthChecking: false });
    }
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出本机登录后，错题和伴学记录会继续保存在云端。',
      success(res) {
        if (!res.confirm) return;
        clearToken();
        wx.reLaunch({ url: '/pages/login/login' });
      },
    });
  },
});
