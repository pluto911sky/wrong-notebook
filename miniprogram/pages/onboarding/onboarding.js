const api = require('../../utils/api');
const { syncUiPreferences, queueToast } = require('../../utils/ui');

// 登录后的「完善信息」：填写学习台名字（谁的学习台），之后可在设置页修改
Page({
  data: {
    name: '',
    maxLength: 12,
    captureMode: '',
    saving: false,
    errorMessage: '',
    reduceTransparency: false,
    islandToast: null,
  },

  onLoad(query) {
    syncUiPreferences(this);
    if (!api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    const user = api.getStoredUser();
    const current = user && user.name && user.name !== api.DEFAULT_USER_NAME ? user.name : '';
    const mode = query && query.captureMode;
    this.setData({
      name: current,
      maxLength: api.PROFILE_NAME_MAX || 12,
      captureMode: mode === 'photo' || mode === 'text' ? mode : '',
    });
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value, errorMessage: '' });
  },

  submit() {
    if (this.data.saving) return;
    const error = api.validateProfileName(this.data.name);
    if (error) {
      this.setData({ errorMessage: error });
      return;
    }
    this.setData({ saving: true, errorMessage: '' });
    return api
      .updateProfile({ name: this.data.name })
      .then((user) => {
        this.setData({ saving: false });
        queueToast({ title: '欢迎，' + user.name, type: 'success' });
        const mode = this.data.captureMode;
        if (mode) {
          wx.redirectTo({ url: '/pages/capture/capture?mode=' + mode });
        } else {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      })
      .catch((err) => {
        this.setData({ saving: false, errorMessage: (err && err.message) || '保存失败，请重试' });
      });
  },
});
