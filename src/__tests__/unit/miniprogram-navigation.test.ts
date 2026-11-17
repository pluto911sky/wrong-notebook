import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadPage(name: string, api = {}, petApi = {}, platform = {}) {
    const wx = {
        navigateTo: vi.fn(),
        navigateBack: vi.fn(),
        redirectTo: vi.fn(),
        reLaunch: vi.fn(),
        getStorageSync: vi.fn(() => true),
        showToast: vi.fn(),
        showModal: vi.fn(),
        stopPullDownRefresh: vi.fn(),
        pageScrollTo: vi.fn(),
        ...platform,
    };
    // Capture the real WeChat page with local platform and API stand-ins.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page: any;
    runInNewContext(readFileSync(resolve('miniprogram/pages', name, name + '.js'), 'utf8'), {
        Page(definition: { data: Record<string, unknown> }) {
            page = { ...definition, setData: (update: object) => Object.assign(definition.data, update) };
        },
        wx,
        require: (path: string) => {
            if (path === '../../utils/api') return api;
            if (path === '../../utils/pet') return petApi;
            if (path === '../../utils/draft') return { newRequestId: () => 'test-request' };
            if (path === '../../utils/ui') return { syncUiPreferences: vi.fn(), showToast: vi.fn(), queueToast: vi.fn() };
            throw new Error('Unexpected dependency: ' + path);
        },
        setTimeout: (run: () => void) => run(),
    });
    return { page, wx };
}

