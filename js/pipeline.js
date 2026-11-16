/* ============================================================
   十二步生成管线：9 个大模型阶段映射 12 步，支持流式、暂停选择、停止与断点重试
   ============================================================ */
(function () {
  const STAGES = [
    { id: "brief", title: "分析产品输入", steps: [1], build: (c) => Prompts.brief(c) },
    { id: "research", title: "产品研究与卖点提取", steps: [2], build: (c) => Prompts.research(c) },
    { id: "ranking", title: "卖点排序", steps: [3], build: (c) => Prompts.ranking(c) },
    {
      id: "styles", title: "推荐三种视觉风格", steps: [4], build: (c) => Prompts.styles(c),
      choice: { key: "style", noun: "视觉风格", mark: "风格", recTitle: "推荐" },
    },
    {
      id: "concepts", title: "三套差异化创意提案", steps: [5], build: (c) => Prompts.concepts(c),
      choice: { key: "concept", noun: "创意提案", mark: "提案", recTitle: "评估与推荐" },
    },
    { id: "deepen", title: "导演深化 · 产品视觉圣经", steps: [6, 7], build: (c) => Prompts.deepen(c) },
    { id: "storyboard", title: "广告结构 · 逐镜头分镜", steps: [8], build: (c) => Prompts.storyboard(c) },
    { id: "craft", title: "VFX · 全AI制作 · 声音剪辑", steps: [9, 10, 11], build: (c) => Prompts.craft(c) },
    { id: "qc", title: "质量验收", steps: [12], build: (c) => Prompts.qc(c) },
  ];

  /* 把「## 风格一｜xxx」这类标题切成可选择卡片 */
  function parseChoices(text, choice) {
    const re = new RegExp("^##\\s*" + choice.mark + "([一二三四1234])\\s*[｜|:]\\s*(.+)$", "gm");
    const hits = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ index: m.index, length: m[0].length, title: m[2].trim() });
    }
    if (hits.length < 2) return { cards: [], note: "" };
    const cards = hits.map((h, i) => {
      const start = h.index + h.length;
      const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
      let body = text.slice(start, end);
      const recIdx = body.search(/^##\s/m);
      if (recIdx > -1) body = body.slice(0, recIdx);
      return { title: h.title, body: body.trim() };
    });
    const recRe = new RegExp("^##\\s*" + choice.recTitle + "\\s*$", "m");
    const recMatch = recRe.exec(text);
    const note = recMatch ? text.slice(recMatch.index + recMatch[0].length).trim() : "";
    return { cards, note };
  }

  /* 快速模式：按推荐段落自动选，否则取第一项 */
  function autoPick(text, cards, choice) {
    if (!cards.length) return "采用模型推荐项（详见原文）";
    const recRe = new RegExp("^##\\s*" + choice.recTitle + "\\s*$", "m");
    const recMatch = recRe.exec(text);
    const rec = recMatch ? text.slice(recMatch.index) : text;
    const nums = ["一", "二", "三", "四"];
    for (let i = 0; i < cards.length; i++) {
      const label = choice.mark + nums[i];
      if (rec.indexOf("推荐" + label) > -1 || rec.indexOf("推荐「" + cards[i].title) > -1 || rec.indexOf(cards[i].title) > -1) {
        return cards[i].title;
      }
    }
    return cards[0].title;
  }

  async function run(state, hooks) {
    const controller = new AbortController();
    state.controller = controller;
    const start = state.stageIndex || 0;

    for (let i = start; i < STAGES.length; i++) {
      const stage = STAGES[i];
      state.stageIndex = i;
      hooks.onStageStart(stage, i, STAGES.length);
      const messages = [
        { role: "system", content: Prompts.SYSTEM },
        { role: "user", content: stage.build(state) },
      ];
      let content;
      try {
        const res = await Cloud.chat({
          model: state.model,
          messages,
          signal: controller.signal,
          onDelta: (delta, full) => hooks.onDelta(stage, delta, full),
        });
        content = (res.content || "").trim();
      } catch (err) {
        state.stageIndex = i;
        hooks.onError(stage, err);
        return;
      }
      if (!content) {
        hooks.onError(stage, new Error("模型返回了空内容，请重试本阶段。"));
        return;
      }
      state.results[stage.id] = content;
      hooks.onStageDone(stage, content);

      if (stage.choice) {
        const parsed = parseChoices(content, stage.choice);
        let picked;
        if (state.options.mode === "pro") {
          hooks.onWaiting(stage);
          picked = await hooks.onChoice(stage, parsed);
        } else {
          picked = autoPick(content, parsed.cards, stage.choice);
        }
        if (controller.signal.aborted) {
          hooks.onError(stage, new DOMException("已停止生成", "AbortError"));
          return;
        }
        state.choices[stage.choice.key] = picked;
        hooks.onChoiceResolved(stage, picked);
      }
      state.stageIndex = i + 1;
    }
    hooks.onComplete();
  }

  /* 导出完整方案 Markdown */
  function buildExport(state) {
    const p = state.options;
    const lines = [
      "# 产品TVC创意导演 · 完整方案",
      "",
      "> 产品描述：" + state.description,
      "> 成片时长：" + p.duration + " 秒 ｜ 客户类型：" + p.client + " ｜ 模式：" + (p.mode === "pro" ? "专业" : "快速"),
      "> 视觉风格：" + (state.choices.style || "—"),
      "> 选定创意：" + (state.choices.concept || "—"),
      "> 生成时间：" + new Date().toLocaleString("zh-CN"),
      "",
      "---",
      "",
    ];
    STAGES.forEach((s) => {
      if (!state.results[s.id]) return;
      lines.push("# 第" + s.steps.map((n) => String(n).padStart(2, "0")).join("/") + "步 · " + s.title);
      lines.push("");
      lines.push(state.results[s.id]);
      lines.push("");
      if (s.choice && state.choices[s.choice.key]) {
        lines.push("**【已选定" + s.choice.noun + "】** " + state.choices[s.choice.key]);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    });
    return lines.join("\n");
  }

  window.Pipeline = { STAGES, run, buildExport, parseChoices };
})();
