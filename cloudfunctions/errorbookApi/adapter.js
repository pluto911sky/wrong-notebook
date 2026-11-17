"use strict";

const { createHash } = require("node:crypto");

const COLLECTIONS = {
  users: "eb_users",
  notebooks: "eb_notebooks",
  errorItems: "eb_error_items",
  pets: "eb_pets",
  analysisRequests: "eb_analysis_requests",
  quotaCards: "eb_quota_cards",
};

const LOCAL_BLOCKLIST = [
  /(?:法轮功|六四事件|天安门事件)/i,
  /(?:色情网站|约炮神器|裸聊|成人电影)/i,
  /(?:冰毒配方|制造炸药|购买枪支|代开发票|赌博网站)/i,
];

function createAdapter(cloud) {
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();
  const _ = db.command;
  const ensuredCollections = new Set();

  async function ensureCollection(name) {
    if (ensuredCollections.has(name)) return;
    try {
      await db.createCollection(name);
    } catch {
      // 已存在时 CloudBase 返回已存在错误，忽略即可
    }
    ensuredCollections.add(name);
  }

  function docMissing(error) {
    const code = String(error?.errCode ?? error?.code ?? "");
    const msg = String(error?.errMsg ?? error?.message ?? "");
    return (
      /document .*does not exist/i.test(msg) ||
      code.includes("DOCUMENT_NOT_EXIST") ||
      code.includes("DOCUMENT_NOT_FOUND")
    );
  }

  async function readFrom(source, collection, docId) {
    try {
      const res = await source.collection(collection).doc(docId).get();
      return res?.data || null;
    } catch (err) {
      if (docMissing(err)) return null;
      throw err;
    }
  }

  async function readDoc(collection, docId) {
    await ensureCollection(collection);
    return readFrom(db, collection, docId);
  }

  async function runTransaction(names, action) {
    await Promise.all([...new Set(names)].map(ensureCollection));
    // The server SDK resolves after commit without forwarding the callback value.
    let result;
    await db.runTransaction(async (transaction) => {
      result = await action({
        readDoc: (collection, id) => readFrom(transaction, collection, id),
        async setDoc(collection, id, data) {
          await transaction.collection(collection).doc(id).set({ data });
          return { _id: id, ...data };
        },
        async removeDoc(collection, id) {
          await transaction.collection(collection).doc(id).remove();
        },
        async updateDoc(collection, id, data) {
          // CloudBase merges plain objects into nested fields. A released lease is null.
          const patch = collection === COLLECTIONS.users && data.analysisLease
            ? { ...data, analysisLease: _.set(data.analysisLease) }
            : data;
          await transaction.collection(collection).doc(id).update({ data: patch });
        },
      });
    });
    return result;
  }

  async function setDoc(collection, docId, data) {
    await ensureCollection(collection);
    await db.collection(collection).doc(docId).set({ data });
    return { _id: docId, ...data };
  }

  async function addDoc(collection, data) {
    await ensureCollection(collection);
    const res = await db.collection(collection).add({ data });
    return { _id: res._id, id: res._id, ...data };
  }

  async function updateDoc(collection, docId, data) {
    await ensureCollection(collection);
    await db.collection(collection).doc(docId).update({ data });
  }

  async function removeDoc(collection, docId) {
    await ensureCollection(collection);
    await db.collection(collection).doc(docId).remove();
  }

  async function queryDocs(collection, { where = {}, orderByField, orderDir = "desc", limit = 200, skip = 0 } = {}) {
    await ensureCollection(collection);
    let q = db.collection(collection).where(where);
    if (orderByField) {
      q = q.orderBy(orderByField, orderDir);
    }
    if (skip > 0) q = q.skip(skip);
    const res = await q.limit(limit).get();
    return res?.data || [];
  }

  async function countDocs(collection, where = {}) {
    await ensureCollection(collection);
    const res = await db.collection(collection).where(where).count();
    return res?.total || 0;
  }

  function unmasteredFilter() {
    return _.or([
      { masteryLevel: _.lte(0) },
      { masteryLevel: null },
      { masteryLevel: _.exists(false) },
    ]);
  }

  function countUnmasteredItems(collection, userId) {
    return countDocs(collection, _.and([{ userId }, unmasteredFilter()]));
  }

  async function listErrorItems(collection, { userId, subjectId, mastery, search, skip, limit }) {
    await ensureCollection(collection);
    const scope = subjectId ? { userId, subjectId } : { userId };
    const filters = [scope];
    if (mastery === "1") filters.push({ masteryLevel: _.gt(0) });
    if (mastery === "0") filters.push(unmasteredFilter());
    if (search) {
      const regexp = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filters.push(_.or(["questionText", "subjectName", "knowledgePoints"].map((field) => ({
        [field]: db.RegExp({ regexp, options: "i" }),
      }))));
    }
    const query = db.collection(collection).where(filters.length === 1 ? scope : _.and(filters));
    const [result, count] = await Promise.all([
      query.orderBy("createdAt", "desc").orderBy("_id", "desc").skip(skip).limit(limit).field({
        _id: true, subjectId: true, subjectName: true, questionText: true, masteryLevel: true,
        createdAt: true, originalImageFileId: true, originalImageUrl: true, answerText: true, analysis: true,
      }).get(),
      query.count(),
    ]);
    return { rows: result.data || [], total: count.total || 0 };
  }

  const files = {
    async uploadBase64Image(userId, imageBase64, mimeType = "image/jpeg", itemId) {
      let clean = String(imageBase64 || "");
      const m = clean.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        mimeType = m[1];
        clean = m[2];
      }
      if (!clean) return "";
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
      const safeUid = createHash("sha256").update(String(userId)).digest("hex").slice(0, 16);
      const content = Buffer.from(clean, "base64");
      const name = itemId
        ? `${itemId}_${createHash("sha256").update(content).digest("hex").slice(0, 24)}`
        : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const cloudPath = `eb_images/${safeUid}/${name}.${ext}`;
      const res = await cloud.uploadFile({
        cloudPath,
        fileContent: content,
      });
      return res?.fileID || "";
    },

    async getTempUrls(fileIds) {
      const valid = (fileIds || []).filter((id) => typeof id === "string" && id.startsWith("cloud://"));
      if (!valid.length) return {};
      const map = {};
      for (let i = 0; i < valid.length; i += 20) {
        const chunk = valid.slice(i, i + 20);
        const res = await cloud.getTempFileURL({
          fileList: chunk.map((fileID) => ({ fileID, maxAge: 3600 })),
        });
        for (const item of res?.fileList || []) {
          if (item.status === 0 && item.tempFileURL) {
            map[item.fileID] = item.tempFileURL;
          }
        }
      }
      return map;
    },

    async deleteFiles(fileIds, { strict = false } = {}) {
      const valid = (fileIds || []).filter((id) => typeof id === "string" && id.startsWith("cloud://"));
      if (!valid.length) return;
      if (!strict) {
        await cloud.deleteFile({ fileList: valid }).catch(() => {});
        return;
      }
      const result = await cloud.deleteFile({ fileList: valid });
      const accepted = new Set(["0", "-503003", "STORAGE_FILE_NONEXIST"]);
      if (valid.some((id) => !result?.fileList?.some((file) =>
        file.fileID === id && accepted.has(String(file.status))))) {
        throw new Error("题图清理未确认");
      }
    },

    async downloadBase64(fileId) {
      if (!fileId || !String(fileId).startsWith("cloud://")) return "";
      const res = await cloud.downloadFile({ fileID: fileId });
      return res?.fileContent ? Buffer.from(res.fileContent).toString("base64") : "";
    },
  };

  function securityOpenApi() {
    const sourceAppId = cloud.getWXContext()?.FROM_APPID;
    // In a shared environment, the user's OpenID belongs to the calling app.
    const api = sourceAppId ? cloud.openapi({ appid: sourceAppId }) : cloud.openapi;
    return api?.security;
  }

  const moderationUnavailable = "内容安全校验暂不可用，请稍后重试";
  const textRejected = "文字未通过内容安全校验，请修改后重试";
  const imageRejected = "图片未通过内容安全校验，请更换题图后重试";

  function getErrorCode(result) {
    return String(result?.errCode ?? result?.errcode ?? result?.code ?? "");
  }

  function imageMimeType(buf) {
    if (buf.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
    if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
    if (["GIF87a", "GIF89a"].includes(buf.subarray(0, 6).toString("ascii"))) return "image/gif";
    return "";
  }

  const security = {
    async checkText(text, openid, scene = 2) {
      const s = typeof text === "string" ? text.trim() : "";
      if (!s) return { ok: true };
      for (const re of LOCAL_BLOCKLIST) {
        if (re.test(s)) {
          return { ok: false, reason: "内容包含敏感或违规信息，请修改后重试" };
        }
      }
      try {
        const api = securityOpenApi();
        const characters = Array.from(s);
        const maxCharacters = 2400;
        const overlap = 100;
        for (let offset = 0; offset < characters.length; offset += maxCharacters - overlap) {
          const end = offset + maxCharacters;
          const res = await api.msgSecCheck({
            content: characters.slice(offset, end).join(""),
            version: 2,
            scene,
            openid,
          });
          const code = getErrorCode(res);
          const verdict = res?.result?.suggest;
          if (code === "87014" || verdict === "risky" || verdict === "review") {
            return { ok: false, reason: textRejected };
          }
          if (code !== "0" || verdict !== "pass") {
            return { ok: false, reason: moderationUnavailable };
          }
          if (end >= characters.length) break;
        }
      } catch (err) {
        return { ok: false, reason: getErrorCode(err) === "87014" ? textRejected : moderationUnavailable };
      }
      return { ok: true };
    },

    async checkImage(imageBase64) {
      const clean = String(imageBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
      if (!clean) return { ok: false, reason: "图片数据为空" };
      const maxImageBytes = 1000 * 1024;
      if (Buffer.byteLength(clean, "base64") > maxImageBytes) {
        return { ok: false, reason: "图片超过内容安全校验大小限制，请缩小裁剪范围或压缩到 1 MB 以下后重试" };
      }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) {
        return { ok: false, reason: "图片数据格式无效，请重新选择题图" };
      }
      const buf = Buffer.from(clean, "base64");
      const mimeType = imageMimeType(buf);
      if (!mimeType) return { ok: false, reason: "请选择 JPEG、PNG 或 GIF 格式的图片" };
      try {
        const api = securityOpenApi();
        const res = await api.imgSecCheck({ media: { contentType: mimeType, value: buf } });
        const code = getErrorCode(res);
        if (code === "87014") return { ok: false, reason: imageRejected };
        if (code === "0" && res.result === undefined && res.buffer === undefined) return { ok: true };
        return { ok: false, reason: moderationUnavailable };
      } catch (err) {
        return { ok: false, reason: getErrorCode(err) === "87014" ? imageRejected : moderationUnavailable };
      }
    },
  };

  return {
    collections: COLLECTIONS,
    cmd: _,
    db: { readDoc, setDoc, addDoc, updateDoc, removeDoc, queryDocs, countDocs, countUnmasteredItems, runTransaction, listErrorItems },
    files,
    security,
    getIdentity: () => cloud.getWXContext(),
  };
}

module.exports = { createAdapter, COLLECTIONS };
