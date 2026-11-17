const { syncUiPreferences, showToast } = require('../../utils/ui');

Page({
  data: {
    needConsent: false,
    platformAuthorization: false,
    canOpenPlatformGuide: false,
    reduceTransparency: false,
    islandToast: null,
  },

  onLoad(options) {
    syncUiPreferences(this);
    const source = options && options.from;
    this.setData({
      needConsent: source === 'consent' || source === 'authorization',
      platformAuthorization: source === 'authorization',
      canOpenPlatformGuide: typeof wx.openPrivacyContract === 'function',
    });
  },

  onShow() {
    syncUiPreferences(this);
  },

  onUnload() {
    if (this.data.platformAuthorization) getApp().resolvePrivacy({ event: 'disagree' });
  },

  agreeWithWeChat(event) {
    getApp().resolvePrivacy({ event: 'agree', buttonId: event.currentTarget.id });
    this.agreeAndBack();
  },

  agreeAndBack() {
    wx.setStorageSync('mp.privacy_agreed', true);
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && typeof prev.setData === 'function') {
      prev.setData({ privacyAgreed: true });
    }
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },

  openPlatformGuide() {
    wx.openPrivacyContract({
      fail: () => showToast(this, { title: '暂时无法打开微信隐私指引', type: 'warn' }),
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },
});
