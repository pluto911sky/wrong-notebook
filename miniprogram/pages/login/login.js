const api = require('../../utils/api');
const { syncUiPreferences, queueToast } = require('../../utils/ui');

Page({
  data: {
    mode: 'login', // login | register
    name: '',
    email: '',
    password: '',
    baseUrl: 'http://localhost:3333',
    isCloudMode: false,
    captureMode: '',
    showEmailForm: false,
    showServerConfig: false,
    privacyAgreed: false,
    wxSubmitting: false,
    submitting: false,
    errorMessage: '',
    reduceTransparency: false,
    islandToast: null,
  },

  onLoad(query) {
    syncUiPreferences(this);
    const agreed = Boolean(wx.getStorageSync('mp.privacy_agreed'));
    const requestedMode = query && query.captureMode;
    this.setData({
      baseUrl: api.getBaseUrl(),
      isCloudMode: api.isCloudMode(),
      captureMode: requestedMode === 'photo' || requestedMode === 'text' ? requestedMode : '',
      privacyAgreed: agreed,
    });
  },

  onShow() {
    syncUiPreferences(this);
    const agreed = Boolean(wx.getStorageSync('mp.privacy_agreed'));
    if (agreed !== this.data.privacyAgreed) {
      this.setData({ privacyAgreed: agreed });
    }
  },

  togglePrivacyAgree() {
    const next = !this.data.privacyAgreed;
    this.setData({ privacyAgreed: next, errorMessage: '' });
    if (next) {
      wx.setStorageSync('mp.privacy_agreed', true);
    } else {
      wx.removeStorageSync('mp.privacy_agreed');
    }
  },

  openPrivacyDoc() {
    wx.navigateTo({ url: '/pages/privacy/privacy?from=consent' });
  },

  toggleEmailForm() {
    this.setData({ showEmailForm: !this.data.showEmailForm, errorMessage: '' });
  },

  toggleServerConfig() {
    this.setData({ showServerConfig: !this.data.showServerConfig });
  },

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    this.setData({ mode, errorMessage: '' });
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value });
  },

  onEmailInput(event) {
    this.setData({ email: event.detail.value });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  onBaseUrlInput(event) {
    this.setData({ baseUrl: event.detail.value });
  },

  ensurePrivacyConsent(callback) {
    if (this.data.privacyAgreed) {
      callback();
      return;
    }
    wx.showModal({
      title: '隐私保护提示',
      content: '继续使用错题本前，请先阅读并同意《用户隐私保护指引》。',
      confirmText: '同意并继续',
      cancelText: '查看详情',
      confirmColor: '#059669',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('mp.privacy_agreed', true);
          this.setData({ privacyAgreed: true, errorMessage: '' });
          callback();
        } else {
          this.openPrivacyDoc();
        }
      },
    });
  },

  wechatQuickLogin() {
    if (this.data.wxSubmitting || this.data.submitting) return;
    this.ensurePrivacyConsent(() => {
      if (!this.data.isCloudMode) api.setBaseUrl(this.data.baseUrl.trim());
      this.setData({ wxSubmitting: true, errorMessage: '' });

      api
        .wechatLogin()
        .then((res) => {
          this.setData({ wxSubmitting: false });
          this.finishLogin(res && res.user);
        })
        .catch((err) => {
          this.setData({
            wxSubmitting: false,
            errorMessage: (err && err.message) || '微信登录失败，请重试',
          });
        });
    });
  },

  finishLogin(user) {
    queueToast({ title: '登录成功', type: 'success' });
    const mode = this.data.captureMode;
    const loggedInUser = user || (typeof api.getStoredUser === 'function' ? api.getStoredUser() : null);
    // 第 2 步：首次登录先完善信息（学习台名字）
    if (typeof api.needsProfile === 'function' && api.needsProfile(loggedInUser)) {
      wx.redirectTo({ url: '/pages/onboarding/onboarding' + (mode ? '?captureMode=' + mode : '') });
      return;
    }
    if (mode === 'photo' || mode === 'text') {
      wx.redirectTo({ url: '/pages/capture/capture?mode=' + mode });
      return;
    }
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },

  validate() {
    const { mode, name, email, password } = this.data;
    if (mode === 'register' && !name.trim()) {
      return '请输入昵称';
    }
    if (!email.trim()) {
      return '请输入邮箱';
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      return '邮箱格式不正确';
    }
    if (password.length < 6) {
      return '密码至少 6 位';
    }
    return '';
  },

  submit() {
    if (this.data.submitting || this.data.wxSubmitting) return;

    const error = this.validate();
    if (error) {
      this.setData({ errorMessage: error });
      return;
    }

    this.ensurePrivacyConsent(() => {
      if (!this.data.isCloudMode) api.setBaseUrl(this.data.baseUrl.trim());
      this.setData({ submitting: true, errorMessage: '' });

      const { mode, name, email, password } = this.data;
      const emailValue = email.trim();
      const passwordValue = password;

      const doLogin = () => api.login({ email: emailValue, password: passwordValue });

      const task =
        mode === 'register'
          ? api
              .register({ name: name.trim(), email: emailValue, password: passwordValue })
              .catch((err) => {
                if (err && (err.statusCode === 409 || err.code === 'HTTP_409')) {
                  return null;
                }
                throw err;
              })
              .then(doLogin)
          : doLogin();

      task
        .then((user) => {
          this.setData({ submitting: false });
          this.finishLogin(user);
        })
        .catch((err) => {
          this.setData({
            submitting: false,
            errorMessage: (err && err.message) || '操作失败，请重试',
          });
        });
    });
  },
});
