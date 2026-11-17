const api = require('../../utils/api');
const { syncUiPreferences } = require('../../utils/ui');

Page({
    data: {
        notebooks: [{ id: '', name: '全部学科' }],
        notebookIndex: 0,
        notebooksError: '',
        masteryFilter: 'all', // all | 0 | 1
        searchQuery: '',
        appliedSearchQuery: '',
        items: [],
        total: 0,
        page: 1,
        pageSize: 18,
        totalPages: 1,
        viewState: 'loading', // loading | ready | error | loadingMore
        errorMessage: '',
        loadMoreError: '',
        reduceTransparency: false,
        islandToast: null,
    },

    onLoad(query) {
        syncUiPreferences(this);
        if (query && (query.mastery === '0' || query.mastery === '1')) {
            this.setData({ masteryFilter: query.mastery });
        }
    },

    onShow() {
        syncUiPreferences(this);
        if (!api.isLoggedIn()) {
            this.goLogin();
            return;
        }
        this.loadNotebooks();
        this.loadItems();
    },

    onUnload() {
        this.notebooksRequestId = (this.notebooksRequestId || 0) + 1;
        this.itemsRequestId = (this.itemsRequestId || 0) + 1;
    },

    loadNotebooks() {
        const requestId = (this.notebooksRequestId || 0) + 1;
        this.notebooksRequestId = requestId;
        this.setData({ notebooksError: '' });
        api.request({ path: '/api/notebooks' })
            .then((notebooks) => {
                if (requestId !== this.notebooksRequestId) return;
                const selected = this.data.notebooks[this.data.notebookIndex];
                const list = [{ id: '', name: '全部学科' }].concat(notebooks || []);
                const index = list.findIndex((notebook) => selected && notebook.id === selected.id);
                this.setData({
                    notebooks: list,
                    notebookIndex: Math.max(index, 0),
                });
                if (index === -1) this.loadItems();
            })
            .catch((err) => {
                if (requestId !== this.notebooksRequestId) return;
                if (err && err.code === 'UNAUTHORIZED') {
                    this.goLogin();
                    return;
                }
                this.setData({ notebooksError: '学科加载失败' });
            });
    },

    onNotebookChange(event) {
        const index = Number(event.detail.value);
        this.setData({ notebookIndex: index });
        this.loadItems();
    },

    onMasteryFilterTap(event) {
        const filter = event.currentTarget.dataset.filter;
        if (!filter || filter === this.data.masteryFilter) return;
        this.setData({ masteryFilter: filter });
        this.loadItems();
    },

    onSearchInput(event) {
        this.setData({ searchQuery: event.detail.value });
    },

    onSearchConfirm() {
        this.setData({ appliedSearchQuery: this.data.searchQuery.trim() });
        this.loadItems();
    },

    clearSearch() {
        this.setData({ searchQuery: '', appliedSearchQuery: '' });
        this.loadItems();
    },

    retryLoad() {
        this.loadItems();
    },

    loadItems(page = 1) {
        const requestId = (this.itemsRequestId || 0) + 1;
        this.itemsRequestId = requestId;
        const { notebooks, notebookIndex, masteryFilter, appliedSearchQuery, pageSize } = this.data;
        const isFirstPage = page === 1;
        const subject = notebooks[notebookIndex];
        const subjectId = subject && subject.id ? subject.id : '';
        let path = '/api/error-items/list?page=' + page + '&pageSize=' + pageSize;
        if (subjectId) {
            path += '&subjectId=' + encodeURIComponent(subjectId);
        }
        if (masteryFilter === '0' || masteryFilter === '1') {
            path += '&mastery=' + masteryFilter;
        }
        if (appliedSearchQuery) {
            path += '&query=' + encodeURIComponent(appliedSearchQuery);
        }

        this.setData({ viewState: isFirstPage ? 'loading' : 'loadingMore', loadMoreError: '', errorMessage: '' });
        api.request({ path })
            .then((res) => {
                if (requestId !== this.itemsRequestId) return;
                const mapped = (res.items || []).map((item) => ({
                    id: item.id,
                    subjectName: (item.subject && item.subject.name) || '未分类',
                    brief: this.briefOf(item.questionText),
                    hasImage: item.hasImage ?? Boolean(item.originalImageUrl),
                    hasAiAnalysis: item.hasAiAnalysis ?? Boolean(item.answerText || item.analysis),
                    mastered: (item.masteryLevel || 0) > 0,
                    createdText: this.timeText(item.createdAt),
                }));
                const items = isFirstPage ? mapped : this.data.items.concat(mapped);
                this.setData({
                    items,
                    page,
                    total: res.total || 0,
                    totalPages: res.totalPages || 1,
                    viewState: 'ready',
                });
            })
            .catch((err) => {
                if (requestId !== this.itemsRequestId) return;
                if (err && err.code === 'UNAUTHORIZED') {
                    this.goLogin();
                    return;
                }
                this.setData(isFirstPage
                    ? { viewState: 'error', errorMessage: (err && err.message) || '加载失败' }
                    : { viewState: 'ready', loadMoreError: '下一页加载失败' });
            });
    },

    briefOf(text) {
        if (!text) return '（无题干文字，含原图）';
        const clean = String(text).replace(/\s+/g, ' ').trim();
        return clean.length > 52 ? clean.slice(0, 52) + '…' : clean;
    },

    timeText(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.getMonth() + 1 + '月' + d.getDate() + '日';
    },

    loadMore() {
        if (this.data.viewState !== 'ready') return;
        if (this.data.page >= this.data.totalPages) return;
        this.loadItems(this.data.page + 1);
    },

    goLogin() {
        if (this.redirectingToLogin) return;
        this.redirectingToLogin = true;
        wx.redirectTo({
            url: '/pages/login/login',
            fail: () => { this.redirectingToLogin = false; },
        });
    },

    goCapture() {
        wx.navigateTo({ url: '/pages/capture/capture' });
    },

    goDetail(event) {
        const id = event.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) });
    },
});
