const config = require('./config');
const { getReduceTransparency, getHapticEnabled } = require('./utils/ui');

App({
  config,
  globalData: {
    appName: '智能错题本',
    analyzeDraft: null,
    quota: null,
    reduceTransparency: false,
    hapticEnabled: true,
    pendingIslandToast: null,
  },
  privacyResolvers: [],

  onLaunch() {
    this.globalData.reduceTransparency = getReduceTransparency();
    this.globalData.hapticEnabled = getHapticEnabled();

    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        this.privacyResolvers.push(resolve);
        if (this.privacyResolvers.length > 1) return;
        wx.navigateTo({
          url: '/pages/privacy/privacy?from=authorization',
          fail: () => this.resolvePrivacy({ event: 'disagree' }),
        });
      });
    }
  },

  resolvePrivacy(choice) {
    this.privacyResolvers.splice(0).forEach((resolve) => resolve(choice));
  },
});
