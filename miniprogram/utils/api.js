// API 工具层：支持微信云开发（含跨 AppID 共享云环境）与 Next.js HTTP 双后端模式
// 支持微信一键登录、OCR 扫描与智能分析

const appConfig = require('../config');

const STORAGE_COOKIES = 'mp.cookies';
const STORAGE_BASE_URL = 'mp.baseUrl';
const STORAGE_QUOTA_CACHE = 'mp.quotaCache';
const STORAGE_USER_CACHE = 'mp.userCache';
const STORAGE_CLOUD_LOGIN = 'mp.cloudLoggedIn';
const DEFAULT_BASE_URL = appConfig.defaultHttpBaseUrl || 'http://localhost:3333';

let _cloudInstancePromise = null;
let sessionVersion = 0;

function isCloudMode() {
    return appConfig.backendMode === 'cloud';
}

function getCloudClient() {
    if (_cloudInstancePromise) return _cloudInstancePromise;
    _cloudInstancePromise = (async () => {
        if (!wx.cloud) {
            throw { code: 'CLOUD_UNAVAILABLE', message: '当前基础库不支持微信云开发，请升级开发者工具基础库' };
        }
        let currentAppId = '';
        try {
            const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
            currentAppId = (info && info.miniProgram && info.miniProgram.appId) || '';
        } catch (e) {
            currentAppId = '';
        }

        if (currentAppId && currentAppId === appConfig.resourceAppid) {
            wx.cloud.init({ env: appConfig.resourceEnv, traceUser: true });
            return wx.cloud;
        }

        if (typeof wx.cloud.Cloud === 'function') {
            const sharedCloud = new wx.cloud.Cloud({
                resourceAppid: appConfig.resourceAppid,
                resourceEnv: appConfig.resourceEnv,
            });
            await sharedCloud.init();
            return sharedCloud;
        }

        wx.cloud.init({ env: appConfig.resourceEnv, traceUser: true });
        return wx.cloud;
    })().catch((err) => {
        _cloudInstancePromise = null;
        throw err;
    });
    return _cloudInstancePromise;
}

function getBaseUrl() {
    return wx.getStorageSync(STORAGE_BASE_URL) || DEFAULT_BASE_URL;
}

function setBaseUrl(url) {
    const normalized = String(url || '').replace(/\/+$/, '');
    if (!normalized) return;
    wx.setStorageSync(STORAGE_BASE_URL, normalized);
}

function getCookies() {
    return wx.getStorageSync(STORAGE_COOKIES) || {};
}

function saveCookie(name, value) {
    const cookies = getCookies();
    cookies[name] = value;
    wx.setStorageSync(STORAGE_COOKIES, cookies);
}

function clearCookies(discardPendingPet = false) {
    sessionVersion += 1;
    require('./pet').clearLocalPetState(discardPendingPet);
    wx.removeStorageSync(STORAGE_COOKIES);
    wx.removeStorageSync(STORAGE_QUOTA_CACHE);
    wx.removeStorageSync(STORAGE_USER_CACHE);
    wx.removeStorageSync(STORAGE_CLOUD_LOGIN);
    wx.removeStorageSync('mp.sandboxDeviceId');
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) {
        app.globalData.analyzeDraft = null;
        app.globalData.quota = null;
    }
}

function clearToken() {
    clearCookies();
}

function getStoredUser() {
    return wx.getStorageSync(STORAGE_USER_CACHE) || null;
}

function setStoredUser(user) {
    if (user && typeof user === 'object') {
        wx.setStorageSync(STORAGE_USER_CACHE, user);
    }
}

function getCachedQuota() {
    return wx.getStorageSync(STORAGE_QUOTA_CACHE) || null;
}

function setCachedQuota(quota) {
    if (quota && typeof quota === 'object') {
        wx.setStorageSync(STORAGE_QUOTA_CACHE, quota);
    }
}

