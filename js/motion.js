/* ============================================================
   动效系统：Hero 双层视差（滚动+鼠标，rAF 合并计算）· GSAP 横向流程 · 进度与揭示
   只动画 transform / opacity，尊重 prefers-reduced-motion，粗指针设备禁用鼠标视差。
   ============================================================ */
(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const nav = document.getElementById("nav");
  const progress = document.getElementById("scrollProgress");
  const hero = document.getElementById("top");
  const heroBg = document.querySelector(".hero-bg");
  const layers = Array.from(document.querySelectorAll("[data-depth]"));
  const track = document.getElementById("marqueeTrack");
  const timecode = document.getElementById("heroTimecode");

  /* ---------- 进度条 / 导航 / 原则揭示 ---------- */
  function onScrollUI() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    nav.classList.toggle("scrolled", window.scrollY > 40);
  }
  window.addEventListener("scroll", onScrollUI, { passive: true });
  window.addEventListener("resize", onScrollUI);
  onScrollUI();

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.25 });
  document.querySelectorAll(".principle").forEach((el) => io.observe(el));

  /* ---------- Hero 视差 + marquee（同一 rAF，避免 transform 冲突） ---------- */
  if (!reduced) {
    if (track) track.innerHTML += track.innerHTML;
    let mx = 0, my = 0, tx = 0, ty = 0, marqueeX = 0;
    if (finePointer && hero) {
      hero.addEventListener("mousemove", (e) => {
        const r = hero.getBoundingClientRect();
        mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
        my = ((e.clientY - r.top) / r.height - 0.5) * 2;
      });
      hero.addEventListener("mouseleave", () => { mx = 0; my = 0; });
    }
    let marqueeHalf = track ? track.scrollWidth / 2 : 0;
    window.addEventListener("resize", () => { marqueeHalf = track ? track.scrollWidth / 2 : 0; });

    function frame(now) {
      tx += (mx - tx) * 0.06;
      ty += (my - ty) * 0.06;
      const sy = window.scrollY;
      const heroVisible = sy < window.innerHeight * 1.2;
      if (heroVisible) {
        const p = Math.min(sy / Math.max(window.innerHeight, 1), 1);
        if (heroBg) heroBg.style.transform = "scale(" + (1 + p * 0.09) + ")";
        for (const el of layers) {
          const d = parseFloat(el.dataset.depth) || 0;
          const x = tx * d * 46;
          const y = ty * d * 34 - sy * d * 0.85;
          el.style.transform = "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0)";
        }
      }
      if (track && marqueeHalf > 0) {
        marqueeX -= 0.45;
        if (-marqueeX >= marqueeHalf) marqueeX = 0;
        track.style.transform = "translateX(" + marqueeX + "px)";
      }
      if (timecode) {
        const t = Math.floor(now / 1000);
        const f = Math.floor((now % 1000) / 1000 * 24);
        timecode.textContent = "00:" + String(Math.floor(t / 60) % 60).padStart(2, "0") + ":" +
          String(t % 60).padStart(2, "0") + ":" + String(f).padStart(2, "0");
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 十二步横向滚动（GSAP 懒加载，失败则降级为可横向拖动） ---------- */
  const viewport = document.getElementById("processViewport");
  const processTrack = document.getElementById("processTrack");
  const hint = document.getElementById("processHint");

  function fallbackHorizontal() {
    viewport.style.overflowX = "auto";
    if (hint) hint.textContent = "横向滑动查看十二步";
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  if (!reduced && window.innerWidth > 760 && viewport && processTrack) {
    loadScript("https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js")
      .then(() => loadScript("https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"))
      .then(() => {
        const gsap = window.gsap;
        gsap.registerPlugin(window.ScrollTrigger);
        const amount = () => Math.max(processTrack.scrollWidth - viewport.clientWidth + 40, 0);
        if (amount() <= 0) { fallbackHorizontal(); return; }
        gsap.to(processTrack, {
          x: () => -amount(),
          ease: "none",
          scrollTrigger: {
            trigger: ".process",
            start: "top top",
            end: () => "+=" + amount(),
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
      })
      .catch(fallbackHorizontal);
  } else if (viewport && window.innerWidth > 760) {
    fallbackHorizontal();
  }
})();
