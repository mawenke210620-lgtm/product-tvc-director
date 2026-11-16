/* Markdown 安全渲染：marked 解析 + DOMPurify 消毒，模型输出一律视为不可信 */
(function () {
  if (window.marked) {
    window.marked.setOptions({ gfm: true, breaks: true });
  }

  function escapeText(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render(text) {
    const src = String(text == null ? "" : text);
    if (!window.marked) {
      return escapeText(src).replace(/\n/g, "<br />");
    }
    const html = window.marked.parse(src);
    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(html, {
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
        FORBID_ATTR: ["onerror", "onclick", "onload", "srcset"],
      });
    }
    return escapeText(src).replace(/\n/g, "<br />");
  }

  window.MD = { render, escapeText };
})();
