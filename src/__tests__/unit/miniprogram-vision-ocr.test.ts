import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

function bootVision(anchors?: Array<{ text?: string; subtext?: string }>, needsFrame = false) {
    const frameBuffer = new ArrayBuffer(12 * 8 * 4);
    let onAnchors: (value: typeof anchors) => void;
    const session = {
        on: vi.fn((_event, callback) => { onAnchors = callback; }),
        start: vi.fn((ready) => ready(null)),
        runOCR: vi.fn(() => { if (anchors && !needsFrame) onAnchors(anchors); }),
        getVKFrame: vi.fn(() => { if (anchors && needsFrame) onAnchors(anchors); }),
        requestAnimationFrame: vi.fn((callback: () => void) => setTimeout(callback, 16)),
        cancelAnimationFrame: vi.fn(clearTimeout),
        destroy: vi.fn(),
    };
    const wx = {
        getImageInfo: vi.fn(({ success }) => success({ width: 12, height: 8 })),
        createOffscreenCanvas: vi.fn(() => {
            const image = { onload: () => {}, set src(_path: string) { this.onload(); } };
            return {
                createImage: () => image,
                getContext: () => ({
                    drawImage: vi.fn(),
                    getImageData: () => ({ data: new Uint8ClampedArray(frameBuffer) }),
                }),
            };
        }),
        createVKSession: vi.fn(() => session),
    };
    const module = { exports: {} as {
        recognizeImage: (filePath: string, getWebGLContext: () => Promise<object>) => Promise<string>;
    } };
    runInNewContext(readFileSync('miniprogram/utils/vision-ocr.js', 'utf8'), {
        module, wx, setTimeout, clearTimeout,
    });
    return { ...module.exports, session, wx, frameBuffer };
}

describe('微信端侧静态图 OCR', () => {
    afterEach(() => vi.useRealTimers());

    it('把截图中的材料与分问分开，省略分值和后面的作答', async () => {
        const { recognizeImage } = bootVision([{
            text: '月3.废纸属于可回收物，相当于保护17棵大树。 (1)如果纸厂回收了36t废纸，大约可以重新生产出多少千克再生纸? (6分)36136订:850x36=30600(4克)答:大约可以重新306克。',
        }]);
        await expect(recognizeImage('crop.jpg', async () => ({}))).resolves.toBe(
            '3.废纸属于可回收物，相当于保护17棵大树。\n\n(1)如果纸厂回收了36t废纸，大约可以重新生产出多少千克再生纸?',
        );
    });

    it('保留后续小问、选项、题内分数单位和公式', async () => {
        const { recognizeImage } = bootVision([{
            text: '答题时间为（6分钟）。(1)求 x。\n2x = 6。请写出计算过程？（4分）\n(2)得了6分的是谁？\nA. 小明\nB. 小红',
        }]);
        await expect(recognizeImage('crop.jpg', async () => ({}))).resolves.toBe(
            '答题时间为（6分钟）。\n\n(1)求 x。\n2x = 6。请写出计算过程？\n\n(2)得了6分的是谁？\nA. 小明\nB. 小红',
        );
    });

    it('将本地裁剪题图转成 RGBA，并提取题干全文', async () => {
        const { recognizeImage, session, wx, frameBuffer } = bootVision([
            { text: '求 x 的值。\n2x + 3 = 11', subtext: '求 x 的值。' },
            { text: '求 x 的值。\n2x + 3 = 11', subtext: '2x + 3 = 11' },
        ]);
        const gl = {};
        await expect(recognizeImage('local-crop.jpg', async () => gl)).resolves.toBe('求 x 的值。\n2x + 3 = 11');
        expect(wx.getImageInfo).toHaveBeenCalledWith(expect.objectContaining({ src: 'local-crop.jpg' }));
        expect(wx.createVKSession).toHaveBeenCalledWith({ track: { OCR: { mode: 2 } }, version: 'v1', gl });
        expect(session.runOCR).toHaveBeenCalledWith({ frameBuffer, width: 12, height: 8 });
        expect(session.destroy).toHaveBeenCalledOnce();
    });

    it('无回调时结束等待并释放识别会话', async () => {
        vi.useFakeTimers();
        const { recognizeImage, session } = bootVision();
        const result = expect(recognizeImage('local-crop.jpg', async () => ({}))).rejects.toThrow('识题超时');
        await vi.runAllTimersAsync();
        await result;
        expect(session.destroy).toHaveBeenCalledOnce();
        expect(session.cancelAnimationFrame).toHaveBeenCalledOnce();
    });

    it('主动读取 VisionKit 帧，拿到题干后停止等待', async () => {
        vi.useFakeTimers();
        const { recognizeImage, session } = bootVision([{ text: '求 x 的值。' }], true);
        const completed = expect(recognizeImage('crop.jpg', async () => ({}))).resolves.toBe('求 x 的值。');
        await vi.advanceTimersByTimeAsync(40);
        await completed;
        expect(session.getVKFrame).toHaveBeenCalledOnce();
        expect(session.cancelAnimationFrame).toHaveBeenCalledOnce();
        expect(session.destroy).toHaveBeenCalledOnce();
    });
});

