import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createCore } = require("../../../cloudfunctions/errorbookApi/core");
const { createAdapter } = require("../../../cloudfunctions/errorbookApi/adapter");
const {
    parseJsonFromAI,
    resolveAIConfig,
    inspectPlatformAIConfig,
    buildOpenAIRequest,
    buildGeminiRequest,
    callModel,
    createAIService,
} = require("../../../cloudfunctions/errorbookApi/ai-client");

function createMemoryCloudDeps(openId = "openid-wx-1") {
    const store = new Map<string, Map<string, Record<string, unknown>>>();
    const ensureCol = (c: string) => {
        if (!store.has(c)) store.set(c, new Map<string, Record<string, unknown>>());
        return store.get(c)!;
    };
    let seq = 1;

    const db = {
        async readDoc(col: string, id: string) {
            return ensureCol(col).get(id) || null;
        },
        async setDoc(col: string, id: string, data: Record<string, unknown>) {
            const doc = { _id: id, ...data };
            ensureCol(col).set(id, doc);
            return doc;
        },
        async addDoc(col: string, data: Record<string, unknown>) {
            const id = `doc_${seq++}`;
            const doc = { _id: id, id, ...data };
            ensureCol(col).set(id, doc);
            return doc;
        },
        async updateDoc(col: string, id: string, patch: Record<string, unknown>) {
            const cur = ensureCol(col).get(id);
            if (!cur) throw new Error("not found");
            ensureCol(col).set(id, { ...cur, ...patch });
        },
        async removeDoc(col: string, id: string) {
            ensureCol(col).delete(id);
        },
        async queryDocs(
            col: string,
            {
                where = {},
                orderByField,
                orderDir = "desc", limit, skip = 0,
            }: { where?: Record<string, unknown>; orderByField?: string; orderDir?: string; limit?: number; skip?: number } = {}
        ) {
            const list = Array.from(ensureCol(col).values()).filter((item) =>
                Object.entries(where).every(([k, v]) => item[k] === v)
            );
            if (orderByField) {
                list.sort((a, b) => {
                    const av = a[orderByField] || "";
                    const bv = b[orderByField] || "";
                    return orderDir === "asc"
                        ? String(av).localeCompare(String(bv))
                        : String(bv).localeCompare(String(av));
                });
            }
            return list.slice(skip, limit === undefined ? undefined : skip + limit);
        },
        async countDocs(col: string, where: Record<string, unknown> = {}) {
            return (await this.queryDocs(col, { where })).length;
        },
    };
    let transactionTail: Promise<unknown> = Promise.resolve();
    const runTransaction = (_collections: string[], action: (ops: typeof db) => Promise<unknown>) => {
        const result = transactionTail.then(async () => {
            const snapshot = structuredClone(store);
            try {
                return await action(db);
            } catch (error) {
                store.clear();
                for (const [name, documents] of snapshot) store.set(name, documents);
                throw error;
            }
        });
        transactionTail = result.catch(() => {});
        return result;
    };

    const files = {
        uploadBase64Image: vi.fn().mockResolvedValue("cloud://vision-prod.img/eb_images/demo.jpg"),
        getTempUrls: vi.fn().mockResolvedValue({
            "cloud://vision-prod.img/eb_images/demo.jpg": "https://cdn.example/demo.jpg",
        }),
        deleteFiles: vi.fn().mockResolvedValue(undefined),
        downloadBase64: vi.fn().mockResolvedValue("aGVsbG8="),
    };

    const security = {
        checkText: vi.fn().mockImplementation(async (txt: string) =>
            String(txt).includes("违规词") ? { ok: false, reason: "内容违规" } : { ok: true }
        ),
        checkImage: vi.fn().mockResolvedValue({ ok: true }),
    };

    const ai = {
        generatePractice: vi.fn().mockResolvedValue({
            similar: { questionText: "3x + 5 = 20", answerText: "x = 5", analysis: "移项后除以 3" },
            advanced: { questionText: "2(x + 3) - 5 = 11", answerText: "x = 5", analysis: "先去括号，再移项" },
            challenge: { questionText: "2(x + 3) = 3(x - 1)", answerText: "x = 9", analysis: "展开两边后合并同类项" },
        }),
        ocrImage: vi.fn().mockResolvedValue({ questionText: "1+1=?", subject: "数学", requiresImage: false }),
        analyzeImage: vi.fn().mockResolvedValue({
            questionText: "已知 x+1=2",
            subject: "数学",
            answerText: "x=1",
            analysis: "移项得 x=1",
            mistakeAnalysis: "计算符号注意",
            knowledgePoints: ["一元一次方程"],
            requiresImage: false,
        }),
        reanswerQuestion: vi.fn().mockResolvedValue({
            answerText: "x=3",
            analysis: "步骤解析",
            mistakeAnalysis: "易错点",
            knowledgePoints: ["代数"],
        }),
    };

    const handler = createCore({
        db: {
            ...db,
            runTransaction,
            async countUnmasteredItems(collection: string, userId: string) {
                return (await db.queryDocs(collection, { where: { userId } }))
                    .filter((item) => Number(item.masteryLevel || 0) <= 0).length;
            },
            async listErrorItems(collection: string, { userId, subjectId, mastery, search, skip, limit }: any) {
                const rows = (await db.queryDocs(collection, {
                    where: { userId }, orderByField: "createdAt",
                })).filter((item) => (!subjectId || item.subjectId === subjectId) &&
                    (mastery !== "0" || !item.masteryLevel) &&
                    (mastery !== "1" || Number(item.masteryLevel) > 0) &&
                    (!search || [item.questionText, item.subjectName, item.knowledgePoints]
                        .flat().some((value) => String(value || "").toLowerCase().includes(search.toLowerCase()))));
                return { rows: rows.slice(skip, skip + limit), total: rows.length };
            },
        },
        collections: {
            users: "eb_users",
            notebooks: "eb_notebooks",
            errorItems: "eb_error_items",
            pets: "eb_pets",
            analysisRequests: "eb_analysis_requests",
            quotaCards: "eb_quota_cards",
        },
        files,
        security,
        ai,
        getIdentity: () => ({ FROM_OPENID: openId }),
    });

    return { handler, files, security, ai, db };
}