function deferred<T>() {
    let resolve!: (result: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function itemList(id: string, total = 1, totalPages = 1) {
    return { total, totalPages, items: [{ id, questionText: id }] };
}

it('错题详情默认显示答案，详细解析按需展开，从详情进入闯关', () => {
    const { page, wx } = loadPage('detail', { isCloudMode: () => true });
    page.setData({ id: 'exercise' });
    page.applyItemData({ questionText: ' 2x + 3 = 11 ', originalImageUrl: 'https://example.test/figure', answerText: 'x = 4', analysis: '移项\n\n系数化为 1' });
    expect(page.data.questionText).toBe('2x + 3 = 11');
    expect(page.data.showSupportingImage).toBe(true);
    expect(page.data.detailsExpanded).toBe(false);
    expect(page.data.solutionSteps.map(({ text }: { text: string }) => text)).toEqual(['移项', '系数化为 1']);
    page.toggleDetails();
    expect(page.data.detailsExpanded).toBe(true);
    page.startPractice();
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/practice/practice?id=exercise' });
    page.applyItemData({ questionText: '如图，求角 A 的大小。', originalImageUrl: 'https://example.test/figure' });
    expect(page.data.showSupportingImage).toBe(true);
});

it('宠物本地核销未同步时，不会被云端旧快照覆盖', async () => {
    const storage = new Map<string, unknown>();
    const saveCloudPet = vi.fn().mockRejectedValue(new Error('离线'));
    const fetchCloudPet = vi.fn().mockResolvedValue({
        pet: { type: 'cat', hasChosenPet: true, lotteryHistory: [{ id: 'wish', redeemed: false }] },
    });
    const module = { exports: {} as any };
    runInNewContext(readFileSync(resolve('miniprogram/utils/pet.js'), 'utf8'), {
        module, require: () => ({ getAccountScope: () => 'account', fetchCloudPet, saveCloudPet }),
        wx: {
            getStorageSync: (key: string) => structuredClone(storage.get(key)),
            setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
            removeStorageSync: (key: string) => storage.delete(key),
        },
        setTimeout: () => 1, clearTimeout: () => {}, console,
    });
    const pet = module.exports;
    await pet.syncPetFromCloud();
    pet.toggleWishRedeem('wish');
    const local = await pet.syncPetFromCloud();
    expect(local.lotteryHistory[0].redeemed).toBe(true);
    expect(fetchCloudPet).toHaveBeenCalledTimes(1);
    expect(saveCloudPet.mock.calls[0][0].lotteryHistory[0].redeemed).toBe(true);
});

it('闯关答错可以重试，只有答对才同步经验和解锁下一关', async () => {
    const generatePractice = vi.fn().mockResolvedValue({
        practice: {
            similar: { questionText: '3x − 5 = 10' },
            advanced: { questionText: '2(x + 3) − 5 = 11' },
            challenge: { questionText: '2(x + 3) = 3(x − 1)' },
        },
        progress: 0,
    });
    const submitPracticeAnswer = vi.fn()
        .mockResolvedValueOnce({ correct: false })
        .mockResolvedValueOnce({ correct: true, experience: 5, totalExperience: 5, answerText: 'x = 5' });
    const syncPracticeExperience = vi.fn();
    const { page } = loadPage('practice', { generatePractice, submitPracticeAnswer }, { syncPracticeExperience });
    await page.onLoad({ id: 'exercise' });
    page.onAnswerInput({ detail: { value: 'x = 4' } });
    await page.submitAnswer();
    page.advance();
    expect(page.data.index).toBe(0);
    expect(page.data.result).toBeNull();
    expect(syncPracticeExperience).not.toHaveBeenCalled();

    page.onAnswerInput({ detail: { value: 'x = 5' } });
    await page.submitAnswer();
    expect(page.data.result.answerText).toBe('x = 5');
    expect(page.data.showSolution).toBe(false);
    expect(syncPracticeExperience).toHaveBeenCalledOnce();
    expect(syncPracticeExperience).toHaveBeenCalledWith(5);
    page.advance();
    expect(page.data.index).toBe(1);
    expect(page.data.answer).toBe('');
    expect(page.data.result).toBeNull();
});

async function settle() {
    await new Promise<void>((done) => setImmediate(done));
}

it('设置的账号重置需在弹窗再次确认，取消不请求清除', async () => {
    const resetCloudAccount = vi.fn().mockResolvedValue(undefined);
    const { page, wx } = loadPage('profile', { resetCloudAccount });
    page.setData({ cloudMode: true, user: { id: 'demo' } });
    page.confirmAccountReset();
    const modal = wx.showModal.mock.calls[0][0] as unknown as {
        confirmText: string;
        success: (result: { confirm: boolean }) => Promise<void>;
    };
    expect(modal.confirmText).toBe('确认重置');
    await modal.success({ confirm: false });
    expect(resetCloudAccount).not.toHaveBeenCalled();
    await modal.success({ confirm: true });
    expect(resetCloudAccount).toHaveBeenCalledOnce();
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/login' });
});

describe('小程序首页', () => {
    it('保留错题列表并标明待攻克统计暂不可用，重试后显示真实状态', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce(itemList('recent'))
            .mockRejectedValueOnce(new Error('计数失败'))
            .mockResolvedValueOnce(itemList('recent'))
            .mockResolvedValueOnce({ total: 0, items: [] });
        const { page } = loadPage('index', { request });

        page.loadRecent();
        await settle();

        expect(page.data.recentItems[0].id).toBe('recent');
        expect(page.data.masteryState).toBe('error');
        expect(page.data.masteredCount).toBeNull();

        page.loadRecent();
        await settle();

        expect(page.data.masteryState).toBe('ready');
        expect(page.data.masteredCount).toBe(1);
    });

    it('首页首屏按阶段目标、录入错题、小精灵排列，最近录入位于首屏之后', () => {
        const markup = readFileSync(resolve('miniprogram/pages/index/index.wxml'), 'utf8');
        const dashboard = markup.slice(markup.indexOf('class="home-dashboard"'), markup.indexOf('<!-- 最近录入列表 -->'));
        expect(dashboard).toMatch(/review-hero-card[\s\S]*capture-section[\s\S]*pet-banner-card/);
        expect(dashboard).not.toContain('查看全部错题');
        expect([...dashboard.matchAll(/class="stat-label">([^<]+)/g)].map((label) => label[1]))
            .toEqual(['待攻克', '已掌握', '全部错题']);
    });

    it('未登录时统一录题入口先登录，随后进入录题页', () => {
        const { page, wx } = loadPage('index', { isLoggedIn: () => false });

        page.goCapture();

        expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/login/login?captureMode=photo' });
    });

    it('首页底部按错题本、拍一题、小精灵排列', () => {
        const markup = readFileSync(resolve('miniprogram/pages/index/index.wxml'), 'utf8');
        const dock = markup.split('class="floating-nav-dock"')[1];
        expect(dock).toBeDefined();
        expect([...dock.matchAll(/class="nav-dock-label">([^<]+)/g)].map((label) => label[1]))
            .toEqual(['错题本', '拍一题', '小精灵']);
    });

    it('首页显示真实统计和额度，下拉刷新后更新统计', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce({
                total: 2,
                items: [{ id: 'q1', questionText: '题目1', originalImageUrl: 'cloud://img/1.jpg' }],
            })
            .mockResolvedValueOnce({ total: 1, items: [{ id: 'q1' }] });
        const getQuota = vi.fn().mockResolvedValue({ accessMode: 'trial', trialRemaining: 2, trialLimit: 3 });
        const { page, wx } = loadPage(
            'index',
            {
                isLoggedIn: () => true,
                getStoredUser: () => ({ name: '小明' }),
                getCachedQuota: () => ({ accessMode: 'trial', trialRemaining: 3, trialLimit: 3 }),
                getQuota,
                request,
            },
            {
                getPetState: () => ({ type: 'cat', name: '算算喵', level: 1, currentExp: 10, maxExp: 40, hasChosenPet: true }),
                getPetSpecies: () => ({ type: 'cat', avatar: '/assets/pets/cat.jpg' }),
                syncPetFromCloud: () => Promise.resolve(),
            }
        );

        page.onShow();
        expect(page.data.quotaSummary).toBe('免费解析 3/3 次');
        await settle();

        expect(page.data.quotaSummary).toBe('免费解析 2/3 次');
        expect(page.data.recentItems[0].hasImage).toBe(true);

        expect(page.data).toMatchObject({ totalCount: 2, unmasteredCount: 1, masteredCount: 1 });
        page.goHome();
        expect(wx.pageScrollTo).toHaveBeenCalledWith({ scrollTop: 0, duration: 180 });

        request
            .mockResolvedValueOnce({ total: 2, items: [] })
            .mockResolvedValueOnce({ total: 0, items: [] });
        page.onPullDownRefresh();
        await settle();
        expect(wx.stopPullDownRefresh).toHaveBeenCalled();
    });
});

