const api = require('./api');
const config = require('../config');

const MAX_IMAGE_BYTES = 1000 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const imageTypes = ['image/jpeg', 'image/png', 'image/gif'];

function activeOwner() {
    if (!api.isLoggedIn()) return '';
    const user = api.getStoredUser();
    if (!user || !user.id) return '';
    const backend = api.isCloudMode() ? 'cloud:' + config.resourceEnv : api.getBaseUrl();
    return JSON.stringify([backend, String(user.id)]);
}

function newRequestId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function storageKey(owner) {
    return 'mp.errorbookDraft.v1.' + encodeURIComponent(owner);
}

function readDraft(owner, stage) {
    if (!owner || owner !== activeOwner()) return null;
    const saved = wx.getStorageSync(storageKey(owner));
    const value = saved && saved[stage];
    return value && typeof value === 'object' ? sanitizeDraft(stage, value) : null;
}

function asText(value) {
    return typeof value === 'string' ? value : '';
}

function sanitizeDraft(stage, value) {
    const { imagePath, mimeType, analysisAttempt: attempt } = value;
    const base = {
        imagePath: asText(imagePath),
        mimeType: imageTypes.includes(mimeType) ? mimeType : 'image/jpeg',
        analysisAttempt: attempt && asText(attempt.requestId) && asText(attempt.signature)
            ? { requestId: attempt.requestId, signature: attempt.signature }
            : null,
    };

    if (stage === 'capture') {
        return {
            ...base,
            inputMode: value.inputMode === 'text' ? 'text' : 'photo',
            typedQuestion: asText(value.typedQuestion),
            typedWrongAnswer: asText(value.typedWrongAnswer),
            aiEnabled: value.aiEnabled !== false,
        };
    }

    const result = value.result || {};
    return {
        ...base,
        requestId: asText(value.requestId),
        subjectId: asText(value.subjectId),
        savePending: value.savePending === true,
        editedFields: value.editedFields && typeof value.editedFields === 'object'
            ? { answerText: value.editedFields.answerText === true, analysis: value.editedFields.analysis === true }
            : {},
        result: {
            subject: asText(result.subject),
            questionText: asText(result.questionText),
            wrongAnswerText: asText(result.wrongAnswerText),
            handwrittenAnswer: asText(result.handwrittenAnswer).slice(0, 2000),
            handwritingChecked: result.handwritingChecked === true,
            answerText: asText(result.answerText),
            analysis: asText(result.analysis),
            mistakeAnalysis: asText(result.mistakeAnalysis),
            analyzed: result.analyzed === true,
            knowledgePoints: Array.isArray(result.knowledgePoints)
                ? result.knowledgePoints.filter((item) => typeof item === 'string').slice(0, 8)
                : [],
        },
    };
}

function writeDraft(owner, stage, value) {
    if (!owner || owner !== activeOwner()) return false;
    const key = storageKey(owner);
    const saved = wx.getStorageSync(key) || {};
    wx.setStorageSync(key, { ...saved, [stage]: sanitizeDraft(stage, value) });
    return true;
}

function promoteDraft(owner, draft, otherInput) {
    if (!owner || owner !== activeOwner()) return false;
    const key = storageKey(owner);
    const saved = wx.getStorageSync(key) || {};
    if (saved.confirm) return false;
    const next = { confirm: sanitizeDraft('confirm', draft) };
    if (otherInput && (otherInput.imagePath || otherInput.typedQuestion || otherInput.typedWrongAnswer)) {
        next.capture = sanitizeDraft('capture', otherInput);
    }
    wx.setStorageSync(key, next);
    return true;
}

function clearDraft(owner, stage) {
    if (!owner || owner !== activeOwner()) return;
    const key = storageKey(owner);
    const saved = wx.getStorageSync(key) || {};
    delete saved[stage];
    if (saved.capture || saved.confirm) {
        wx.setStorageSync(key, saved);
    } else {
        wx.removeStorageSync(key);
    }
}

function clearAccountDrafts() {
    const owner = activeOwner();
    if (!owner) return;
    const key = storageKey(owner);
    const saved = wx.getStorageSync(key) || {};
    for (const stage of ['capture', 'confirm']) releaseImage(saved[stage]?.imagePath);
    wx.removeStorageSync(key);
}

function analysisAttempt(previous, input) {
    const signature = JSON.stringify(input);
    return previous && previous.signature === signature
        ? previous
        : { requestId: newRequestId(), signature };
}

function keepImage(filePath, mimeType) {
    const fileSystem = wx.getFileSystemManager();
    if (fileSystem.statSync(filePath).size > MAX_IMAGE_BYTES) {
        throw new Error('图片过大，请重新框选单题或裁剪后再试');
    }
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const savedPath = wx.env.USER_DATA_PATH + '/eb-draft-' + newRequestId() + '.' + ext;
    fileSystem.copyFileSync(filePath, savedPath);
    return savedPath;
}

function releaseImage(imagePath) {
    if (!imagePath || !imagePath.startsWith(wx.env.USER_DATA_PATH + '/eb-draft-')) return;
    try {
        wx.getFileSystemManager().unlinkSync(imagePath);
    } catch {
        // The file may already have been removed by the device.
    }
}

function imageExists(imagePath) {
    if (!imagePath) return false;
    try {
        wx.getFileSystemManager().accessSync(imagePath);
        return true;
    } catch {
        return false;
    }
}

function readImageBase64(imagePath) {
    if (!imagePath) return Promise.resolve('');
    return new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
            filePath: imagePath,
            encoding: 'base64',
            success({ data }) {
                if (!data || data.length > MAX_BASE64_LENGTH) {
                    reject(new Error('图片不可用或过大，请重新选图'));
                    return;
                }
                resolve(data);
            },
            fail() {
                reject(new Error('读取草稿图片失败，请重新选图'));
            },
        });
    });
}

module.exports = {
    activeOwner,
    newRequestId,
    readDraft,
    writeDraft,
    promoteDraft,
    clearDraft,
    clearAccountDrafts,
    analysisAttempt,
    keepImage,
    releaseImage,
    imageExists,
    readImageBase64,
};
