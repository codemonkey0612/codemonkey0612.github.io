/* 匠 TAKUMI｜AI・Webシステム開発 — site motion.
   Every page works without this file. Motion is skipped for prefers-reduced-motion
   (the head script only adds .motion when motion is allowed). No dependencies. */
(() => {
  "use strict";
  window.TAKUMI = true;
  const doc = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const introOn = doc.classList.contains("motion") && !doc.classList.contains("intro-seen");
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
  const STICKY = /^[、。，．・！？」』）】〕：；ー〜.,!?']$/;
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
    const count = (el) => {
      const to = parseFloat(el.dataset.count);
      if (!Number.isFinite(to)) return;
      const t0 = performance.now();
      const dur = 1700;
      const step = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 4))));
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = "0";
      requestAnimationFrame(step);
    };
    const countIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          countIO.unobserve(e.target);
          const inHero = introOn && e.target.closest(".hero");
          if (inHero) {
            e.target.textContent = "0";
            setTimeout(() => count(e.target), 1500);
          } else count(e.target);
        }
      },
      { threshold: 0.5 },
    );
    $$("[data-count]").forEach((el) => countIO.observe(el));
  }

  // ---------- header, progress bar, back-to-top ----------
  const header = $(".site-header");
  const bar = $(".progress");
  const toTop = $(".to-top");
  let lastY = scrollY;
  onScroll.push((y) => {
    header.classList.toggle("is-scrolled", y > 24);
    if (Math.abs(y - lastY) > 8) {
      header.classList.toggle("is-hidden", y > lastY && y > 480 && !doc.classList.contains("nav-open"));
      lastY = y;
    }
    const max = doc.scrollHeight - innerHeight;
    const p = max > 0 ? clamp(y / max, 0, 1) : 0;
    bar.style.transform = `scaleX(${p})`;
    if (toTop) {
      toTop.classList.toggle("is-visible", y > 700);
      toTop.style.setProperty("--p", p.toFixed(3));
    }
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
    matchMedia("(min-width: 1100px)").addEventListener("change", (m) => m.matches && setMenu(false));
  }

  // ---------- hero ----------
  const hero = $("[data-hero]");
  if (hero) {
    setTimeout(() => hero.classList.add("is-ready"), introOn ? 1300 : 60);

    // the showreel plays (muted) while it is on screen
    const reel = $(".reel-video", hero);
    if (reel && !reduced && "IntersectionObserver" in window) {
      new IntersectionObserver((es) => {
        if (es[0].isIntersecting) reel.play().catch(() => {});
        else reel.pause();
      }).observe(reel);
    }

    // rotating words
    const rot = $("[data-rotator]", hero);
    if (rot) {
      const items = [...rot.children];
      let k = 0;
      items[0].classList.add("is-active");
      if (!reduced && items.length > 1) {
        setInterval(() => {
          if (document.hidden) return;
          const cur = items[k];
          k = (k + 1) % items.length;
          const nxt = items[k];
          cur.classList.remove("is-active");
          cur.classList.add("is-out");
          cur.setAttribute("aria-hidden", "true");
          nxt.classList.remove("is-out");
          nxt.classList.add("is-active");
          nxt.removeAttribute("aria-hidden");
          setTimeout(() => cur.classList.remove("is-out"), 720);
        }, 2600);
      }
    }

    // floating cards and the reel follow the mouse a little
    const visual = $(".hero-visual", hero);
    if (visual && fine && !reduced) {
      const layers = $$("[data-depth]", visual);
      const tilt = $("[data-tilt-soft]", visual);
      let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
      const loop = () => {
        x = lerp(x, tx, 0.08);
        y = lerp(y, ty, 0.08);
        for (const l of layers) {
          const d = parseFloat(l.dataset.depth);
          l.style.transform = `translate3d(${(x * d).toFixed(2)}px, ${(y * d).toFixed(2)}px, 0)`;
        }
        if (tilt) tilt.style.transform = `perspective(1200px) rotateY(${(x * 4).toFixed(2)}deg) rotateX(${(-y * 4).toFixed(2)}deg)`;
        raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(loop) : 0;
      };
      hero.addEventListener("pointermove", (e) => {
        const r = hero.getBoundingClientRect();
        tx = (e.clientX - r.left) / r.width - 0.5;
        ty = (e.clientY - r.top) / r.height - 0.5;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      hero.addEventListener("pointerleave", () => {
        tx = ty = 0;
        if (!raf) raf = requestAnimationFrame(loop);
      });
    }

    // gold sparkles drifting up through the hero
    const cv = $(".sparkles", hero);
    const ctx = cv?.getContext("2d");
    if (ctx && !reduced) {
      let W = 0, H = 0, dpr = 1, parts = [], running = false, visible = true;
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 32;
      const s = sprite.getContext("2d");
      const g = s.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "rgba(255,243,200,1)");
      g.addColorStop(0.35, "rgba(226,186,92,0.85)");
      g.addColorStop(1, "rgba(226,186,92,0)");
      s.fillStyle = g;
      s.fillRect(0, 0, 32, 32);
      const size = () => {
        dpr = Math.min(devicePixelRatio || 1, 2);
        const r = hero.getBoundingClientRect();
        W = cv.width = Math.round(r.width * dpr);
        H = cv.height = Math.round(r.height * dpr);
        const n = Math.round(clamp((r.width * r.height) / 22000, 24, 70));
        parts = Array.from({ length: n }, () => ({
          x: Math.random() * W,
          y: Math.random() * H,
          r: (2 + Math.random() * 7) * dpr,
          v: (0.12 + Math.random() * 0.4) * dpr,
          sway: Math.random() * Math.PI * 2,
          tw: Math.random() * Math.PI * 2,
        }));
      };
      const frame = (t) => {
        if (!running) return;
        ctx.clearRect(0, 0, W, H);
        for (const p of parts) {
          p.y -= p.v;
          p.x += Math.sin(t * 0.0006 + p.sway) * 0.25 * dpr;
          if (p.y < -20) {
            p.y = H + 20;
            p.x = Math.random() * W;
          }
          ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.002 + p.tw));
          ctx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        }
        requestAnimationFrame(frame);
      };
      const setRunning = () => {
        const on = visible && !document.hidden;
        if (on && !running) {
          running = true;
          requestAnimationFrame(frame);
        } else if (!on) running = false;
      };
      size();
      new IntersectionObserver((es) => {
        visible = es[0].isIntersecting;
        setRunning();
      }).observe(hero);
      document.addEventListener("visibilitychange", setRunning);
      let rt = 0;
      addEventListener("resize", () => {
        clearTimeout(rt);
        rt = setTimeout(size, 200);
      });
    }
  }

  // ---------- flow: the line fills as you read ----------
  const flow = $("[data-flow]");
  if (flow) {
    onScroll.push(() => {
      const r = flow.getBoundingClientRect();
      flow.style.setProperty("--p", clamp((innerHeight * 0.8 - r.top) / (r.height + innerHeight * 0.25), 0, 1).toFixed(3));
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

  // ---------- video popup ----------
  const modal = $(".video-modal");
  if (modal && typeof modal.showModal === "function") {
    const v = $(".vm-video", modal);
    const title = $(".vm-title", modal);
    const close = () => modal.open && modal.close();
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-video]");
      if (!a) return;
      e.preventDefault();
      v.src = a.dataset.video;
      title.textContent = a.dataset.videoTitle ?? "";
      modal.showModal();
      v.play().catch(() => {});
    });
    $(".vm-close", modal).addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    modal.addEventListener("close", () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
  }

  // ---------- movie theater ----------
  const theater = $("[data-theater]");
  if (theater) {
    const video = $(".theater-video", theater);
    const ttl = $(".theater-title", theater);
    const pil = $(".theater-pillar", theater);
    const link = $(".theater-link", theater);
    theater.addEventListener("click", (e) => {
      const b = e.target.closest(".t-item");
      if (!b) return;
      for (const x of $$(".t-item", theater)) x.setAttribute("aria-pressed", String(x === b));
      video.classList.add("is-switching");
      setTimeout(() => {
        video.pause();
        video.poster = b.dataset.poster;
        video.src = b.dataset.src;
        video.classList.remove("is-switching");
        video.play().catch(() => {});
      }, reduced ? 0 : 250);
      ttl.textContent = b.dataset.title;
      pil.textContent = b.dataset.pillar;
      link.href = b.dataset.href;
      link.firstChild.textContent = `${b.dataset.name}を見る`;
      if (innerWidth < 1024) theater.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  }

  // ---------- pointer niceties (mouse only) ----------
  if (fine && !reduced) {
    // a soft gold light follows the cursor on cards
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest?.("[data-spot]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });

    // service cards play their promo video (muted) on hover
    for (const card of $$("[data-hover-video]")) {
      const media = $(".svc-media", card);
      let v = null;
      let timer = 0;
      card.addEventListener("pointerenter", () => {
        timer = setTimeout(() => {
          if (!v) {
            v = document.createElement("video");
            v.muted = true;
            v.loop = true;
            v.playsInline = true;
            v.preload = "auto";
            v.setAttribute("aria-hidden", "true");
            v.src = card.dataset.hoverVideo;
            v.addEventListener("playing", () => card.classList.add("is-playing"));
            media.append(v);
          }
          v.play().catch(() => {});
        }, 180);
      });
      card.addEventListener("pointerleave", () => {
        clearTimeout(timer);
        card.classList.remove("is-playing");
        if (v) v.pause();
      });
    }

    // works tilt toward the cursor
    for (const el of $$("[data-tilt]")) {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(900px) rotateY(${(x * 7).toFixed(2)}deg) rotateX(${(-y * 7).toFixed(2)}deg) translateY(-4px)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    }

    // magnetic buttons
    for (const el of $$("[data-magnetic]")) {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${(dx * 0.2).toFixed(1)}px, ${(dy * 0.3).toFixed(1)}px)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    }
  }

  runScroll();
})();