describe('小精灵抽奖音频', () => {
    it.each([[true, 'blank'], [false, 'won']] as const)('转盘循环音效切换为结果播报 (%s)', async (isBlank, clip) => {
        const played: Array<{ src: string; loop: boolean }> = [];
        const audio = {
            src: '',
            loop: false,
            play() { played.push({ src: this.src, loop: this.loop }); },
            stop: vi.fn(),
            destroy: vi.fn(),
        };
        const prize = { name: '心愿卡', benefit: '测试' };
        const drawWish = vi.fn().mockReturnValue({ success: true, wonIndex: 0, prize, isBlank });
        const { page } = loadPage('pet', {}, {
            PET_SPECIES: [{}], WHEEL_SEGMENTS: [prize], drawWish,
        }, { createInnerAudioContext: () => audio });
        page.syncPetState = vi.fn();
        page.setData({ pet: { lotteryTickets: 1 } });
        await page.handleDrawWish();
        expect(played).toEqual([
            { src: '/assets/pet-audio/spin.mp3', loop: true },
            { src: '/assets/pet-audio/' + clip + '.mp3', loop: false },
        ]);
        expect(drawWish).toHaveBeenCalledOnce();
        page.onHide();
        expect(audio.destroy).toHaveBeenCalledOnce();
    });
});

