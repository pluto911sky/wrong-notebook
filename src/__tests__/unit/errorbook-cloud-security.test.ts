import { describe, expect, it, vi } from "vitest";

const { createAdapter } = require("../../../cloudfunctions/errorbookApi/adapter");

function mockAdapter(identity = {}) {
    const msgSecCheck = vi.fn().mockResolvedValue({ errCode: 0, result: { suggest: "pass" } });
    const imgSecCheck = vi.fn().mockResolvedValue({ errCode: 0 });
    const api = { security: { msgSecCheck, imgSecCheck } };
    const openapi = Object.assign(vi.fn(() => api), api);
    const cloud = {
        init: vi.fn(),
        database: () => ({ command: {} }),
        getWXContext: () => identity,
        openapi,
    };
    return { cloud, security: createAdapter(cloud).security, openapi, msgSecCheck, imgSecCheck };
}

const SAMPLE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

describe("cloud content moderation", () => {
    it("checks every part of long text and denies a later review verdict", async () => {
        const { security, msgSecCheck } = mockAdapter();
        msgSecCheck
            .mockResolvedValueOnce({ errCode: 0, result: { suggest: "pass" } })
            .mockResolvedValueOnce({ errCode: 0, result: { suggest: "review" } });

        expect(await security.checkText("数学题".repeat(820) + "尾部", "wx-user")).toMatchObject({ ok: false });
        expect(msgSecCheck).toHaveBeenCalledTimes(2);
        expect(msgSecCheck.mock.calls[1][0].content).toContain("尾部");
    });

    it("uses the caller Mini Program AppID for shared-environment security APIs", async () => {
        const { security, openapi, msgSecCheck, imgSecCheck } = mockAdapter({ FROM_APPID: "wxSource" });
        expect(await security.checkText("二次方程", "wx-openid", 2)).toEqual({ ok: true });
        expect(msgSecCheck).toHaveBeenCalledWith({ content: "二次方程", openid: "wx-openid", scene: 2, version: 2 });
        expect(await security.checkImage("data:image/png;base64," + SAMPLE_PNG)).toEqual({ ok: true });
        expect(imgSecCheck).toHaveBeenCalledWith({
            media: { contentType: "image/png", value: Buffer.from(SAMPLE_PNG, "base64") },
        });
        expect(openapi.mock.calls).toEqual([[{ appid: "wxSource" }], [{ appid: "wxSource" }]]);
    });

    it.each([
        { errCode: 501, result: { suggest: "pass" } },
        { errCode: 0 },
        { errCode: 0, result: { suggest: "unknown" } },
        { errCode: "87014", result: { suggest: "pass" } },
    ])("denies a missing or failed text verdict (%j)", async (reply) => {
        const { security, msgSecCheck } = mockAdapter();
        msgSecCheck.mockResolvedValue(reply);
        expect(await security.checkText("例题", "wx-user")).toMatchObject({ ok: false });
    });

    it("denies unavailable text and image moderation", async () => {
        const { cloud, msgSecCheck, imgSecCheck } = mockAdapter();
        msgSecCheck.mockRejectedValue({ errCode: 501 });
        imgSecCheck.mockRejectedValue({ errCode: 501 });
        const { security } = createAdapter(cloud);
        expect(await security.checkText("例题", "wx-user")).toMatchObject({ ok: false });
        expect(await security.checkImage(SAMPLE_PNG)).toMatchObject({ ok: false });
        const withoutOpenapi = createAdapter({ ...cloud, openapi: undefined }).security;
        expect(await withoutOpenapi.checkText("例题", "wx-user")).toMatchObject({ ok: false });
        expect(await withoutOpenapi.checkImage(SAMPLE_PNG)).toMatchObject({ ok: false });
    });

    it("requires an image pass and rejects oversized or invalid uploads before provider calls", async () => {
        const { security, imgSecCheck } = mockAdapter();
        const oversized = Buffer.concat([Buffer.from(SAMPLE_PNG, "base64"), Buffer.alloc(1024 * 1024)]).toString("base64");
        expect(await security.checkImage(oversized)).toMatchObject({ ok: false });
        expect(await security.checkImage("!!!" + SAMPLE_PNG)).toMatchObject({ ok: false });
        expect(imgSecCheck).not.toHaveBeenCalled();

        imgSecCheck.mockResolvedValueOnce({ errCode: 12345 }).mockResolvedValueOnce(undefined);
        expect(await security.checkImage(SAMPLE_PNG)).toMatchObject({ ok: false });
        expect(await security.checkImage(SAMPLE_PNG)).toMatchObject({ ok: false });
    });
});
