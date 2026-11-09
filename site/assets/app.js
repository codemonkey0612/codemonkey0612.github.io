/* 匠 TAKUMI — site interactions. No libraries.
   Every page works without this file; motion is skipped for prefers-reduced-motion
   (the head script only adds html.motion when motion is allowed). */
(() => {
  "use strict";
  const doc = document.documentElement;
  const motion = doc.classList.contains("motion");
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const ms = (el, name) => parseFloat(el?.style.getPropertyValue(name)) || 0;
  const fontsReady = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 900))]);
  window.TAKUMI = true;

  /* ---------- header: solid once scrolled, out of the way while reading down ---------- */
  const hd = $("[data-hd]");
  const progress = $(".progress");
  const darkZone = $(".cta") ?? $(".ft"); // the dark band runs from here to the end of the page
  let lastY = scrollY;
  let ticking = false;
  const onScroll = () => {
    const y = scrollY;
    hd?.classList.toggle("scrolled", y > 8);
    if (darkZone && hd) hd.classList.toggle("dark", darkZone.getBoundingClientRect().top < hd.offsetHeight / 2);
    if (!doc.classList.contains("nav-open")) hd?.classList.toggle("hide", y > lastY + 2 && y > 320);
    if (y < lastY - 2) hd?.classList.remove("hide");
    lastY = y;
    const max = doc.scrollHeight - innerHeight;
    progress?.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : "0");
    ticking = false;
  };
  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();
  hd?.addEventListener("focusin", () => hd.classList.remove("hide"));

  /* ---------- mobile menu ---------- */
  const menuBtn = $(".menu-btn");
  const nav = $("#nav");
  const setMenu = (open) => {
    doc.classList.toggle("nav-open", open);
    menuBtn?.setAttribute("aria-expanded", String(open));
    if (open) hd?.classList.remove("hide");
  };
  menuBtn?.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
  nav?.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && doc.classList.contains("nav-open")) {
      setMenu(false);
      menuBtn?.focus();
    }
  });
  matchMedia("(min-width: 961px)").addEventListener("change", (e) => e.matches && setMenu(false));

  /* ---------- scroll reveals: elements that enter together are staggered ---------- */
  if (motion) {
    const io = new IntersectionObserver((entries) => {
      entries
        .filter((e) => e.isIntersecting)
        .forEach((e, i) => {
          e.target.style.setProperty("--rd", `${Math.min(i, 6) * 80}ms`);
          e.target.classList.add("in");
          io.unobserve(e.target);
        });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    $$("[data-reveal], [data-flow]").forEach((el) => io.observe(el));
  } else {
    $$("[data-flow]").forEach((el) => el.classList.add("in"));
  }

  /* ---------- numbers count up when they come into view ---------- */
  const fmt = (n) => n.toLocaleString("ja-JP");
  const countUp = (el, to, delay = 0, dur = 1500) => {
    if (!motion || !Number.isFinite(to)) return;
    cancelAnimationFrame(el._raf);
    const start = performance.now() + delay;
    el.textContent = fmt(0);
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      el.textContent = fmt(Math.round(to * (1 - (1 - t) ** 4)));
      if (t < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
  };
  const cio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      countUp(e.target, Number(e.target.dataset.count), 150);
      cio.unobserve(e.target);
    }
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => cio.observe(el));

  /* ---------- hero entrance ---------- */
  const hero = $("[data-hero]");
  if (hero) fontsReady.then(() => requestAnimationFrame(() => hero.classList.add("is-ready")));

  /* ---------- hero demo: type the code, build the screen it describes ---------- */
  const demo = $("[data-demo]");
  if (demo) {
    const tabs = $$(".demo-tab", demo);
    const codes = $$(".code-scene", demo);
    const uis = $$(".ui-scene", demo);
    const url = $("[data-url]", demo);
    let current = 0;
    let timer = 0;
    let run = 0;
    let visible = false;
    let started = false;

    const show = (i) => {
      current = i;
      tabs.forEach((t, k) => t.setAttribute("aria-pressed", String(k === i)));
      codes.forEach((c, k) => (c.hidden = k !== i));
      uis.forEach((u, k) => (u.hidden = k !== i));
      if (url) url.textContent = uis[i].dataset.url;
    };

    // Streams text in like a model's answer; stops (and shows the full text) if the scene changes.
    const stream = (el, delay, id) => {
      const full = (el.dataset.text ??= el.textContent);
      const chars = [...full];
      const start = performance.now() + delay;
      let shown = 0;
      el.textContent = "";
      const step = (now) => {
        if (id !== run) {
          el.textContent = full;
          return;
        }
        const n = Math.min(chars.length, Math.max(0, Math.floor((now - start) / 32)));
        if (n !== shown) el.textContent = chars.slice(0, (shown = n)).join("");
        if (shown < chars.length) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const play = (i) => {
      clearTimeout(timer);
      const id = ++run;
      show(i);
      if (!motion) return;
      const code = codes[i];
      const ui = uis[i];
      // Pace each line by its width, then time each piece of the screen to the line that creates it.
      let t = 350;
      const ends = $$(".ln", code).map((ln) => {
        const cl = $(".cl", ln);
        const len = Number(cl.dataset.len) || 0;
        const dur = len ? Math.min(760, Math.max(160, len * 15)) : 0;
        ln.style.setProperty("--d", `${t}ms`);
        cl.style.setProperty("--dur", `${dur}ms`);
        cl.style.setProperty("--steps", String(Math.max(1, len)));
        t += dur + 85;
        return t;
      });
      const total = t;
      $$("[data-at]", ui).forEach((el) => {
        const k = Number(el.dataset.at);
        el.style.setProperty("--t", `${k < ends.length ? ends[k] : total}ms`);
      });
      for (const el of [code, ui]) {
        el.classList.remove("play", "done");
        void el.offsetWidth; // restart the CSS animations
        el.classList.add("play");
      }
      $$("[data-stream]", ui).forEach((el) => stream(el, ms(el.closest("[data-at]"), "--t") + 250, id));
      $$("[data-to]", ui).forEach((el) => countUp(el, Number(el.dataset.to), ms(el.closest("[data-at]"), "--t"), 1100));
      timer = setTimeout(() => {
        code.classList.add("done");
        timer = setTimeout(() => visible && !document.hidden && play((i + 1) % codes.length), 4800);
      }, total + 600);
    };

    tabs.forEach((t, k) => t.addEventListener("click", () => play(k)));
    new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (!visible) clearTimeout(timer);
      else if (!was) fontsReady.then(() => setTimeout(() => (started = true) && play(current), started ? 0 : 450));
    }, { threshold: 0.3 }).observe(demo);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearTimeout(timer);
      else if (visible && started) play(current);
    });
  }

  /* ---------- works index: the cover follows the cursor ---------- */
  const rows = $("[data-preview-list]");
  if (rows && fine) {
    const box = document.createElement("div");
    box.className = "preview";
    box.setAttribute("aria-hidden", "true");
    const pic = document.createElement("img");
    pic.alt = "";
    pic.decoding = "async";
    box.append(pic);
    document.body.append(box);
    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let raf = 0;
    let on = false;
    const aim = (e) => {
      tx = Math.min(e.clientX + 28, innerWidth - box.offsetWidth - 16);
      ty = Math.max(16, Math.min(e.clientY - box.offsetHeight / 2, innerHeight - box.offsetHeight - 16));
    };
    const loop = () => {
      const k = motion ? 0.14 : 1;
      x += (tx - x) * k;
      y += (ty - y) * k;
      box.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      raf = on || Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(loop) : 0;
    };
    rows.addEventListener("pointerover", (e) => {
      const a = e.target.closest("[data-preview]");
      if (!a) return;
      if (pic.getAttribute("src") !== a.dataset.preview) pic.src = a.dataset.preview;
      aim(e);
      if (!on) {
        x = tx;
        y = ty;
      }
      on = true;
      box.classList.add("on");
      raf ||= requestAnimationFrame(loop);
    });
    rows.addEventListener("pointermove", (e) => {
      aim(e);
      raf ||= requestAnimationFrame(loop);
    });
    rows.addEventListener("pointerleave", () => {
      on = false;
      box.classList.remove("on");
    });
  }

  /* ---------- a "View" cursor over work images ---------- */
  if (fine && motion && $("[data-cursor]")) {
    const dot = document.createElement("div");
    dot.className = "cursor";
    dot.setAttribute("aria-hidden", "true");
    document.body.append(dot);
    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let raf = 0;
    const loop = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      dot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(loop) : 0;
    };
    addEventListener("pointermove", (e) => {
      tx = e.clientX;
      ty = e.clientY;
      const over = e.target.closest?.("[data-cursor]");
      if (over && !dot.classList.contains("on")) {
        dot.textContent = over.dataset.cursor;
        x = tx;
        y = ty;
      }
      dot.classList.toggle("on", Boolean(over));
      raf ||= requestAnimationFrame(loop);
    }, { passive: true });
    document.addEventListener("pointerleave", () => dot.classList.remove("on"));
  }

  /* ---------- buttons lean toward the cursor ---------- */
  if (fine && motion) {
    $$("[data-magnetic]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.14).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.24).toFixed(1)}px)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    });
  }

  /* ---------- review carousel: buttons, progress bar, drag with a mouse ---------- */
  $$("[data-carousel]").forEach((root) => {
    const track = $(".car-track", root);
    const bar = $(".car-bar i", root);
    const [prev, next] = $$(".car-btn", root);
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      const w = track.clientWidth / track.scrollWidth;
      bar.style.width = `${(w * 100).toFixed(2)}%`;
      bar.style.left = `${max > 0 ? ((track.scrollLeft / max) * (1 - w) * 100).toFixed(2) : 0}%`;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max - 2;
    };
    const page = (dir) => {
      const item = track.firstElementChild;
      const step = item ? item.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || "24") : track.clientWidth;
      track.scrollBy({ left: dir * step, behavior: motion ? "smooth" : "auto" });
    };
    prev.addEventListener("click", () => page(-1));
    next.addEventListener("click", () => page(1));
    track.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
    addEventListener("resize", update);
    update();
    if (!fine) return;
    let down = false;
    let moved = false;
    let sx = 0;
    let sl = 0;
    track.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true;
      moved = false;
      sx = e.clientX;
      sl = track.scrollLeft;
    });
    addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - sx;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        track.classList.add("drag");
      }
      if (moved) track.scrollLeft = sl - dx;
    });
    addEventListener("pointerup", () => {
      if (!down) return;
      down = false;
      if (moved) {
        const item = track.firstElementChild;
        const step = item ? item.getBoundingClientRect().width + 24 : 1;
        track.classList.remove("drag");
        track.scrollTo({ left: Math.round(track.scrollLeft / step) * step, behavior: "smooth" });
      }
    });
    track.addEventListener("click", (e) => moved && (e.preventDefault(), e.stopPropagation()), true);
  });

  /* ---------- works filter ---------- */
  const filters = $("[data-filters]");
  if (filters) {
    const items = $$("[data-filter-list] > li");
    const status = $("[data-filter-status]");
    items.forEach((li, i) => (li.style.viewTransitionName = `work-${i}`));
    filters.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      const f = b.dataset.filter;
      const apply = () => {
        $$("button", filters).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        let n = 0;
        for (const li of items) {
          const show = f === "all" || li.dataset.cat === f;
          li.hidden = !show;
          if (show) {
            n++;
            li.classList.add("in");
          }
        }
        if (status) status.textContent = `${n}件の実績を表示しています`;
      };
      if (motion && document.startViewTransition) document.startViewTransition(apply);
      else apply();
    });
  }
})();
