const api = require('../../utils/api');
const drafts = require('../../utils/draft');
const petApi = require('../../utils/pet');
const { recognizeImage } = require('../../utils/vision-ocr');
const { syncUiPreferences, showToast, queueToast, haptic } = require('../../utils/ui');

const MIN_CROP_SIZE = 52;

Page({
    data: {
        inputMode: 'photo', // photo | text
        // 原图与裁剪后图片
        rawImagePath: '',
        rawWidth: 0,
        rawHeight: 0,
        imagePath: '',
        mimeType: 'image/jpeg',
        // 自由框选裁剪舞台尺寸与框坐标 (单位: px)
        stageWidth: 320,
        stageHeight: 240,
        cropX: 20,
        cropY: 20,
        cropW: 280,
        cropH: 200,
        croppingBusy: false,
        // 打字输入
        typedQuestion: '',
        typedWrongAnswer: '',
        // 方案 A：底部 AI 分析开关与额度
        aiEnabled: false,
        quota: null,
        viewState: 'idle', // idle | cropping | ready | analyzing | error
        stageText: '',
        errorMessage: '',
        photoOcrFailed: false,
        hasConfirmDraft: false,
        checkingPet: false,
        reduceTransparency: false,
        islandToast: null,
    },

    async onLoad(query) {
        syncUiPreferences(this);
        this.draftOwner = drafts.activeOwner();
        this.defaultMode = query && query.mode === 'text' ? 'text' : 'photo';
        if (!api.isLoggedIn()) {
            queueToast({ title: '请先登录后继续录题', type: 'warn' });
            wx.redirectTo({ url: '/pages/login/login?captureMode=' + this.defaultMode });
            return;
        }
        if (!this.draftOwner) {
            wx.redirectTo({ url: '/pages/login/login?captureMode=' + this.defaultMode });
            return;
        }
        if (!petApi.getPetState().hasChosenPet) {
            this.setData({ checkingPet: true });
            const pet = await petApi.syncPetFromCloud();
            if (!this.isCurrent()) return;
            if (!pet.hasChosenPet) {
                wx.redirectTo({ url: '/pages/pet/pet?captureMode=' + this.defaultMode });
                return;
            }
            this.setData({ checkingPet: false });
            this.restoreDraft();
            this.refreshQuota();
            return;
        }
        this.restoreDraft();
    },

    onShow() {
        syncUiPreferences(this);
        if (this.data.checkingPet) return;
        if (this.isCurrent()) {
            if (this.needsRestore) this.restoreDraft();
            this.refreshQuota();
        } else if (this.draftOwner) {
            wx.redirectTo({ url: '/pages/login/login?captureMode=' + this.defaultMode });
        }
    },

    refreshQuota() {
        api.getQuota().then((res) => {
            if (!this.isCurrent() || !res || !res.quota) return;
            const nextData = { quota: res.quota };
            const canRetry = this.captureDraft && this.captureDraft.analysisAttempt;
            if (!res.quota.canAnalyze && !canRetry) nextData.aiEnabled = false;
            this.setData(nextData);
        }).catch(() => {});
    },

    onUnload() {
        this.unloaded = true;
        clearTimeout(this.stageTimer);
    },

    isCurrent() {
        return !this.unloaded && Boolean(this.draftOwner) && this.draftOwner === drafts.activeOwner();
    },

    restoreDraft() {
        this.needsRestore = false;
        const stored = drafts.readDraft(this.draftOwner, 'capture');
        const quota = api.getCachedQuota();
        this.captureDraft = stored || {};
        const imagePath = stored && drafts.imageExists(stored.imagePath) ? stored.imagePath : '';
        this.setData({
            inputMode: (stored && stored.inputMode) || this.defaultMode,
            typedQuestion: (stored && stored.typedQuestion) || '',
            typedWrongAnswer: (stored && stored.typedWrongAnswer) || '',
            aiEnabled: stored ? stored.aiEnabled : this.defaultMode === 'text' && (!quota || quota.canAnalyze),
            imagePath,
            rawImagePath: '',
            mimeType: (stored && stored.mimeType) || 'image/jpeg',
            hasConfirmDraft: Boolean(drafts.readDraft(this.draftOwner, 'confirm')),
            quota,
            viewState: imagePath ? 'ready' : 'idle',
            stageText: '',
            errorMessage: stored && stored.imagePath && !imagePath ? '草稿图片已不可用，请重新选图' : '',
        });
    },

    updateCapture(patch, viewPatch = patch) {
        if (!this.isCurrent()) return false;
        const next = { ...this.captureDraft, ...this.data, ...patch };
        try {
            if (!drafts.writeDraft(this.draftOwner, 'capture', next)) return false;
        } catch {
            this.setData({ errorMessage: '本地草稿保存失败，请检查设备存储后重试' });
            return false;
        }
        this.captureDraft = next;
        this.setData(viewPatch);
        return true;
    },

    resumeConfirm() {
        if (!this.isCurrent() || this.navigating) return;
        this.navigating = true;
        this.needsRestore = true;
        wx.navigateTo({
            url: '/pages/confirm/confirm',
            complete: () => { this.navigating = false; },
        });
    },

    switchInputMode(event) {
        const mode = event.currentTarget.dataset.mode;
        if (!mode || this.data.viewState === 'analyzing') return;
        this.updateCapture({
            inputMode: mode,
            errorMessage: '',
        });
    },

    goProfile() {
        wx.navigateTo({ url: '/pages/profile/profile' });
    },

    toggleAiEnabled() {
        const { aiEnabled, quota } = this.data;
        if (!aiEnabled && quota && !quota.canAnalyze && !(this.captureDraft && this.captureDraft.analysisAttempt)) {
            api.showQuotaExhaustedModal();
            return;
        }
        haptic('light');
        this.updateCapture({ aiEnabled: !aiEnabled });
    },

    chooseImage(event) {
        if (!this.isCurrent() || this.data.croppingBusy) return;
        const sourceType = [event.currentTarget.dataset.source]; // camera | album
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType,
            sizeType: ['original', 'compressed'],
            success: (res) => {
                const file = res.tempFiles && res.tempFiles[0];
                if (!file) return;
                this.enterCropMode(file.tempFilePath);
            },
            fail: () => {},
        });
    },

    // 进入「单道错题框选裁剪」模式
    enterCropMode(filePath) {
        if (!this.isCurrent()) return;
        wx.getImageInfo({
            src: filePath,
            success: (info) => {
                if (!this.isCurrent()) return;
                const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
                const windowWidth = sys.windowWidth || 375;
                const windowHeight = sys.windowHeight || 667;
                // 页面左右 padding 各 28rpx + 卡片左右内边距 20rpx
                const maxStageW = Math.max(240, Math.round(windowWidth - (96 * windowWidth) / 750));
                const maxStageH = Math.max(240, Math.round(windowHeight * 0.54));

                const natW = info.width || 1000;
                const natH = info.height || 1000;
                const ratio = natW / natH;

                let stageW = maxStageW;
                let stageH = Math.round(stageW / ratio);
                if (stageH > maxStageH) {
                    stageH = maxStageH;
                    stageW = Math.round(stageH * ratio);
                }

                this.setData({
                    rawImagePath: filePath,
                    rawWidth: natW,
                    rawHeight: natH,
                    stageWidth: stageW,
                    stageHeight: stageH,
                    cropX: 0,
                    cropY: 0,
                    cropW: stageW,
                    cropH: stageH,
                    viewState: 'cropping',
                    errorMessage: '',
                });
            },
            fail: () => {
                if (this.isCurrent()) this.setData({ errorMessage: '无法读取图片尺寸，请重新选图' });
            },
        });
    },

    reopenCropMode() {
        const filePath = this.data.rawImagePath || this.data.imagePath;
        if (filePath) {
            this.enterCropMode(filePath);
        }
    },

    resetCropToFull() {
        const { stageWidth, stageHeight } = this.data;
        this.setData({
            cropX: 0,
            cropY: 0,
            cropW: stageWidth,
            cropH: stageHeight,
        });
    },

    useFullImageDirectly() {
        const { rawWidth, rawHeight } = this.data;
        this.exportSelection(0, 0, rawWidth, rawHeight);
    },

    // 触摸拖动裁剪框 / 四个角柄
    onCropTouchStart(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        const handle = event.currentTarget.dataset.handle || 'move';
        this.cropDrag = {
            handle,
            startX: touch.clientX,
            startY: touch.clientY,
            origX: this.data.cropX,
            origY: this.data.cropY,
            origW: this.data.cropW,
            origH: this.data.cropH,
        };
    },

    onCropTouchMove(event) {
        const touch = event.touches && event.touches[0];
        const drag = this.cropDrag;
        if (!touch || !drag) return;

        const dx = touch.clientX - drag.startX;
        const dy = touch.clientY - drag.startY;
        const { stageWidth, stageHeight } = this.data;

        let x = drag.origX;
        let y = drag.origY;
        let w = drag.origW;
        let h = drag.origH;

        if (drag.handle === 'move') {
            x = Math.max(0, Math.min(stageWidth - w, drag.origX + dx));
            y = Math.max(0, Math.min(stageHeight - h, drag.origY + dy));
        } else {
            if (drag.handle.includes('l')) {
                const maxLeft = drag.origX + drag.origW - MIN_CROP_SIZE;
                x = Math.max(0, Math.min(maxLeft, drag.origX + dx));
                w = drag.origW + (drag.origX - x);
            }
            if (drag.handle.includes('r')) {
                w = Math.max(MIN_CROP_SIZE, Math.min(stageWidth - drag.origX, drag.origW + dx));
            }
            if (drag.handle.includes('t')) {
                const maxTop = drag.origY + drag.origH - MIN_CROP_SIZE;
                y = Math.max(0, Math.min(maxTop, drag.origY + dy));
                h = drag.origH + (drag.origY - y);
            }
            if (drag.handle.includes('b')) {
                h = Math.max(MIN_CROP_SIZE, Math.min(stageHeight - drag.origY, drag.origH + dy));
            }
        }

        this.setData({
            cropX: Math.round(x),
            cropY: Math.round(y),
            cropW: Math.round(w),
            cropH: Math.round(h),
        });
    },

    onCropTouchEnd() {
        this.cropDrag = null;
    },

    confirmCrop() {
        const { rawWidth, rawHeight, stageWidth, stageHeight, cropX, cropY, cropW, cropH } = this.data;
        const scaleX = rawWidth / stageWidth;
        const scaleY = rawHeight / stageHeight;
        const sx = Math.max(0, Math.round(cropX * scaleX));
        const sy = Math.max(0, Math.round(cropY * scaleY));
        const sw = Math.min(rawWidth - sx, Math.round(cropW * scaleX));
        const sh = Math.min(rawHeight - sy, Math.round(cropH * scaleY));
        this.exportSelection(sx, sy, sw, sh);
    },

    exportSelection(sx, sy, sw, sh) {
        const { rawImagePath, croppingBusy } = this.data;
        if (!this.isCurrent() || !rawImagePath || croppingBusy || sw <= 0 || sh <= 0) return;
        this.setData({ croppingBusy: true, errorMessage: '' });

        const downscale = Math.min(1, 1400 / sw, 1800 / sh);
        const width = Math.max(1, Math.round(sw * downscale));
        const height = Math.max(1, Math.round(sh * downscale));
        const showExportError = () => {
            if (this.isCurrent()) this.setData({ croppingBusy: false, errorMessage: '导出图片失败，请重新框选或选图' });
        };

        // 云函数 imgSecCheck 与草稿层都限制题图 ≤ 1000*1024 字节。
        // 真机原图容易超限，这里自动降质/缩小输出，避免直接弹「图片过大」导致流程中断。
        const MAX_EXPORT_BYTES = 900 * 1024;
        const EXPORT_ATTEMPTS = [
            { quality: 0.86, scale: 1 },
            { quality: 0.72, scale: 1 },
            { quality: 0.58, scale: 1 },
            { quality: 0.72, scale: 0.75 },
            { quality: 0.55, scale: 0.6 },
        ];

        this.createSelectorQuery().select('#cropCanvas').fields({ node: true }).exec((res) => {
            if (!this.isCurrent()) return;
            const canvas = res && res[0] && res[0].node;
            if (!canvas) {
                showExportError();
                return;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const img = canvas.createImage();
            img.onload = () => {
                if (!this.isCurrent()) return;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

                const exportAttempt = (index) => {
                    const step = EXPORT_ATTEMPTS[index];
                    if (!step) {
                        if (this.isCurrent()) {
                            this.setData({ croppingBusy: false, errorMessage: '题图压缩后仍过大，请缩小框选范围后重试' });
                        }
                        return;
                    }
                    wx.canvasToTempFilePath({
                        canvas,
                        width,
                        height,
                        destWidth: Math.max(1, Math.round(width * step.scale)),
                        destHeight: Math.max(1, Math.round(height * step.scale)),
                        fileType: 'jpg',
                        quality: step.quality,
                        success: (file) => {
                            if (!this.isCurrent()) return;
                            let size = 0;
                            try {
                                size = wx.getFileSystemManager().statSync(file.tempFilePath).size;
                            } catch (err) {
                                // 无法取到大小时交给草稿层的大小校验兜底
                                size = 0;
                            }
                            if (size > MAX_EXPORT_BYTES) {
                                exportAttempt(index + 1);
                                return;
                            }
                            this.setData({ croppingBusy: false });
                            this.readImage(file.tempFilePath);
                        },
                        fail: showExportError,
                    });
                };
                exportAttempt(0);
            };
            img.onerror = showExportError;
            img.src = rawImagePath;
        });
    },

    readImage(filePath) {
        if (!this.isCurrent()) return;
        const previousPath = this.data.imagePath;
        let savedPath = '';
        try {
            const mimeType = 'image/jpeg';
            savedPath = drafts.keepImage(filePath, mimeType);
            if (this.updateCapture(
                { imagePath: savedPath, mimeType, analysisAttempt: null },
                {
                    imagePath: savedPath,
                    mimeType,
                    rawImagePath: this.data.rawImagePath === previousPath ? '' : this.data.rawImagePath,
                    viewState: 'ready',
                    errorMessage: '',
                }
            )) {
                drafts.releaseImage(previousPath);
            } else {
                drafts.releaseImage(savedPath);
            }
        } catch (err) {
            drafts.releaseImage(savedPath);
            this.setData({
                viewState: this.data.rawImagePath ? 'cropping' : (previousPath ? 'ready' : 'idle'),
                errorMessage: err && /^图片过大/.test(err.message) ? err.message : '无法保存草稿图片，请重新选图或检查设备存储',
            });
        }
    },

    previewImage() {
        if (!this.data.imagePath) return;
        wx.previewImage({ urls: [this.data.imagePath] });
    },

    retake() {
        const previousPath = this.data.imagePath;
        const cleared = this.updateCapture(
            { imagePath: '', analysisAttempt: null },
            { rawImagePath: '', imagePath: '', viewState: 'idle', errorMessage: '' }
        );
        if (cleared) drafts.releaseImage(previousPath);
    },

    handlePhotoSubmit() {
        return this.submitPhoto(this.data.aiEnabled ? 'analyze' : 'ocr');
    },

    handleCloudOcr() {
        return this.submitPhoto('cloudOcr');
    },

    handleTextSubmit() {
        this.submitText(this.data.aiEnabled);
    },

    stageConfirm(result, inputMode) {
        if (!this.isCurrent()) return;
        const { imagePath, mimeType, typedQuestion, typedWrongAnswer, aiEnabled } = this.data;
        const draft = {
            requestId: drafts.newRequestId(),
            imagePath: inputMode === 'photo' ? imagePath : '',
            mimeType,
            result,
        };
        const otherInput = inputMode === 'photo'
            ? { inputMode: 'text', typedQuestion, typedWrongAnswer, aiEnabled }
            : { inputMode: 'photo', imagePath, mimeType, aiEnabled };

        try {
            if (!drafts.promoteDraft(this.draftOwner, draft, otherInput)) {
                this.restoreDraft();
                return;
            }
        } catch {
            this.setData({ errorMessage: '本地草稿保存失败，请检查设备存储后重试' });
            return;
        }
        this.setData({ hasConfirmDraft: true });
        this.resumeConfirm();
    },

    skipToManualConfirm() {
        if (!this.data.imagePath || this.data.viewState === 'analyzing') return;
        this.stageConfirm({ subject: '数学' }, 'photo');
    },

    beginAnalysis(signature) {
        const previous = this.captureDraft && this.captureDraft.analysisAttempt;
        const attempt = drafts.analysisAttempt(previous, signature);
        const { quota } = this.data;
        if (quota && !quota.canAnalyze && attempt !== previous) {
            this.setData({ aiEnabled: false });
            api.showQuotaExhaustedModal();
            return '';
        }
        if (!this.updateCapture({ analysisAttempt: attempt }, {})) return '';
        return attempt.requestId;
    },

    getOcrWebGLContext() {
        return new Promise((resolve) => {
            this.createSelectorQuery().select('#ocrCanvas').fields({ node: true }).exec((res) => {
                const canvas = res && res[0] && res[0].node;
                try {
                    resolve(canvas ? canvas.getContext('webgl') : null);
                } catch {
                    resolve(null);
                }
            });
        });
    },

    async submitPhoto(mode) {
        const { imagePath, mimeType, viewState } = this.data;
        if (!this.isCurrent() || !imagePath || viewState === 'analyzing' || this.data.hasConfirmDraft) return;
        const requestId = mode === 'analyze' ? this.beginAnalysis([mode, imagePath, mimeType]) : '';
        if (mode === 'analyze' && !requestId) return;

        this.setData({
            viewState: 'analyzing',
            stageText: mode === 'analyze' ? '正在识别题干并生成解析…'
                : mode === 'cloudOcr' ? '正在云端提取题干…' : '正在手机上识别题干…',
            errorMessage: '',
            photoOcrFailed: false,
        });
        if (mode === 'analyze') {
            this.stageTimer = setTimeout(() => {
                if (this.isCurrent()) this.setData({ stageText: '正在生成参考答案与步骤解析…' });
            }, 1500);
        }

        let usedLocalOcr = false;
        try {
            let result;
            let analyzed = false;
            if (mode !== 'ocr') {
                const imageBase64 = await drafts.readImageBase64(imagePath);
                if (!this.isCurrent()) return;
                const payload = { imageBase64, mimeType };
                try {
                    result = mode === 'cloudOcr' ? await api.ocrImage(payload)
                        : await api.analyzeImage({ ...payload, language: 'zh', requestId });
                    analyzed = mode === 'analyze';
                } catch (error) {
                    if (mode !== 'analyze' || !error || error.code !== 'AI_NOT_CONFIGURED') throw error;
                    if (!this.isCurrent()) return;
                    clearTimeout(this.stageTimer);
                    this.setData({ stageText: '改用手机识题…' });
                }
            }
            if (!result && mode !== 'cloudOcr') {
                usedLocalOcr = true;
                const questionText = await recognizeImage(imagePath, () => this.getOcrWebGLContext());
                result = { questionText };
            }
            if (!this.isCurrent()) return;
            this.setData({
                viewState: 'ready',
                stageText: '',
                quota: result.quota || this.data.quota,
            });
            this.stageConfirm({ ...result, analyzed }, 'photo');
        } catch (err) {
            if (this.isCurrent()) this.setData({ photoOcrFailed: usedLocalOcr });
            this.showSubmitError(err, 'ready', mode !== 'analyze'
                ? '扫描失败，可改为手动填写题干'
                : '解析失败，可先保存错题');
        } finally {
            clearTimeout(this.stageTimer);
        }
    },

    onTypedQuestionInput(event) {
        this.setData({ typedQuestion: event.detail.value });
        this.updateCapture({}, {});
    },

    onTypedWrongAnswerInput(event) {
        this.setData({ typedWrongAnswer: event.detail.value });
        this.updateCapture({}, {});
    },

    async submitText(analyze) {
        if (!this.isCurrent() || this.data.viewState === 'analyzing' || this.data.hasConfirmDraft) return;
        const questionText = this.data.typedQuestion.trim();
        const wrongAnswerText = this.data.typedWrongAnswer.trim();
        if (!questionText) {
            showToast(this, { title: '请先输入或粘贴错题题干', type: 'warn' });
            return;
        }
        if (!analyze) {
            this.stageConfirm({ questionText, wrongAnswerText }, 'text');
            return;
        }

        const requestId = this.beginAnalysis(['text', questionText, wrongAnswerText]);
        if (!requestId) return;
        this.setData({ viewState: 'analyzing', stageText: '正在生成参考答案与步骤解析…', errorMessage: '' });
        try {
            const result = await api.analyzeText({ questionText, wrongAnswerText, requestId, language: 'zh' });
            if (!this.isCurrent()) return;
            this.setData({
                viewState: this.data.imagePath ? 'ready' : 'idle',
                stageText: '',
                quota: result.quota || this.data.quota,
            });
            this.stageConfirm({ ...result, questionText, wrongAnswerText, analyzed: true }, 'text');
        } catch (err) {
            this.showSubmitError(err, this.data.imagePath ? 'ready' : 'idle', '解析失败，可先保存错题');
        }
    },

    showSubmitError(err, viewState, fallback) {
        if (!this.isCurrent()) return;
        const patch = { viewState, stageText: '', errorMessage: (err && err.message) || fallback };
        if (err && err.code === 'AI_TRIAL_EXHAUSTED') {
            patch.aiEnabled = false;
            if (err.quota) patch.quota = err.quota;
        }
        this.setData(patch);
    },
});