function cookieHeader() {
    const cookies = getCookies();
    return Object.keys(cookies)
        .map((name) => name + '=' + cookies[name])
        .join('; ');
}

function extractSetCookies(header) {
    if (!header) return;
    let raw = header['Set-Cookie'] || header['set-cookie'];
    if (!raw) return;
    if (!Array.isArray(raw)) raw = [raw];
    raw.forEach((line) => {
        const pair = String(line).split(';')[0];
        const eqIndex = pair.indexOf('=');
        if (eqIndex <= 0) return;
        const name = pair.slice(0, eqIndex).trim();
        const value = pair.slice(eqIndex + 1).trim();
        if (value === '' || value === 'deleteMe') {
            const cookies = getCookies();
            delete cookies[name];
            wx.setStorageSync(STORAGE_COOKIES, cookies);
            return;
        }
        saveCookie(name, value);
    });
}

function isLoggedIn() {
    if (isCloudMode()) {
        return Boolean(wx.getStorageSync(STORAGE_CLOUD_LOGIN));
    }
    return !!getCookies()['next-auth.session-token'];
}

function getAccountScope() {
    const user = isLoggedIn() ? getStoredUser() : null;
    const account = user && (user.id || user.email);
    if (!account) return '';
    const backend = isCloudMode()
        ? 'cloud:' + appConfig.resourceAppid + ':' + appConfig.resourceEnv
        : 'http:' + getBaseUrl();
    return backend + ':' + account;
}

function handleUnifiedResponse(statusCode, data, resolve, reject, options) {
    if (data && data.quota) {
        setCachedQuota(data.quota);
    }
    if (statusCode >= 200 && statusCode < 300) {
        resolve(data);
    } else if (statusCode === 401) {
        const preserveSessionOn401 = Boolean(options && options.preserveSessionOn401);
        if (data?.code === 'ACCOUNT_RESET') {
            require('./draft').clearAccountDrafts();
            clearCookies(true);
        } else if (!preserveSessionOn401) {
            clearCookies();
        }
        reject({
            code: 'UNAUTHORIZED',
            message: preserveSessionOn401 && data && data.message ? data.message : '登录已失效，请重新登录',
        });
    } else if (statusCode === 402 || (data && data.code === 'AI_TRIAL_EXHAUSTED')) {
        reject({
            code: 'AI_TRIAL_EXHAUSTED',
            message: '解析次数已用完，仍可录题和复习',
            quota: data && data.quota,
            data,
        });
    } else {
        const message =
            (data && data.message) ||
            (data && data.error) ||
            '请求失败(' + statusCode + ')';
        const code = data && typeof data.code === 'string' ? data.code : 'HTTP_' + statusCode;
        reject({ code, message, data });
    }
}