describe('欢迎 → 微信登录 → 完善信息', () => {
    it('欢迎页的微信登录按钮进入登录页', () => {
        const markup = readFileSync(resolve('miniprogram/pages/index/index.wxml'), 'utf8');
        expect(markup).toContain('欢迎来到错题本');
        expect(markup).toMatch(/bindtap="goLogin"\s*>微信登录/);
        const { page, wx } = loadPage('index', { isLoggedIn: () => false });
        page.goLogin();
        expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/login/login' });
    });

    it('首次微信登录后先去填写学习台名字，并保留录题模式', async () => {
        const user = { id: 'u1', name: '微信同学', profileCompleted: false };
        const api = {
            getBaseUrl: () => '',
            isCloudMode: () => true,
            setBaseUrl: vi.fn(),
            wechatLogin: vi.fn().mockResolvedValue({ isNewUser: true, user }),
            needsProfile: (u: { profileCompleted?: boolean }) => u?.profileCompleted === false,
        };
        const { page, wx } = loadPage('login', api);
        page.onLoad({ captureMode: 'photo' });
        page.wechatQuickLogin();
        await settle();
        expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/onboarding/onboarding?captureMode=photo' });
    });

    it('已登录但未填名字时首页跳转完善信息', () => {
        const { page, wx } = loadPage('index', {
            isLoggedIn: () => true,
            getStoredUser: () => ({ name: '微信同学', profileCompleted: false }),
            needsProfile: () => true,
        });
        page.onShow();
        expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/onboarding/onboarding' });
    });

    it('完善信息页校验名字并保存后进入首页', async () => {
        const updateProfile = vi.fn().mockResolvedValue({ name: '欣欣', profileCompleted: true });
        const { page, wx } = loadPage('onboarding', {
            isLoggedIn: () => true,
            getStoredUser: () => ({ name: '微信同学' }),
            DEFAULT_USER_NAME: '微信同学',
            PROFILE_NAME_MAX: 12,
            validateProfileName: (n: string) => (String(n || '').trim() ? '' : '请填写名字'),
            updateProfile,
        });
        page.onLoad({});
        expect(page.data.name).toBe('');
        page.submit();
        expect(page.data.errorMessage).toBe('请填写名字');
        expect(updateProfile).not.toHaveBeenCalled();
        page.onNameInput({ detail: { value: '欣欣' } });
        await page.submit();
        expect(updateProfile).toHaveBeenCalledWith({ name: '欣欣' });
        expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' });
    });

    it('设置页可修改学习台名字', async () => {
        const updateProfile = vi.fn().mockResolvedValue({ name: '小明', profileCompleted: true });
        const { page, wx } = loadPage('profile', {
            updateProfile,
            validateProfileName: () => '',
        });
        page.setData({ user: { id: 'u1', name: '欣欣' } });
        page.editName();
        const modal = wx.showModal.mock.calls[0][0] as unknown as {
            content: string;
            success: (r: { confirm: boolean; content: string }) => Promise<void>;
        };
        expect(modal.content).toBe('欣欣');
        await modal.success({ confirm: true, content: '小明' });
        expect(updateProfile).toHaveBeenCalledWith({ name: '小明' });
        expect(page.data.user.name).toBe('小明');
    });
});

describe('小程序登录续接录题', () => {
    const api = {
        getBaseUrl: () => 'https://example.test',
        isCloudMode: () => true,
        setBaseUrl: vi.fn(),
        wechatLogin: vi.fn().mockResolvedValue({ isNewUser: true }),
    };

    it.each(['photo', 'text'])('微信登录后继续进入 %s 模式', async (captureMode) => {
        const { page, wx } = loadPage('login', api);

        page.onLoad({ captureMode });
        page.wechatQuickLogin();
        await settle();

        expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/capture/capture?mode=' + captureMode });
    });

    it('拒绝透传任意页面地址', async () => {
        const { page, wx } = loadPage('login', api);

        page.onLoad({ captureMode: '/pages/profile/profile', next: '/pages/profile/profile' });
        page.wechatQuickLogin();
        await settle();

        expect(wx.redirectTo).not.toHaveBeenCalled();
        expect(wx.navigateBack).toHaveBeenCalledOnce();
    });
});

