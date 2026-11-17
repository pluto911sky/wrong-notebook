"use strict";

const http = require("node:http");
const https = require("node:https");
const { createTencentOcr, getTencentOcrConfig } = require("./tencent-ocr");

function requestJson(targetUrl, { method = "POST", headers = {}, body, timeoutMs = 50000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === "http:" ? http : https;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;

    const req = transport.request(
      parsed,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg =
              (json && json.error && (json.error.message || json.error)) ||
              (json && json.message) ||
              `模型接口返回错误 (${res.statusCode})`;
            const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
            err.statusCode = res.statusCode;
            err.responseBody = raw.slice(0, 500);
            reject(err);
            return;
          }
          resolve(json || { raw });
        });
      },
    );

    const deadlineTimer = setTimeout(() => {
      req.destroy(new Error("模型推理超时，请稍后重试"));
    }, timeoutMs);
    req.once("close", () => clearTimeout(deadlineTimer));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJsonFromAI(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return {};
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        // fallback below
      }
    }
  }
  return { rawText: text };
}

const BUILTIN_THINKING_HOSTS = new Set([
  "api.deepseek.com",
  "open.bigmodel.cn",
  "api.z.ai",
]);

function normalizeTask(task) {
  return String(task || "").toLowerCase() === "ocr" ? "ocr" : "solve";
}

function parseOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parseHostList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getHostname(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isDashScopeHost(hostname) {
  return /(?:^|\.)dashscope(?:-intl|-us)?\.aliyuncs\.com$/i.test(hostname || "");
}

function matchesHostList(hostname, hosts) {
  if (!hostname || !Array.isArray(hosts) || !hosts.length) return false;
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isThinkingCapableOpenAIHost(hostname, customHosts = []) {
  if (!hostname) return false;
  if (isDashScopeHost(hostname)) return true;
  if (BUILTIN_THINKING_HOSTS.has(hostname) || hostname === "volces.com" || hostname.endsWith(".volces.com")) {
    return true;
  }
  return matchesHostList(hostname, customHosts);
}

function parseTimeoutMs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : undefined;
}

/**
 * 解析当前任务（ocr | solve）的思考模式开关与推理深度。
 * OCR 任务仅提取题干，在已识别的支持思考控制接口上默认关闭思考以降低延迟。
 */
function resolveTaskThinkingSettings({ provider, task, baseUrl, env = {}, override = {}, user = null, isCustomKey = false }) {
  const normalizedTask = normalizeTask(task);
  const customHosts = parseHostList(env.THINKING_CAPABLE_HOSTS);
  const explicitOverride =
    parseOptionalBoolean(override?.disableThinking) ??
    parseOptionalBoolean(override?.customDisableThinking) ??
    parseOptionalBoolean(user?.customDisableThinking);

  let reasoningEffort = (override?.reasoningEffort || "").trim().toLowerCase();
  if (!isCustomKey && !reasoningEffort) {
    const taskEffort =
      normalizedTask === "ocr"
        ? (env.OPENAI_OCR_REASONING_EFFORT || env.AI_OCR_REASONING_EFFORT || "").trim().toLowerCase()
        : (env.OPENAI_SOLVE_REASONING_EFFORT || env.AI_SOLVE_REASONING_EFFORT || "").trim().toLowerCase();
    const globalEffort = (env.OPENAI_REASONING_EFFORT || env.AI_REASONING_EFFORT || "").trim().toLowerCase();
    reasoningEffort = taskEffort || globalEffort;
  }

  let disableThinking = explicitOverride;
  if (disableThinking === undefined && !isCustomKey) {
    const providerPrefix = provider === "gemini" ? "GEMINI" : "OPENAI";
    const taskScope = normalizedTask === "ocr" ? "OCR" : "SOLVE";
    disableThinking =
      parseOptionalBoolean(env[`${providerPrefix}_${taskScope}_DISABLE_THINKING`]) ??
      parseOptionalBoolean(env[`AI_${taskScope}_DISABLE_THINKING`]) ??
      parseOptionalBoolean(env[`${providerPrefix}_DISABLE_THINKING`]) ??
      parseOptionalBoolean(env.AI_DISABLE_THINKING);
  }

  if (disableThinking === undefined && normalizedTask === "ocr") {
    const hostname = getHostname(baseUrl);
    if (provider === "gemini" || isThinkingCapableOpenAIHost(hostname, customHosts)) {
      disableThinking = true;
    }
  }

  return {
    task: normalizedTask,
    disableThinking,
    reasoningEffort,
    thinkingCapableHosts: customHosts,
  };
}

function buildOpenAIThinkingParams(aiCfg = {}) {
  const { baseUrl, model, disableThinking, reasoningEffort, thinkingCapableHosts } = aiCfg;
  const hostname = getHostname(baseUrl);
  const customHosts = Array.isArray(thinkingCapableHosts) ? thinkingCapableHosts : [];
  const params = {};

  if (disableThinking === undefined && !reasoningEffort) {
    return params;
  }

  // OpenAI 官方接口不识别 thinking/enable_thinking，仅在未禁用时允许 reasoning_effort
  if (hostname === "api.openai.com" && !matchesHostList(hostname, customHosts)) {
    if (disableThinking !== true && reasoningEffort) {
      params.reasoning_effort = reasoningEffort;
    }
    return params;
  }

  if (disableThinking !== undefined) {
    const useDashScopeField =
      isDashScopeHost(hostname) ||
      (!isThinkingCapableOpenAIHost(hostname, customHosts) && /^qwen/i.test(String(model || "").trim()));
    if (useDashScopeField) {
      params.enable_thinking = !disableThinking;
    } else {
      params.thinking = { type: disableThinking ? "disabled" : "enabled" };
    }
  }

  if (disableThinking !== true && reasoningEffort) {
    params.reasoning_effort = reasoningEffort;
  }

  return params;
}

function buildGeminiThinkingConfig(aiCfg = {}) {
  const { model, disableThinking, reasoningEffort } = aiCfg;
  if (disableThinking === undefined && !reasoningEffort) {
    return null;
  }

  const m = String(model || "").toLowerCase();
  if (disableThinking === true) {
    // Gemini 2.5 Pro 强制开启思考，传入 thinkingBudget: 0 会返回 400
    if (m.includes("2.5-pro")) {
      return null;
    }
    if (m.includes("gemini-3")) {
      return { thinkingLevel: "LOW" };
    }
    return { thinkingBudget: 0 };
  }

  if (reasoningEffort && m.includes("gemini-3")) {
    const upper = reasoningEffort.toUpperCase();
    if (["MINIMAL", "LOW", "MEDIUM", "HIGH"].includes(upper)) {
      return { thinkingLevel: upper };
    }
  }

  if (disableThinking === false) {
    return m.includes("gemini-3") ? { thinkingLevel: "HIGH" } : { thinkingBudget: -1 };
  }

  return null;
}

function isThinkingParamError(err) {
  if (!err || Number(err.statusCode) !== 400) return false;
  const detail = `${err.message || ""}\n${err.responseBody || ""}`.toLowerCase();
  return (
    detail.includes("thinking") ||
    detail.includes("reasoning_effort") ||
    detail.includes("reasoning effort")
  );
}

function resolveAIConfig(user, override = {}, env = process.env, options = {}) {
  const task = normalizeTask(options.task);
  const timeoutMs = parseTimeoutMs(env.AI_TIMEOUT_MS);
  const overrideKey = typeof override.customApiKey === "string" ? override.customApiKey.trim() : "";
  const userKey = typeof user?.customApiKey === "string" ? user.customApiKey.trim() : "";
  const customKey = overrideKey || userKey;

  if (customKey) {
    const provider =
      override.customAiProvider === "gemini" ||
      (!override.customAiProvider && user?.customAiProvider === "gemini") ||
      customKey.startsWith("AIza")
        ? "gemini"
        : "openai";
    const baseUrl = (override.customBaseUrl || user?.customBaseUrl || "").trim();
    const effectiveBaseUrl = baseUrl || (provider === "openai" ? "https://api.openai.com/v1" : "");
    const rawModel =
      task === "ocr"
        ? override.customOcrModel || user?.customOcrModel || override.customModel || user?.customModel || ""
        : override.customModel || user?.customModel || "";
    const model = String(rawModel).trim();
    const thinking = resolveTaskThinkingSettings({
      provider,
      task,
      baseUrl: effectiveBaseUrl,
      env,
      override,
      user,
      isCustomKey: true,
    });
    return {
      ok: true,
      source: "custom_key",
      provider,
      apiKey: customKey,
      baseUrl: effectiveBaseUrl,
      model: model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o"),
      timeoutMs,
      ...thinking,
    };
  }

  const taskProvider = ((task === "ocr" ? env.AI_OCR_PROVIDER : env.AI_SOLVE_PROVIDER) || env.AI_PROVIDER || "")
    .trim()
    .toLowerCase();

  const openaiSolveKey = (env.OPENAI_API_KEY || "").trim();
  const openaiOcrKey = (env.OPENAI_OCR_API_KEY || "").trim();
  const openaiKey = task === "ocr" ? openaiOcrKey || openaiSolveKey : openaiSolveKey;

  const geminiSolveKey = (env.GOOGLE_API_KEY || "").trim();
  const geminiOcrKey = (env.GEMINI_OCR_API_KEY || "").trim();
  const geminiKey = task === "ocr" ? geminiOcrKey || geminiSolveKey : geminiSolveKey;

  const buildPlatformConfig = (provider, apiKey, defaultBaseUrl, defaultModel) => {
    const prefix = provider === "gemini" ? "GEMINI" : "OPENAI";
    const taskKey = task === "ocr" ? "OCR" : "SOLVE";
    const baseUrl = (env[`${prefix}_${taskKey}_BASE_URL`] || env[`${prefix}_BASE_URL`] || defaultBaseUrl).trim();
    const model = (env[`${prefix}_${taskKey}_MODEL`] || env[`${prefix}_MODEL`] || defaultModel).trim();
    const thinking = resolveTaskThinkingSettings({
      provider,
      task,
      baseUrl,
      env,
      override,
      user,
    });
    return {
      ok: true,
      source: "platform",
      provider,
      apiKey,
      baseUrl,
      model,
      timeoutMs,
      ...thinking,
    };
  };

  if (taskProvider === "gemini" && geminiKey) {
    return buildPlatformConfig("gemini", geminiKey, "", "gemini-2.5-flash");
  }

  if (taskProvider === "openai" && openaiKey) {
    return buildPlatformConfig("openai", openaiKey, "https://api.openai.com/v1", "gpt-4o");
  }

  if (openaiKey) {
    return buildPlatformConfig("openai", openaiKey, "https://api.openai.com/v1", "gpt-4o");
  }

  if (geminiKey) {
    return buildPlatformConfig("gemini", geminiKey, "", "gemini-2.5-flash");
  }

  return {
    ok: false,
    error: "服务端尚未配置模型密钥，请在云函数环境变量中配置 OPENAI_API_KEY 或 GOOGLE_API_KEY。",
  };
}

function summarizePlatformConfig(cfg) {
  if (!cfg || !cfg.ok) {
    return {
      ok: false,
      configured: false,
      provider: null,
      hasKey: false,
      hasBaseUrl: false,
      hasModel: false,
    };
  }
  return {
    ok: true,
    configured: true,
    provider: cfg.provider,
    hasKey: Boolean(cfg.apiKey),
    hasBaseUrl: Boolean(cfg.baseUrl),
    hasModel: Boolean(cfg.model),
  };
}

/**
 * 复用业务配置解析逻辑，分别汇总解题与 OCR 两条链路的平台配置状态（不泄露任何密钥或地址原文）。
 */
function inspectPlatformAIConfig(env = process.env) {
  const solveCfg = resolveAIConfig(null, {}, env, { task: "solve" });
  const ocrCfg = resolveAIConfig(null, {}, env, { task: "ocr" });
  const solve = summarizePlatformConfig(solveCfg);
  const tencent = usesTencentOcr(env) ? getTencentOcrConfig(env) : null;
  const ocr = tencent ? {
    ok: tencent.configured,
    configured: tencent.configured,
    provider: "tencent",
    hasKey: tencent.configured,
    hasBaseUrl: true,
    hasModel: true,
    ...(!tencent.configured ? { message: "腾讯云 OCR 密钥尚未配置" } : {}),
  } : summarizePlatformConfig(ocrCfg);
  const ok = solve.ok && ocr.ok;
  const provider =
    solve.provider && ocr.provider
      ? solve.provider === ocr.provider
        ? solve.provider
        : `${solve.provider}/${ocr.provider}`
      : solve.provider || ocr.provider || null;

  return {
    ok,
    configured: ok,
    provider,
    hasKey: solve.hasKey && ocr.hasKey,
    hasBaseUrl: solve.hasBaseUrl && ocr.hasBaseUrl,
    hasModel: solve.hasModel && ocr.hasModel,
    solve,
    ocr,
    aiTimeoutMs: parseTimeoutMs(env.AI_TIMEOUT_MS) || 50000,
    ...(ok ? {} : { message: solveCfg.error || ocrCfg.error || "服务端尚未配置默认模型密钥" }),
  };
}

function buildGeminiRequest(aiCfg, { systemPrompt, userPrompt, imageBase64, mimeType = "image/jpeg", includeThinking = true }) {
  const base = (aiCfg.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const model = aiCfg.model || "gemini-2.5-flash";
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(aiCfg.apiKey)}`;
  const parts = [{ text: `${systemPrompt}\n\n${userPrompt}` }];
  if (imageBase64) {
    const cleanB64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    parts.push({ inline_data: { mime_type: mimeType || "image/jpeg", data: cleanB64 } });
  }
  const generationConfig = { temperature: 0.2 };
  const thinkingConfig = includeThinking ? buildGeminiThinkingConfig(aiCfg) : null;
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }
  return {
    url,
    hasThinkingParams: Boolean(thinkingConfig),
    body: {
      contents: [{ role: "user", parts }],
      generationConfig,
    },
  };
}

function buildOpenAIRequest(aiCfg, { systemPrompt, userPrompt, imageBase64, mimeType = "image/jpeg", includeThinking = true }) {
  const base = (aiCfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const userContent = imageBase64
    ? [
        { type: "text", text: userPrompt },
        {
          type: "image_url",
          image_url: {
            url: imageBase64.startsWith("data:")
              ? imageBase64
              : `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
          },
        },
      ]
    : userPrompt;

  const thinkingParams = includeThinking ? buildOpenAIThinkingParams(aiCfg) : {};
  const hasThinkingParams = Object.keys(thinkingParams).length > 0;
  return {
    url,
    hasThinkingParams,
    headers: {
      Authorization: `Bearer ${aiCfg.apiKey}`,
    },
    body: {
      model: aiCfg.model || "gpt-4o",
      temperature: 0.2,
      ...thinkingParams,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    },
  };
}