// 统一请求：自动按 config.backendMode 路由到共享微信云函数或 HTTP 后端
function request(options) {
    const { path, method = 'GET', data, timeout = 60000, preserveSessionOn401 = false } = options;
    const requestSession = sessionVersion;
    function isCurrentSession(reject) {
        if (requestSession === sessionVersion) return true;
        reject({ code: 'SESSION_CHANGED', message: '登录状态已变化，请重新打开该页面' });
        return false;
    }

    if (isCloudMode()) {
        const accountVersion = getStoredUser()?.accountVersion;
        return new Promise((resolve, reject) => {
            getCloudClient()
                .then((client) => {
                    if (!isCurrentSession(reject)) return;
                    return client.callFunction({
                        name: appConfig.cloudFunctionName || 'errorbookApi',
                        data: {
                            path,
                            method,
                            ...(accountVersion ? { accountVersion } : {}),
                            data: data || {},
                        },
                    });
                })
                .then((res) => {
                    if (!isCurrentSession(reject)) return;
                    const result = (res && res.result) || {};
                    const statusCode = typeof result.statusCode === 'number' ? result.statusCode : 200;
                    const body = result.data !== undefined ? result.data : result;
                    handleUnifiedResponse(statusCode, body, resolve, reject, { preserveSessionOn401 });
                })
                .catch((err) => {
                    const errCode = err && (err.errCode !== undefined ? err.errCode : err.code);
                    const rawMsg = (err && (err.message || err.errMsg)) || '';
                    const isShareUnauthorized =
                        errCode === -601012 ||
                        String(errCode) === '-601012' ||
                        /601012|未获得该环境授权/.test(rawMsg);
                    const friendlyMessage = isShareUnauthorized
                        ? '云环境资源复用未授权 (-601012)：请由资源方(' +
                          appConfig.resourceAppid +
                          ')在云开发「环境共享」中添加当前小程序并授权环境 ' +
                          appConfig.resourceEnv +
                          '，或改为当前小程序自有云环境。'
                        : rawMsg || '云开发请求失败，请确认云环境已共享或已部署云函数';
                    reject({
                        code: errCode !== undefined ? String(errCode) : 'CLOUD_ERROR',
                        message: friendlyMessage,
                        detail: rawMsg,
                    });
                });
        });
    }

    return new Promise((resolve, reject) => {
        wx.request({
            url: getBaseUrl() + path,
            method,
            data,
            timeout,
            header: {
                'content-type': 'application/json',
                Cookie: cookieHeader(),
            },
            success(res) {
                if (!isCurrentSession(reject)) return;
                extractSetCookies(res.header);
                handleUnifiedResponse(res.statusCode, res.data, resolve, reject, { preserveSessionOn401 });
            },
            fail(err) {
                reject({
                    code: 'NETWORK',
                    message: '无法连接服务器，请确认本地服务已启动且已关闭域名校验',
                    detail: err && err.errMsg,
                });
            },
        });
    });
}

// NextAuth credentials 登录（手动维护 Cookie，兼容 login(email, password) 与 login({ email, password })）
function login(emailOrObj, passwordArg) {
    const email =
        typeof emailOrObj === 'object' && emailOrObj !== null
            ? emailOrObj.email
            : emailOrObj;
    const password =
        typeof emailOrObj === 'object' && emailOrObj !== null
            ? emailOrObj.password
            : passwordArg;
    let csrfToken = '';
    return new Promise((resolve, reject) => {
        wx.request({
            url: getBaseUrl() + '/api/auth/csrf',
            method: 'GET',
            header: { Cookie: cookieHeader() },
            success(res) {
                extractSetCookies(res.header);
                if (res.statusCode !== 200 || !res.data || !res.data.csrfToken) {
                    reject({ code: 'CSRF', message: '无法获取登录凭证，请检查服务器地址' });
                    return;
                }
                csrfToken = res.data.csrfToken;
                wx.request({
                    url: getBaseUrl() + '/api/auth/callback/credentials',
                    method: 'POST',
                    header: {
                        'content-type': 'application/x-www-form-urlencoded',
                        Cookie: cookieHeader(),
                    },
                    data:
                        'email=' + encodeURIComponent(email) +
                        '&password=' + encodeURIComponent(password) +
                        '&csrfToken=' + encodeURIComponent(csrfToken) +
                        '&json=true',
                    success(res2) {
                        extractSetCookies(res2.header);
                        if (isLoggedIn()) {
                            request({ path: '/api/auth/session' })
                                .then((session) => {
                                    if (session && session.user) {
                                        setStoredUser(session.user);
                                        resolve(session.user);
                                    } else {
                                        clearCookies();
                                        reject({ code: 'AUTH', message: '邮箱或密码不正确' });
                                    }
                                })
                                .catch(reject);
                        } else {
                            reject({ code: 'AUTH', message: '邮箱或密码不正确，或账号被禁用' });
                        }
                    },
                    fail(err) {
                        reject({ code: 'NETWORK', message: '登录请求失败', detail: err && err.errMsg });
                    },
                });
            },
            fail(err) {
                reject({
                    code: 'NETWORK',
                    message: '无法连接服务器，请确认地址正确、服务已启动，并在开发者工具中关闭域名校验',
                    detail: err && err.errMsg,
                });
            },
        });
    });
}

