"use strict";

const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ALLOWED_APPIDS = new Set([
  "wx377b76862fca1861",
  "wx29f37952fff2dc57",
]);

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const fromAppId = wxContext.FROM_APPID || "";

  if (fromAppId && !ALLOWED_APPIDS.has(fromAppId)) {
    return {
      errCode: -1,
      errMsg: `unauthorized appid: ${fromAppId}`,
      auth: "",
    };
  }

  return {
    errCode: 0,
    errMsg: "",
    auth: JSON.stringify({
      appId: fromAppId || wxContext.APPID || "",
      openId: wxContext.FROM_OPENID || wxContext.OPENID || "",
    }),
  };
};
