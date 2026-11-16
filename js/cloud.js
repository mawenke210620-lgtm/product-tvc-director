/* ============================================================
   模型接入层：两种后端，同一套调用接口
     1) workbuddy —— WorkBuddy 云服务（免密钥，前端只持有 publishableKey）
     2) openai    —— 任意 OpenAI 兼容接口（自带 baseUrl / apiKey）
   配置来自同目录 config.js（不入库，见 config.example.js），
   也可由部署平台在页面里先行注入 window.TVC_CONFIG。
   ============================================================ */
(function () {
  const DEFAULTS = {
    provider: "workbuddy",
    // workbuddy 模式
    endpoint: "https://wbapp-vftgkc6etpq3jqtgwrc4kb.app.workbuddy.host",
    publishableKey: "wbpk_VFtgkC6ETpQ3jqtgWrC4Kb_5K9rYBP2VfP3NsUHS6387lsG6TyaAGJz",
    oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
    // openai 模式
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: ["gpt-4o-mini"],
  };

  const CONFIG = Object.assign({}, DEFAULTS, window.TVC_CONFIG || {});
  const isOpenAI = CONFIG.provider === "openai";

  /* ---------- OpenAI 兼容：SSE 流式解析 ---------- */
  function parseSSEBlock(block) {
    const lines = block.split("\n");
    let out = "";
    let done = false;
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") { done = true; continue; }
      try {
        const json = JSON.parse(payload);
        const ch = json.choices && json.choices[0];
        if (ch && ch.delta && ch.delta.content) out += ch.delta.content;
      } catch (e) { /* 忽略心跳与非 JSON 片段 */ }
    }
    return { text: out, done };
  }

  const Cloud = {
    client: null,
    models: [],
    ready: false,
    provider: CONFIG.provider,

    init() {
      if (!isOpenAI) {
        if (this.client) return this.client;
        if (!window.WorkBuddyCloud) {
          throw new Error("云服务 SDK 未能加载，请检查网络后刷新页面。");
        }
        this.client = window.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: CONFIG.endpoint,
          publishableKey: CONFIG.publishableKey,
          oauthRelayBaseUrl: CONFIG.oauthRelayBaseUrl,
        });
        return this.client;
      }
      if (!CONFIG.apiKey) {
        throw new Error("未配置 apiKey：请复制 config.example.js 为 config.js 并填入你的接口信息。");
      }
      return null;
    },

    async loadModels() {
      if (isOpenAI) {
        const list = (CONFIG.models || []).map((m) =>
          typeof m === "string" ? { id: m, name: m } : { id: m.id, name: m.name || m.id }
        );
        if (!list.length) throw new Error("config.js 的 models 为空，请至少配置一个模型名。");
        this.init();
        this.models = list;
        this.ready = true;
        return list;
      }
      this.init();
      const list = await this.client.llm.models.list();
      this.models = (list || []).filter((m) => m && m.id);
      this.ready = true;
      return this.models;
    },

    usableModels() {
      return this.models.filter((m) => m.disabled !== true);
    },

    statusText(count) {
      return (isOpenAI ? "模型接口已就绪" : "云服务已连接") + " · " + count + " 个可用模型，可开始生成。";
    },

    /* 流式调用：始终带 system 首条消息 */
    async chat({ model, messages, signal, onDelta, temperature }) {
      if (!model) throw new Error("尚未选择可用模型。");
      if (!messages.length || messages[0].role !== "system") {
        throw new Error("调用缺少 system 首条消息。");
      }
      this.init();

      if (isOpenAI) {
        const body = { model, messages, stream: true };
        if (typeof temperature === "number") body.temperature = temperature;
        const res = await fetch(CONFIG.baseUrl.replace(/\/$/, "") + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + CONFIG.apiKey },
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          const err = new Error("接口返回 " + res.status + (detail ? "：" + detail.slice(0, 200) : ""));
          err.code = res.status === 429 ? "quota_rate_limited" : "request_failed";
          throw err;
        }
        if (!res.body) throw new Error("当前浏览器不支持流式读取。");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            const { text, done: end } = parseSSEBlock(block);
            if (text) {
              content += text;
              if (onDelta) onDelta(text, content);
            }
            if (end) return { content, finishReason: "stop", usage: null };
          }
        }
        const tail = parseSSEBlock(buffer);
        if (tail.text) { content += tail.text; if (onDelta) onDelta(tail.text, content); }
        return { content, finishReason: "stop", usage: null };
      }

      const params = {
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        signal,
      };
      if (typeof temperature === "number") params.temperature = temperature;

      let content = "";
      let finishReason = null;
      let usage = null;
      for await (const chunk of this.client.llm.chat.completions.create(params)) {
        const choice = chunk && chunk.choices && chunk.choices[0];
        const delta = choice && choice.delta;
        if (delta && delta.content) {
          content += delta.content;
          if (onDelta) onDelta(delta.content, content);
        }
        if (choice && choice.finish_reason) finishReason = choice.finish_reason;
        if (chunk && chunk.usage) usage = chunk.usage;
      }
      return { content, finishReason, usage };
    },
  };

  /* 把 SDK 错误翻译成人话 */
  Cloud.friendlyError = function (err) {
    if (!err) return "发生未知错误。";
    if (err.name === "AbortError") return "已停止生成。";
    const code = (err.error && err.error.code) || err.code || "";
    const msg = (err.error && err.error.message) || err.message || "";
    if (code.indexOf("quota_") === 0) {
      return code === "quota_rate_limited"
        ? "请求过于频繁，请稍等片刻后重试。"
        : "云服务额度已用完或受限，请到云服务管理面板查看额度。";
    }
    if (code.indexOf("auth_") === 0) {
      return "鉴权失败：请检查 config.js 中的 apiKey / publishableKey，以及该域名是否已在后端授权。";
    }
    if (code.indexOf("request_") === 0) return "请求参数或模型不匹配：" + msg;
    if (code.indexOf("gateway_") === 0 || code.indexOf("model_") === 0) {
      return "模型服务暂时不可用，请点击重试。" + (err.requestId ? "（诊断号 " + err.requestId + "）" : "");
    }
    if (code === "content_filter" || code.indexOf("internal_") === 0) {
      return "生成未完成：" + (msg || "内容被拦截或服务内部错误。");
    }
    return msg || "网络或服务异常，请稍后重试。";
  };

  window.Cloud = Cloud;
})();