function register(payload) {
    return request({
        path: '/api/register',
        method: 'POST',
        data: payload,
    });
}

function logout() {
    clearCookies();
    return Promise.resolve();
}

// 获取账号和智能解析额度
function getQuota() {
    return request({
        path: '/api/user/quota',
        method: 'GET',
    }).then((res) => {
        if (res && res.quota) {
            setCachedQuota(res.quota);
        }
        if (res && res.user) {
            setStoredUser(res.user);
        }
        return res;
    });
}

// 清除先前保存的模型密钥
function clearApiKey() {
    return request({
        path: '/api/user/quota',
        method: 'POST',
        data: { action: 'clear_api_key' },
    });
}

function quotaCardAction(action, data) {
    return request({ path: '/api/user/quota', method: 'POST', data: { action, ...data } });
}

async function resetCloudAccount() {
    const user = getStoredUser();
    if (!isCloudMode() || !user?.id) throw new Error('请先登录');
    const resetKey = 'mp.resetRequest.' + user.id;
    const drafts = require('./draft');
    const requestId = wx.getStorageSync(resetKey) || drafts.newRequestId();
    wx.setStorageSync(resetKey, requestId);
    require('./pet').pauseCloudPetSync();
    const result = await request({
        path: '/api/user/reset', method: 'POST', data: { confirm: 'RESET_ACCOUNT', requestId },
    });
    if (!result?.reset) throw new Error('未确认重置，请重试');
    drafts.clearAccountDrafts();
    clearCookies(true);
    wx.removeStorageSync(resetKey);
}

// 专用 OCR 扫描提取错题题干（不消耗 3 次免费 AI 分析试用额度）
function ocrImage(payload) {
    return request({
        path: '/api/ocr',
        method: 'POST',
        timeout: 180000,
        data: payload,
    });
}

// 拍照并进行智能解析
function analyzeImage(payload) {
    return request({
        path: '/api/analyze',
        method: 'POST',
        timeout: 200000,
        data: payload,
    });
}

// 解析文字题干
function analyzeText(payload) {
    return request({
        path: '/api/reanswer',
        method: 'POST',
        timeout: 180000,
        data: payload,
    });
}

// 对已上传保存的错题触发 AI 深度分析并写回数据库
function analyzeErrorItem(id, payload) {
    return request({
        path: '/api/error-items/' + encodeURIComponent(id) + '/analyze',
        method: 'POST',
        timeout: 200000,
        data: payload || {},
    });
}

function getHomeSummary() {
    return request({ path: '/api/home' }).then((res) => [res.recent, res.pending]);
}

function generatePractice(id) {
    return request({
        path: '/api/error-items/' + encodeURIComponent(id) + '/practice',
        method: 'POST',
    });
}

function submitPracticeAnswer(id, stage, answer) {
    return request({
        path: '/api/error-items/' + encodeURIComponent(id) + '/practice-answer',
        method: 'POST',
        data: { stage, answer },
    });
}

// 微信小程序一键登录（cloud 模式直接用云开发原生 OPENID；http 模式走 /api/auth/wechat 签发 Cookie）
function wechatLogin(options) {
    const nickname =
        options && typeof options.nickname === 'string' ? options.nickname.trim() : '';
    const finishLogin = (res) => {
        if (isCloudMode()) {
            wx.setStorageSync(STORAGE_CLOUD_LOGIN, true);
        }
        if (res && res.user) {
            setStoredUser(res.user);
        }
        if (res && res.quota) {
            setCachedQuota(res.quota);
        }
        return res;
    };

    if (isCloudMode()) {
        return request({
            path: '/api/auth/wechat',
            method: 'POST',
        }).then(finishLogin);
    }

    return new Promise((resolve, reject) => {
        wx.login({
            success(loginRes) {
                const code = loginRes && loginRes.code;
                if (!code) {
                    reject({ code: 'WECHAT_LOGIN_FAILED', message: '未取得微信登录凭证，请重试' });
                    return;
                }
                request({
                    path: '/api/auth/wechat',
                    method: 'POST',
                    data: { code, nickname },
                })
                    .then((res) => resolve(finishLogin(res)))
                    .catch(reject);
            },
            fail() {
                reject({ code: 'WECHAT_LOGIN_FAILED', message: '未取得微信登录凭证，请重试' });
            },
        });
    });
}

