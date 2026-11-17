const REDUCE_TRANSPARENCY_KEY = 'ui_reduce_transparency';
const HAPTIC_ENABLED_KEY = 'ui_haptic_feedback';

function readBoolStorage(key, fallback) {
  try {
    const val = wx.getStorageSync(key);
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === 1) return true;
    if (val === 'false' || val === 0) return false;
  } catch (e) {
    // ignore storage read errors in restricted environments
  }
  return fallback;
}

function writeBoolStorage(key, value) {
  try {
    wx.setStorageSync(key, Boolean(value));
  } catch (e) {
    // ignore storage write errors
  }
}

function getReduceTransparency() {
  const app = getApp();
  if (app && app.globalData && typeof app.globalData.reduceTransparency === 'boolean') {
    return app.globalData.reduceTransparency;
  }
  const stored = readBoolStorage(REDUCE_TRANSPARENCY_KEY, false);
  if (app && app.globalData) {
    app.globalData.reduceTransparency = stored;
  }
  return stored;
}

function setReduceTransparency(enabled) {
  const next = Boolean(enabled);
  writeBoolStorage(REDUCE_TRANSPARENCY_KEY, next);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.reduceTransparency = next;
  }
  return next;
}

function getHapticEnabled() {
  const app = getApp();
  if (app && app.globalData && typeof app.globalData.hapticEnabled === 'boolean') {
    return app.globalData.hapticEnabled;
  }
  const stored = readBoolStorage(HAPTIC_ENABLED_KEY, true);
  if (app && app.globalData) {
    app.globalData.hapticEnabled = stored;
  }
  return stored;
}

function setHapticEnabled(enabled) {
  const next = Boolean(enabled);
  writeBoolStorage(HAPTIC_ENABLED_KEY, next);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.hapticEnabled = next;
  }
  return next;
}

function haptic(type = 'light') {
  if (!getHapticEnabled()) return;
  if (typeof wx.vibrateShort !== 'function') return;
  try {
    wx.vibrateShort({ type, fail() {} });
  } catch (e) {
    // ignore on platforms/simulators without vibrator
  }
}

function inferToastType(options) {
  if (options && options.type) return options.type;
  if (options && options.icon === 'success') return 'success';
  if (options && options.icon === 'error') return 'error';
  const title = (options && options.title) || '';
  if (/失败|异常|错误|不可达|超时|拒绝/.test(title)) return 'error';
  if (/请先|未找到|不能|至少|补全|选择/.test(title)) return 'warn';
  return 'info';
}

function normalizeToastOptions(raw) {
  const opts = typeof raw === 'string' ? { title: raw } : (raw || {});
  return {
    title: String(opts.title || ''),
    type: inferToastType(opts),
    duration: typeof opts.duration === 'number' && opts.duration > 0 ? opts.duration : 2200,
  };
}

function showToast(page, rawOptions) {
  const opts = normalizeToastOptions(rawOptions);
  if (!opts.title) return;

  if (opts.type === 'error' || opts.type === 'warn') {
    haptic('medium');
  } else if (opts.type === 'success') {
    haptic('light');
  }

  if (!page || typeof page.setData !== 'function') {
    wx.showToast({
      title: opts.title,
      icon: opts.type === 'success' ? 'success' : 'none',
      duration: opts.duration,
    });
    return;
  }

  if (page.__islandToastTimer) {
    clearTimeout(page.__islandToastTimer);
    page.__islandToastTimer = null;
  }

  const nextSeq = (page.__islandToastSeq || 0) + 1;
  page.__islandToastSeq = nextSeq;

  page.setData({
    islandToast: {
      visible: true,
      title: opts.title,
      type: opts.type,
      seq: nextSeq,
    },
  });

  page.__islandToastTimer = setTimeout(() => {
    page.__islandToastTimer = null;
    if (page.__islandToastSeq !== nextSeq) return;
    page.setData({
      'islandToast.visible': false,
    });
  }, opts.duration);
}

function queueToast(rawOptions) {
  const opts = normalizeToastOptions(rawOptions);
  if (!opts.title) return;
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.pendingIslandToast = opts;
  }
}

function syncUiPreferences(page) {
  if (!page || typeof page.setData !== 'function') return;
  const reduceTransparency = getReduceTransparency();
  const hapticEnabled = getHapticEnabled();
  page.setData({
    reduceTransparency,
    hapticEnabled,
  });

  const app = getApp();
  if (app && app.globalData && app.globalData.pendingIslandToast) {
    const pending = app.globalData.pendingIslandToast;
    app.globalData.pendingIslandToast = null;
    setTimeout(() => showToast(page, pending), 60);
  }
}

module.exports = {
  getReduceTransparency,
  setReduceTransparency,
  getHapticEnabled,
  setHapticEnabled,
  haptic,
  showToast,
  queueToast,
  syncUiPreferences,
};