function extractGeminiText(res) {
  return res?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
}

function extractOpenAIText(res) {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
  }
  return "";
}

async function executeWithThinkingFallback({ aiCfg, promptArgs, buildRequest, extractText, requestImpl }) {
  const deadline = Date.now() + (aiCfg.timeoutMs || 50000);
  const dispatch = (req) => {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new Error("模型推理超时，请稍后重试");
    const reqInit = { method: "POST", body: req.body, timeoutMs };
    if (req.headers) {
      reqInit.headers = req.headers;
    }
    return requestImpl(req.url, reqInit);
  };

  const first = buildRequest(aiCfg, { ...promptArgs, includeThinking: true });
  try {
    return extractText(await dispatch(first));
  } catch (err) {
    // 兼容不识别 thinking/enable_thinking/thinkingConfig 参数的第三方中转或旧模型
    if (first.hasThinkingParams && isThinkingParamError(err)) {
      const retry = buildRequest(aiCfg, { ...promptArgs, includeThinking: false });
      return extractText(await dispatch(retry));
    }
    throw err;
  }
}

async function callModel(aiCfg, { systemPrompt, userPrompt, imageBase64, mimeType = "image/jpeg", task, requestImpl = requestJson }) {
  const effectiveCfg = task ? { ...aiCfg, task: normalizeTask(task) } : aiCfg;
  const promptArgs = { systemPrompt, userPrompt, imageBase64, mimeType };

  if (effectiveCfg.provider === "gemini") {
    return executeWithThinkingFallback({
      aiCfg: effectiveCfg,
      promptArgs,
      buildRequest: buildGeminiRequest,
      extractText: extractGeminiText,
      requestImpl,
    });
  }

  return executeWithThinkingFallback({
    aiCfg: effectiveCfg,
    promptArgs,
    buildRequest: buildOpenAIRequest,
    extractText: extractOpenAIText,
    requestImpl,
  });
}