describe('小程序错题列表', () => {
    it('学科顺序刷新后仍保留原有学科和攻克筛选', async () => {
        const math = { id: 'math', name: '数学' };
        const history = { id: 'history', name: '历史' };
        const fetchNotebooks = vi.fn()
            .mockResolvedValueOnce([math, history])
            .mockResolvedValueOnce([history, math]);
        const request = vi.fn(({ path }: { path: string }) => path === '/api/notebooks'
            ? fetchNotebooks()
            : Promise.resolve(itemList('review')));
        const { page } = loadPage('list', { request, isLoggedIn: () => true });

        page.onLoad({ mastery: '0' });
        page.onShow();
        await settle();
        page.onNotebookChange({ detail: { value: '1' } });
        await settle();
        page.onShow();
        await settle();

        expect(page.data.notebooks[page.data.notebookIndex]).toEqual(math);
        expect(request.mock.calls.at(-1)?.[0].path).toContain('&subjectId=math&mastery=0');
    });

    it('快速切换筛选时，过期分页结果不会覆盖新列表', async () => {
        const pending = deferred<ReturnType<typeof itemList>>();
        const request = vi.fn()
            .mockResolvedValueOnce(itemList('all', 2, 2))
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce(itemList('mastered'));
        const { page } = loadPage('list', { request });

        page.loadItems();
        await settle();
        page.loadMore();
        page.onMasteryFilterTap({ currentTarget: { dataset: { filter: '1' } } });
        await settle();
        pending.resolve(itemList('old-next', 2, 2));
        await settle();

        expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['mastered']);
        expect(page.data.total).toBe(1);
    });

    it('下一页失败时保留前一页，并重试同一页', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce(itemList('first', 2, 2))
            .mockRejectedValueOnce(new Error('连接中断'))
            .mockResolvedValueOnce(itemList('second', 2, 2));
        const { page } = loadPage('list', { request });

        page.loadItems();
        await settle();
        page.loadMore();
        await settle();

        expect(page.data.items[0].id).toBe('first');
        expect(page.data.page).toBe(1);
        expect(page.data.viewState).toBe('ready');
        expect(page.data.loadMoreError).toBeTruthy();

        page.loadMore();
        await settle();

        expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first', 'second']);
        expect(page.data.page).toBe(2);
        expect(page.data.loadMoreError).toBe('');
    });

    it('翻页沿用已提交的搜索词，不混入尚未提交的输入', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce(itemList('first', 2, 2))
            .mockResolvedValueOnce(itemList('second', 2, 2));
        const { page } = loadPage('list', { request });

        page.onSearchInput({ detail: { value: '分数' } });
        page.onSearchConfirm();
        await settle();
        page.onSearchInput({ detail: { value: '函数' } });
        page.loadMore();
        await settle();

        expect(request.mock.calls[1][0].path).toContain('&query=' + encodeURIComponent('分数'));
    });
});

describe('小程序 API 401 处理与自检登录态保护', () => {
    function loadApi(callFunctionImpl: (args: any) => Promise<any>) {
        const storage = new Map<string, unknown>([
            ['mp.cloudLoggedIn', true],
            ['mp.userCache', { id: 'u1', name: '微信同学' }],
        ]);
        const clearLocalPetState = vi.fn();
        const wx = {
            getStorageSync: (k: string) => (storage.has(k) ? storage.get(k) : ''),
            setStorageSync: (k: string, v: unknown) => storage.set(k, v),
            removeStorageSync: (k: string) => storage.delete(k),
            getAccountInfoSync: () => ({ miniProgram: { appId: 'wx29f37952fff2dc57' } }),
            cloud: {
                init: vi.fn(),
                callFunction: vi.fn(callFunctionImpl),
            },
        };
        const mod = { exports: {} as any };
        runInNewContext(readFileSync(resolve('miniprogram/utils/api.js'), 'utf8'), {
            wx,
            module: mod,
            exports: mod.exports,
            getApp: () => ({ globalData: {} }),
            require: (id: string) => {
                if (id === '../config') return require('../../../miniprogram/config');
                if (id === './pet') return { clearLocalPetState };
                throw new Error('Unexpected dependency: ' + id);
            },
        });
        return { api: mod.exports, storage, clearLocalPetState };
    }

    it('healthCheck 收到 401 时不清除当前登录态', async () => {
        const { api, storage, clearLocalPetState } = loadApi(async () => ({
            result: { statusCode: 401, data: { ok: false, message: '健康检查令牌无效' } },
        }));

        expect(api.isLoggedIn()).toBe(true);
        await expect(api.healthCheck()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
            message: '健康检查令牌无效',
        });
        expect(api.isLoggedIn()).toBe(true);
        expect(storage.get('mp.userCache')).toEqual({ id: 'u1', name: '微信同学' });
        expect(clearLocalPetState).not.toHaveBeenCalled();
    });

    it('普通业务接口收到 401 时正常清除当前登录态', async () => {
        const { api, clearLocalPetState } = loadApi(async () => ({
            result: { statusCode: 401, data: { message: '未获取到微信身份凭证，请重试' } },
        }));

        expect(api.isLoggedIn()).toBe(true);
        await expect(api.getQuota()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
            message: '登录已失效，请重新登录',
        });
        expect(api.isLoggedIn()).toBe(false);
        expect(clearLocalPetState).toHaveBeenCalledTimes(1);
    });
});
