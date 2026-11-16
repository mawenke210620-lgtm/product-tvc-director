/* ============================================================
   工作台 UI 逻辑
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    input: $("productInput"), charCount: $("charCount"), chips: $("exampleChips"),
    dropzone: $("dropzone"), fileInput: $("fileInput"), fileList: $("fileList"),
    modeSeg: $("modeSeg"), modeNote: $("modeNote"), duration: $("durationSel"),
    client: $("clientSel"), model: $("modelSel"), prompts: $("promptsChk"),
    start: $("startBtn"), stop: $("stopBtn"), env: $("envStatus"),
    rail: $("stepsRail"), empty: $("emptyState"), stream: $("streamView"),
    streamTitle: $("streamTitle"), streamStep: $("streamStep"), streamContent: $("streamContent"),
    choice: $("choiceView"), result: $("resultView"),
    toolbar: $("outputToolbar"), doneSummary: $("doneSummary"),
    copy: $("copyBtn"), export: $("exportBtn"), toast: $("toast"), outputBody: $("outputBody"),
  };

  const state = {
    description: "", materials: "", imageCount: 0,
    options: { mode: "fast", duration: 30, client: "品牌方", prompts: true },
    model: null, results: {}, choices: {}, stageIndex: 0, controller: null, running: false,
  };
  const files = [];
  const DRAFT_KEY = "tvc-director-draft-v1";

  /* ---------- 小工具 ---------- */
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }
  function envStatus(msg, type) {
    els.env.textContent = msg || "";
    els.env.className = "env-status" + (type ? " " + type : "");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function scrollToOutput() {
    if (window.innerWidth < 1100) {
      els.outputBody.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------- 静态内容渲染 ---------- */
  function renderStatic() {
    $("processTrack").innerHTML = Data.STEPS.map((s) => `
      <article class="step-card">
        ${s.wait ? '<span class="step-badge wait">等待确认</span>' : '<span class="step-badge">自动</span>'}
        <div class="step-num">${pad(s.n)}</div>
        <h3>${s.title}</h3>
        <p>${s.desc}</p>
        <div class="step-out">${s.out}</div>
      </article>`).join("");

    els.rail.innerHTML = Data.STEPS.map((s) =>
      `<li data-step="${s.n}"><span class="dot">${pad(s.n)}</span><span>${s.title.split(" · ")[0]}</span></li>`
    ).join("");

    els.chips.innerHTML = Data.EXAMPLES.map((e) =>
      `<button type="button" class="chip" data-text="${MD.escapeText(e)}">${e.length > 12 ? e.slice(0, 12) + "…" : e}</button>`
    ).join("");
    els.chips.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        els.input.value = c.dataset.text;
        els.input.dispatchEvent(new Event("input"));
        els.input.focus();
      })
    );

    $("principleList").innerHTML = Data.PRINCIPLES.map((p, i) => `
      <div class="principle">
        <span class="p-num">RULE ${pad(i + 1)}</span>
        <h3>${p.title}</h3>
        <p>${p.desc}</p>
      </div>`).join("");

    $("templateGrid").innerHTML = Data.TEMPLATES.map(([k, v]) =>
      `<div class="template-item"><b>${k}</b><span>${v}</span></div>`
    ).join("");

    const labels = { fast: "自动跑完十二步，风格与创意采用推荐项。", pro: "在第 04 步选风格、第 05 步选创意时暂停，等你确认后再继续。" };
    els.modeNote.textContent = labels[state.options.mode];
  }

  function setRail(activeSteps, waiting) {
    const active = activeSteps || [];
    els.rail.querySelectorAll("li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.remove("active", "done", "waiting");
      if (active.includes(n)) li.classList.add(waiting ? "waiting" : "active");
      else if (state.results && stageDoneForStep(n)) li.classList.add("done");
    });
  }
  function stageDoneForStep(n) {
    return Pipeline.STAGES.some((s) => s.steps.includes(n) && state.results[s.id]);
  }

  /* ---------- 文件上传 ---------- */
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("解析组件加载失败"));
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }

  async function extractText(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (["txt", "md", "csv", "json", "log"].includes(ext)) return await file.text();
    if (ext === "docx") {
      await loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js");
      const buf = await file.arrayBuffer();
      const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return res.value || "";
    }
    if (ext === "pdf") {
      await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let out = "";
      const maxPages = Math.min(pdf.numPages, 20);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        out += tc.items.map((it) => it.str).join(" ") + "\n";
      }
      return out;
    }
    return "";
  }

  async function addFiles(list) {
    for (const file of Array.from(list)) {
      if (files.length >= 6) { toast("最多附加 6 个文件"); break; }
      if (file.size > 10 * 1024 * 1024) { toast(file.name + " 超过 10MB，已跳过"); continue; }
      const item = { name: file.name, size: file.size, text: "", image: null, error: "" };
      files.push(item);
      renderFiles();
      try {
        if (file.type.startsWith("image/")) {
          item.image = URL.createObjectURL(file);
        } else {
          item.text = await extractText(file);
          if (!item.text.trim()) item.error = "未读到文字内容";
        }
      } catch (e) {
        item.error = "解析失败：" + (e.message || "格式不受支持");
      }
      renderFiles();
      rebuildMaterials();
    }
  }

  function renderFiles() {
    els.fileList.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      if (f.image) {
        li.className = "img-thumb";
        const img = document.createElement("img");
        img.src = f.image; img.alt = "";
        li.appendChild(img);
      }
      const name = document.createElement("span");
      name.className = "fname";
      name.textContent = f.name + (f.error ? "（" + f.error + "）" : f.image ? "（图片参考，建议补充外观描述）" : "");
      const size = document.createElement("span");
      size.className = "fsize";
      size.textContent = (f.size / 1024).toFixed(0) + "KB";
      const del = document.createElement("button");
      del.type = "button"; del.textContent = "×"; del.setAttribute("aria-label", "移除 " + f.name);
      del.addEventListener("click", () => { files.splice(i, 1); renderFiles(); rebuildMaterials(); });
      li.append(name, size, del);
      els.fileList.appendChild(li);
    });
  }

  function rebuildMaterials() {
    state.materials = files.filter((f) => f.text).map((f) => "〔" + f.name + "〕\n" + f.text).join("\n\n");
    state.imageCount = files.filter((f) => f.image).length;
  }

  /* ---------- 草稿（仅本机浏览器） ---------- */
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ description: els.input.value, options: state.options }));
    } catch (e) { /* 存储不可用时忽略 */ }
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d) return;
      if (d.description) els.input.value = d.description;
      if (d.options) Object.assign(state.options, d.options);
      els.duration.value = String(state.options.duration);
      els.client.value = state.options.client;
      els.prompts.checked = state.options.prompts !== false;
      els.modeSeg.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("active", b.dataset.value === state.options.mode));
    } catch (e) { /* 忽略损坏草稿 */ }
  }

  /* ---------- 生成流程 ---------- */
  let rafPending = null;
  function streamRender(text) {
    if (rafPending) { rafPending = text; return; }
    rafPending = text;
    requestAnimationFrame(() => {
      const t = rafPending; rafPending = null;
      els.streamContent.innerHTML = MD.render(t);
      els.streamContent.scrollTop = els.streamContent.scrollHeight;
    });
  }

  function addResultBlock(stage, content) {
    const d = document.createElement("details");
    d.className = "result-block";
    d.dataset.stage = stage.id;
    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = stage.title;
    const steps = document.createElement("span");
    steps.className = "rb-steps";
    steps.textContent = "第 " + stage.steps.map(pad).join(" / ") + " 步";
    summary.append(title, steps);
    const body = document.createElement("div");
    body.className = "rb-body md-body";
    body.innerHTML = MD.render(content);
    d.append(summary, body);
    els.result.appendChild(d);
  }

  function setRunning(running) {
    state.running = running;
    els.start.hidden = running;
    els.stop.hidden = !running;
    els.input.disabled = running;
    els.start.disabled = running;
  }

  function showStageError(stage, err) {
    const msg = Cloud.friendlyError(err);
    setRunning(false);
    els.stream.classList.remove("streaming");
    els.streamTitle.textContent = stage.title + " · 中断";
    const box = document.createElement("div");
    box.className = "env-status err";
    box.style.marginTop = "14px";
    box.textContent = msg;
    const retry = document.createElement("button");
    retry.className = "btn btn-primary";
    retry.style.marginTop = "12px";
    retry.textContent = "从「" + stage.title + "」重试";
    retry.addEventListener("click", () => {
      box.remove(); retry.remove();
      setRunning(true);
      Pipeline.run(state, hooks);
    });
    els.stream.append(box, retry);
    setRail(stage.steps, false);
    toast("生成中断：" + msg);
  }

  const hooks = {
    onStageStart(stage, i, total) {
      els.empty.hidden = true;
      els.choice.hidden = true;
      els.stream.hidden = false;
      els.stream.classList.add("streaming");
      els.streamTitle.textContent = stage.title;
      els.streamStep.textContent = "阶段 " + (i + 1) + " / " + total + " · 第 " + stage.steps.map(pad).join("/") + " 步";
      els.streamContent.innerHTML = "";
      setRail(stage.steps, false);
      scrollToOutput();
    },
    onDelta(stage, delta, full) { streamRender(full); },
    onStageDone(stage, content) {
      els.stream.classList.remove("streaming");
      els.streamContent.innerHTML = MD.render(content);
      addResultBlock(stage, content);
      setRail([], false);
    },
    onWaiting(stage) { setRail(stage.steps, true); },
    onChoice(stage, parsed) {
      return new Promise((resolve) => {
        const signal = state.controller && state.controller.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            resolve((parsed.cards[0] && parsed.cards[0].title) || "已停止");
          }, { once: true });
        }
        els.stream.hidden = true;
        els.choice.hidden = false;
        els.choice.innerHTML = "";
        const head = document.createElement("h3");
        head.className = "choice-head";
        head.textContent = "请选择" + stage.choice.noun;
        const desc = document.createElement("p");
        desc.className = "choice-desc";
        desc.textContent = "专业模式：流程已暂停，选定后自动继续后续阶段。";
        els.choice.append(head, desc);

        if (parsed.cards.length >= 2) {
          const grid = document.createElement("div");
          grid.className = "choice-grid";
          parsed.cards.forEach((card) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "choice-card";
            const h = document.createElement("h4");
            h.textContent = card.title;
            const body = document.createElement("div");
            body.className = "cc-body md-body";
            body.innerHTML = MD.render(card.body);
            const pick = document.createElement("span");
            pick.className = "cc-pick";
            pick.textContent = "选择这一项 →";
            btn.append(h, body, pick);
            btn.addEventListener("click", () => resolve(card.title));
            grid.appendChild(btn);
          });
          els.choice.appendChild(grid);
        }
        if (parsed.note) {
          const note = document.createElement("div");
          note.className = "choice-note md-body";
          note.innerHTML = MD.render("**模型推荐**\n\n" + parsed.note);
          els.choice.appendChild(note);
        }
        const fb = document.createElement("div");
        fb.className = "choice-fallback";
        const input = document.createElement("input");
        input.placeholder = "也可以直接输入你的选择或修改意见，回车确认";
        const ok = document.createElement("button");
        ok.className = "btn btn-ghost"; ok.textContent = "确认";
        const submit = () => { if (input.value.trim()) resolve(input.value.trim()); };
        ok.addEventListener("click", submit);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
        fb.append(input, ok);
        els.choice.appendChild(fb);
        scrollToOutput();
      });
    },
    onChoiceResolved(stage, picked) {
      els.choice.hidden = true;
      els.stream.hidden = false;
      toast("已选定" + stage.choice.noun + "：" + picked);
    },
    onError(stage, err) {
      if (err && err.name === "AbortError") {
        setRunning(false);
        els.streamTitle.textContent = "已停止";
        els.stream.classList.remove("streaming");
        setRail([], false);
        toast("已停止，已生成的阶段保留在下方");
        els.toolbar.hidden = !Object.keys(state.results).length;
        return;
      }
      showStageError(stage, err);
      els.toolbar.hidden = !Object.keys(state.results).length;
    },
    onComplete() {
      setRunning(false);
      setRail([], false);
      els.streamTitle.textContent = "十二步已完成";
      els.streamStep.textContent = "DONE";
      els.stream.classList.remove("streaming");
      els.toolbar.hidden = false;
      els.doneSummary.textContent = "共 " + Object.keys(state.results).length + " 个阶段产物 · 可导出完整方案";
      toast("方案已生成完毕，可导出 Markdown");
    },
  };

  function startGeneration() {
    const desc = els.input.value.trim();
    if (!desc) { toast("请先输入一句产品描述"); els.input.focus(); return; }
    if (!state.model) { toast("尚未就绪：没有可用模型，请检查下方云服务状态"); return; }
    if (state.running) return;

    state.description = desc;
    state.options.duration = Number(els.duration.value);
    state.options.client = els.client.value;
    state.options.prompts = els.prompts.checked;
    state.results = {}; state.choices = {}; state.stageIndex = 0;
    els.result.innerHTML = "";
    els.toolbar.hidden = true;
    saveDraft();
    setRunning(true);
    Pipeline.run(state, hooks);
  }

  /* ---------- 导出 ---------- */
  function exportAll() {
    const text = Pipeline.buildExport(state);
    const blob = new Blob(["﻿" + text], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = state.description.replace(/[\\/:*?"<>|\s]/g, "").slice(0, 18) || "产品";
    a.download = "产品TVC方案_" + name + ".md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("已导出完整方案 Markdown");
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    els.input.addEventListener("input", () => {
      els.charCount.textContent = els.input.value.length + " 字";
      state.description = els.input.value.trim();
      saveDraft();
    });
    els.modeSeg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        els.modeSeg.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.options.mode = b.dataset.value;
        els.modeNote.textContent = state.options.mode === "pro"
          ? "在第 04 步选风格、第 05 步选创意时暂停，等你确认后再继续。"
          : "自动跑完十二步，风格与创意采用推荐项。";
        saveDraft();
      })
    );
    [els.duration, els.client, els.prompts].forEach((el) => el.addEventListener("change", saveDraft));

    els.dropzone.addEventListener("click", () => els.fileInput.click());
    els.dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); } });
    els.fileInput.addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("dragover"); }));
    els.dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

    els.start.addEventListener("click", startGeneration);
    els.stop.addEventListener("click", () => { if (state.controller) state.controller.abort(); });
    els.export.addEventListener("click", exportAll);
    els.copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(Pipeline.buildExport(state));
        toast("全文已复制到剪贴板");
      } catch (e) { toast("复制失败，请使用导出"); }
    });

    document.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = document.querySelector(b.dataset.goto);
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  }

  /* ---------- 云服务初始化 ---------- */
  async function initCloud() {
    try {
      const models = await Cloud.loadModels();
      const usable = Cloud.usableModels();
      els.model.innerHTML = "";
      if (!usable.length) {
        els.model.innerHTML = "<option>无可用模型</option>";
        els.start.disabled = true;
        envStatus("云服务已连接，但当前没有可用模型。请到云服务管理面板启用模型后刷新。", "err");
        return;
      }
      usable.forEach((m) => {
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.name || m.id;
        els.model.appendChild(o);
      });
      state.model = usable[0].id;
      els.model.addEventListener("change", () => { state.model = els.model.value; });
      envStatus(Cloud.statusText(usable.length), "ok");
    } catch (err) {
      els.model.innerHTML = "<option>不可用</option>";
      els.start.disabled = true;
      envStatus(Cloud.friendlyError(err), "err");
    }
  }

  renderStatic();
  loadDraft();
  els.input.dispatchEvent(new Event("input"));
  bind();
  initCloud();
})();
