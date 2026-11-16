/* ============================================================
   配置模板 —— 复制本文件为 config.js 后按需修改（config.js 已被 .gitignore 忽略）
   ============================================================ */

/* 方式 A：WorkBuddy 云服务（免密钥，推荐）
   在 WorkBuddy 里为本项目开通云服务后，把 publicConfig 三个值填进来即可。
   前端只持有 publishableKey，它本身不带权限，服务端按 Origin 校验。 */
window.TVC_CONFIG = {
  provider: "workbuddy",
  endpoint: "https://YOUR-APP.app.workbuddy.host",
  publishableKey: "wbpk_xxxxxxxxxxxxxxxxxxxx",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
};

/* 方式 B：任意 OpenAI 兼容接口（自带 Key）
   注意：Key 会进入浏览器，仅适合个人本地/内网使用；对外部署请走服务端代理。
   接口需支持 stream:true（SSE）并允许当前域名跨域。 */
// window.TVC_CONFIG = {
//   provider: "openai",
//   baseUrl: "https://api.openai.com/v1",
//   apiKey: "sk-...",
//   models: ["gpt-4o-mini", "gpt-4o"],
// };

/* 方式 C：本地 Ollama / vLLM / LM Studio 等
   它们大多兼容 OpenAI 协议，且默认允许本地跨域。 */
// window.TVC_CONFIG = {
//   provider: "openai",
//   baseUrl: "http://127.0.0.1:11434/v1",
//   apiKey: "ollama",
//   models: ["qwen2.5:14b", "llama3.1:8b"],
// };
