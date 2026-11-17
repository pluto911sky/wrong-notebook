"use strict";

const cloud = require("wx-server-sdk");
const { randomUUID } = require("node:crypto");
const { createAdapter, COLLECTIONS } = require("./adapter");
const { createAIService } = require("./ai-client");
const { createCore } = require("./core");

const SLOW_REQUEST_MS = 10000;

let handler = null;

function getHandler() {
  if (!handler) {
    const adapter = createAdapter(cloud);
    const ai = createAIService(process.env);
    handler = createCore({
      db: adapter.db,
      collections: COLLECTIONS,
      files: adapter.files,
      security: adapter.security,
      ai,
      getIdentity: adapter.getIdentity,
    });
  }
  return handler;
}

// 云函数日志按单行 JSON 检索；这里统一做长度截断与密钥脱敏，避免把凭证写进日志。
function redact(value) {
  return String(value == null ? "" : value)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***")
    .replace(/\b((?:api[_-]?key|access[_-]?token|health[_-]?token|token|secret|password|authorization)\s*[=:]\s*)[^\s,"'&]+/gi, "$1***")
    .replace(/\b(sk|AIza)[A-Za-z0-9_\-]{8,}\b/g, "$1***")
    .slice(0, 800);
}

// 仅记录去掉查询参数与锚点后的纯路由路径，防止查询参数中的令牌或检索词进入云日志。
function sanitizeRoutePath(rawPath) {
  const clean = String(rawPath || "/")
    .trim()
    .split(/[?#]/)[0]
    .slice(0, 200);
  return clean || "/";
}

function logRecord(level, fields) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.warn(line);
}

function errorFields(error) {
  return {
    code: String(error?.code || error?.errCode || "UNKNOWN").slice(0, 80),
    name: String(error?.name || "Error").slice(0, 80),
    message: redact(error?.message),
    stack: redact(error?.stack).slice(0, 800),
  };
}

exports.redact = redact;
exports.sanitizeRoutePath = sanitizeRoutePath;

exports.main = async (event = {}) => {
  const requestId = randomUUID();
  const route = `${String(event.method || "GET").toUpperCase().slice(0, 16)} ${redact(sanitizeRoutePath(event.path))}`;
  const clientRequestId =
    typeof event?.data?.requestId === "string" ? event.data.requestId.slice(0, 64) : "";
  const started = Date.now();

  try {
    const result = await getHandler()(event);
    const durationMs = Date.now() - started;
    const statusCode = Number(result?.statusCode) || 500;
    if (statusCode >= 500 || durationMs >= SLOW_REQUEST_MS) {
      logRecord(statusCode >= 500 ? "error" : "warn", {
        event: "cloud_request_finished",
        requestId,
        clientRequestId,
        route,
        statusCode,
        durationMs,
        message: redact(result?.data?.message),
      });
    }
    return result;
  } catch (error) {
    logRecord("error", {
      event: "cloud_request_failed",
      requestId,
      clientRequestId,
      route,
      durationMs: Date.now() - started,
      ...errorFields(error),
    });
    return {
      statusCode: 500,
      data: {
        message: "云服务暂时无法处理请求，请稍后重试",
        requestId,
      },
    };
  }
};