describe('拍照录题的识题入口', () => {
    function bootCapture(hasChosenPet = true) {
        const api = {
            isLoggedIn: () => true,
            analyzeImage: vi.fn(),
            ocrImage: vi.fn(),
            getCachedQuota: vi.fn(),
        };
        const drafts = {
            activeOwner: () => 'test-owner',
            readDraft: vi.fn(),
            readImageBase64: vi.fn().mockResolvedValue('base64'),
        };
        const localOcr = { recognizeImage: vi.fn().mockResolvedValue('2x + 3 = 11') };
        const dependencies = {
            '../../utils/api': api,
            '../../utils/draft': drafts,
            '../../utils/pet': {
                getPetState: () => ({ hasChosenPet }),
                syncPetFromCloud: async () => ({ hasChosenPet }),
            },
            '../../utils/vision-ocr': localOcr,
            '../../utils/ui': { queueToast: vi.fn(), syncUiPreferences: vi.fn() },
        };
        const wx = { redirectTo: vi.fn() };
        // Capture the real page definition with platform and storage stand-ins.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let page: any;
        runInNewContext(readFileSync('miniprogram/pages/capture/capture.js', 'utf8'), {
            Page: (definition: { data: Record<string, unknown> }) => { page = definition; },
            require: (key: keyof typeof dependencies) => dependencies[key],
            wx,
            setTimeout, clearTimeout,
        });
        page.draftOwner = 'test-owner';
        page.defaultMode = 'photo';
        page.setData = (patch: object) => Object.assign(page.data, patch);
        page.stageConfirm = vi.fn();
        page.restoreDraft();
        page.setData({ imagePath: 'local-crop.jpg', viewState: 'ready' });
        return { page, api, drafts, localOcr, wx };
    }

    it('首次拍照默认走端侧 OCR，将题干送入校对页', async () => {
        const { page, api, drafts, localOcr } = bootCapture();
        expect(page.data.aiEnabled).toBe(false);
        await page.handlePhotoSubmit();
        expect(localOcr.recognizeImage).toHaveBeenCalledOnce();
        expect(drafts.readImageBase64).not.toHaveBeenCalled();
        expect(api.ocrImage).not.toHaveBeenCalled();
        expect(api.analyzeImage).not.toHaveBeenCalled();
        expect(page.stageConfirm).toHaveBeenCalledWith({ questionText: '2x + 3 = 11', analyzed: false }, 'photo');
    });

    it('云解析缺少模型配置时回退到手机识题', async () => {
        const { page, api, localOcr } = bootCapture();
        page.beginAnalysis = () => 'test-request';
        page.data.aiEnabled = true;
        api.analyzeImage.mockRejectedValueOnce({ code: 'AI_NOT_CONFIGURED' });
        await page.handlePhotoSubmit();
        expect(api.analyzeImage).toHaveBeenCalledOnce();
        expect(localOcr.recognizeImage).toHaveBeenCalledOnce();
        expect(page.stageConfirm).toHaveBeenCalledWith({ questionText: '2x + 3 = 11', analyzed: false }, 'photo');
    });

    it('手机识题超时后只在用户主动选择时上传同一题图走云 OCR', async () => {
        const { page, api, localOcr } = bootCapture();
        localOcr.recognizeImage.mockRejectedValueOnce(new Error('手机识题超时'));
        api.ocrImage.mockResolvedValueOnce({ questionText: '135° 的角怎么画？' });
        await page.handlePhotoSubmit();
        expect(page.data.photoOcrFailed).toBe(true);
        expect(api.ocrImage).not.toHaveBeenCalled();
        await page.handleCloudOcr();
        expect(api.ocrImage).toHaveBeenCalledWith({ imageBase64: 'base64', mimeType: 'image/jpeg' });
        expect(api.analyzeImage).not.toHaveBeenCalled();
        expect(page.stageConfirm).toHaveBeenCalledWith({ questionText: '135° 的角怎么画？', analyzed: false }, 'photo');
    });

    it('拍照和文字入口都要求先领养，并保留录题方式', async () => {
        const { page, wx } = bootCapture(false);
        await page.onLoad({ mode: 'text' });
        expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/pet/pet?captureMode=text' });
        await page.onLoad({ mode: 'photo' });
        expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/pet/pet?captureMode=photo' });
    });
});

it('只有确认领养才继续原录题方式，关闭面板不会默认领养', async () => {
    const switchPetSpecies = vi.fn().mockReturnValue({ hasChosenPet: true });
    const petApi = {
        PET_SPECIES: [{ type: 'fox' }],
        WHEEL_SEGMENTS: [{}],
        switchPetSpecies,
        getPetState: () => ({ hasChosenPet: true }),
    };
    const wx = { redirectTo: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page: any;
    runInNewContext(readFileSync('miniprogram/pages/pet/pet.js', 'utf8'), {
        Page: (definition: { data: Record<string, unknown> }) => { page = definition; },
        require: (key: string) => key === '../../utils/pet' ? petApi : { syncUiPreferences: vi.fn() },
        wx,
    });
    page.setData = (patch: object) => Object.assign(page.data, patch);
    page.onLoad({ captureMode: 'text' });
    page.data.pet = { hasChosenPet: false, type: 'cat' };
    page.closeSpeciesPicker();
    expect(switchPetSpecies).not.toHaveBeenCalled();
    expect(wx.redirectTo).not.toHaveBeenCalled();
    await page.confirmSelectSpecies();
    expect(switchPetSpecies).toHaveBeenCalledWith('fox', '');
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/capture/capture?mode=text' });
});