function resolveConfiguredTask(user, override, env, task) {
  const cfg = resolveAIConfig(user, override, env, { task });
  if (!cfg.ok) {
    const err = new Error(cfg.error);
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  return cfg;
}

function answerField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTaskResult(raw, task, requiredFields) {
  const parsed = parseJsonFromAI(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
      requiredFields.some((field) => !answerField(parsed[field]))) {
    const err = new Error(task === "ocr"
      ? "未能识题，请重新框选图片或手动填写题干"
      : "未生成完整的题目解析，请核对题干后重试");
    err.code = "AI_INCOMPLETE_RESULT";
    throw err;
  }
  return parsed;
}

function formatSolution(parsed, wrongAnswerText) {
  const diagnosis = answerField(parsed.mistakeAnalysis);
  return {
    answerText: answerField(parsed.answerText),
    analysis: answerField(parsed.analysis),
    mistakeAnalysis: diagnosis && !wrongAnswerText && !/^常见易错提示[：:]/.test(diagnosis)
      ? `常见易错提示：${diagnosis}`
      : diagnosis,
    knowledgePoints: Array.isArray(parsed.knowledgePoints)
      ? [...new Set(parsed.knowledgePoints.map(answerField).filter(Boolean))].slice(0, 8)
      : [],
  };
}

const PRINTED_QUESTION_PROMPT =
  "逐字转录原题，只抄录印刷体题干、编号、选项和题目自带的文字。忽略手写答案、演算、涂改、圈点和批阅标记。省略题末的评分标注（如（6分）），保留题目条件中的分值。材料与各分问应各自成段。" +
  "保留题目顺序、换行、公式、单位、空格与原有作答空白。看不清的印刷文字用［无法辨认］标记，不补写。" +
  "有表格时转为 Markdown 表格，保留标题、行列顺序、单位和空单元格。有配图时保留图号、图注和可读标记，并在原位置写［见原图］。" +
  "题面包含配图、表格、复杂公式或其他须参照原图的内容时，将 requiresImage 设为 true。";

const SOLUTION_FORMAT_PROMPT =
  "answerText 先说结论，分问的答案逐项对应。" +
  "analysis 用空行分隔编号步骤，每段先写本步做什么，再讲依据以及计算如何得到；适合时在末尾验算。" +
  "mistakeAnalysis 用空行分隔易错点，每段写清容易在哪里错、为什么及如何避免，结合题中的条件或算式，避免套话。" +
  "knowledgePoints 只列本题实际考查的具体知识点。";

function usesTencentOcr(env) {
  return String(env.AI_OCR_PROVIDER || "").trim().toLowerCase() === "tencent";
}

function createAIService(env = process.env, { requestImpl = requestJson, tencentRequest } = {}) {
  const tencentOcr = usesTencentOcr(env) ? createTencentOcr(env, tencentRequest) : null;
  return {
    inspectConfig() {
      return inspectPlatformAIConfig(env);
    },

    async ocrImage({ imageBase64, mimeType, subjectHint, user, override }) {
      if (tencentOcr) return tencentOcr({ imageBase64, subjectHint });
      const cfg = resolveConfiguredTask(user, override, env, "ocr");
      const systemPrompt =
        "你是严谨的中小学试卷 OCR 识别助手。不要输出解答或答案。" +
        PRINTED_QUESTION_PROMPT +
        "整题无法识别时将 questionText 留空。必须返回纯 JSON：{\"questionText\":\"...\",\"subject\":\"数学|英语|物理|化学|语文|生物|历史|地理|政治\",\"requiresImage\":false}。";
      const userPrompt = subjectHint
        ? `请识别图中错题题干（可能属于学科：${subjectHint}），只返回 JSON。`
        : "请识别图中错题题干与学科，只返回 JSON。";
      const raw = await callModel(cfg, { systemPrompt, userPrompt, imageBase64, mimeType, task: "ocr", requestImpl });
      const parsed = parseTaskResult(raw, "ocr", ["questionText"]);
      return {
        questionText: answerField(parsed.questionText),
        subject: answerField(parsed.subject) || subjectHint || "数学",
        requiresImage: parsed.requiresImage === true,
      };
    },

    async analyzeImage({ imageBase64, mimeType, subjectHint, wrongAnswerText, user, override }) {
      const cfg = resolveConfiguredTask(user, override, env, "solve");
      const wrongAttempt = answerField(wrongAnswerText);
      const systemPrompt =
        "你是经验丰富的中小学错题辅导老师。请识别图片中的错题并给出完整分析。" +
        PRINTED_QUESTION_PROMPT +
        SOLUTION_FORMAT_PROMPT +
        (wrongAttempt
          ? "结合给出的学生错解找出可验证的错因。如果信息不足，请说明不确定性，切勿编造作答过程。"
          : "只给出这道题的常见易错提示，切勿推定学生做错的步骤。") +
        "无法确认题干或求解时，将对应字段留空。必须返回纯 JSON：" +
        "{\"questionText\":\"完整题干\",\"subject\":\"学科\",\"answerText\":\"标准答案\",\"analysis\":\"分步推导与解析\",\"mistakeAnalysis\":\"常见易错点与卡壳诊断\",\"knowledgePoints\":[\"知识点1\",\"知识点2\"],\"requiresImage\":false}";
      const wrongAttemptPrompt = wrongAttempt ? `\n\n学生提供的错解或卡壳记录：\n${wrongAttempt}` : "";
      const userPrompt = `${subjectHint ? `学科提示：${subjectHint}\n` : ""}请识别并分析图中这道错题。${wrongAttemptPrompt}\n\n请只返回 JSON。`;
      const raw = await callModel(cfg, { systemPrompt, userPrompt, imageBase64, mimeType, task: "solve", requestImpl });
      const parsed = parseTaskResult(raw, "solve", ["questionText", "answerText", "analysis"]);
      return {
        questionText: answerField(parsed.questionText),
        subject: answerField(parsed.subject) || subjectHint || "数学",
        ...formatSolution(parsed, wrongAttempt),
        requiresImage: parsed.requiresImage === true,
      };
    },

    async reanswerQuestion({ questionText, wrongAnswerText, subjectHint, imageBase64, mimeType, user, override, transcribeHandwriting = false }) {
      const cfg = resolveConfiguredTask(user, override, env, "solve");
      const wrongAttempt = answerField(wrongAnswerText);
      const readHandwriting = Boolean(imageBase64 && transcribeHandwriting);
      const systemPrompt =
        "你是经验丰富的中小学错题辅导老师。请针对题目给出标准答案和详细分步解析。" +
        SOLUTION_FORMAT_PROMPT +
        (imageBase64 ? "以用户校对的题干为准，结合原图中的印刷体、配图和表格独立求解。求解时不要参考图中的手写答案和批阅。" : "") +
        (readHandwriting ? "额外转录本题清晰可见的学生手写答案或算式到 handwrittenAnswer 字段。仅照抄，不纠正错误、不补写，不抄教师的批阅或订正；无法区分或看不清时返回空字符串。手写转录与参考答案字段分开。" : "") +
        (wrongAttempt
          ? "结合给出的学生错解找出可验证的错因。如果信息不足，请说明不确定性，切勿编造作答过程。"
          : "只给出这道题的常见易错提示，切勿推定学生做错的步骤。") +
        "无法求解时将答案和解析字段留空。必须返回纯 JSON：" +
        "{\"answerText\":\"标准答案\",\"analysis\":\"分步推导与解析\",\"mistakeAnalysis\":\"易错点与卡壳原因\",\"knowledgePoints\":[\"知识点1\",\"知识点2\"]}";
      const wrongAttemptPrompt = wrongAttempt ? `\n\n学生提供的错解或卡壳记录：\n${wrongAttempt}` : "";
      const userPrompt = `${subjectHint ? `学科：${subjectHint}\n` : ""}题目：\n${questionText}${wrongAttemptPrompt}\n\n请只返回 JSON。`;
      const raw = await callModel(cfg, { systemPrompt, userPrompt, imageBase64, mimeType, task: "solve", requestImpl });
      const parsed = parseTaskResult(raw, "solve", ["answerText", "analysis"]);
      return { ...formatSolution(parsed, wrongAttempt),
        ...(readHandwriting ? { handwrittenAnswer: answerField(parsed.handwrittenAnswer).slice(0, 2000) } : {}),
      };
    },

    async generatePractice({ questionText, subjectHint, knowledgePoints }) {
      const cfg = resolveConfiguredTask(null, {}, env, "solve");
      const systemPrompt =
        "你是中小学出题老师。根据原题出三道可以独立作答的新题，保留核心知识点和学段。" +
        "similar 换条件或问法，难度和推理步数接近原题。" +
        "advanced 在同类题上增加一个有意义的条件或推理步骤，允许学生继续使用原方法；不要只换大数字。" +
        "challenge 是压轴题，在进阶题基础上再增加一次有意义的推理或条件组合。不得跨学段或换核心知识点。" +
        "新题必须完整自足，不引用原图、原表或未提供的材料。题干不泄露答案。" +
        "每关只允许单选题或唯一的短数值答案，禁止要求描述步骤、解释理由、证明或写开放性段落。题干写明答案格式与单位，answerText 只写选项字母或最终数值。" +
        "acceptedAnswers 只列含义完全等价的常见写法（如题目问 x 的值时，x=5 和 5）；不列不完整或模糊答案。" +
        "分别独立解题、验算，核对答案和解析一致。原题信息不足以可靠出题时将字段留空。" +
        '只返回 JSON，必须包含 similar、advanced、challenge 三个对象。每个对象格式为 {"questionText":"","answerText":"","acceptedAnswers":[],"analysis":""}。';
      const userPrompt = JSON.stringify({ questionText, subjectHint, knowledgePoints });
      const raw = await callModel(cfg, { systemPrompt, userPrompt, task: "solve", requestImpl });
      const parsed = parseJsonFromAI(raw);
      const normalize = (round) => ({
        questionText: answerField(round?.questionText),
        answerText: answerField(round?.answerText),
        acceptedAnswers: Array.isArray(round?.acceptedAnswers)
          ? [...new Set(round.acceptedAnswers.map(answerField).filter((answer) => answer && answer.length <= 500))].slice(0, 12)
          : [],
        analysis: answerField(round?.analysis),
      });
      const practice = {
        similar: normalize(parsed?.similar),
        advanced: normalize(parsed?.advanced),
        challenge: normalize(parsed?.challenge),
      };
      const comparable = (text) => text.replace(/[\s。？！?！.]/gu, "").normalize("NFKC");
      const texts = [questionText, ...Object.values(practice).map((round) => round.questionText)].map(comparable);
      if (texts.some((text) => !text) || new Set(texts).size !== texts.length) {
        const error = new Error("练习题不完整或重复");
        error.code = "AI_INCOMPLETE_RESULT";
        throw error;
      }
      return practice;
    },
  };
}

module.exports = {
  buildGeminiRequest,
  buildGeminiThinkingConfig,
  buildOpenAIRequest,
  buildOpenAIThinkingParams,
  callModel,
  createAIService,
  inspectPlatformAIConfig,
  isThinkingParamError,
  parseJsonFromAI,
  resolveAIConfig,
};
