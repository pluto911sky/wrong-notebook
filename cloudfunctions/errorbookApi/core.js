"use strict";

const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { inspectPlatformAIConfig } = require("./ai-client");

const { preparePet, applyPetAction } = require("./pet-actions");

const {
  PRACTICE_STAGES, PRACTICE_EXP, completePractice, practiceQuestions, normalizePracticeAnswer, practiceAnswerMatches,
} = require("./practice");

const DEFAULT_AI_TRIAL_LIMIT = 100;
const QUOTA_CARD_AMOUNTS = [100, 300, 1000];
const DAILY_AD_REWARD_LIMIT = 3;
const VALID_PET_TYPES = new Set(["cat", "fox", "dragon", "owl", "bunny"]);

const ANALYSIS_LEASE_MS = 10 * 60 * 1000;
const ANALYSIS_REPLAY_MS = 7 * 24 * 60 * 60 * 1000;
const QUOTA_EXHAUSTED = "解析次数已用完，仍可录题和复习";

const DEFAULT_NOTEBOOK_NAMES = ["语文", "数学", "英语", "科学"];
const SCIENCE_NOTEBOOKS = new Set(["物理", "化学", "生物", "自然科学"]);
function quotaCardId(value) {
  const raw = typeof value === "string" && value.length <= 80
    ? value.replace(/[\s-]+/g, "").toUpperCase() : "";
  return /^[0-9A-F]{32}$/.test(raw) ? createHash("sha256").update(raw).digest("hex") : "";
}

// 1x1 PNG，仅用于验证跨 AppID 图片内容安全接口是否可达，不代表真实题图的审核结论。
const HEALTH_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function getChinaDateKey(now = new Date()) {
  const cstMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(cstMs).toISOString().slice(0, 10);
}

