/* 匠｜AI・Webシステム開発 — site motion.
   Every page works without this file. Motion is skipped for prefers-reduced-motion
   (the head script only adds .motion when motion is allowed). No dependencies. */
(() => {
  "use strict";
  window.TAKUMI = true;
  const doc = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- one rAF-throttled loop for everything scroll-linked ----------
  const onScroll = [];
  let ticking = false;
  const runScroll = () => {
    ticking = false;
    for (const f of onScroll) f(scrollY);
  };
  const requestScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(runScroll);
    }
  };
  addEventListener("scroll", requestScroll, { passive: true });
  addEventListener("resize", requestScroll);

  // ---------- split text into characters (screen readers get the plain text) ----------
  const STICKY = /^[、。，．・！？」』）】〕：；ー〜]$/;
  function split(el) {
    if (el.dataset.splitDone) return;
    el.dataset.splitDone = "1";
    const text = el.textContent;
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = text;
    const vis = document.createElement("span");
    vis.className = "split";
    vis.setAttribute("aria-hidden", "true");
    let i = 0;
    let last = null;
    for (const tok of text.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) {
        vis.append(" ");
        last = null;
        continue;
      }
      // Latin words stay whole; Japanese breaks between characters (punctuation sticks to the left).
      const units = /[^\x00-\x7f]/.test(tok) ? [...tok] : [tok];
      for (const u of units) {
        const word = last && STICKY.test(u) ? last : document.createElement("span");
        word.className = "word";
        for (const ch of u) {
          const c = document.createElement("span");
          c.className = "ch";
          c.style.setProperty("--i", i++);
          c.textContent = ch;
          word.append(c);
        }
        if (word !== last) vis.append(word);
        last = word;
      }
    }
    el.replaceChildren(sr, vis);
  }
  $$("[data-split]").forEach(split);

  // ---------- reveal on scroll ----------
  const revealables = $$("[data-reveal], [data-split]");
  for (const el of $$("[data-reveal]")) {
    const sibs = [...el.parentElement.children].filter((c) => c.hasAttribute("data-reveal"));
    el.style.setProperty("--d", `${Math.min(sibs.indexOf(el), 5) * 90}ms`);
  }
  if (reduced || !("IntersectionObserver" in window)) {
    revealables.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    revealables.forEach((el) => io.observe(el));
  }

  // ---------- count-up numbers ----------
  if (!reduced && "IntersectionObserver" in window) {
    const countIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          countIO.unobserve(e.target);
          const el = e.target;
          const to = parseFloat(el.dataset.count);
          if (!Number.isFinite(to)) continue;
          const t0 = performance.now();
          const dur = 1600;
          const step = (t) => {
            const p = clamp((t - t0) / dur, 0, 1);
            el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 4))));
            if (p < 1) requestAnimationFrame(step);
          };
          el.textContent = "0";
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.5 },
    );
    $$("[data-count]").forEach((el) => countIO.observe(el));
  }

  // ---------- header and progress bar ----------
  const header = $(".site-header");
  const bar = $(".progress");
  let lastY = scrollY;
  onScroll.push((y) => {
    header.classList.toggle("is-scrolled", y > 24);
    if (Math.abs(y - lastY) > 8) {
      header.classList.toggle("is-hidden", y > lastY && y > 400 && !doc.classList.contains("nav-open"));
      lastY = y;
    }
    const max = doc.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
  });

  // ---------- mobile menu ----------
  const menuBtn = $(".menu-btn");
  const nav = $("#site-nav");
  const setMenu = (open) => {
    doc.classList.toggle("nav-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    $(".sr-only", menuBtn).textContent = open ? "メニューを閉じる" : "メニューを開く";
    if (open) header.classList.remove("is-hidden");
  };
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", () => setMenu(!doc.classList.contains("nav-open")));
    nav.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && doc.classList.contains("nav-open")) {
        setMenu(false);
        menuBtn.focus();
      }
    });
    matchMedia("(min-width: 1024px)").addEventListener("change", (m) => m.matches && setMenu(false));
  }

  // ---------- hero: particles that gather into 匠 ----------
  function hero() {
    const sec = $("[data-hero]");
    if (!sec) return;
    const cv = $(".hero-canvas", sec);
    const slot = $(".hero-glyph", sec);
    const ctx = cv && slot && cv.getContext("2d");
    if (!ctx) {
      slot?.classList.add("is-static");
      sec.classList.add("is-ready");
      return;
    }
    // [r, g, b, alpha, share]: paper white, softer whites, pale indigo, a few vermilion.
    const PALETTE = [
      [247, 245, 240, 0.95, 0.4],
      [247, 245, 240, 0.62, 0.24],
      [247, 245, 240, 0.34, 0.14],
      [159, 190, 232, 0.85, 0.13],
      [232, 102, 70, 1, 0.09],
    ];
    const pick = () => {
      let r = Math.random();
      for (let i = 0; i < PALETTE.length; i++) if ((r -= PALETTE[i][4]) <= 0) return i;
      return 0;
    };
    let W = 0, H = 0, dpr = 1, size = 2, parts = [], buckets = [], dust = [];
    let running = false, built = false, visible = true, scrollP = 0, lastW = 0, lastH = 0;
    const mouse = { x: -1e5, y: -1e5, on: false };

    function build() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      const box = sec.getBoundingClientRect();
      W = Math.round(box.width * dpr);
      H = Math.round(box.height * dpr);
      cv.width = W;
      cv.height = H;
      lastW = box.width;
      lastH = box.height;
      // Draw 匠 into the slot's square and sample its pixels.
      const r = slot.getBoundingClientRect();
      const side = Math.round(Math.min(r.width, r.height) * dpr);
      if (side < 40) return;
      const ox = (r.left - box.left) * dpr + (r.width * dpr - side) / 2;
      const oy = (r.top - box.top) * dpr + (r.height * dpr - side) / 2;
      const off = document.createElement("canvas");
      off.width = off.height = side;
      const o = off.getContext("2d", { willReadFrequently: true });
      o.fillStyle = "#fff";
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.font = `800 ${side * 0.9}px "Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif`;
      o.fillText("匠", side / 2, side * 0.53);
      const data = o.getImageData(0, 0, side, side).data;
      const gap = Math.max(3 * dpr, Math.round(side / 96));
      size = Math.max(1.3 * dpr, gap * 0.4);
      const pts = [];
      for (let y = 0; y < side; y += gap) {
        for (let x = (y / gap) % 2 ? gap / 2 : 0; x < side; x += gap) {
          if (data[((y | 0) * side + (x | 0)) * 4 + 3] > 120) pts.push([ox + x, oy + y]);
        }
      }
      const old = parts;
      parts = pts.map(([x, y], i) => {
        const p = old[i] ?? {
          x: Math.random() * W,
          y: H * (0.25 + Math.random() * 0.95),
          vx: 0,
          vy: 0,
          c: pick(),
          k: 0.012 + Math.random() * 0.03,
          ph: Math.random() * Math.PI * 2,
          s: 0.75 + Math.random() * 0.7,
        };
        const a = Math.random() * Math.PI * 2;
        p.tx = x;
        p.ty = y;
        p.ex = Math.cos(a) * (0.4 + Math.random());
        p.ey = Math.sin(a) * (0.4 + Math.random()) - 0.6;
        return p;
      });
      buckets = PALETTE.map((_, ci) => parts.filter((p) => p.c === ci));
      built = true;
      const n = Math.round((box.width * box.height) / 11000);
      dust = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        v: (0.08 + Math.random() * 0.3) * dpr,
        a: 0.08 + Math.random() * 0.3,
        s: (0.6 + Math.random()) * dpr,
      }));
      if (reduced) {
        for (const p of parts) {
          p.x = p.tx;
          p.y = p.ty;
        }
        draw(0, false);
      }
    }

    function draw(t, move = true) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgb(200,215,235)";
      for (const d of dust) {
        if (move) {
          d.y -= d.v;
          if (d.y < -4) {
            d.y = H + 4;
            d.x = Math.random() * W;
          }
        }
        ctx.globalAlpha = d.a;
        ctx.fillRect(d.x, d.y, d.s, d.s);
      }
      const fade = 1 - scrollP * 0.85;
      const spread = scrollP * scrollP * 700 * dpr;
      const R = 120 * dpr;
      const R2 = R * R;
      for (let ci = 0; ci < PALETTE.length; ci++) {
        const [r, g, b, a] = PALETTE[ci];
        ctx.globalAlpha = a * fade;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        for (const p of buckets[ci] ?? []) {
          if (move) {
            const tx = p.tx + p.ex * spread + Math.sin(t * 0.0011 + p.ph) * 0.9 * dpr;
            const ty = p.ty + p.ey * spread + Math.cos(t * 0.0013 + p.ph) * 0.9 * dpr;
            let ax = (tx - p.x) * p.k;
            let ay = (ty - p.y) * p.k;
            if (mouse.on) {
              const dx = p.x - mouse.x;
              const dy = p.y - mouse.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < R2 && d2 > 1) {
                const d = Math.sqrt(d2);
                const f = (1 - d / R) * 2.6 * dpr;
                ax += (dx / d) * f;
                ay += (dy / d) * f;
              }
            }
            p.vx = (p.vx + ax) * 0.84;
            p.vy = (p.vy + ay) * 0.84;
            p.x += p.vx;
            p.y += p.vy;
          }
          const s = size * p.s;
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
    }

    const frame = (t) => {
      if (!running) return;
      draw(t);
      requestAnimationFrame(frame);
    };
    const setRunning = (on) => {
      on = on && built && !reduced && visible && !document.hidden;
      if (on && !running) {
        running = true;
        requestAnimationFrame(frame);
      } else if (!on) running = false;
    };

    const start = () => {
      build();
      sec.classList.add("is-ready");
      setRunning(true);
    };
    const fonts = document.fonts?.load
      ? Promise.race([document.fonts.load('800 120px "Shippori Mincho B1"', "匠"), new Promise((r) => setTimeout(r, 2500))])
      : Promise.resolve();
    fonts.then(start, start);

    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      setRunning(true);
    }).observe(sec);
    document.addEventListener("visibilitychange", () => setRunning(true));
    let rt = 0;
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const b = sec.getBoundingClientRect();
        // Ignore the small height changes mobile browsers make while scrolling.
        if (Math.abs(b.width - lastW) > 1 || Math.abs(b.height - lastH) > 120) build();
      }, 220);
    });
    onScroll.push((y) => {
      scrollP = clamp(y / (sec.offsetHeight * 0.85), 0, 1);
    });

    if (!reduced) {
      const toCanvas = (e) => {
        const b = cv.getBoundingClientRect();
        mouse.x = (e.clientX - b.left) * dpr;
        mouse.y = (e.clientY - b.top) * dpr;
      };
      sec.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        toCanvas(e);
        mouse.on = true;
      });
      sec.addEventListener("pointerleave", () => (mouse.on = false));
      // A click (or tap) away from the buttons scatters the particles; they gather again.
      sec.addEventListener("pointerdown", (e) => {
        if (e.target.closest("a, button")) return;
        toCanvas(e);
        for (const p of parts) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (18 + Math.random() * 26) * dpr * Math.max(0.15, 1 - d / (600 * dpr));
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
        if (e.pointerType === "touch") mouse.on = false;
      });
    }
  }
  hero();

  // ---------- works: vertical scroll drives a horizontal gallery (desktop) ----------
  const hs = $("[data-hscroll]");
  if (hs) {
    const sticky = $(".hscroll-sticky", hs);
    const track = $(".hscroll-track", hs);
    const index = $("[data-hscroll-index]", hs);
    const fill = $(".hscroll-bar span", hs);
    const count = track.children.length - 1;
    const wide = matchMedia("(min-width: 1024px)");
    let dist = 0;
    const measure = () => {
      const pin = wide.matches && !reduced;
      hs.classList.toggle("is-pinned", pin);
      if (!pin) {
        hs.style.height = "";
        track.style.transform = "";
        return;
      }
      dist = Math.max(0, track.scrollWidth - innerWidth);
      hs.style.height = `${dist + innerHeight}px`;
    };
    const update = () => {
      if (!hs.classList.contains("is-pinned")) return;
      const p = dist ? clamp(-hs.getBoundingClientRect().top / dist, 0, 1) : 0;
      track.style.transform = `translate3d(${(-p * dist).toFixed(1)}px,0,0)`;
      if (fill) fill.style.transform = `scaleX(${p})`;
      if (index) index.textContent = String(1 + Math.round(p * (count - 1))).padStart(2, "0");
    };
    measure();
    update();
    onScroll.push(update);
    addEventListener("resize", () => {
      measure();
      update();
    });
    addEventListener("load", () => {
      measure();
      update();
    });
    // Keyboard: bring the focused card into view by scrolling the page, not the sticky box.
    track.addEventListener("focusin", (e) => {
      if (!hs.classList.contains("is-pinned")) return;
      sticky.scrollLeft = 0;
      const li = e.target.closest("li");
      const p = clamp((li.offsetLeft - innerWidth * 0.2) / dist, 0, 1);
      scrollTo({ top: hs.offsetTop + p * dist, behavior: "auto" });
    });
  }

  // ---------- flow: the line fills as you read ----------
  const flow = $("[data-flow]");
  if (flow) {
    onScroll.push(() => {
      const r = flow.getBoundingClientRect();
      flow.style.setProperty("--p", clamp((innerHeight * 0.8 - r.top) / (r.height + innerHeight * 0.2), 0, 1).toFixed(3));
    });
  }

  // ---------- works filter ----------
  const filters = $("[data-filters]");
  const list = $("[data-filter-list]");
  const status = $("[data-filter-status]");
  if (filters && list) {
    filters.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      for (const b of $$("button", filters)) b.setAttribute("aria-pressed", String(b === btn));
      const f = btn.dataset.filter;
      let shown = 0;
      for (const card of list.children) {
        const show = f === "all" || card.dataset.cat === f;
        card.classList.toggle("is-hidden", !show);
        card.classList.remove("is-pop");
        if (show) {
          shown++;
          card.classList.add("is-in");
          void card.offsetWidth;
          card.classList.add("is-pop");
        }
      }
      if (status) status.textContent = `${shown}件の実績を表示しています`;
    });
  }

  // ---------- pointer niceties (mouse only) ----------
  if (fine && !reduced) {
    // service rows: a preview image follows the cursor
    const rows = $$("[data-preview]");
    if (rows.length) {
      const pv = document.createElement("img");
      pv.className = "hover-preview";
      pv.alt = "";
      pv.setAttribute("aria-hidden", "true");
      document.body.append(pv);
      let x = 0, y = 0, tx = 0, ty = 0, on = false, raf = 0;
      const loop = () => {
        x = lerp(x, tx, 0.16);
        y = lerp(y, ty, 0.16);
        const rot = clamp((tx - x) * 0.05, -9, 9);
        pv.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -62%) rotate(${rot.toFixed(2)}deg)`;
        raf = on || Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(loop) : 0;
      };
      for (const r of rows) {
        const im = new Image();
        im.src = r.dataset.preview; // warm the cache
        r.addEventListener("pointerenter", (e) => {
          if (!pv.src.endsWith(r.dataset.preview.replace(/^\.\//, ""))) pv.src = r.dataset.preview;
          if (!on && !pv.classList.contains("is-visible")) {
            x = tx = e.clientX;
            y = ty = e.clientY;
          }
          on = true;
          pv.classList.add("is-visible");
          if (!raf) raf = requestAnimationFrame(loop);
        });
        r.addEventListener("pointermove", (e) => {
          tx = e.clientX;
          ty = e.clientY;
        });
        r.addEventListener("pointerleave", () => {
          on = false;
          pv.classList.remove("is-visible");
        });
      }
    }

    // a small cursor that grows on links and says "View" on works
    const cursor = $(".cursor");
    const label = $(".cursor-label");
    if (cursor) {
      let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, raf = 0;
      const loop = () => {
        x = lerp(x, tx, 0.22);
        y = lerp(y, ty, 0.22);
        cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(loop) : 0;
      };
      addEventListener(
        "pointermove",
        (e) => {
          tx = e.clientX;
          ty = e.clientY;
          cursor.classList.add("is-active");
          if (!raf) raf = requestAnimationFrame(loop);
        },
        { passive: true },
      );
      doc.addEventListener("pointerleave", () => cursor.classList.remove("is-active"));
      document.addEventListener("pointerover", (e) => {
        const view = e.target.closest("[data-cursor]");
        const link = e.target.closest("a, button, summary");
        cursor.classList.toggle("is-view", !!view);
        cursor.classList.toggle("is-link", !view && !!link);
        label.textContent = view ? view.dataset.cursor : "";
      });
    }

    // magnetic buttons
    for (const el of $$("[data-magnetic]")) {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.3).toFixed(1)}px)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    }
  }

  runScroll();
})();