// 完善信息：学习台名字
const DEFAULT_USER_NAME = '微信同学';
const PROFILE_NAME_MAX = 12;

function validateProfileName(name) {
    const value = String(name || '').trim();
    if (!value) return '请填写名字';
    if (Array.from(value).length > PROFILE_NAME_MAX) return '名字最多 ' + PROFILE_NAME_MAX + ' 个字';
    return '';
}

// 是否还需要填写名字：云端返回 profileCompleted；旧数据按默认昵称判断
function needsProfile(user) {
    if (!user || typeof user !== 'object') return false;
    if (typeof user.profileCompleted === 'boolean') return !user.profileCompleted;
    const name = String(user.name || '').trim();
    return !name || name === DEFAULT_USER_NAME;
}

function updateProfile(payload) {
    const value = String((payload && payload.name) || '').trim();
    const error = validateProfileName(value);
    if (error) return Promise.reject({ code: 'INVALID_NAME', message: error });
    const task = isCloudMode()
        ? request({ path: '/api/user/profile', method: 'POST', data: { name: value } })
        : request({ path: '/api/user', method: 'PATCH', data: { name: value } });
    return task.then((res) => {
        const updated = (res && res.user) || res || {};
        const user = {
            ...(getStoredUser() || {}),
            ...updated,
            name: updated.name || value,
            profileCompleted: true,
        };
        setStoredUser(user);
        return user;
    });
}

// 伴学宠物精灵云端同步
function fetchCloudPet() {
    return request({
        path: '/api/pet',
        method: 'GET',
    });
}

function saveCloudPet(pet, metadata) {
    return request({
        path: '/api/pet',
        method: 'PUT',
        data: { pet, ...metadata },
    });
}

// 真机排障：分项探测身份、数据库、内容安全与 AI 配置（只读，不消耗解析额度）
function healthCheck(options) {
    const probe = options && options.probe ? '?probe=' + encodeURIComponent(options.probe) : '';
    return request({
        path: '/api/health' + probe,
        method: 'GET',
        preserveSessionOn401: true,
    });
}

// 解析额度用完后，仍可继续录题和复习
function showQuotaExhaustedModal() {
    wx.showModal({
        title: '解析次数已用完',
        content: '你仍可拍照识题、手动录入或复习已保存的错题。',
        confirmText: '知道了',
        showCancel: false,
        confirmColor: '#1769e0',
    });
}

module.exports = {
    isCloudMode,
    getBaseUrl,
    setBaseUrl,
    isLoggedIn,
    getAccountScope,
    clearCookies,
    clearToken,
    quotaCardAction,
    resetCloudAccount,
    getStoredUser,
    setStoredUser,
    getCachedQuota,
    setCachedQuota,
    request,
    login,
    wechatLogin,
    register,
    logout,
    getQuota,
    DEFAULT_USER_NAME,
    PROFILE_NAME_MAX,
    validateProfileName,
    needsProfile,
    updateProfile,
    fetchCloudPet,
    saveCloudPet,
    clearApiKey,
    ocrImage,
    analyzeImage,
    analyzeText,
    analyzeErrorItem,
    getHomeSummary,
    generatePractice,
    submitPracticeAnswer,
    healthCheck,
    showQuotaExhaustedModal,
};