function isVipActiveNow(isVip, vipExpireAt) {
  if (!isVip) return false;
  if (!vipExpireAt) return true;
  const t = new Date(vipExpireAt).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

function computeUserQuotaStatus(user) {
  const trialUsed = typeof user?.aiTrialUsed === "number" && user.aiTrialUsed >= 0 ? user.aiTrialUsed : 0;
  const trialLimit = DEFAULT_AI_TRIAL_LIMIT;
  const trialRemaining = Math.max(0, trialLimit - trialUsed);
  const paidQuota = typeof user?.aiPaidQuota === "number" && user.aiPaidQuota >= 0 ? user.aiPaidQuota : 0;
  const isVip = isVipActiveNow(user?.isVip, user?.vipExpireAt);
  const vipExpireAt = user?.vipExpireAt ? new Date(user.vipExpireAt).toISOString() : null;

  const todayKey = getChinaDateKey();
  const rawAd = typeof user?.dailyAdRewards === "number" && user.dailyAdRewards >= 0 ? user.dailyAdRewards : 0;
  const adRewardsUsedToday = user?.lastAdRewardDate === todayKey ? rawAd : 0;
  const adRewardsRemainingToday = Math.max(0, DAILY_AD_REWARD_LIMIT - adRewardsUsedToday);

  let accessMode;
  let statusText;
  if (user?.role === "admin") {
    accessMode = "admin";
    statusText = "管理员账号 · 不限次数";
  } else if (isVip) {
    accessMode = "vip";
    statusText = "不限次解析";
  } else if (trialRemaining > 0) {
    accessMode = "trial";
    statusText = `剩余 ${trialRemaining}/${trialLimit} 次`;
  } else if (paidQuota > 0) {
    accessMode = "paid_quota";
    statusText = `剩余 ${paidQuota} 次`;
  } else {
    accessMode = "exhausted";
    statusText = QUOTA_EXHAUSTED;
  }

  return {
    trialUsed,
    trialLimit,
    trialRemaining,
    paidQuota,
    adRewardsUsedToday,
    adRewardsDailyLimit: DAILY_AD_REWARD_LIMIT,
    adRewardsRemainingToday,
    isVip,
    vipExpireAt,
    hasCustomApiKey: false,
    canClearLegacyKey: Boolean(user?.customApiKey),
    accessMode,
    canAnalyze: accessMode !== "exhausted",
    statusText,
  };
}

function clampInt(val, fallback, min, max) {
  const n = typeof val === "number" ? Math.round(val) : Number.parseInt(String(val ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function formatPetResponse(doc) {
  return {
    type: VALID_PET_TYPES.has(doc?.type) ? doc.type : "cat",
    name: doc?.name || "算算喵",
    hasChosenPet: Boolean(doc?.hasChosenPet),
    level: clampInt(doc?.level, 0, 0, 999),
    currentExp: clampInt(doc?.currentExp, 0, 0, 100000),
    maxExp: clampInt(doc?.maxExp, 40, 10, 100000),
    hunger: clampInt(doc?.hunger, 65, 0, 100),
    mood: clampInt(doc?.mood, 80, 0, 100),
    conqueredErrors: clampInt(doc?.conqueredErrors, 0, 0, 100000),
    capturedErrors: clampInt(doc?.capturedErrors, 0, 0, 100000),
    fishCan: clampInt(doc?.fishCan, 2, 0, 9999),
    energyFruit: clampInt(doc?.energyFruit, 1, 0, 9999),
    lotteryTickets: clampInt(doc?.lotteryTickets, 1, 0, 999),
    lotteryHistory: Array.isArray(doc?.lotteryHistory) ? doc.lotteryHistory.slice(0, 60) : [],
    rewardedMasteryIds: Array.isArray(doc?.rewardedMasteryIds) ? doc.rewardedMasteryIds.slice(0, 300) : [],
    rewardedCaptureIds: Array.isArray(doc?.rewardedCaptureIds) ? doc.rewardedCaptureIds.slice(0, 300) : [],
    practiceExperienceApplied: clampInt(doc?.practiceExperienceApplied, 0, 0, Number.MAX_SAFE_INTEGER),
    lastDailyBonusDate: doc?.lastDailyBonusDate || "",
  };
}

function parseRoute(rawPath) {
  const clean = String(rawPath || "/").trim();
  const [pathname, queryString = ""] = clean.split("?");
  const query = {};
  if (queryString) {
    for (const part of queryString.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq < 0) {
        query[decodeURIComponent(part)] = "";
      } else {
        query[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
      }
    }
  }
  return { pathname, query };
}

function jsonResp(statusCode, data) {
  return { statusCode, data };
}

function createCore({ db, collections, files, security, ai, getIdentity }) {
  function resolveOpenId() {
    const ctx = getIdentity() || {};
    return ctx.FROM_OPENID || ctx.OPENID || "";
  }

  function userDocId(openId) {
    return "u_" + createHash("sha256").update(String(openId)).digest("hex").slice(0, 24);
  }

  function initialUser(openId, id, nickname) {
    const now = new Date().toISOString();
    return {
      openId,
      name: nickname || "微信同学",
      email: `wx_${id.slice(2, 14)}@cloud.local`,
      role: "user",
      isActive: true,
      aiTrialUsed: 0,
      aiTrialLimit: DEFAULT_AI_TRIAL_LIMIT,
      aiPaidQuota: 0,
      dailyAdRewards: 0,
      lastAdRewardDate: null,
      isVip: false,
      vipExpireAt: null,
      customAiProvider: null,
      customApiKey: null,
      customBaseUrl: null,
      customModel: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async function ensureUser(openId, nickname) {
    const id = userDocId(openId);
    const existing = await db.readDoc(collections.users, id);
    if (existing) return { id, user: existing, isNewUser: false };

    return db.runTransaction([collections.users], async (tx) => {
      const concurrentUser = await tx.readDoc(collections.users, id);
      if (concurrentUser) return { id, user: concurrentUser, isNewUser: false };

      const user = await tx.setDoc(collections.users, id, initialUser(openId, id, nickname));
      return { id, user, isNewUser: true };
    });
  }

  function accountError(current, version) {
    if (current?.isActive === false) return jsonResp(403, { message: "账号已停用" });
    if (current?.resetting) return jsonResp(409, { message: "账号重置未完成，请在设置重试" });
    if (!current || current.accountVersion !== version) {
      return jsonResp(401, { code: "ACCOUNT_RESET", message: "账号已重置，请重新登录" });
    }
    return null;
  }

  function accountWrites(userId, version) {
    const runTransaction = (names, action) => db.runTransaction([collections.users, ...names], async (tx) => {
      const current = await tx.readDoc(collections.users, userId);
      const response = accountError(current, version);
      if (response) throw Object.assign(new Error(response.data.message), { accountResponse: response });
      const result = await action(tx);
      // Touch the same user document as reset so concurrent commits conflict.
      await tx.updateDoc(collections.users, userId, {
        writeSequence: (current.writeSequence || 0) + 1,
      });
      return result;
    });
    return {
      runTransaction,
      setDoc: (collection, ...args) => runTransaction([collection], (tx) => tx.setDoc(collection, ...args)),
      updateDoc: (collection, ...args) => runTransaction([collection], (tx) => tx.updateDoc(collection, ...args)),
      removeDoc: (collection, ...args) => runTransaction([collection], (tx) => tx.removeDoc(collection, ...args)),
    };
  }

  async function ensureNotebooks(userId, writes) {
    const list = await db.queryDocs(collections.notebooks, {
      where: { userId },
      orderByField: "createdAt",
      orderDir: "asc",
      limit: 100,
    });
    const now = new Date().toISOString();
    return Promise.all(DEFAULT_NOTEBOOK_NAMES.map(async (name) => {
      // Reuse the existing science notebook so its saved questions stay accessible.
      const legacy = name === "科学" ? list.find((doc) => SCIENCE_NOTEBOOKS.has(doc.name)) : null;
      const book = list.find((doc) => doc.name === name) || legacy || await writes.setDoc(
        collections.notebooks, requestDocId("n_", userId, "subject", name), { userId, name, createdAt: now }
      );
      return { id: book._id || book.id, name, createdAt: book.createdAt };
    }));
  }

  function requestDocId(prefix, userId, scope, id) {
    const digest = createHash("sha256").update(JSON.stringify([userId, scope, id])).digest("hex");
    return prefix + digest.slice(0, 30);
  }

  function validRequestId(id) {
    return typeof id === "string" && /^[\w-]{1,100}$/.test(id);
  }

  async function resetAccount(userId, openId, requestId, accountVersion) {
    const lock = await db.runTransaction([collections.users], async (tx) => {
      const current = await tx.readDoc(collections.users, userId);
      if (current.isActive === false) return jsonResp(403, { message: "账号已停用" });
      if (current.lastResetRequestId === requestId) return jsonResp(200, { reset: true });
      if (current.accountVersion && current.accountVersion !== accountVersion) {
        return jsonResp(401, { code: "ACCOUNT_RESET", message: "账号已重置，请重新登录" });
      }
      if (current.analysisLease?.expiresAt > Date.now() || current.resetLeaseUntil > Date.now()) {
        return jsonResp(409, { message: "有操作正在进行，请稍后重试" });
      }
      await tx.updateDoc(collections.users, userId, {
        resetting: true,
        resetLeaseUntil: Date.now() + 75_000,
      });
      return { current };
    });
    if (!lock.current) return lock;

    async function drain(collection, where, clearRow) {
      for (;;) {
        const rows = await db.queryDocs(collection, { where, limit: 20 });
        if (!rows.length) return;
        await Promise.all(rows.map(clearRow));
      }
    }

    try {
      await drain(collections.errorItems, { userId }, async (item) => {
        if (item.originalImageFileId) await files.deleteFiles([item.originalImageFileId], { strict: true });
        await db.removeDoc(collections.errorItems, item._id || item.id);
      });
      for (const collection of [collections.notebooks, collections.analysisRequests]) {
        await drain(collection, { userId }, (row) => db.removeDoc(collection, row._id || row.id));
      }
      await drain(collections.quotaCards, { redeemedBy: userId }, (card) =>
        db.updateDoc(collections.quotaCards, card._id || card.id, { redeemedBy: null }));
      await drain(collections.quotaCards, { issuedBy: userId }, (card) =>
        db.updateDoc(collections.quotaCards, card._id || card.id, { issuedBy: null }));
      if (await db.readDoc(collections.pets, userId)) await db.removeDoc(collections.pets, userId);
      await db.setDoc(collections.users, userId, {
        ...initialUser(openId, userId),
        role: lock.current.role || "user",
        aiTrialUsed: lock.current.aiTrialUsed || 0,
        aiPaidQuota: lock.current.aiPaidQuota || 0,
        isVip: Boolean(lock.current.isVip),
        vipExpireAt: lock.current.vipExpireAt || null,
        dailyAdRewards: lock.current.dailyAdRewards || 0,
        lastAdRewardDate: lock.current.lastAdRewardDate || null,
        accountVersion: randomUUID(),
        lastResetRequestId: requestId,
      });
      return jsonResp(200, { reset: true });
    } catch (error) {
      await db.updateDoc(collections.users, userId, { resetLeaseUntil: 0 }).catch(() => {});
      throw error;
    }
  }

  async function runAnalysis({ writes, userId, scope, requestId, solve, itemId, questionFromImage = false, practiceFor }) {
    if (requestId !== undefined && !validRequestId(requestId)) {
      return jsonResp(400, { message: "分析请求号无效" });
    }

    const operationId = requestId && requestDocId("a_", userId, scope, requestId);
    const lease = { token: randomUUID(), expiresAt: Date.now() + ANALYSIS_LEASE_MS };
    const names = [collections.users];
    if (operationId) names.push(collections.analysisRequests);
    if (itemId) names.push(collections.errorItems);

    const reservation = await writes.runTransaction(names, async (tx) => {
      const user = await tx.readDoc(collections.users, userId);
      const quota = computeUserQuotaStatus(user);
      let upgradePractice = false;
      if (practiceFor !== undefined) {
        const item = await tx.readDoc(collections.errorItems, itemId);
        if (!item || item.userId !== userId) return { response: jsonResp(404, { message: "错题不存在" }) };
        if (String(item.questionText || "").trim() !== practiceFor) {
          return { response: jsonResp(409, { message: "题干已更新，请刷新后重试" }) };
        }
        if (item.practiceSource === practiceFor && completePractice(item.practice)) {
          return { response: jsonResp(200, {
            practice: practiceQuestions(item.practice), progress: item.practiceProgress || 0, quota,
          }) };
        }
        upgradePractice = item.practiceSource === practiceFor && Boolean(item.practice?.similar && item.practice?.advanced);
      }
      if (operationId) {
        const completed = await tx.readDoc(collections.analysisRequests, operationId);
        if (completed) {
          const cached = completed.itemId ? { itemId: completed.itemId } : completed.result;
          return { response: jsonResp(200, { ...cached, quota }) };
        }
      }
      if (user.analysisLease?.expiresAt > Date.now()) {
        return { response: jsonResp(409, { code: "AI_BUSY", message: "已有分析正在进行，请稍后重试" }) };
      }
      if (!quota.canAnalyze && !upgradePractice) {
        return { response: jsonResp(402, { code: "AI_TRIAL_EXHAUSTED", message: QUOTA_EXHAUSTED, quota }) };
      }
      await tx.updateDoc(collections.users, userId, { analysisLease: lease });
      return { accessMode: upgradePractice ? "practice_upgrade" : quota.accessMode };
    });
    if (reservation.response) return reservation.response;

    let finished = false;
    try {
      const result = await solve();
      const hasText = (field) => typeof field === "string" && field.trim().length > 0;
      const valid = practiceFor === undefined
        ? hasText(result?.answerText) && hasText(result?.analysis) && (!questionFromImage || hasText(result?.questionText))
        : completePractice(result?.practice);
      if (!valid) {
        return jsonResp(502, { code: "AI_INVALID_RESULT", message: "没有生成完整解析，未扣次数。可重试或先保存错题" });
      }

      const completed = await writes.runTransaction(names, async (tx) => {
        const user = await tx.readDoc(collections.users, userId);
        if (user.analysisLease?.token !== lease.token) {
          return jsonResp(409, { code: "AI_BUSY", message: "本次分析已超时，请重试" });
        }
        let response = result;
        if (itemId) {
          const item = await tx.readDoc(collections.errorItems, itemId);
          if (!item || item.userId !== userId) return jsonResp(404, { message: "错题不存在" });
          if (practiceFor !== undefined && String(item.questionText || "").trim() !== practiceFor) {
            return jsonResp(409, { message: "题干已更新，请刷新后重试" });
          }
          const patch = practiceFor !== undefined ? { practice: result.practice, practiceSource: practiceFor } : {
            questionText: result.questionText || item.questionText,
            answerText: result.answerText,
            analysis: result.analysis,
            mistakeAnalysis: result.mistakeAnalysis || "",
            knowledgePoints: Array.isArray(result.knowledgePoints) ? result.knowledgePoints : item.knowledgePoints || [],
            updatedAt: new Date().toISOString(),
          };
          await tx.updateDoc(collections.errorItems, itemId, patch);
          response = practiceFor === undefined ? { itemId } : {
            practice: practiceQuestions(result.practice), progress: item.practiceProgress || 0,
          };
        }
        const patch = { analysisLease: null, updatedAt: new Date().toISOString() };
        if (reservation.accessMode === "trial") patch.aiTrialUsed = (user.aiTrialUsed || 0) + 1;
        if (reservation.accessMode === "paid_quota") patch.aiPaidQuota = Math.max(0, user.aiPaidQuota - 1);
        await tx.updateDoc(collections.users, userId, patch);
        if (operationId) {
          await tx.setDoc(collections.analysisRequests, operationId, {
            userId, ...(itemId ? { itemId } : { result }),
            expiresAt: new Date(Date.now() + ANALYSIS_REPLAY_MS),
          });
        }
        return jsonResp(200, { ...response, quota: computeUserQuotaStatus({ ...user, ...patch }) });
      });
      finished = completed.statusCode === 200;
      return completed;
    } catch (error) {
      if (error?.accountResponse) return error.accountResponse;
      if (error?.code === "AI_INCOMPLETE_RESULT") {
        return jsonResp(502, { code: "AI_INVALID_RESULT", message: "没有生成完整解析，未扣次数。可重试或先保存错题" });
      }
      if (error?.code === "AI_NOT_CONFIGURED") {
        return jsonResp(502, {
          code: "AI_NOT_CONFIGURED",
          message: "解析服务未配置，可先保存，未扣次数",
        });
      }
      console.warn("Cloud AI analysis failed", error?.code || error?.statusCode || "unknown");
      return jsonResp(502, { code: "AI_ANALYSIS_FAILED", message: "解析未完成，可重试或先保存" });
    } finally {
      if (!finished) {
        await db.runTransaction([collections.users], async (tx) => {
          const user = await tx.readDoc(collections.users, userId);
          if (user?.analysisLease?.token === lease.token) {
            await tx.updateDoc(collections.users, userId, { analysisLease: null });
          }
        }).catch((error) => console.warn("Cloud AI reservation cleanup failed", error?.code || "unknown"));
      }
    }
  }

  function sanitizeUserPublic(id, user) {
    return {
      id,
      name: user.name,
      email: user.email,
      role: user.role || "user",
      profileCompleted: Boolean(user.profileCompleted),
      ...(user.accountVersion ? { accountVersion: user.accountVersion } : {}),
    };
  }

  function formatErrorItem(doc, tempUrlMap = {}) {
    const id = doc._id || doc.id;
    const rawImg = doc.originalImageFileId
      ? tempUrlMap[doc.originalImageFileId] || doc.originalImageFileId
      : doc.originalImageUrl || "";
    return {
      id,
      userId: doc.userId,
      subjectId: doc.subjectId || "",
      subject: doc.subjectName ? { id: doc.subjectId || "", name: SCIENCE_NOTEBOOKS.has(doc.subjectName) ? "科学" : doc.subjectName } : null,
      questionText: doc.questionText || "",
      answerText: doc.answerText || "",
      analysis: doc.analysis || "",
      wrongAnswerText: doc.wrongAnswerText || "",
      mistakeAnalysis: doc.mistakeAnalysis || "",
      mistakeStatus: doc.mistakeStatus || "unknown",
      knowledgePoints: Array.isArray(doc.knowledgePoints)
        ? JSON.stringify(doc.knowledgePoints)
        : doc.knowledgePoints || "[]",
      tags: Array.isArray(doc.knowledgePoints)
        ? doc.knowledgePoints.map((name) => ({ name }))
        : [],
      originalImageUrl: rawImg,
      masteryLevel: doc.masteryLevel || 0,
      userNotes: doc.userNotes || "",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  function formatListItem(doc) {
    return {
      id: doc._id || doc.id,
      subject: doc.subjectName ? { id: doc.subjectId || "", name: SCIENCE_NOTEBOOKS.has(doc.subjectName) ? "科学" : doc.subjectName } : null,
      questionText: doc.questionText || "",
      masteryLevel: doc.masteryLevel || 0,
      createdAt: doc.createdAt,
      hasImage: Boolean(doc.originalImageFileId || doc.originalImageUrl),
      hasAiAnalysis: Boolean(String(doc.answerText || "").trim() || String(doc.analysis || "").trim()),
    };
  }

  async function formatWithImage(doc) {
    const urlMap = doc.originalImageFileId
      ? await files.getTempUrls([doc.originalImageFileId]).catch(() => ({}))
      : {};
    return formatErrorItem(doc, urlMap);
  }

  async function probe(fn) {
    const started = Date.now();
    try {
      const detail = (await fn()) || {};
      return { ...detail, ms: Date.now() - started, ok: detail.ok !== false };
    } catch (err) {
      return {
        ok: false,
        ms: Date.now() - started,
        code: String(err?.code || err?.errCode || "UNKNOWN").slice(0, 60),
        message: String(err?.message || err?.errMsg || "探测失败").slice(0, 160),
      };
    }
  }

  function verifyHealthToken(expected, provided) {
    if (!expected || typeof provided !== "string" || !provided) return false;
    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(provided, "utf8");
    return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  }

  // 真机排障用：普通自检沿用微信身份校验；仅在无微信身份上下文或启用 live=1 真实模型探测时校验请求体中的 HEALTH_TOKEN。
  async function runHealthCheck(query, body) {
    const expected = String(process.env.HEALTH_TOKEN || "");
    const token = typeof body.token === "string" ? body.token : "";
    const hasValidToken = verifyHealthToken(expected, token);
    const wantLive = query.live === "1" || body.live === true || body.live === "1";

    const ctx = getIdentity() || {};
    const openId = ctx.FROM_OPENID || ctx.OPENID || "";

    if (!openId && !hasValidToken) {
      return jsonResp(401, { ok: false, message: "未获取到微信身份凭证，请重试" });
    }

    if (wantLive && expected && !hasValidToken) {
      return jsonResp(401, { ok: false, message: "健康检查令牌无效" });
    }

    const rawProbe = body.probe !== undefined ? body.probe : query.probe;
    const only = String(rawProbe || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const want = (name) => only.length === 0 || only.includes(name);

    const checks = {};

    if (want("identity")) {
      checks.identity = await probe(async () => ({
        ok: Boolean(openId),
        hasOpenId: Boolean(openId),
        hasFromOpenId: Boolean(ctx.FROM_OPENID),
        fromAppid: String(ctx.FROM_APPID || ctx.APPID || ""),
        env: String(ctx.ENV || "").slice(0, 80),
        note: "fromAppid 为调用方小程序；与资源方 AppID 不同说明环境共享已生效",
      }));
    }

    if (want("db")) {
      checks.db = await probe(async () => {
        const doc = await db.readDoc(collections.users, "__health_probe__");
        return { ok: true, reachable: true, unexpectedDoc: Boolean(doc) };
      });
    }

    if (want("securityText")) {
      checks.securityText = await probe(async () => {
        if (!openId) return { ok: false, message: "未获取到 openid，文本审核需从小程序端发起" };
        const sec = await security.checkText("运行环境自检", openId, 2);
        return {
          ok: Boolean(sec?.ok),
          reason: String(sec?.reason || "").slice(0, 120),
          note: "「内容安全校验暂不可用」通常意味着跨 AppID 云调用权限或参数未通过",
        };
      });
    }

    if (want("securityImage")) {
      checks.securityImage = await probe(async () => {
        const sec = await security.checkImage(`data:image/png;base64,${HEALTH_PNG}`);
        return {
          ok: Boolean(sec?.ok),
          reason: String(sec?.reason || "").slice(0, 120),
          note: "1x1 PNG 只验证图片审核接口连通性；被业务拒绝也说明接口可达，请结合 reason 判断",
        };
      });
    }

    if (want("ai")) {
      checks.ai = await probe(async () => {
        const inspection =
          typeof ai?.inspectConfig === "function"
            ? ai.inspectConfig()
            : inspectPlatformAIConfig(process.env);
        const base = {
          ...inspection,
          live: false,
          note: "仅检查环境变量（分别解析解题与 OCR 配置），未发起推理；真实连通性测试需传 live=1 并在请求体 data.token 中提供 HEALTH_TOKEN",
        };
        if (!wantLive) return base;
        if (!expected) return { ...base, ok: false, message: "live 探测需先配置 HEALTH_TOKEN" };
        const started = Date.now();
        try {
          await ai.reanswerQuestion({ questionText: "1+1=?", wrongAnswerText: "", subjectHint: "数学" });
          return { ...base, live: true, ok: true, modelLatencyMs: Date.now() - started };
        } catch (err) {
          return {
            ...base,
            live: true,
            ok: false,
            modelLatencyMs: Date.now() - started,
            code: String(err?.code || err?.statusCode || "UNKNOWN").slice(0, 60),
            message: String(err?.message || "模型调用失败").slice(0, 160),
          };
        }
      });
    }

    const failed = Object.keys(checks).filter((name) => !checks[name].ok);
    return jsonResp(200, {
      ok: failed.length === 0,
      failed,
      checks,
      hint: "?probe=identity,db,securityText,securityImage,ai 可只测指定项；真实模型探测需传 live=1 并在请求体 data.token 中传入 HEALTH_TOKEN",
    });
  }

  async function handle(event = {}) {
    const method = String(event.method || "GET").toUpperCase();
    const { pathname, query } = parseRoute(event.path || "/");
    const body = event.data && typeof event.data === "object" ? event.data : {};

    if (pathname === "/api/health") {
      return await runHealthCheck(query, body);
    }

    const openId = resolveOpenId();
    if (!openId) {
      return jsonResp(401, { message: "未获取到微信身份凭证，请重试" });
    }

    // 1. 微信登录
    if (pathname === "/api/auth/wechat" && method === "POST") {
      const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 32) : "";
      if (nickname) {
        const sec = await security.checkText(nickname, openId, 1);
        if (!sec.ok) return jsonResp(400, { message: sec.reason || "昵称未通过安全审核" });
      }
      const { id, user, isNewUser } = await ensureUser(openId, nickname);
      const blocked = accountError(user, user.accountVersion);
      if (blocked) return blocked;
      await ensureNotebooks(id, accountWrites(id, user.accountVersion));
      return jsonResp(200, {
        isNewUser,
        cloud: true,
        user: sanitizeUserPublic(id, user),
        quota: computeUserQuotaStatus(user),
      });
    }

    const { id: userId, user } = await ensureUser(openId);

    if (pathname === "/api/user/reset" && method === "POST") {
      if (body.confirm !== "RESET_ACCOUNT" || !validRequestId(body.requestId)) {
        return jsonResp(400, { message: "请确认重置账号" });
      }
      return resetAccount(userId, openId, body.requestId, event.accountVersion);
    }

    const blocked = accountError(user, event.accountVersion);
    if (blocked) return blocked;
    const writes = accountWrites(userId, event.accountVersion);

    if (pathname === "/api/auth/session" && method === "GET") {
      return jsonResp(200, { user: sanitizeUserPublic(userId, user) });
    }

    // 完善信息：学习台名字（首次登录填写，设置页可修改）
    if (pathname === "/api/user/profile" && (method === "POST" || method === "PATCH")) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || Array.from(name).length > 12) {
        return jsonResp(400, { message: "名字需为 1-12 个字" });
      }
      const sec = await security.checkText(name, openId, 1);
      if (!sec.ok) return jsonResp(400, { message: sec.reason || "名字未通过安全审核" });
      const patch = { name, profileCompleted: true, updatedAt: new Date().toISOString() };
      await writes.updateDoc(collections.users, userId, patch);
      return jsonResp(200, { user: sanitizeUserPublic(userId, { ...user, ...patch }) });
    }

    // 2. 配额与 BYOK / 兑换码
    if (pathname === "/api/user/quota") {
      if (method === "GET") {
        return jsonResp(200, {
          user: sanitizeUserPublic(userId, user),
          quota: computeUserQuotaStatus(user),
        });
      }
      if (method === "POST") {
        const action = body.action;
        if (action === "save_api_key") {
          return jsonResp(403, { message: "小程序暂未开放此功能" });
        }

        if (action === "issue_card" || action === "revoke_card") {
          if (user.role !== "admin") return jsonResp(403, { message: "需要管理员权限" });
          if (action === "issue_card") {
            const amount = body.amount;
            if (!QUOTA_CARD_AMOUNTS.includes(amount)) {
              return jsonResp(400, { message: "请选择 100、300 或 1000 次" });
            }
            const raw = randomBytes(16).toString("hex").toUpperCase();
            const cardId = quotaCardId(raw);
            const now = Date.now();
            const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
            await writes.setDoc(collections.quotaCards, cardId, {
              amount, issuedBy: userId, status: "available", createdAt: new Date(now).toISOString(), expiresAt,
            });
            return jsonResp(201, { cardId, amount, expiresAt, code: raw.match(/.{4}/g).join("-") });
          }
          const cardId = quotaCardId(body.code);
          if (!cardId) {
            return jsonResp(400, { message: "卡片编号无效" });
          }
          return writes.runTransaction([collections.quotaCards], async (tx) => {
            const card = await tx.readDoc(collections.quotaCards, cardId);
            if (!card) return jsonResp(404, { message: "次卡不存在" });
            if (card.status !== "available") return jsonResp(409, { message: "次卡已兑换或作废" });
            await tx.updateDoc(collections.quotaCards, cardId, { status: "revoked", revokedAt: new Date().toISOString() });
            return jsonResp(200, { message: "次卡已作废" });
          });
        }

        if (action === "redeem_code") {
          const cardId = quotaCardId(body.code);
          if (!cardId) return jsonResp(400, { message: "卡密格式不正确" });
          return writes.runTransaction([collections.users, collections.quotaCards], async (tx) => {
            const card = await tx.readDoc(collections.quotaCards, cardId);
            if (!card || !QUOTA_CARD_AMOUNTS.includes(card.amount)) {
              return jsonResp(404, { message: "未找到次卡" });
            }
            const current = await tx.readDoc(collections.users, userId);
            if (card.status === "redeemed" && card.redeemedBy === userId) {
              return jsonResp(200, { granted: 0, alreadyRedeemed: true, quota: computeUserQuotaStatus(current) });
            }
            if (card.status !== "available" || !(Date.parse(card.expiresAt) > Date.now())) {
              return jsonResp(409, { message: "次卡已失效或已使用" });
            }
            const updatedAt = new Date().toISOString();
            const patch = { aiPaidQuota: computeUserQuotaStatus(current).paidQuota + card.amount, updatedAt };
            await tx.updateDoc(collections.users, userId, patch);
            await tx.updateDoc(collections.quotaCards, cardId, { status: "redeemed", redeemedBy: userId, redeemedAt: updatedAt });
            return jsonResp(200, { granted: card.amount, quota: computeUserQuotaStatus({ ...current, ...patch }) });
          });
        }

        if (action === "clear_api_key") {
          const patch = {
            customAiProvider: null,
            customApiKey: null,
            customBaseUrl: null,
            customModel: null,
            updatedAt: new Date().toISOString(),
          };
          await writes.updateDoc(collections.users, userId, patch);
          return jsonResp(200, {
            message: "已解绑自有模型 Key",
            quota: computeUserQuotaStatus({ ...user, ...patch }),
          });
        }

        return jsonResp(400, { message: "Unsupported action" });
      }
    }

    if (pathname === "/api/user/ad-reward" && method === "POST") {
      return jsonResp(403, { message: "小程序暂未开放视频奖励" });
    }

    if (pathname === "/api/pet" && method === "GET") {
      const doc = await db.readDoc(collections.pets, userId);
      const practiceExperience = user.practiceExperience || 0;
      return jsonResp(200, {
        pet: preparePet(formatPetResponse(doc), practiceExperience),
        revision: doc?.revision || 0, practiceExperience,
      });
    }
    if (pathname === "/api/pet" && method === "PUT") {
      return jsonResp(409, { code: "PET_UPDATE_REQUIRED", message: "请更新小程序后再操作精灵" });
    }
    if (pathname === "/api/pet/action" && method === "POST") {
      if (!validRequestId(body.requestId)) return jsonResp(400, { message: "操作请求号无效" });
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (Array.from(name).length > 12) return jsonResp(400, { message: "昵称最多 12 个字" });
      if (name && ["adopt", "rename"].includes(body.action)) {
        const sec = await security.checkText(name, openId, 1);
        if (!sec.ok) return jsonResp(400, { message: sec.reason || "宠物名称未通过安全审核" });
      }
      const receiptId = requestDocId("p_", userId, "pet-action", body.requestId);
      const needsItem = body.action === "capture" || body.action === "mastery";
      const names = [collections.pets, collections.analysisRequests];
      if (needsItem) names.push(collections.errorItems);
      return writes.runTransaction(names, async (tx) => {
        const current = await tx.readDoc(collections.pets, userId);
        const freshUser = await tx.readDoc(collections.users, userId);
        const practiceExperience = freshUser.practiceExperience || 0;
        const pet = preparePet(formatPetResponse(current), practiceExperience);
        const receipt = await tx.readDoc(collections.analysisRequests, receiptId);
        const revision = current?.revision || 0;
        if (receipt) return jsonResp(200, { pet, revision, result: receipt.result });
        if (body.revision !== revision) {
          return jsonResp(409, { code: "PET_CONFLICT", message: "精灵进度已在其他设备更新，请重试" });
        }
        const item = needsItem && validRequestId(body.itemId)
          ? await tx.readDoc(collections.errorItems, body.itemId) : null;
        if (needsItem && item?.userId !== userId) return jsonResp(404, { message: "错题不存在" });
        const outcome = applyPetAction(pet, { ...body, name }, {
          item, defaults: formatPetResponse({}), receiptId, practiceExperience,
        });
        if (outcome.error) return jsonResp(400, { message: outcome.error });
        const { flag, ...result } = outcome;
        if (flag) await tx.updateDoc(collections.errorItems, body.itemId, { [flag]: true });
        await tx.setDoc(collections.pets, userId, { ...pet, revision: revision + 1 });
        await tx.setDoc(collections.analysisRequests, receiptId, {
          userId, result, expiresAt: new Date(Date.now() + ANALYSIS_REPLAY_MS),
        });
        return jsonResp(200, { pet, revision: revision + 1, result });
      });
    }

    // 5. 学科错题本 Notebooks
    if (pathname === "/api/notebooks") {
      if (method === "GET") {
        const list = await ensureNotebooks(userId, writes);
        return jsonResp(200, list);
      }
      if (method === "POST") {
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
        if (!DEFAULT_NOTEBOOK_NAMES.includes(name)) {
          return jsonResp(400, { message: "仅支持语文、数学、英语、科学" });
        }
        const list = await ensureNotebooks(userId, writes);
        return jsonResp(200, list.find((item) => item.name === name));
      }
    }

    // 6. OCR（免费）
    if (pathname === "/api/ocr" && method === "POST") {
      const { imageBase64, mimeType, subjectId } = body;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return jsonResp(400, { message: "Missing image data" });
      }
      const imgSec = await security.checkImage(imageBase64, mimeType || "image/jpeg");
      if (!imgSec.ok) return jsonResp(400, { message: imgSec.reason || "图片未通过安全审核" });

      let subjectHint = "";
      if (subjectId) {
        const nb = await db.readDoc(collections.notebooks, subjectId);
        if (nb && nb.userId === userId) subjectHint = nb.name;
      }
      try {
        const parsed = await ai.ocrImage({ imageBase64, mimeType, subjectHint });
        return jsonResp(200, parsed);
      } catch (err) {
        console.warn("Cloud OCR failed", err?.code || err?.statusCode || "unknown");
        const upstreamStatus = err?.statusCode;
        const hasUpstreamStatus = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599;
        const messages = {
          AI_NOT_CONFIGURED: "题图识别服务尚未配置，可先保存原图并手动填写题干",
          AI_INCOMPLETE_RESULT: "未识别到题干，请重新框选题目或手动填写题干",
        };
        const knownCode = Object.hasOwn(messages, err?.code) ? err.code : "OCR_UPSTREAM_ERROR";
        return jsonResp(502, {
          code: knownCode,
          message: messages[knownCode] || "OCR 未能识别题干，可重试或先保存原图",
          ...(hasUpstreamStatus ? { upstreamStatus } : {}),
        });
      }
    }

    // 7. 拍照智能深度分析
    if (pathname === "/api/analyze" && method === "POST") {
      const { imageBase64, mimeType, subjectId } = body;
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return jsonResp(400, { message: "Missing image data" });
      }
      const imgSec = await security.checkImage(imageBase64, mimeType || "image/jpeg");
      if (!imgSec.ok) return jsonResp(400, { message: imgSec.reason || "图片未通过安全审核" });

      const wrongAnswerText = typeof body.wrongAnswerText === "string" ? body.wrongAnswerText.trim().slice(0, 2000) : "";
      if (wrongAnswerText) {
        const sec = await security.checkText(wrongAnswerText, openId, 2);
        if (!sec.ok) return jsonResp(400, { message: sec.reason || "错解未通过安全审核" });
      }

      let subjectHint = "";
      if (subjectId) {
        const nb = await db.readDoc(collections.notebooks, subjectId);
        if (nb && nb.userId === userId) subjectHint = nb.name;
      }

      return runAnalysis({
        writes, userId, scope: pathname, requestId: body.requestId, questionFromImage: true,
        solve: () => ai.analyzeImage({ imageBase64, mimeType, subjectHint, wrongAnswerText }),
      });
    }

    // 8. 文本智能分析
    if (pathname === "/api/reanswer" && method === "POST") {
      const { questionText, subject, imageBase64, mimeType } = body;
      if (typeof questionText !== "string" || !questionText.trim() || questionText.length > 5000) {
        return jsonResp(400, { message: "请输入不超过 5000 字的题干" });
      }
      const wrongAnswerText = typeof body.wrongAnswerText === "string" ? body.wrongAnswerText.trim().slice(0, 2000) : "";
      const txtSec = await security.checkText([questionText, wrongAnswerText].filter(Boolean).join("\n"), openId, 2);
      if (!txtSec.ok) return jsonResp(400, { message: txtSec.reason || "输入内容未通过安全审核" });
      if (imageBase64) {
        const imgSec = await security.checkImage(imageBase64, mimeType || "image/jpeg");
        if (!imgSec.ok) return jsonResp(400, { message: imgSec.reason || "图片未通过安全审核" });
      }

      return runAnalysis({
        writes, userId, scope: pathname, requestId: body.requestId,
        solve: () => ai.reanswerQuestion({
          questionText, wrongAnswerText, subjectHint: typeof subject === "string" ? subject : "", imageBase64, mimeType,
        }),
      });
    }

    if (pathname === "/api/home" && method === "GET") {
      const [recent, pending] = await Promise.all([
        db.listErrorItems(collections.errorItems, { userId, skip: 0, limit: 5 }),
        db.countUnmasteredItems(collections.errorItems, userId).catch(() => null),
      ]);
      return jsonResp(200, {
        recent: { items: recent.rows.map(formatListItem), total: recent.total },
        pending: pending === null ? null : { total: pending },
      });
    }

    // 9. 错题列表
    if (pathname === "/api/error-items/list" && method === "GET") {
      const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
      const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize || "20", 10) || 20));
      const { rows, total } = await db.listErrorItems(collections.errorItems, {
        userId,
        subjectId: query.subjectId || "",
        mastery: query.mastery,
        search: (query.query || "").trim().slice(0, 120),
        skip: (page - 1) * pageSize,
        limit: pageSize,
      });
      return jsonResp(200, {
        items: rows.map(formatListItem),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    // 10. 新建错题
    if (pathname === "/api/error-items" && method === "POST") {
      const { requestId } = body;
      if (requestId !== undefined && !validRequestId(requestId)) {
        return jsonResp(400, { message: "保存请求号无效" });
      }
      const itemId = requestId && requestDocId("e_", userId, pathname, requestId);
      if (itemId) {
        const existing = await db.readDoc(collections.errorItems, itemId);
        if (existing) return jsonResp(200, await formatWithImage(existing));
      }
      if (body.lookupOnly === true) {
        return jsonResp(404, { code: "SAVE_NOT_FOUND", message: "尚未找到已保存的错题，请重新选择原图" });
      }

      const {
        questionText = "",
        answerText = "",
        analysis = "",
        wrongAnswerText = "",
        mistakeAnalysis = "",
        mistakeStatus = "unknown",
        knowledgePoints = [],
        originalImageUrl = "",
        subjectId = "",
      } = body;

      if (!String(questionText || "").trim() && !originalImageUrl) {
        return jsonResp(400, { message: "请填写题干或上传题图" });
      }
      const points = Array.isArray(knowledgePoints)
        ? knowledgePoints.filter((point) => typeof point === "string").slice(0, 12) : [];
      const textCombined = [questionText, wrongAnswerText, answerText, analysis, mistakeAnalysis, ...points]
        .filter((value) => typeof value === "string" && value.trim()).join("\n");
      if (textCombined) {
        const sec = await security.checkText(textCombined, openId, 2);
        if (!sec.ok) return jsonResp(400, { message: sec.reason || "输入内容未通过安全合规审核" });
      }

      let subjectName = "数学";
      if (subjectId) {
        const nb = await db.readDoc(collections.notebooks, subjectId);
        if (!nb || nb.userId !== userId) return jsonResp(400, { message: "请选择有效的学科错题本" });
        subjectName = SCIENCE_NOTEBOOKS.has(nb.name) ? "科学" : nb.name;
      } else {
        const nbs = await ensureNotebooks(userId, writes);
        if (nbs[0]) subjectName = nbs[0].name;
      }

      let originalImageFileId = "";
      if (originalImageUrl) {
        if (typeof originalImageUrl !== "string" || !originalImageUrl.startsWith("data:image/")) {
          return jsonResp(400, { message: "请上传本地题图" });
        }
        const imageMime = originalImageUrl.match(/^data:(image\/[^;]+);base64,/)?.[1];
        const imgSec = await security.checkImage(originalImageUrl, imageMime);
        if (!imgSec.ok) return jsonResp(400, { message: imgSec.reason || "图片未通过安全审核" });
        originalImageFileId = await files.uploadBase64Image(userId, originalImageUrl, imageMime, itemId);
        if (!originalImageFileId) return jsonResp(502, { message: "题图上传未完成，请重试" });
      }

      const now = new Date().toISOString();
      const data = {
        userId,
        subjectId,
        subjectName,
        questionText: String(questionText || ""),
        answerText: String(answerText || ""),
        analysis: String(analysis || ""),
        wrongAnswerText: String(wrongAnswerText || ""),
        mistakeAnalysis: String(mistakeAnalysis || ""),
        mistakeStatus: String(mistakeStatus || "unknown"),
        knowledgePoints: points,
        originalImageFileId,
        originalImageUrl: "",
        masteryLevel: 0,
        userNotes: "",
        createdAt: now,
        updatedAt: now,
      };
      const saveId = itemId || "e_" + randomUUID();
      const { item, isNew } = await writes.runTransaction([collections.errorItems], async (tx) => {
        const existing = await tx.readDoc(collections.errorItems, saveId);
        if (existing) return { item: existing, isNew: false };
        const item = await tx.setDoc(collections.errorItems, saveId, data);
        return { item, isNew: true };
      }).catch(async (error) => {
        if (error.accountResponse && originalImageFileId) {
          const existing = await db.readDoc(collections.errorItems, saveId);
          if (existing?.originalImageFileId !== originalImageFileId) await files.deleteFiles([originalImageFileId]);
        }
        throw error;
      });
      if (!isNew && originalImageFileId && item.originalImageFileId !== originalImageFileId) {
        await files.deleteFiles([originalImageFileId]);
      }
      return jsonResp(isNew ? 201 : 200, await formatWithImage(item));
    }

    // 11. 单条错题详情 / 操作 (/api/error-items/:id[/action])
    const itemMatch = pathname.match(/^\/api\/error-items\/([^/]+)(?:\/(mastery|notes|analyze|practice|practice-answer|delete))?$/);
    if (itemMatch) {
      const itemId = decodeURIComponent(itemMatch[1]);
      const action = itemMatch[2] || "";
      const doc = await db.readDoc(collections.errorItems, itemId);
      if (!doc || doc.userId !== userId) {
        return jsonResp(404, { message: "错题不存在或无权访问" });
      }

      if (!action && method === "GET") {
        return jsonResp(200, await formatWithImage(doc));
      }

      if (action === "mastery" && method === "PATCH") {
        const masteryLevel = clampInt(body.masteryLevel, 0, 0, 5);
        await writes.updateDoc(collections.errorItems, itemId, {
          masteryLevel,
          updatedAt: new Date().toISOString(),
        });
        return jsonResp(200, { id: itemId, masteryLevel });
      }

      if (action === "notes" && method === "PATCH") {
        const userNotes = typeof body.userNotes === "string" ? body.userNotes.slice(0, 5000) : "";
        if (userNotes.trim()) {
          const sec = await security.checkText(userNotes, openId, 2);
          if (!sec.ok) return jsonResp(400, { message: sec.reason || "笔记内容未通过安全审核" });
        }
        await writes.updateDoc(collections.errorItems, itemId, {
          userNotes,
          updatedAt: new Date().toISOString(),
        });
        return jsonResp(200, { id: itemId, userNotes });
      }

      if (action === "delete" && method === "DELETE") {
        await writes.removeDoc(collections.errorItems, itemId);
        if (doc.originalImageFileId) {
          await files.deleteFiles([doc.originalImageFileId]);
        }
        return jsonResp(200, { deleted: true, id: itemId });
      }

      if (action === "practice-answer" && method === "POST") {
        const index = PRACTICE_STAGES.indexOf(body.stage);
        const answer = typeof body.answer === "string" && body.answer.length <= 500
          ? normalizePracticeAnswer(body.answer) : "";
        if (index < 0 || !answer) return jsonResp(400, { message: "请输入答案" });
        return writes.runTransaction([collections.errorItems, collections.users], async (tx) => {
          const item = await tx.readDoc(collections.errorItems, itemId);
          if (!item || item.userId !== userId) return jsonResp(404, { message: "错题不存在" });
          if (!completePractice(item.practice) || item.practiceSource !== String(item.questionText || "").trim()) {
            return jsonResp(409, { message: "请重新打开练习" });
          }
          const progress = item.practiceProgress || 0;
          if (index > progress) return jsonResp(409, { message: "请先完成上一关" });
          const round = item.practice[body.stage];
          const alternate = Array.isArray(round.acceptedAnswers) ? round.acceptedAnswers : [];
          const correct = [round.answerText, ...alternate].some((value) => practiceAnswerMatches(value, answer));
          if (!correct) return jsonResp(200, { correct: false, experience: 0 });

          const currentUser = await tx.readDoc(collections.users, userId);
          const experience = index === progress ? PRACTICE_EXP[index] : 0;
          const totalExperience = (currentUser.practiceExperience || 0) + experience;
          if (experience) {
            await tx.updateDoc(collections.errorItems, itemId, { practiceProgress: index + 1 });
            await tx.updateDoc(collections.users, userId, { practiceExperience: totalExperience });
          }
          return jsonResp(200, {
            correct: true, experience, totalExperience, answerText: round.answerText, analysis: round.analysis,
          });
        });
      }

      if (action === "practice" && method === "POST") {
        const questionText = String(doc.questionText || "").trim();
        if (!questionText || questionText.length > 5000) {
          return jsonResp(400, { message: "请先补齐题干文字，再开始同类练习" });
        }
        const sec = await security.checkText(questionText, openId, 2);
        if (!sec.ok) return jsonResp(400, { message: sec.reason || "题干内容未通过安全审核" });
        return runAnalysis({
          writes, userId, scope: pathname, itemId, practiceFor: questionText,
          solve: async () => ({
            practice: await ai.generatePractice({
              questionText,
              subjectHint: doc.subjectName || "",
              knowledgePoints: Array.isArray(doc.knowledgePoints) ? doc.knowledgePoints : [],
            }),
          }),
        });
      }

      if (action === "analyze" && method === "POST") {
        const effectiveText = typeof body.questionText === "string" && body.questionText.trim()
          ? body.questionText.trim()
          : String(doc.questionText || "").trim();
        const wrongAnswerText = typeof doc.wrongAnswerText === "string" ? doc.wrongAnswerText.trim() : "";
        const text = [effectiveText, wrongAnswerText].filter(Boolean).join("\n");
        if (text) {
          const sec = await security.checkText(text, openId, 2);
          if (!sec.ok) return jsonResp(400, { message: sec.reason || "题干内容未通过安全审核" });
        }

        let imageBase64 = "";
        let mimeType = "image/jpeg";
        if (doc.originalImageFileId) {
          imageBase64 = await files.downloadBase64(doc.originalImageFileId);
          if (/\.png$/i.test(doc.originalImageFileId)) mimeType = "image/png";
          if (/\.webp$/i.test(doc.originalImageFileId)) mimeType = "image/webp";
        } else if (doc.originalImageUrl?.startsWith("data:image/")) {
          imageBase64 = doc.originalImageUrl;
          mimeType = imageBase64.match(/^data:(image\/[^;]+);base64,/)?.[1] || mimeType;
        }
        if (!effectiveText && !imageBase64) {
          return jsonResp(400, { message: "缺少题干或题图，无法解析" });
        }
        if (imageBase64) {
          const sec = await security.checkImage(imageBase64, mimeType);
          if (!sec.ok) return jsonResp(400, { message: sec.reason || "图片未通过安全审核" });
        }

        const input = { subjectHint: doc.subjectName || "", imageBase64, mimeType, wrongAnswerText };
        const result = await runAnalysis({
          writes, userId, scope: pathname, requestId: body.requestId, itemId, questionFromImage: !effectiveText,
          solve: () => effectiveText
            ? ai.reanswerQuestion({ ...input, questionText: effectiveText })
            : ai.analyzeImage(input),
        });
        if (result.statusCode === 200) {
          const current = await db.readDoc(collections.errorItems, itemId);
          if (!current || current.userId !== userId) return jsonResp(404, { message: "错题不存在" });
          return jsonResp(200, { item: await formatWithImage(current), quota: result.data.quota });
        }
        return result;
      }
    }

    return jsonResp(404, { message: `Unknown route: ${method} ${pathname}` });
  }

  return async (event) => {
    try {
      return await handle(event);
    } catch (error) {
      if (error?.accountResponse) return error.accountResponse;
      throw error;
    }
  };
}

module.exports = {
  createCore,
  computeUserQuotaStatus,
  DEFAULT_AI_TRIAL_LIMIT,
  DAILY_AD_REWARD_LIMIT,
};
