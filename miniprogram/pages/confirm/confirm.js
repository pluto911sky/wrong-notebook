const api = require('../../utils/api');
const drafts = require('../../utils/draft');
const petApi = require('../../utils/pet');
const { inferSubject, supportedSubject } = require('../../utils/subjects');
const { syncUiPreferences, showToast, queueToast } = require('../../utils/ui');

Page({
    data: {
        imagePath: '',
        questionText: '',
        wrongAnswerText: '',
        handwrittenAnswer: '',
        handwritingChecked: false,
        answerText: '',
        analysis: '',
        mistakeAnalysis: '',
        knowledgePoints: [],
        analyzed: false,
        analyzingNow: false,
        detailsExpanded: false,
        notebooks: [],
        notebookIndex: -1,
        quota: null,
        viewState: 'loading',
        savePending: false,
        errorMessage: '',
        reduceTransparency: false,
        islandToast: null,
    },

    onLoad() {
        syncUiPreferences(this);
        this.draftOwner = drafts.activeOwner();
        this.draft = drafts.readDraft(this.draftOwner, 'confirm');
        if (!this.draft || !this.draft.requestId) {
            showToast(this, { title: '未找到录题草稿', type: 'warn' });
            this.setData({ viewState: 'error', errorMessage: '请返回采集页重新录题' });
            return;
        }

        const { result, imagePath, savePending } = this.draft;
        const imageAvailable = !imagePath || drafts.imageExists(imagePath);
        this.setData({
            ...result,
            imagePath: imageAvailable ? imagePath : '',
            savePending,
            analyzed: Boolean(result.analyzed || result.answerText || result.analysis),
            quota: api.getCachedQuota(),
            errorMessage: !imageAvailable
                ? (savePending ? '草稿图片已不可用，可重试查询上次保存结果' : '草稿图片已不可用，可补全题干后保存文字')
                : '',
        });
        this.loadNotebooks();
        this.refreshQuota();
    },

    onShow() {
        syncUiPreferences(this);
        if (this.draftOwner && !this.isCurrent()) {
            wx.redirectTo({ url: '/pages/login/login' });
        }
    },

    onUnload() {
        this.unloaded = true;
        clearTimeout(this.redirectTimer);
    },

    isCurrent() {
        return !this.unloaded && Boolean(this.draftOwner) && this.draftOwner === drafts.activeOwner();
    },

    refreshQuota() {
        api.getQuota()
            .then((res) => {
                if (this.isCurrent() && res && res.quota) this.setData({ quota: res.quota });
            })
            .catch(() => {});
    },

    loadNotebooks() {
        api.request({ path: '/api/notebooks' })
            .then((notebooks) => {
                if (!this.isCurrent()) return;
                const list = (notebooks || []).filter((item) => supportedSubject(item.name));
                const { subjectId, result, savePending } = this.draft;
                let index = list.findIndex((item) => item.id === subjectId);
                if (index < 0 && !savePending) {
                    const inferred = inferSubject(this.data.questionText, result.subject);
                    index = list.findIndex((item) => supportedSubject(item.name) === inferred);
                }
                this.setData({
                    notebooks: list,
                    notebookIndex: index,
                    viewState: 'ready',
                });
            })
            .catch((err) => {
                if (this.isCurrent()) {
                    this.setData({ viewState: 'error', errorMessage: err.message || '获取错题本失败' });
                }
            });
    },

    retryNotebooks() {
        if (!this.draft || !this.isCurrent()) return;
        this.setData({ viewState: 'loading', errorMessage: '' });
        this.loadNotebooks();
    },

    persistDraft(patch) {
        if (!this.isCurrent()) return false;
        const next = { ...this.draft, ...patch };
        this.draft = next;
        try {
            return drafts.writeDraft(this.draftOwner, 'confirm', next);
        } catch {
            this.setData({ errorMessage: '本地草稿保存失败，请检查设备存储后重试' });
            return false;
        }
    },

    canEdit() {
        return this.isCurrent() && this.data.viewState === 'ready' && !this.data.savePending;
    },

    editField(field, event) {
        if (!this.canEdit()) return;
        const value = event.detail.value;
        this.setData({ [field]: value });
        const patch = { result: { ...this.draft.result, [field]: value } };
        if (field === 'answerText' || field === 'analysis') {
            patch.editedFields = { ...this.draft.editedFields, [field]: true };
        }
        this.persistDraft(patch);
    },

    onQuestionInput(event) {
        if (!this.canEdit()) return;
        this.editField('questionText', event);
        if (this.draft.subjectId) return;
        const subject = inferSubject(event.detail.value, this.draft.result.subject);
        const notebookIndex = this.data.notebooks.findIndex((item) => supportedSubject(item.name) === subject);
        this.setData({ notebookIndex });
    },

    onWrongAnswerInput(event) {
        this.editField('wrongAnswerText', event);
    },

    onAnswerInput(event) {
        this.editField('answerText', event);
    },

    onAnalysisInput(event) {
        this.editField('analysis', event);
    },

    toggleDetails() {
        this.setData({ detailsExpanded: !this.data.detailsExpanded });
    },

    previewImage() {
        if (!this.isCurrent() || !this.data.imagePath) return;
        wx.previewImage({ urls: [this.data.imagePath] });
    },

    onNotebookChange(event) {
        if (!this.canEdit()) return;
        const index = Number(event.detail.value);
        const notebook = this.data.notebooks[index];
        if (!notebook) return;
        this.setData({ notebookIndex: index });
        this.persistDraft({ subjectId: notebook.id });
    },

    async runAiAnalyzeNow() {
        if (!this.canEdit() || this.data.analyzingNow) return;
        const { imagePath, notebooks, notebookIndex, quota } = this.data;
        const questionText = this.data.questionText.trim();
        const wrongAnswerText = this.data.wrongAnswerText.trim();
        const subject = notebooks[notebookIndex];
        const { mimeType, analysisAttempt: previous } = this.draft;

        if (!questionText && !imagePath) {
            showToast(this, { title: '请先输入题干或上传图片', type: 'warn' });
            return;
        }

        const transcribeHandwriting = Boolean(questionText && imagePath && api.isCloudMode());
        const signature = [questionText, wrongAnswerText, subject && subject.id, imagePath, mimeType, transcribeHandwriting];
        const attempt = drafts.analysisAttempt(previous, signature);
        if (quota && !quota.canAnalyze && attempt !== previous) {
            api.showQuotaExhaustedModal();
            return;
        }
        if (!this.persistDraft({ analysisAttempt: attempt })) return;
        this.setData({ analyzingNow: true, errorMessage: '' });

        try {
            const imageBase64 = await drafts.readImageBase64(imagePath);
            if (!this.isCurrent()) return;
            const payload = { imageBase64: imageBase64 || undefined, mimeType, wrongAnswerText, requestId: attempt.requestId, transcribeHandwriting, language: 'zh' };
            const res = questionText
                ? await api.analyzeText({ ...payload, questionText, subject: subject ? subject.name : '数学' })
                : await api.analyzeImage({ ...payload, subjectId: subject && subject.id });
            if (!this.isCurrent()) return;
            const currentNotebook = this.data.notebooks[this.data.notebookIndex];
            const contentChanged = this.data.questionText.trim() !== questionText ||
                this.data.wrongAnswerText.trim() !== wrongAnswerText ||
                (currentNotebook && currentNotebook.id) !== (subject && subject.id);
            const quotaUpdate = res.quota || this.data.quota;
            if (contentChanged) {
                this.setData({ quota: quotaUpdate, errorMessage: '题干、错解或学科已修改，可按当前内容重新分析' });
                this.persistDraft({ analysisAttempt: null });
                return;
            }

            const result = {
                ...this.draft.result,
                analyzed: true,
                ...(typeof res.handwrittenAnswer === 'string'
                    ? { handwrittenAnswer: res.handwrittenAnswer, handwritingChecked: true }
                    : {}),
                questionText: this.data.questionText || res.questionText || '',
                answerText: this.draft.editedFields.answerText ? this.data.answerText : res.answerText,
                analysis: this.draft.editedFields.analysis ? this.data.analysis : res.analysis,
                mistakeAnalysis: res.mistakeAnalysis || '',
                knowledgePoints: res.knowledgePoints || [],
            };
            this.setData({ ...result, quota: quotaUpdate });
            this.persistDraft({ result, analysisAttempt: null });
            showToast(this, { title: '解析完成', type: 'success' });
        } catch (err) {
            if (!this.isCurrent()) return;
            if (err && err.code === 'AI_TRIAL_EXHAUSTED') {
                if (err.quota) this.setData({ quota: err.quota });
                api.showQuotaExhaustedModal();
            }
            this.setData({ errorMessage: (err && err.message) || '解析失败，可先保存错题' });
        } finally {
            if (this.isCurrent()) this.setData({ analyzingNow: false });
        }
    },

    async save() {
        if (!this.isCurrent() || this.data.viewState !== 'ready' || this.data.analyzingNow) return;
        const {
            imagePath, questionText, wrongAnswerText, answerText, analysis, mistakeAnalysis,
            knowledgePoints, notebooks, notebookIndex, savePending,
        } = this.data;
        const subject = notebooks[notebookIndex];
        const { requestId, mimeType } = this.draft;
        const subjectId = savePending ? this.draft.subjectId : subject && subject.id;
        const cloudMode = api.isCloudMode();
        const lostDraftImage = Boolean(this.draft.imagePath && !imagePath);
        const lookupSaved = () => api.request({
            path: '/api/error-items', method: 'POST', data: { requestId, lookupOnly: true },
        });
        const notFound = (error) => ['SAVE_NOT_FOUND', 'HTTP_404'].includes(error?.code);

        if (!savePending && !questionText.trim() && !imagePath) {
            showToast(this, { title: '请补全题干', type: 'warn' });
            return;
        }
        if (!savePending && !subjectId) {
            showToast(this, { title: '请选择学科', type: 'warn' });
            return;
        }

        this.setData({ viewState: 'saving', errorMessage: '' });
        let pending = savePending;
        let saved;
        try {
            if (savePending && cloudMode) {
                try {
                    saved = await lookupSaved();
                    if (!saved?.id) throw new Error('保存回执无效');
                } catch (error) {
                    if (!notFound(error)) throw error;
                    pending = false;
                }
            }
            if (!saved) {
                if (lostDraftImage) throw new Error('题图已失效，可补全题干后保存文字');
                if (!subjectId) throw new Error('请选择学科');
                const imageBase64 = await drafts.readImageBase64(imagePath);
                if (!this.isCurrent()) return;
                if (!this.persistDraft({ subjectId, imagePath, savePending: true })) {
                    this.setData({ viewState: 'ready' });
                    return;
                }
                pending = true;
                try {
                    saved = await api.request({
                        path: '/api/error-items', method: 'POST', timeout: 120000,
                        data: {
                            requestId,
                            questionText: questionText.trim(),
                            wrongAnswerText: wrongAnswerText.trim(),
                            answerText: answerText.trim(),
                            analysis: analysis.trim(),
                            mistakeAnalysis: mistakeAnalysis.trim(),
                            mistakeStatus: wrongAnswerText.trim() ? 'wrong_attempt' : 'unknown',
                            knowledgePoints,
                            originalImageUrl: imageBase64 ? 'data:' + mimeType + ';base64,' + imageBase64 : '',
                            subjectId,
                        },
                    });
                    if (!saved?.id) throw new Error('保存回执无效');
                } catch (error) {
                    const rejected = /^HTTP_4\d{2}$/.test(error?.code || '') || ['UNAUTHORIZED', 'SESSION_CHANGED'].includes(error?.code);
                    if (rejected) {
                        pending = false;
                        throw error;
                    }
                    if (!cloudMode || !this.isCurrent()) throw error;
                    try {
                        saved = await lookupSaved();
                        if (!saved?.id) throw error;
                    } catch {
                        throw error;
                    }
                }
            }
        } catch (error) {
            if (!this.isCurrent()) return;
            const lostImage = lostDraftImage || (imagePath && !drafts.imageExists(imagePath));
            this.persistDraft({ savePending: pending, ...(!pending && lostImage ? { imagePath: '' } : {}) });
            this.setData({
                viewState: 'ready',
                savePending: pending,
                imagePath: lostImage ? '' : imagePath,
                errorMessage: pending ? (error?.message ? '暂未确认保存：' + error.message : '暂未确认保存，重试不会重复录入') : (error?.message || '保存失败，请重试'),
            });
            return;
        }

        if (!this.isCurrent()) return;
        try {
            drafts.clearDraft(this.draftOwner, 'confirm');
            drafts.releaseImage(imagePath);
        } catch {
            // If cleanup fails, the same request ID can safely retrieve this record again.
        }
        const reward = await Promise.resolve().then(() => petApi.recordPetErrorCaptured(saved && saved.id)).catch(() => null);
        if (!this.isCurrent()) return;
        const toastTitle = reward ? `已保存 · 宠物经验 +${reward.expGained}` : '已保存';
        queueToast({ title: toastTitle, type: 'success' });
        wx.reLaunch({ url: '/pages/index/index' });
    },
});
