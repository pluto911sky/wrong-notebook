"use strict";

function getTencentOcrConfig(env) {
  const secretId = String(env.TENCENT_OCR_SECRET_ID || "").trim();
  const secretKey = String(env.TENCENT_OCR_SECRET_KEY || "").trim();
  return { secretId, secretKey, configured: Boolean(secretId && secretKey) };
}

function createTencentOcrRequest({ secretId, secretKey }) {
  const { ocr } = require("tencentcloud-sdk-nodejs-ocr");
  const client = new ocr.v20181119.Client({
    credential: { secretId, secretKey },
    region: "",
    profile: { httpProfile: { endpoint: "ocr.tencentcloudapi.com", reqTimeout: 12 } },
  });
  return (params) => client.GeneralAccurateOCR(params);
}

function formatLines(detections) {
  const lines = (Array.isArray(detections) ? detections : []).filter(
    (line) => typeof line?.DetectedText === "string" && line.DetectedText.trim()
  );
  if (lines.every((line) => Number.isFinite(line.ItemPolygon?.Y) && Number.isFinite(line.ItemPolygon?.X))) {
    lines.sort((a, b) => a.ItemPolygon.Y - b.ItemPolygon.Y || a.ItemPolygon.X - b.ItemPolygon.X);
  }
  return lines.map((line) => line.DetectedText.trim()).join("\n")
    .replace(/([。？！?!])\s*[（(]\s*[0-9０-９]+(?:[.．][0-9０-９]+)?\s*分\s*[）)](?=\s*(?:\n|$))/gu, "$1")
    .replace(/(?:\n|([。？！?!]))[ \t]*(?=[（(][0-9０-９一二三四五六七八九十]+[）)])/gu, "$1\n\n")
    .trim();
}

function createTencentOcr(env, request) {
  const config = getTencentOcrConfig(env);
  return async ({ imageBase64, subjectHint }) => {
    if (!config.configured) {
      throw Object.assign(new Error("腾讯云 OCR 密钥尚未配置"), { code: "AI_NOT_CONFIGURED" });
    }
    request ||= createTencentOcrRequest(config);
    const response = await request({
      ImageBase64: imageBase64.replace(/^data:[^;]+;base64,/, "").trim(),
      ConfigID: "OCR",
      IsWords: false,
      WordsType: "2",
    });
    const questionText = formatLines(response.TextDetections);
    if (!questionText) {
      throw Object.assign(new Error("未识别到印刷题干"), { code: "AI_INCOMPLETE_RESULT" });
    }
    return { questionText, subject: subjectHint || "", requiresImage: true };
  };
}

module.exports = { createTencentOcr, getTencentOcrConfig };
