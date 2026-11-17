// 运行模式配置：
// - backendMode: 'cloud' 使用共享微信云开发环境（免独立服务器与域名备案）；'http' 对接自建 Next.js 服务
module.exports = {
  backendMode: 'cloud',
  resourceAppid: 'wx29f37952fff2dc57',
  resourceEnv: 'vision-prod-d6gm5kqaz79d6a35f',
  cloudFunctionName: 'errorbookApi',
  defaultHttpBaseUrl: 'http://localhost:3333',
};
