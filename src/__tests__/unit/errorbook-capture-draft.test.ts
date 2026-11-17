import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = require("../../../miniprogram/utils/api");
const { createAIService } = require("../../../cloudfunctions/errorbookApi/ai-client");

describe("小程序录题草稿", () => {
    let storage: Map<string, unknown>;

    beforeEach(() => {
        storage = new Map();
        vi.stubGlobal("wx", {
            getStorageSync: (key: string) => storage.get(key),
            setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
            removeStorageSync: (key: string) => storage.delete(key),
        });
        vi.spyOn(api, "isLoggedIn").mockReturnValue(true);
        vi.spyOn(api, "isCloudMode").mockReturnValue(false);
        vi.spyOn(api, "getBaseUrl").mockReturnValue("https://example.test");
        vi.spyOn(api, "getStoredUser").mockReturnValue({ id: "first" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("按账号隔离，只持久化确认页需要的字段", () => {
        const drafts = require("../../../miniprogram/utils/draft");
        const owner = drafts.activeOwner();
        drafts.writeDraft(owner, "confirm", {
            requestId: "save-id",
            imagePath: "wxfile://usr/eb-draft-1.jpg",
            imageBase64: "AAAA",
            result: { questionText: "1+1", apiKey: "should-not-be-stored" },
        });

        expect(drafts.readDraft(owner, "confirm")).toMatchObject({
            requestId: "save-id",
            imagePath: "wxfile://usr/eb-draft-1.jpg",
            result: { questionText: "1+1" },
        });
        expect(JSON.stringify([...storage.values()])).not.toMatch(/AAAA|apiKey|should-not-be-stored/);

        vi.mocked(api.getStoredUser).mockReturnValue({ id: "second" });
        expect(drafts.readDraft(drafts.activeOwner(), "confirm")).toBeNull();
        expect(drafts.readDraft(owner, "confirm")).toBeNull();
        expect(drafts.writeDraft(owner, "confirm", { requestId: "overwritten" })).toBe(false);

        vi.mocked(api.getStoredUser).mockReturnValue({ id: "first" });
        expect(drafts.readDraft(owner, "confirm").requestId).toBe("save-id");
    });

    it("从持久化草稿以相同请求号重试同一分析，编辑输入后产生新请求号", () => {
        const drafts = require("../../../miniprogram/utils/draft");
        const owner = drafts.activeOwner();
        const signature = ["text", "", "题干", "错解"];
        const initial = drafts.analysisAttempt(null, signature);
        drafts.writeDraft(owner, "capture", { analysisAttempt: initial });
        const persisted = drafts.readDraft(owner, "capture").analysisAttempt;
        expect(drafts.analysisAttempt(persisted, signature).requestId).toBe(initial.requestId);
        expect(drafts.analysisAttempt(persisted, ["text", "", "题干", "修订错解"]).requestId).not.toBe(initial.requestId);
    });

    it.each([
        ["给加点字选择正确读音，并写出近义词。", "语文"],
        ["废纸回收后可以生产多少千克再生纸？", "数学"],
        ["Choose the correct answer and fill in the blanks.", "英语"],
        ["观察实验：磁铁能吸引哪些物体？", "科学"],
        ["题干不清", ""],
    ])("按题干推荐学科：%s", (text, expected) => {
        const { inferSubject } = require("../../../miniprogram/utils/subjects");
        expect(inferSubject(text)).toBe(expected);
    });

    it("首次保存回执丢失时自动核对请求号，确认后返回首页", async () => {
        vi.mocked(api.isCloudMode).mockReturnValue(true);
        const drafts = require("../../../miniprogram/utils/draft");
        const pet = require("../../../miniprogram/utils/pet");
        vi.spyOn(pet, "recordPetErrorCaptured").mockReturnValue(null);
        const owner = drafts.activeOwner();
        drafts.writeDraft(owner, "confirm", { requestId: "lost-reply", result: { questionText: "2+3=？" } });
        const saves: object[] = [];
        vi.spyOn(api, "request").mockImplementation(async ({ path, data }: any) => {
            if (path === "/api/notebooks") return [{ id: "math", name: "数学" }];
            saves.push(data);
            if (data.lookupOnly) return { id: "confirmed-item" };
            throw new Error("连接断开");
        });
        vi.spyOn(api, "getQuota").mockResolvedValue({});
        const reLaunch = vi.fn();
        Object.assign(Reflect.get(globalThis, "wx"), { showToast: vi.fn(), reLaunch });
        vi.stubGlobal("getApp", () => ({ globalData: {} }));
        let definition: any;
        vi.stubGlobal("Page", (page: any) => { definition = page; });
        const path = require.resolve("../../../miniprogram/pages/confirm/confirm");
        delete require.cache[path];
        try {
            require(path);
            const page = {
                ...definition,
                data: { ...definition.data },
                setData(patch: object) { Object.assign(this.data, patch); },
            };
            page.onLoad();
            await Promise.resolve();
            await page.save();
            expect(saves).toEqual([
                expect.objectContaining({ requestId: "lost-reply", subjectId: "math" }),
                { requestId: "lost-reply", lookupOnly: true },
            ]);
            expect(reLaunch).toHaveBeenCalledWith({ url: "/pages/index/index" });
        } finally {
            delete require.cache[path];
        }
    });

    it("校对页重进后用原请求号确认已保存的题，即使本地原图已丢失", async () => {
        vi.useFakeTimers();
        vi.mocked(api.isCloudMode).mockReturnValue(true);
        const drafts = require("../../../miniprogram/utils/draft");
        const pet = require("../../../miniprogram/utils/pet");
        vi.spyOn(pet, "recordPetErrorCaptured").mockReturnValue(null);
        const owner = drafts.activeOwner();
        drafts.writeDraft(owner, "confirm", {
            requestId: "save-once",
            subjectId: "math",
            imagePath: "wxfile://usr/eb-draft-photo.jpg",
            savePending: true,
            result: { questionText: "1+1=？" },
        });

        let definition: any;
        vi.stubGlobal("Page", (page: any) => { definition = page; });
        const path = require.resolve("../../../miniprogram/pages/confirm/confirm");
        delete require.cache[path];
        const request = vi.spyOn(api, "request").mockImplementation(async ({ path, data }: any) => {
            if (path === "/api/notebooks") return [{ id: "math", name: "数学" }];
            if (data?.lookupOnly) return { id: "saved-item" };
            throw new Error("不应重传保存状态未知的题图");
        });
        vi.spyOn(api, "getQuota").mockResolvedValue({});
        const reLaunch = vi.fn();
        vi.stubGlobal("getApp", () => ({ globalData: {} }));
        Object.assign(Reflect.get(globalThis, "wx"), { showToast: vi.fn(), reLaunch });

        try {
            require(path);
            const page = {
                ...definition,
                data: { ...definition.data },
                setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
            };
            page.onLoad();
            await Promise.resolve();
            await page.save();
            expect(request).toHaveBeenCalledWith(expect.objectContaining({
                path: "/api/error-items", method: "POST",
                data: { requestId: "save-once", lookupOnly: true },
            }));
            expect(drafts.readDraft(owner, "confirm")).toBeNull();
            await vi.runAllTimersAsync();
            expect(reLaunch).toHaveBeenCalledWith({ url: "/pages/index/index" });
        } finally {
            delete require.cache[path];
            vi.useRealTimers();
        }
    });
});

describe("云函数模型响应校验", () => {
    function createMockService(content: string) {
        const requestImpl = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
        const service = createAIService({ OPENAI_API_KEY: "test-key" }, { requestImpl });
        return { service, requestImpl };
    }

    it("拒绝纯文本与伪装成字符串的对象字段", async () => {
        const plain = createMockService("暂时无法识题，请重新上传。");
        await expect(plain.service.ocrImage({ imageBase64: "AAAA" })).rejects.toThrow(/识题/);

        const wrongType = createMockService('{"answerText":{"value":"2"},"analysis":"两数相加"}');
        await expect(wrongType.service.reanswerQuestion({ questionText: "1+1" })).rejects.toThrow(/解析/);
    });

    it("将学生错解传给模型，并对缺少错解的结果标明通用提示", async () => {
        const { service, requestImpl } = createMockService('{"answerText":"2","analysis":"直接相加","mistakeAnalysis":"记错加法规则"}');
        const result = await service.reanswerQuestion({ questionText: "1+1", wrongAnswerText: "我算成3" });
        expect(requestImpl.mock.calls[0][1].body.messages[1].content).toContain("我算成3");
        expect(result.mistakeAnalysis).toBe("记错加法规则");

        const generic = await service.reanswerQuestion({ questionText: "1+1" });
        expect(generic.mistakeAnalysis).toMatch(/^常见易错提示/);
    });
});