describe("CloudBase 云函数 errorbookApi 核心引擎", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("OCR 返回上游状态以定位失败，且不透出模型接口原文", async () => {
        const { handler, ai } = createMemoryCloudDeps();
        ai.ocrImage.mockRejectedValueOnce(Object.assign(new Error("private upstream details"), { statusCode: 401 }));
        const result = await handler({
            path: "/api/ocr",
            method: "POST",
            data: { imageBase64: "aGVsbG8=" },
        });
        expect(result.statusCode).toBe(502);
        expect(result.data).toMatchObject({ code: "OCR_UPSTREAM_ERROR", upstreamStatus: 401 });
        expect(JSON.stringify(result.data)).not.toContain("private upstream details");
    });

    it("拍照智能解析缺少模型配置时提示手动录入并保留试用额度", async () => {
        const { handler, ai } = createMemoryCloudDeps();
        ai.analyzeImage.mockRejectedValueOnce(Object.assign(new Error("private config details"), { code: "AI_NOT_CONFIGURED" }));
        const result = await handler({
            path: "/api/analyze",
            method: "POST",
            data: { imageBase64: "aGVsbG8=", requestId: "missing-ai-config" },
        });
        expect(result.statusCode).toBe(502);
        expect(result.data).toEqual({
            code: "AI_NOT_CONFIGURED",
            message: "解析服务未配置，可先保存，未扣次数",
        });
        const quota = await handler({ path: "/api/user/quota", method: "GET" });
        expect(quota.data.quota.trialRemaining).toBe(100);
    });

    it("腾讯云 OCR 仅识别印刷体并按原题分行，独立于解析模型", async () => {
        const tencentRequest = vi.fn().mockResolvedValue({
            TextDetections: [
                { DetectedText: "（1）怎么画？（5分）", ItemPolygon: { X: 20, Y: 50 } },
                { DetectedText: "3. 画一个135°的角。", ItemPolygon: { X: 10, Y: 10 } },
            ],
        });
        const ai = createAIService({
            AI_OCR_PROVIDER: "tencent",
            TENCENT_OCR_SECRET_ID: "test-id",
            TENCENT_OCR_SECRET_KEY: "test-key",
        }, { tencentRequest });
        await expect(ai.ocrImage({ imageBase64: "aGVsbG8=", subjectHint: "数学" })).resolves.toEqual({
            questionText: "3. 画一个135°的角。\n\n（1）怎么画？",
            subject: "数学",
            requiresImage: true,
        });
        expect(tencentRequest).toHaveBeenCalledWith({
            ImageBase64: "aGVsbG8=", ConfigID: "OCR", IsWords: false, WordsType: "2",
        });
        expect(ai.inspectConfig()).toMatchObject({
            ocr: { ok: true, provider: "tencent" }, solve: { ok: false },
        });
    });

    it("腾讯云 OCR 缺少凭据时不改用另一个模型服务", async () => {
        const requestImpl = vi.fn();
        const ai = createAIService({
            AI_OCR_PROVIDER: "tencent",
            OPENAI_API_KEY: "test-solve-key",
        }, { requestImpl });
        expect(ai.inspectConfig()).toMatchObject({
            ocr: { ok: false, provider: "tencent" }, solve: { ok: true },
        });
        await expect(ai.ocrImage({ imageBase64: "aGVsbG8=" })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
        expect(requestImpl).not.toHaveBeenCalled();
    });

    it("图片识题与解析都要求保留印刷题面和表格结构", async () => {
        const questionText = "根据图 1 作答。\n\n| x | y |\n| --- | --- |\n| 2 | 4 |";
        const response = {
            choices: [{ message: { content: JSON.stringify({
                questionText, answerText: "4", analysis: "按图表读取", requiresImage: true,
            }) } }],
        };
        const requestImpl = vi.fn(async (_url: string, _options: { body: { messages: Array<{ content: unknown }> } }) => response);
        const ai = createAIService({ OPENAI_API_KEY: "test-key" }, { requestImpl });
        const image = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" };
        await expect(ai.ocrImage(image)).resolves.toMatchObject({ questionText, requiresImage: true });
        await expect(ai.analyzeImage(image)).resolves.toMatchObject({ questionText, requiresImage: true });
        for (const [, options] of requestImpl.mock.calls) {
            const prompt = options.body.messages[0].content;
            expect(prompt).toEqual(expect.stringContaining("只抄录印刷体"));
            expect(prompt).toEqual(expect.stringContaining("忽略手写"));
            expect(prompt).toEqual(expect.stringContaining("Markdown 表格"));
            expect(prompt).toEqual(expect.stringContaining("requiresImage"));
        }
    });

    it("应支持微信共享云环境登录与默认学科本，并关闭未验证的激励发放", async () => {
        const { handler } = createMemoryCloudDeps("shared_user_openid_1");

        const loginRes = await handler({
            path: "/api/auth/wechat",
            method: "POST",
            data: { nickname: "欣欣同学" },
        });
        expect(loginRes.statusCode).toBe(200);
        expect(loginRes.data.isNewUser).toBe(true);
        expect(loginRes.data.quota.trialRemaining).toBe(100);

        const nbRes = await handler({ path: "/api/notebooks", method: "GET" });
        expect(nbRes.statusCode).toBe(200);
        expect(nbRes.data.map((n: any) => n.name)).toEqual(["语文", "数学", "英语", "科学"]);

        const reward = await handler({ path: "/api/user/ad-reward", method: "POST" });
        expect(reward.statusCode).toBe(403);
        const redeem = await handler({ path: "/api/user/quota", method: "POST", data: { action: "redeem_code", code: "PACK10" } });
        expect(redeem.statusCode).toBe(400);
    });

    it("首次登录需完善学习台名字，保存后标记完成并可再次修改", async () => {
        const { handler } = createMemoryCloudDeps("profile_user_openid");
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        expect(login.data.user).toMatchObject({ name: "微信同学", profileCompleted: false });

        expect((await handler({ path: "/api/user/profile", method: "POST", data: { name: "  " } })).statusCode).toBe(400);
        expect((await handler({ path: "/api/user/profile", method: "POST", data: { name: "一二三四五六七八九十一二三" } })).statusCode).toBe(400);
        expect((await handler({ path: "/api/user/profile", method: "POST", data: { name: "违规词" } })).statusCode).toBe(400);

        const saved = await handler({ path: "/api/user/profile", method: "POST", data: { name: " 欣欣 " } });
        expect(saved.statusCode).toBe(200);
        expect(saved.data.user).toMatchObject({ name: "欣欣", profileCompleted: true });

        await handler({ path: "/api/user/profile", method: "POST", data: { name: "小明" } });
        const session = await handler({ path: "/api/auth/session", method: "GET" });
        expect(session.data.user).toMatchObject({ name: "小明", profileCompleted: true });
    });

    it("为所属错题生成三关练习，依次答对才发放经验且重练不重复发放", async () => {
        const { handler, db, ai } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        const userId = login.data.user.id;
        await db.setDoc("eb_error_items", "exercise", {
            userId, questionText: "2x + 3 = 11", subjectName: "数学", knowledgePoints: ["一元一次方程"],
        });
        const event = { path: "/api/error-items/exercise/practice", method: "POST" };
        const first = await handler(event);
        expect(first.statusCode).toBe(200);
        expect(first.data.practice.similar.questionText).toBe("3x + 5 = 20");
        expect(first.data.practice.advanced.questionText).toBe("2(x + 3) - 5 = 11");
        expect(first.data.practice.challenge.questionText).toBe("2(x + 3) = 3(x - 1)");
        expect(first.data.practice.similar.answerText).toBeUndefined();
        expect(first.data.quota.trialRemaining).toBe(99);
        expect((await handler(event)).data).toEqual(first.data);
        expect(ai.generatePractice).toHaveBeenCalledTimes(1);
        const submit = (stage: string, answer: string) => handler({
            path: "/api/error-items/exercise/practice-answer", method: "POST", data: { stage, answer },
        });
        expect((await submit("advanced", "x=5")).statusCode).toBe(409);
        expect((await submit("similar", "x=4")).data).toMatchObject({ correct: false, experience: 0 });
        const repeated = await Promise.all([submit("similar", "ｘ＝５"), submit("similar", "5")]);
        expect(repeated.map((result) => result.data.experience).sort()).toEqual([0, 5]);
        expect(repeated.every((result) => result.data.correct && result.data.totalExperience === 5)).toBe(true);
        expect((await submit("advanced", "x=5")).data).toMatchObject({ correct: true, experience: 10, totalExperience: 15 });
        expect((await submit("challenge", "x=9")).data).toMatchObject({ correct: true, experience: 15, totalExperience: 30 });
        expect((await handler({ path: "/api/pet" })).data.practiceExperience).toBe(30);
        await db.setDoc("eb_error_items", "foreign", { userId: "another-user", questionText: "其他错题" });
        expect((await handler({ ...event, path: "/api/error-items/foreign/practice" })).statusCode).toBe(404);
        await db.updateDoc("eb_error_items", "exercise", { questionText: "5x + 3 = 13" });
        ai.generatePractice.mockResolvedValueOnce({ similar: first.data.practice.similar });
        expect((await handler(event)).statusCode).toBe(502);
        const quota = await handler({ path: "/api/user/quota" });
        expect(quota.data.quota.trialRemaining).toBe(99);
    });

    it("已有两关的错题在额度耗尽后仍能补齐第三关", async () => {
        const { handler, db, ai } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        const userId = login.data.user.id;
        await db.updateDoc("eb_users", userId, { aiTrialUsed: 100, aiTrialLimit: 3 });
        const questionText = "2x + 3 = 11";
        await db.setDoc("eb_error_items", "legacy", {
            userId, questionText, practiceSource: questionText,
            practice: {
                similar: { questionText: "3x + 5 = 20" },
                advanced: { questionText: "2(x + 3) - 5 = 11" },
            },
        });
        const result = await handler({ path: "/api/error-items/legacy/practice", method: "POST" });
        expect(result.statusCode).toBe(200);
        expect(result.data.practice.challenge.questionText).toBe("2(x + 3) = 3(x - 1)");
        expect(ai.generatePractice).toHaveBeenCalledOnce();
        expect((await db.readDoc("eb_users", userId))?.aiTrialUsed).toBe(100);
    });

    it("应完整覆盖 100 次试用扣减、402 耗尽拦截并关闭 BYOK 绑定", async () => {
        const { handler } = createMemoryCloudDeps("shared_user_openid_2");
        await handler({ path: "/api/auth/wechat", method: "POST", data: {} });

        // OCR 不消耗试用次数
        const ocr = await handler({
            path: "/api/ocr",
            method: "POST",
            data: { imageBase64: "aGVsbG8=" },
        });
        expect(ocr.statusCode).toBe(200);
        expect(ocr.data.questionText).toBe("1+1=?");

        // 消耗 100 次文本分析
        for (let i = 0; i < 100; i += 1) {
            const res = await handler({
                path: "/api/reanswer",
                method: "POST",
                data: { questionText: `测试题 ${i}` },
            });
            expect(res.statusCode).toBe(200);
            expect(res.data.quota.trialRemaining).toBe(99 - i);
        }

        // 第 101 次应拦截返回 402
        const exhausted = await handler({
            path: "/api/reanswer",
            method: "POST",
            data: { questionText: "第 101 题" },
        });
        expect(exhausted.statusCode).toBe(402);
        expect(exhausted.data.code).toBe("AI_TRIAL_EXHAUSTED");

        // 发布环境关闭自有 Key 绑定
        const bindRes = await handler({
            path: "/api/user/quota",
            method: "POST",
            data: {
                action: "save_api_key",
                customAiProvider: "openai",
                customApiKey: "sk-custom-key-123456",
                customBaseUrl: "https://api.deepseek.com/v1",
                customModel: "deepseek-chat",
            },
        });
        expect(bindRes.statusCode).toBe(403);
    });

    it("次卡限管理员生成，兑换并发只到账一次，先用免费次数", async () => {
        const { handler, db } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        const userId = login.data.user.id;
        const quotaAction = (data: object) => handler({ path: "/api/user/quota", method: "POST", data });
        expect((await quotaAction({ action: "issue_card", amount: 300 })).statusCode).toBe(403);
        await db.updateDoc("eb_users", userId, { role: "admin" });
        expect((await quotaAction({ action: "issue_card", amount: 20 })).statusCode).toBe(400);
        const issued = await quotaAction({ action: "issue_card", amount: 300 });
        expect(issued.statusCode).toBe(201);
        const revoked = await quotaAction({ action: "issue_card", amount: 1000 });
        expect((await quotaAction({ action: "revoke_card", code: revoked.data.code })).statusCode).toBe(200);
        const storedCard = await db.readDoc("eb_quota_cards", issued.data.cardId);
        expect(JSON.stringify(storedCard)).not.toContain(issued.data.code.replace(/-/g, ""));
        await db.updateDoc("eb_users", userId, { role: "user" });
        expect((await quotaAction({ action: "redeem_code", code: revoked.data.code })).statusCode).toBe(409);
        const results = await Promise.all([
            quotaAction({ action: "redeem_code", code: issued.data.code }),
            quotaAction({ action: "redeem_code", code: issued.data.code.toLowerCase() }),
        ]);
        expect(results.map((r) => r.data.granted).sort((a, b) => a - b)).toEqual([0, 300]);
        const analysis = await handler({ path: "/api/reanswer", method: "POST", data: { questionText: "2+3=?" } });
        expect(analysis.data.quota).toMatchObject({ trialRemaining: 99, paidQuota: 300 });
        await db.updateDoc("eb_users", userId, { aiTrialUsed: 100 });
        const paid = await handler({ path: "/api/reanswer", method: "POST", data: { questionText: "2+3=?" } });
        expect(paid.data.quota).toMatchObject({ trialRemaining: 0, paidQuota: 299 });
    });

    it("经确认才能重置本账号；清除关联记录，保留他人数据和已核销卡状态", async () => {
        const { handler, db, files } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        const userId = login.data.user.id;
        await db.setDoc("eb_error_items", "mine", { userId, originalImageFileId: "cloud://test/mine.jpg" });
        await db.setDoc("eb_error_items", "other", { userId: "other" });
        await db.setDoc("eb_pets", userId, { level: 3 });
        await db.setDoc("eb_analysis_requests", "mine-analysis", { userId });
        await db.setDoc("eb_quota_cards", "old-card", { redeemedBy: userId, amount: 300, status: "redeemed" });
        await db.updateDoc("eb_users", userId, { aiTrialUsed: 15, aiPaidQuota: 42, practiceExperience: 30 });
        const reset = (confirm = "") => handler({
            path: "/api/user/reset", method: "POST", data: { confirm, requestId: "reset-once" },
        });
        expect((await reset()).statusCode).toBe(400);
        expect(await db.readDoc("eb_error_items", "mine")).toBeTruthy();
        expect((await reset("RESET_ACCOUNT")).data).toMatchObject({ reset: true });
        expect(files.deleteFiles).toHaveBeenCalledWith(["cloud://test/mine.jpg"], { strict: true });
        expect(await db.readDoc("eb_error_items", "mine")).toBeNull();
        expect(await db.readDoc("eb_error_items", "other")).toBeTruthy();
        expect(await db.readDoc("eb_pets", userId)).toBeNull();
        expect(await db.readDoc("eb_analysis_requests", "mine-analysis")).toBeNull();
        expect(await db.readDoc("eb_quota_cards", "old-card")).toMatchObject({ status: "redeemed", redeemedBy: null });
        const fresh = await handler({ path: "/api/auth/wechat", method: "POST" });
        expect(fresh.data.quota).toMatchObject({ trialRemaining: 85, paidQuota: 42 });
        await db.setDoc("eb_error_items", "new", { userId });
        expect((await reset("RESET_ACCOUNT")).data).toMatchObject({ reset: true });
        expect(await db.readDoc("eb_error_items", "new")).toBeTruthy();
        expect((await handler({ path: "/api/user/quota" })).statusCode).toBe(401);
    });

    it("账号重置后拒绝仍在等待审核的旧保存请求", async () => {
        const { handler, db, security } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        let resume!: () => void;
        let started!: () => void;
        const entered = new Promise<void>((resolve) => { started = resolve; });
        security.checkText.mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => { resume = resolve; started(); });
            return { ok: true };
        });
        const save = handler({ path: "/api/error-items", method: "POST",
            data: { questionText: "待审核的题", requestId: "old-save" } });
        await entered;
        const reset = await handler({ path: "/api/user/reset", method: "POST",
            data: { confirm: "RESET_ACCOUNT", requestId: "reset" } });
        resume();
        expect(reset.statusCode).toBe(200);
        expect((await save).statusCode).toBe(401);
        expect(await db.countDocs("eb_error_items", { userId: login.data.user.id })).toBe(0);
    });

    it("应拒绝空解析、保留最后一次额度，并让同一分析请求复用已完成结果", async () => {
        const { handler, ai, db } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        await db.updateDoc("eb_users", login.data.user.id, { aiTrialLimit: 3, aiTrialUsed: 97 });
        const analyze = (requestId: string, questionText = "1+1=?") =>
            handler({ path: "/api/reanswer", method: "POST", data: { requestId, questionText, wrongAnswerText: "1+1=3" } });
        for (const requestId of ["first", "second"]) expect((await analyze(requestId)).statusCode).toBe(200);

        ai.reanswerQuestion.mockResolvedValueOnce({ answerText: "", analysis: "" });
        expect((await analyze("last")).statusCode).toBe(502);
        expect((await handler({ path: "/api/user/quota" })).data.quota.trialRemaining).toBe(1);

        const [one, two] = await Promise.all([analyze("last"), analyze("concurrent")]);
        expect(one.statusCode).toBe(200);
        expect([402, 409]).toContain(two.statusCode);
        expect((await analyze("last")).statusCode).toBe(200);
        expect(ai.reanswerQuestion).toHaveBeenCalledTimes(4);
        expect(ai.reanswerQuestion).toHaveBeenLastCalledWith(expect.objectContaining({ wrongAnswerText: "1+1=3" }));
    });

    it("应在上传后的响应丢失时复用同一错题，并能搜索 200 道之外的题", async () => {
        const { handler, files, db } = createMemoryCloudDeps();
        const create = (questionText: string, requestId?: string) =>
            handler({ path: "/api/error-items", method: "POST", data: { requestId, questionText,
                ...(requestId ? { originalImageUrl: "data:image/jpeg;base64,aGVsbG8=" } : {}) } });

        files.getTempUrls.mockRejectedValueOnce(new Error("temporary URL failed"));
        const first = await create("最早一道独有关键词", "one-save");
        const retried = await create("最早一道独有关键词", "one-save");
        expect(first.statusCode).toBe(201);
        expect(retried.data.id).toBe(first.data.id);
        expect(files.uploadBase64Image).toHaveBeenCalledTimes(1);
        const lookup = (requestId: string) =>
            handler({ path: "/api/error-items", method: "POST", data: { requestId, lookupOnly: true } });
        expect((await lookup("one-save")).data.id).toBe(first.data.id);
        expect((await lookup("unknown-save")).statusCode).toBe(404);

        const old = await db.readDoc("eb_error_items", first.data.id);
        await db.updateDoc("eb_error_items", first.data.id, { createdAt: "2000-01-01" });
        for (let i = 0; i < 200; i++) {
            await db.addDoc("eb_error_items", { userId: old?.userId, questionText: "最近错题", createdAt: "2026-10-01" });
        }
        const list = await handler({ path: "/api/error-items/list?pageSize=1" });
        expect(list.data.total).toBe(201);
        const search = await handler({ path: "/api/error-items/list?query=" + encodeURIComponent("独有关键词") });
        expect(search.data.items.map((item: any) => item.id)).toEqual([first.data.id]);
    });

    it("应返回 SDK 确认提交的事务结果，即使 SDK 本身没有返回回调值", async () => {
        const database = {
            command: {},
            createCollection: vi.fn(),
            runTransaction: vi.fn(async (action) => {
                await action({});
                await action({});
            }),
        };
        const adapter = createAdapter({ init: vi.fn(), database: () => database });
        const action = vi.fn().mockResolvedValueOnce("before-retry").mockResolvedValueOnce("committed");

        await expect(adapter.db.runTransaction(["eb_users"], action)).resolves.toBe("committed");
    });

    it("事务应能为 analysisLease 为 null 的用户再次取得分析锁", async () => {
        const lease = { token: "request-token", expiresAt: 1800000000000 };
        const replacement = Symbol("replace entire field");
        let stored: typeof lease | null = null;
        const update = vi.fn(async ({ data }: { data: { analysisLease: unknown } }) => {
            if (data.analysisLease === replacement) stored = lease;
            else if (data.analysisLease === null) stored = null;
            else if (stored === null) throw new Error("Cannot create field 'expiresAt' in element {analysisLease: null}");
        });
        const transaction = { collection: () => ({ doc: () => ({ update }) }) };
        const database = {
            command: { set: vi.fn().mockReturnValue(replacement) },
            createCollection: vi.fn(),
            runTransaction: async (action: (tx: typeof transaction) => Promise<unknown>) => action(transaction),
        };
        const adapter = createAdapter({ init: vi.fn(), database: () => database });
        const updateLease = (analysisLease: typeof lease | null) =>
            adapter.db.runTransaction(["eb_users"], (tx: any) =>
                tx.updateDoc("eb_users", "test-user", { analysisLease }));

        await updateLease(lease);
        expect(database.command.set).toHaveBeenCalledWith(lease);
        expect(stored).toEqual(lease);
        await updateLease(null);
        expect(stored).toBeNull();
        await updateLease(lease);
        expect(stored).toEqual(lease);
    });

    it("应让数据库用相同筛选查当前页和完整总数", async () => {
        const count = vi.fn().mockResolvedValue({ total: 215 });
        const get = vi.fn().mockResolvedValue({ data: [{ _id: "q214" }] });
        const chain = { orderBy: vi.fn(), skip: vi.fn(), limit: vi.fn(), field: vi.fn(), count, get };
        chain.orderBy.mockReturnValue(chain);
        chain.skip.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);
        chain.field.mockReturnValue(chain);
        const where = vi.fn().mockReturnValue(chain);
        const database = {
            createCollection: vi.fn(),
            collection: vi.fn().mockReturnValue({ where }),
            command: {
                and: (conditions: unknown[]) => ({ and: conditions }),
                or: (conditions: unknown[]) => ({ or: conditions }),
                gt: (value: number) => ({ gt: value }),
            },
            RegExp: vi.fn().mockImplementation((value) => value),
        };
        const adapter = createAdapter({ init: vi.fn(), database: () => database });
        const result = await adapter.db.listErrorItems("eb_error_items", {
            userId: "test-user", subjectId: "math", mastery: "1", search: "x+1", skip: 200, limit: 10,
        });
        expect(result).toEqual({ rows: [{ _id: "q214" }], total: 215 });
        expect(where).toHaveBeenCalledWith({ and: [
            { userId: "test-user", subjectId: "math" },
            { masteryLevel: { gt: 0 } },
            { or: ["questionText", "subjectName", "knowledgePoints"].map((field) =>
                ({ [field]: { regexp: "x\\+1", options: "i" } })) },
        ] });
        expect(chain.orderBy.mock.calls).toEqual([["createdAt", "desc"], ["_id", "desc"]]);
        expect(chain.skip).toHaveBeenCalledWith(200);
        expect(chain.limit).toHaveBeenCalledWith(10);
        expect(count).toHaveBeenCalledOnce();
    });

    it("应支持错题图片存云存储、列表查询、详情分析、笔记安全审核与删除清理", async () => {
        const { handler, files } = createMemoryCloudDeps("shared_user_openid_3");
        const nbs = await handler({ path: "/api/notebooks", method: "GET" });
        const mathId = nbs.data[0].id;

        const unsafeCreate = await handler({
            path: "/api/error-items",
            method: "POST",
            data: { questionText: "这里包含违规词测试", subjectId: mathId },
        });
        expect(unsafeCreate.statusCode).toBe(400);

        const created = await handler({
            path: "/api/error-items",
            method: "POST",
            data: {
                questionText: "求解一元二次方程 x^2 - 4 = 0",
                originalImageUrl: "data:image/jpeg;base64,aGVsbG8=",
                subjectId: mathId,
            },
        });
        expect(created.statusCode).toBe(201);
        expect(created.data.originalImageUrl).toBe("https://cdn.example/demo.jpg");

        const itemId = created.data.id;
        const list = await handler({ path: "/api/error-items/list?page=1&pageSize=10&mastery=0", method: "GET" });
        expect(list.statusCode).toBe(200);
        expect(list.data.total).toBe(1);

        const analyzed = await handler({
            path: `/api/error-items/${itemId}/analyze`,
            method: "POST",
            data: {},
        });
        expect(analyzed.statusCode).toBe(200);
        expect(analyzed.data.item.answerText).toBe("x=3");

        const del = await handler({
            path: `/api/error-items/${itemId}/delete`,
            method: "DELETE",
        });
        expect(del.statusCode).toBe(200);
        expect(files.deleteFiles).toHaveBeenCalledWith(["cloud://vision-prod.img/eb_images/demo.jpg"]);
    });

    it("首页汇总只统计当前账号，并返回最近错题和待攻克数量", async () => {
        const { handler, db } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        const userId = login.data.user.id;
        await db.setDoc("eb_error_items", "mine", { userId, questionText: "本人的题" });
        await db.setDoc("eb_error_items", "passed", { userId, masteryLevel: 2 });
        await db.setDoc("eb_error_items", "other", { userId: "other" });
        const result = await handler({ path: "/api/home" });
        expect(result.data.recent.total).toBe(2);
        expect(result.data.recent.items.map((item: { id: string }) => item.id)).toEqual(["mine", "passed"]);
        expect(result.data.pending.total).toBe(1);
    });

    it("宠物操作拒绝旧快照，抽奖重放只扣一次，奖励只能领取一次", async () => {
        const { handler, db } = createMemoryCloudDeps();
        const login = await handler({ path: "/api/auth/wechat", method: "POST" });
        await db.setDoc("eb_error_items", "mine", { userId: login.data.user.id, masteryLevel: 2 });
        const action = (kind: string, revision: number, requestId: string, fields = {}) => handler({
            path: "/api/pet/action", method: "POST", data: { action: kind, revision, requestId, ...fields },
        });
        expect((await handler({ path: "/api/pet", method: "PUT", data: { pet: { lotteryTickets: 999 } } })).statusCode).toBe(409);
        const adopted = await action("adopt", 0, "adopt", { type: "dragon", level: 999, lotteryTickets: 999 });
        expect(adopted.data.pet).toMatchObject({ type: "dragon", level: 0, lotteryTickets: 1 });
        expect((await action("rename", 0, "stale", { name: "旧昵称" })).data.code).toBe("PET_CONFLICT");
        const draw = await action("draw", 1, "draw");
        expect(draw.data.pet.lotteryTickets).toBe(0);
        expect((await action("draw", 1, "draw")).data).toEqual(draw.data);
        const reward = await action("mastery", 2, "first", { itemId: "mine" });
        expect(reward.data.result.expGained).toBe(20);
        const second = await action("mastery", 3, "second", { itemId: "mine" });
        expect(second.data.result.alreadyRewarded).toBe(true);
        expect(second.data.pet.currentExp).toBe(20);
    });

    it("应支持 ai-client JSON 解析兜底", () => {
        const parsed = parseJsonFromAI("```json\n{\"answerText\":\"42\",\"knowledgePoints\":[\"数论\"]}\n```");
        expect(parsed.answerText).toBe("42");

        const cfg = resolveAIConfig(null, {}, { OPENAI_API_KEY: "sk-env-12345678", OPENAI_MODEL: "deepseek-chat" });
        expect(cfg.ok).toBe(true);
        expect(cfg.model).toBe("deepseek-chat");
    });

    it("应支持 OCR 与解题模型分离、混用供应商及自定义 Key 回退", () => {
        const bailianEnv = {
            OPENAI_API_KEY: "sk-bailian-test",
            OPENAI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            OPENAI_MODEL: "qwen3.5-plus",
            OPENAI_OCR_MODEL: "qwen3-vl-flash",
        };
        const ocrCfg = resolveAIConfig(null, {}, bailianEnv, { task: "ocr" });
        const solveCfg = resolveAIConfig(null, {}, bailianEnv, { task: "solve" });
        expect(ocrCfg.model).toBe("qwen3-vl-flash");
        expect(ocrCfg.disableThinking).toBe(true);
        expect(solveCfg.model).toBe("qwen3.5-plus");
        expect(solveCfg.disableThinking).toBeUndefined();

        const mixedEnv = {
            AI_PROVIDER: "gemini",
            GOOGLE_API_KEY: "AIza-test-gemini-key",
            GEMINI_MODEL: "gemini-2.5-pro",
            AI_OCR_PROVIDER: "openai",
            OPENAI_OCR_API_KEY: "sk-zhipu-ocr",
            OPENAI_OCR_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
            OPENAI_OCR_MODEL: "glm-4.6v-flash",
        };
        const mixedOcr = resolveAIConfig(null, {}, mixedEnv, { task: "ocr" });
        const mixedSolve = resolveAIConfig(null, {}, mixedEnv, { task: "solve" });
        expect(mixedOcr.provider).toBe("openai");
        expect(mixedOcr.apiKey).toBe("sk-zhipu-ocr");
        expect(mixedOcr.model).toBe("glm-4.6v-flash");
        expect(mixedOcr.disableThinking).toBe(true);
        expect(mixedSolve.provider).toBe("gemini");
        expect(mixedSolve.model).toBe("gemini-2.5-pro");

        const customCfg = resolveAIConfig(
            {
                customApiKey: "sk-user-byok",
                customBaseUrl: "https://api.deepseek.com/v1",
                customModel: "deepseek-flash",
                customOcrModel: "deepseek-flash",
            },
            {},
            bailianEnv,
            { task: "ocr" }
        );
        expect(customCfg.source).toBe("custom_key");
        expect(customCfg.model).toBe("deepseek-flash");
        expect(customCfg.disableThinking).toBe(true);
    });

    it("应按厂商协议生成思考模式请求体并保护非兼容接口", () => {
        const dashOcr = buildOpenAIRequest(
            resolveAIConfig(
                null,
                {},
                {
                    OPENAI_API_KEY: "sk-qwen",
                    OPENAI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    OPENAI_OCR_MODEL: "qwen3-vl-flash",
                },
                { task: "ocr" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(dashOcr.hasThinkingParams).toBe(true);
        expect(dashOcr.body.enable_thinking).toBe(false);
        expect(dashOcr.body.thinking).toBeUndefined();

        const deepseekSolve = buildOpenAIRequest(
            resolveAIConfig(
                null,
                {},
                {
                    OPENAI_API_KEY: "sk-ds",
                    OPENAI_BASE_URL: "https://api.deepseek.com/v1",
                    OPENAI_MODEL: "deepseek-flash",
                    OPENAI_SOLVE_DISABLE_THINKING: "false",
                    OPENAI_REASONING_EFFORT: "high",
                },
                { task: "solve" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(deepseekSolve.hasThinkingParams).toBe(true);
        expect(deepseekSolve.body.thinking).toEqual({ type: "enabled" });
        expect(deepseekSolve.body.reasoning_effort).toBe("high");

        const unknownDefault = buildOpenAIRequest(
            resolveAIConfig(
                null,
                {},
                {
                    OPENAI_API_KEY: "sk-relay",
                    OPENAI_BASE_URL: "https://relay.example.com/v1",
                    OPENAI_MODEL: "gpt-4o",
                },
                { task: "ocr" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(unknownDefault.hasThinkingParams).toBe(false);
        expect(unknownDefault.body.thinking).toBeUndefined();
        expect(unknownDefault.body.enable_thinking).toBeUndefined();

        const customHostOcr = buildOpenAIRequest(
            resolveAIConfig(
                null,
                {},
                {
                    OPENAI_API_KEY: "sk-relay",
                    OPENAI_BASE_URL: "https://relay.example.com/v1",
                    OPENAI_MODEL: "doubao-seed-2-0-lite",
                    THINKING_CAPABLE_HOSTS: "relay.example.com",
                },
                { task: "ocr" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(customHostOcr.hasThinkingParams).toBe(true);
        expect(customHostOcr.body.thinking).toEqual({ type: "disabled" });

        const gemini25Ocr = buildGeminiRequest(
            resolveAIConfig(
                null,
                {},
                { GOOGLE_API_KEY: "AIza-test", GEMINI_MODEL: "gemini-2.5-flash" },
                { task: "ocr" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(gemini25Ocr.body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });

        const gemini3Ocr = buildGeminiRequest(
            resolveAIConfig(
                null,
                {},
                { GOOGLE_API_KEY: "AIza-test", GEMINI_OCR_MODEL: "gemini-3-flash-preview" },
                { task: "ocr" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(gemini3Ocr.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });

        const gemini25ProOcr = buildGeminiRequest(
            resolveAIConfig(
                null,
                {},
                { GOOGLE_API_KEY: "AIza-test", GEMINI_OCR_MODEL: "gemini-2.5-pro" },
                { task: "ocr" }
            ),
            { systemPrompt: "sys", userPrompt: "usr" }
        );
        expect(gemini25ProOcr.hasThinkingParams).toBe(false);
        expect(gemini25ProOcr.body.generationConfig.thinkingConfig).toBeUndefined();
    });

    it("应在模型接口返回 400 不支持思考参数时自动剥离重发，并按任务分发模型", async () => {
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        const requestImpl = vi.fn(async (url: string, opts: { body: Record<string, unknown> }) => {
            calls.push({ url, body: opts.body });
            if (calls.length === 1) {
                const err = new Error("Unknown parameter: thinking") as Error & {
                    statusCode?: number;
                    responseBody?: string;
                };
                err.statusCode = 400;
                err.responseBody = '{"error":{"message":"Unknown parameter: thinking"}}';
                throw err;
            }
            if (opts.body.model === "qwen3-vl-flash") {
                return {
                    choices: [{ message: { content: '{"questionText":"1+1=?","subject":"数学","requiresImage":false}' } }],
                };
            }
            return {
                choices: [
                    {
                        message: {
                            content:
                                '{"questionText":"1+1=?","subject":"数学","answerText":"2","analysis":"直接相加","mistakeAnalysis":"计算粗心","knowledgePoints":["加法"]}',
                        },
                    },
                ],
            };
        });

        const ai = createAIService(
            {
                OPENAI_API_KEY: "sk-test",
                OPENAI_BASE_URL: "https://api.deepseek.com/v1",
                OPENAI_MODEL: "qwen3-vl-plus",
                OPENAI_OCR_MODEL: "qwen3-vl-flash",
                OPENAI_SOLVE_DISABLE_THINKING: "false",
            },
            { requestImpl }
        );

        const ocrRes = await ai.ocrImage({ imageBase64: "AAAA", mimeType: "image/png" });
        expect(ocrRes.questionText).toBe("1+1=?");
        expect(calls).toHaveLength(2);
        expect(calls[0].body.thinking).toEqual({ type: "disabled" });
        expect(calls[1].body.thinking).toBeUndefined();
        expect(calls[1].body.model).toBe("qwen3-vl-flash");

        const solveRes = await ai.analyzeImage({ imageBase64: "AAAA", mimeType: "image/png" });
        expect(solveRes.answerText).toBe("2");
        expect(calls).toHaveLength(3);
        expect(calls[2].body.model).toBe("qwen3-vl-plus");
        expect(calls[2].body.thinking).toEqual({ type: "enabled" });

        // 非思考参数导致的 400 不应误重试
        const nonThinkingReject = vi.fn(async () => {
            const err = new Error("Invalid image payload") as Error & { statusCode?: number };
            err.statusCode = 400;
            throw err;
        });
        await expect(
            callModel(
                resolveAIConfig(
                    null,
                    {},
                    { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "https://api.deepseek.com/v1", OPENAI_MODEL: "deepseek-flash" },
                    { task: "ocr" }
                ),
                { systemPrompt: "s", userPrompt: "u", requestImpl: nonThinkingReject }
            )
        ).rejects.toThrow("Invalid image payload");
        expect(nonThinkingReject).toHaveBeenCalledTimes(1);
    });
});

describe("GET /api/health 真机环境自检", () => {
    it("应分项返回身份、数据库、文本/图片审核与 AI 配置状态，且不泄露 openid 原文", async () => {
        const { handler } = createMemoryCloudDeps("openid-health-1");
        const res = await handler({ method: "GET", path: "/api/health", data: {} });

        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.data.checks)).toEqual([
            "identity", "db", "securityText", "securityImage", "ai",
        ]);
        expect(res.data.checks.identity.ok).toBe(true);
        expect(res.data.checks.db.ok).toBe(true);
        expect(res.data.checks.securityText.ok).toBe(true);
        expect(res.data.checks.securityImage.ok).toBe(true);
        expect(res.data.checks.ai.live).toBe(false);
        expect(Array.isArray(res.data.failed)).toBe(true);
        expect(JSON.stringify(res.data)).not.toContain("openid-health-1");
    });

    it("内容安全不可用时应在 failed 中列出，便于真机定位跨 AppID 云调用", async () => {
        const { handler, security } = createMemoryCloudDeps();
        security.checkText.mockResolvedValue({ ok: false, reason: "内容安全校验暂不可用，请稍后重试" });

        const res = await handler({ method: "GET", path: "/api/health", data: {} });
        expect(res.statusCode).toBe(200);
        expect(res.data.ok).toBe(false);
        expect(res.data.failed).toContain("securityText");
        expect(res.data.checks.securityText.reason).toContain("内容安全校验暂不可用");
    });

    it("?probe 可只探测指定分项", async () => {
        const { handler } = createMemoryCloudDeps();
        const res = await handler({ method: "GET", path: "/api/health?probe=db", data: {} });
        expect(Object.keys(res.data.checks)).toEqual(["db"]);
    });

    it("配置 HEALTH_TOKEN 后普通自检沿用微信身份校验，仅 live 探测与无身份调用校验请求体令牌", async () => {
        const previous = process.env.HEALTH_TOKEN;
        process.env.HEALTH_TOKEN = "health-test-token";
        try {
            const { handler, ai } = createMemoryCloudDeps("openid-health-auth");
            const ordinary = await handler({ method: "GET", path: "/api/health", data: {} });
            expect(ordinary.statusCode).toBe(200);
            expect(ordinary.data.checks.ai.live).toBe(false);

            const rejectedLiveNoToken = await handler({ method: "GET", path: "/api/health?live=1", data: {} });
            expect(rejectedLiveNoToken.statusCode).toBe(401);
            expect(ai.reanswerQuestion).not.toHaveBeenCalled();

            const rejectedLiveQueryToken = await handler({
                method: "GET",
                path: "/api/health?live=1&token=health-test-token",
                data: {},
            });
            expect(rejectedLiveQueryToken.statusCode).toBe(401);
            expect(ai.reanswerQuestion).not.toHaveBeenCalled();

            const allowedLiveBodyToken = await handler({
                method: "POST",
                path: "/api/health",
                data: { live: true, token: "health-test-token", probe: "ai" },
            });
            expect(allowedLiveBodyToken.statusCode).toBe(200);
            expect(allowedLiveBodyToken.data.checks.ai.live).toBe(true);
            expect(allowedLiveBodyToken.data.checks.ai.ok).toBe(true);
            expect(ai.reanswerQuestion).toHaveBeenCalledTimes(1);

            const anonDeps = createMemoryCloudDeps("");
            const anonRejected = await anonDeps.handler({ method: "GET", path: "/api/health", data: {} });
            expect(anonRejected.statusCode).toBe(401);

            const anonAllowed = await anonDeps.handler({
                method: "GET",
                path: "/api/health",
                data: { token: "health-test-token" },
            });
            expect(anonAllowed.statusCode).toBe(200);
        } finally {
            if (previous === undefined) delete process.env.HEALTH_TOKEN;
            else process.env.HEALTH_TOKEN = previous;
        }
    });

    it("AI 自检复用业务配置解析逻辑：分别报告解题与 OCR，并在主供应商无密钥时准确识别回退", async () => {
        const prev = {
            AI_PROVIDER: process.env.AI_PROVIDER,
            AI_SOLVE_PROVIDER: process.env.AI_SOLVE_PROVIDER,
            AI_OCR_PROVIDER: process.env.AI_OCR_PROVIDER,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            OPENAI_OCR_API_KEY: process.env.OPENAI_OCR_API_KEY,
            GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
            GEMINI_OCR_API_KEY: process.env.GEMINI_OCR_API_KEY,
        };
        try {
            process.env.AI_PROVIDER = "openai";
            delete process.env.AI_SOLVE_PROVIDER;
            delete process.env.AI_OCR_PROVIDER;
            delete process.env.OPENAI_API_KEY;
            delete process.env.OPENAI_OCR_API_KEY;
            process.env.GOOGLE_API_KEY = "AIza-gemini-fallback-secret";
            delete process.env.GEMINI_OCR_API_KEY;

            const { handler } = createMemoryCloudDeps("openid-health-ai");
            const fallbackRes = await handler({ method: "GET", path: "/api/health?probe=ai", data: {} });
            expect(fallbackRes.statusCode).toBe(200);
            expect(fallbackRes.data.ok).toBe(true);
            expect(fallbackRes.data.checks.ai.ok).toBe(true);
            expect(fallbackRes.data.checks.ai.provider).toBe("gemini");
            expect(fallbackRes.data.checks.ai.solve).toMatchObject({ ok: true, provider: "gemini", hasKey: true });
            expect(fallbackRes.data.checks.ai.ocr).toMatchObject({ ok: true, provider: "gemini", hasKey: true });
            expect(JSON.stringify(fallbackRes.data)).not.toContain("AIza-gemini-fallback-secret");

            const splitInspection = inspectPlatformAIConfig({
                AI_SOLVE_PROVIDER: "openai",
                OPENAI_API_KEY: "sk-solve-only",
                AI_OCR_PROVIDER: "gemini",
                GEMINI_OCR_API_KEY: "AIza-ocr-only",
            });
            expect(splitInspection.ok).toBe(true);
            expect(splitInspection.solve).toMatchObject({ ok: true, provider: "openai", hasKey: true });
            expect(splitInspection.ocr).toMatchObject({ ok: true, provider: "gemini", hasKey: true });

            const partialInspection = inspectPlatformAIConfig({
                AI_PROVIDER: "gemini",
                OPENAI_OCR_API_KEY: "sk-ocr-only",
            });
            expect(partialInspection.ok).toBe(false);
            expect(partialInspection.solve.ok).toBe(false);
            expect(partialInspection.ocr).toMatchObject({ ok: true, provider: "openai", hasKey: true });
        } finally {
            for (const [key, value] of Object.entries(prev)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it("云日志 route 仅记录去掉查询参数的路径，不泄露自检令牌", async () => {
        const exportsObj: Record<string, any> = {};
        const mod = { exports: exportsObj };
        const warnSpy = vi.fn();
        let fakeNow = 0;
        const FakeDate = class extends Date {
            static now() {
                return fakeNow;
            }
        };

        runInNewContext(readFileSync(resolve("cloudfunctions/errorbookApi/index.js"), "utf8"), {
            require: (id: string) => {
                if (id === "wx-server-sdk") return { init: vi.fn(), database: () => ({}), getWXContext: () => ({}) };
                if (id === "node:crypto") return require("node:crypto");
                if (id === "./adapter") return { createAdapter: () => ({ db: {}, files: {}, security: {}, getIdentity: () => ({}) }), COLLECTIONS: {} };
                if (id === "./ai-client") return { createAIService: () => ({}) };
                if (id === "./core") {
                    return {
                        createCore: () => async () => {
                            fakeNow += 12000;
                            return { statusCode: 200, data: { ok: true, message: "token=secret-msg" } };
                        },
                    };
                }
                throw new Error("Unexpected require: " + id);
            },
            module: mod,
            exports: exportsObj,
            console: { warn: warnSpy, error: vi.fn() },
            Date: FakeDate,
            process,
        });

        expect(mod.exports.sanitizeRoutePath("/api/health?live=1&token=super-secret-token#top")).toBe("/api/health");
        expect(mod.exports.redact("token=super-secret-token prompt_tokens: 120")).toBe("token=*** prompt_tokens: 120");

        const res = await mod.exports.main({
            method: "GET",
            path: "/api/health?live=1&token=super-secret-token",
            data: { token: "super-secret-token" },
        });
        expect(res.statusCode).toBe(200);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(warnSpy.mock.calls[0][0]);
        expect(logged.route).toBe("GET /api/health");
        expect(JSON.stringify(logged)).not.toContain("super-secret-token");
    });
});
