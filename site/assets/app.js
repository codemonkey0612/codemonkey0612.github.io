// TAKUMI site behaviour. Everything here is an enhancement: pages read and work without it.
// - header state, accessible mobile menu (focus trap, Escape)
// - reveals / gold connector drawing / media expand (only with the `motion` class)
// - works filters with a measured layout animation, review "load more"
// - films: play ring, close, error; video popup
// - the live 3D hero (celestial.js) on capable desktops, with a motion switch
(function () {
  "use strict";
  window.TAKUMI = true;
  var d = document;
  // The site assistant: chat.js (a module) loads only when someone opens it.
  var APP_SRC = d.currentScript && d.currentScript.src;
  (function askButton() {
    var fab = d.querySelector(".ask-fab");
    if (!fab) return;
    // Phones: the label folds into the orb after a moment, or once the page is scrolled.
    var small = window.matchMedia("(max-width: 760px)");
    var fold = function () {
      if (small.matches) fab.classList.add("is-compact");
    };
    setTimeout(fold, 5000);
    addEventListener("scroll", function once() {
      if (window.scrollY > 240) {
        fold();
        removeEventListener("scroll", once);
      }
    }, { passive: true });
    // A greeting once per visit, a few seconds in; it goes when touched, closed or the chat opens.
    var seen = false;
    try {
      seen = sessionStorage.getItem("takumi-ask-hint") === "1";
    } catch (e) {}
    if (seen) return;
    var hint = d.createElement("div");
    hint.className = "ask-hint";
    hint.hidden = true;
    hint.innerHTML = '<p><button type="button" data-ask><b lang="en">Ask TAKUMI</b>サービスや料金、実績のこと。このサイトの内容から、AIがすぐにお答えします。</button></p><button class="ask-hint-x" type="button" aria-label="閉じる">×</button>';
    d.body.appendChild(hint);
    var done = function () {
      hint.hidden = true;
      try {
        sessionStorage.setItem("takumi-ask-hint", "1");
      } catch (e) {}
    };
    hint.querySelector(".ask-hint-x").addEventListener("click", done);
    d.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-ask]")) done();
    });
    setTimeout(function () {
      if (!d.querySelector("dialog.ask[open]")) hint.hidden = false;
      setTimeout(done, 12000);
    }, 6000);
  })();
  d.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-ask]");
    var fab = d.querySelector(".ask-fab");
    if (!b || !fab || !APP_SRC) return;
    e.preventDefault();
    var u = new URL("chat.js", APP_SRC);
    u.search = new URL(APP_SRC).search;
    import(u.href).then(function (m) {
      m.open(fab.getAttribute("data-endpoint"), b.getAttribute("data-ask-q") || "");
    });
  });
  var root = d.documentElement;
  var body = d.body;
  var base = body.getAttribute("data-base") || "./";
  var ver = body.getAttribute("data-v") || "";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var motionOff = function () {
    try {
      return localStorage.getItem("takumi-motion") === "off";
    } catch (e) {
      return false;
    }
  };
  var motionOn = function () {
    return !reduce.matches && !motionOff();
  };

  // ---------- header ----------
  var hd = d.querySelector(".hd");
  var onScroll = function () {
    if (hd) hd.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------- mobile menu ----------
  var menu = d.getElementById("menu");
  var menuBtn = d.querySelector(".menu-btn");
  if (menu && menuBtn) {
    var lastFocus = null;
    var focusables = function () {
      return Array.prototype.slice.call(menu.querySelectorAll("a[href], button:not([disabled])"));
    };
    var openMenu = function () {
      lastFocus = d.activeElement;
      menu.hidden = false;
      menuBtn.setAttribute("aria-expanded", "true");
      body.style.overflow = "hidden";
      var f = focusables();
      if (f[0]) f[0].focus();
    };
    var closeMenu = function () {
      menu.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
      body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };
    menuBtn.addEventListener("click", openMenu);
    menu.querySelector(".menu-close").addEventListener("click", closeMenu);
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.key !== "Tab") return;
      var f = focusables();
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && d.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && d.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a[href]")) closeMenu();
    });
    matchMedia("(min-width: 1024px)").addEventListener("change", function (m) {
      if (m.matches && !menu.hidden) closeMenu();
    });
  }

  // ---------- reveals ----------
  var revealAll = function () {
    d.querySelectorAll("[data-reveal], [data-draw], [data-expand]").forEach(function (el) {
      el.classList.add("is-in");
    });
  };
  var io = null;
  var watchReveals = function () {
    if (!root.classList.contains("motion") || !("IntersectionObserver" in window)) return revealAll();
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            var el = e.target;
            el.classList.add("is-in");
            io.unobserve(el);
            // The stagger only times the entrance; hover afterwards answers at once.
            if (el.style.getPropertyValue("--rv-d")) setTimeout(function () { el.style.removeProperty("--rv-d"); }, 1600);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    // Headings rise out of a slot of light as they come into view.
    d.querySelectorAll("main h2:not(.sr-only), main .tale-statement, main .bio-motto, main .tale-next-title, footer .fo-tag").forEach(function (el) {
      if (el.closest(".stage, .menu, dialog, [hidden]")) return;
      el.classList.add("rv-head");
      if (!el.closest("[data-reveal]")) el.setAttribute("data-reveal", "");
    });
    d.querySelectorAll("[data-reveal], [data-draw], [data-expand]").forEach(function (el) {
      // Siblings that reveal together arrive one after another.
      if (el.hasAttribute("data-reveal") && el.parentNode) {
        var sibs = Array.prototype.filter.call(el.parentNode.children, function (c) { return c.hasAttribute("data-reveal"); });
        var i = sibs.indexOf(el);
        if (sibs.length > 1 && i > 0) el.style.setProperty("--rv-d", Math.min(i % 6, 5) * 80 + "ms");
      }
      io.observe(el);
    });
  };
  watchReveals();

  // ---------- video popup ----------
  var modal = d.querySelector(".vmodal");
  if (modal && modal.showModal) {
    var mv = modal.querySelector("video");
    var mt = modal.querySelector(".vmodal-t");
    var opener = null;
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-video]");
      if (!b) return;
      e.preventDefault();
      opener = b;
      mv.src = b.getAttribute("data-video");
      mt.textContent = b.getAttribute("data-video-title") || "";
      modal.showModal();
      var p = mv.play();
      if (p && p.catch) p.catch(function () {});
    });
    var closeModal = function () {
      mv.pause();
      mv.removeAttribute("src");
      mv.load();
      if (modal.open) modal.close();
    };
    modal.querySelector(".vmodal-x").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
    modal.addEventListener("close", function () {
      mv.pause();
      if (opener && opener.focus) opener.focus();
    });
  }

  // ---------- film posters load as the film comes near (they are below the first screen) ----------
  var posters = d.querySelectorAll("video[data-poster]");
  var setPoster = function (v) {
    if (!v.getAttribute("poster")) v.setAttribute("poster", v.getAttribute("data-poster"));
  };
  if ("IntersectionObserver" in window) {
    var posterIo = new IntersectionObserver(
      function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) {
            setPoster(e.target);
            posterIo.unobserve(e.target);
          }
        });
      },
      { rootMargin: "900px 0px" },
    );
    posters.forEach(function (v) {
      posterIo.observe(v);
    });
  } else posters.forEach(setPoster);

  // ---------- films (inline, user-controlled) ----------
  d.querySelectorAll(".film").forEach(function (fig) {
    var frame = fig.querySelector(".film-frame");
    var v = fig.querySelector("video");
    if (!frame || !v) return;
    var label = v.getAttribute("aria-label") || "動画";
    if (!fig.classList.contains("film-controls")) v.controls = false;
    var ring = d.createElement("button");
    ring.type = "button";
    ring.className = "film-ring";
    ring.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z"/></svg><span class="sr-only">' + label + "を再生</span>";
    var close = d.createElement("button");
    close.type = "button";
    close.className = "film-close";
    close.hidden = true;
    close.innerHTML = '<svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>閉じる';
    var msg = d.createElement("p");
    msg.className = "film-msg";
    msg.hidden = true;
    msg.setAttribute("role", "status");
    frame.appendChild(ring);
    frame.appendChild(close);
    frame.appendChild(msg);
    ring.addEventListener("click", function () {
      msg.hidden = true;
      msg.textContent = "読み込んでいます…";
      msg.hidden = false;
      v.controls = true;
      var p = v.play();
      if (p && p.then)
        p.then(function () {
          msg.hidden = true;
        }).catch(function () {
          msg.textContent = "再生できませんでした。もう一度お試しください。";
        });
    });
    v.addEventListener("play", function () {
      fig.classList.add("is-playing");
      ring.hidden = true;
      close.hidden = false;
      msg.hidden = true;
    });
    v.addEventListener("error", function () {
      msg.textContent = "動画を読み込めませんでした。通信環境をご確認のうえ、もう一度お試しください。";
      msg.hidden = false;
      ring.hidden = false;
    }, true);
    close.addEventListener("click", function () {
      v.pause();
      if (!fig.classList.contains("film-controls")) v.controls = false;
      v.currentTime = 0;
      v.load(); // back to the poster
      fig.classList.remove("is-playing");
      close.hidden = true;
      ring.hidden = false;
      ring.focus();
    });
  });

  // ---------- works filters ----------
  // The filter bar sticks under the header; once stuck it gets a frosted background so the
  // cards don't show through it.
  var bar = d.querySelector(".gallery .filters-bar");
  if (bar) {
    var stuck = function () {
      var top = parseFloat(getComputedStyle(bar).top) || 0;
      bar.classList.toggle("is-stuck", bar.getBoundingClientRect().top <= top + 1 && window.scrollY > 0);
    };
    window.addEventListener("scroll", stuck, { passive: true });
    stuck();
  }
  var grid = d.querySelector(".wgrid-edit");
  var filterBtns = d.querySelectorAll(".filters [data-filter]");
  var count = d.querySelector(".filter-count");
  if (grid && filterBtns.length) {
    var cards = Array.prototype.slice.call(grid.children);
    // A gold marker under the chosen tab, gliding to the next one.
    var ink = d.querySelector(".filters-ink");
    var placeInk = function () {
      var on = d.querySelector('.filters [aria-pressed="true"]');
      if (!ink || !on) return;
      ink.style.width = on.offsetWidth + "px";
      ink.style.transform = "translateX(" + on.offsetLeft + "px)";
    };
    placeInk();
    window.addEventListener("resize", placeInk);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(placeInk);
    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-filter");
        var before = new Map();
        cards.forEach(function (c) {
          if (!c.hidden) before.set(c, c.getBoundingClientRect());
        });
        filterBtns.forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        var shown = 0;
        cards.forEach(function (c) {
          var on = key === "all" || c.getAttribute("data-cat") === key;
          c.hidden = !on;
          if (on) {
            shown++;
            c.classList.add("is-in");
          }
        });
        grid.classList.toggle("is-filtered", key !== "all");
        placeInk();
        btn.scrollIntoView && btn.parentNode.scrollWidth > btn.parentNode.clientWidth && btn.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        if (count) count.textContent = shown + "件を表示しています";
        if (!root.classList.contains("motion") || !Element.prototype.animate) return;
        cards.forEach(function (c) {
          if (c.hidden) return;
          var now = c.getBoundingClientRect();
          var was = before.get(c);
          if (was) {
            var dx = was.left - now.left;
            var dy = was.top - now.top;
            if (dx || dy) c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: 250, easing: "cubic-bezier(.2,.7,.2,1)" });
          } else {
            c.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 250, easing: "ease-out" });
          }
        });
      });
    });
  }

  // ---------- reviews: short cards, full text on request ----------
  d.querySelectorAll(".reviews .quote blockquote").forEach(function (bq, i) {
    var p = bq.querySelector("p");
    if (!p) return;
    bq.classList.add("is-clamped");
    if (p.scrollHeight <= p.clientHeight + 2) {
      bq.classList.remove("is-clamped");
      return;
    }
    p.id = p.id || "rv-text-" + i;
    var b = d.createElement("button");
    b.type = "button";
    b.className = "rv-more";
    b.setAttribute("aria-controls", p.id);
    b.setAttribute("aria-expanded", "false");
    b.textContent = "全文を読む";
    bq.after(b);
    b.addEventListener("click", function () {
      var open = bq.classList.toggle("is-clamped") === false;
      b.setAttribute("aria-expanded", String(open));
      b.textContent = open ? "閉じる" : "全文を読む";
    });
  });

  // ---------- reviews: load more ----------
  var reviews = d.querySelector(".reviews[data-more]");
  if (reviews) {
    var step = Number(reviews.getAttribute("data-more")) || 9;
    var items = Array.prototype.slice.call(reviews.children);
    var target = location.hash ? d.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (items.length > step && !(target && items.indexOf(target) >= step)) {
      var shownN = step;
      items.forEach(function (el, i) {
        if (i >= step) el.hidden = true;
      });
      var moreBtn = d.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "btn btn-plate more-btn";
      var label = function () {
        moreBtn.textContent = "さらに表示する（残り" + (items.length - shownN) + "件）";
      };
      label();
      reviews.after(moreBtn);
      moreBtn.addEventListener("click", function () {
        var first = items[shownN];
        var more = Number(reviews.getAttribute("data-step")) || step;
        items.slice(shownN, shownN + more).forEach(function (el) {
          el.hidden = false;
          el.classList.add("is-in");
        });
        shownN = Math.min(items.length, shownN + more);
        if (first) {
          first.setAttribute("tabindex", "-1");
          first.focus();
        }
        if (shownN >= items.length) moreBtn.remove();
        else label();
      });
    }
  }

  // ---------- live 3D hero ----------
  var live = null;
  var capable = function () {
    if (!motionOn()) return false;
    if (!matchMedia("(min-width: 1024px) and (pointer: fine)").matches) return false;
    var c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ""))) return false;
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
    try {
      var gl = d.createElement("canvas").getContext("webgl2");
      return !!gl;
    } catch (e) {
      return false;
    }
  };
  var startLive = function () {
    var stage = d.querySelector(".stage[data-scene]");
    // A generated plate is the artwork itself: keep it, no live scene on top.
    if (!stage || stage.hasAttribute("data-plate") || live || !capable()) return;
    live = "loading";
    import(base + "assets/celestial.js?v=" + ver)
      .then(function (m) {
        return m.start(stage, base + "assets/");
      })
      .then(function (h) {
        live = h;
        if (!motionOn() && h) {
          h.stop();
          live = null;
        }
      })
      .catch(function () {
        live = null; // the still stays: nothing else to do
      });
  };
  var stopLive = function () {
    if (live && live.stop) live.stop();
    live = null;
  };
  if ("requestIdleCallback" in window) requestIdleCallback(startLive, { timeout: 2500 });
  else setTimeout(startLive, 1200);

  // ---------- motion switch ----------
  var toggle = d.querySelector(".motion-toggle");
  var syncToggle = function () {
    if (!toggle) return;
    var off = !motionOn();
    toggle.setAttribute("aria-pressed", String(off));
    toggle.textContent = off ? "動きを戻す" : "動きを減らす";
    toggle.disabled = reduce.matches;
    if (reduce.matches) toggle.textContent = "動きを減らす（端末の設定でオン）";
  };
  syncToggle();
  if (toggle)
    toggle.addEventListener("click", function () {
      try {
        localStorage.setItem("takumi-motion", motionOff() ? "on" : "off");
      } catch (e) {}
      if (motionOn()) {
        root.classList.add("motion");
        startLive();
      } else {
        root.classList.remove("motion");
        revealAll();
        stopLive();
      }
      syncToggle();
    });
  reduce.addEventListener("change", function () {
    if (reduce.matches) {
      root.classList.remove("motion");
      revealAll();
      stopLive();
    }
    syncToggle();
  });

  // ---------- the hero drifts and its copy fades as the page scrolls (desktop, motion on) ----------
  var hero = d.querySelector("main > .stage");
  if (hero && window.matchMedia) {
    var wide = matchMedia("(min-width: 1024px)");
    var ticking = false;
    var drift = function () {
      ticking = false;
      if (!root.classList.contains("motion") || !wide.matches) {
        hero.style.removeProperty("--hpx");
        hero.style.removeProperty("--hpr");
        return;
      }
      var h = hero.offsetHeight || 1;
      var y = Math.min(Math.max(window.scrollY, 0), h);
      hero.style.setProperty("--hpx", y.toFixed(1) + "px");
      hero.style.setProperty("--hpr", (y / h).toFixed(3));
    };
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(drift);
        }
      },
      { passive: true },
    );
    drift();
  }
  // Page-to-page transitions follow the motion switch too.
  window.addEventListener("pageswap", function (e) {
    if (e.viewTransition && !root.classList.contains("motion")) e.viewTransition.skipTransition();
  });

  // ---------- the first visit opens with the emblem; later pages wash in ----------
  var intro = d.querySelector(".ov");
  var endIntro = function () {
    if (root.classList.contains("ov-on")) root.classList.add("ov-seen");
    root.classList.remove("ov-on");
    if (intro) intro.setAttribute("hidden", "");
  };
  if (intro && root.classList.contains("ov-on")) {
    try {
      sessionStorage.setItem("takumi-intro", "1");
    } catch (e) {}
    intro.addEventListener("click", endIntro);
    intro.addEventListener("animationend", function (e) {
      if (e.target === intro) endIntro();
    });
    setTimeout(endIntro, 3200);
  } else if (intro) {
    intro.setAttribute("hidden", "");
  }

  // ---------- a constellation the pointer draws (dark heroes and the footer sky) ----------
  // Stars drift slowly; near the pointer they join with fine gold threads and brighten.
  var skies = [];
  var Sky = function (host, opts) {
    var cv = d.createElement("canvas");
    cv.className = "sky-canvas";
    cv.setAttribute("aria-hidden", "true");
    host.appendChild(cv);
    var cx = cv.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var stars = [];
    var w = 0, h = 0, px = -9999, py = -9999, ease = 0, on = false, raf = 0, t0 = 0;
    var gold = opts.light ? [168, 124, 44] : [245, 226, 173];
    var size = function () {
      var b = host.getBoundingClientRect();
      w = Math.max(1, b.width);
      h = Math.max(1, b.height);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(150, (w * h) / (opts.density || 9000)));
      stars = [];
      for (var i = 0; i < n; i++)
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.pow(Math.random(), 3) * 1.8,
          vx: (Math.random() - 0.5) * 0.06,
          vy: (Math.random() - 0.5) * 0.04 - 0.015,
          tw: Math.random() * Math.PI * 2,
          ts: 0.6 + Math.random() * 1.4,
        });
    };
    var draw = function (now) {
      raf = 0;
      var dt = Math.min(48, now - (t0 || now));
      t0 = now;
      ease += ((px > -999 ? 1 : 0) - ease) * 0.06;
      cx.clearRect(0, 0, w, h);
      var reach = Math.min(240, Math.max(150, w * 0.14));
      var near = [];
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < -10) s.x = w + 10;
        if (s.x > w + 10) s.x = -10;
        if (s.y < -10) s.y = h + 10;
        if (s.y > h + 10) s.y = -10;
        s.tw += s.ts * dt * 0.0012;
        var dx = s.x - px, dy = s.y - py;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var k = ease * Math.pow(Math.max(0, 1 - dist / reach), 0.7);
        var a = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(s.tw))) * (opts.light ? 0.7 : 1) + k * 0.6;
        cx.beginPath();
        cx.arc(s.x, s.y, s.r + k * 1.6, 0, 6.2832);
        cx.fillStyle = "rgba(" + gold[0] + "," + gold[1] + "," + gold[2] + "," + Math.min(1, a).toFixed(3) + ")";
        cx.fill();
        if (k > 0.05) near.push([s, k]);
      }
      // threads between the stars the pointer gathers
      cx.lineWidth = 0.9;
      for (var p = 0; p < near.length; p++) {
        for (var q = p + 1; q < near.length; q++) {
          var A = near[p][0], B = near[q][0];
          var ex = A.x - B.x, ey = A.y - B.y;
          var dd = Math.sqrt(ex * ex + ey * ey);
          if (dd > reach * 0.85) continue;
          var al = Math.min(1, Math.sqrt(near[p][1] * near[q][1]) * 1.6) * (1 - dd / (reach * 0.85)) * (opts.light ? 0.7 : 0.95);
          cx.strokeStyle = "rgba(" + gold[0] + "," + gold[1] + "," + gold[2] + "," + al.toFixed(3) + ")";
          cx.beginPath();
          cx.moveTo(A.x, A.y);
          cx.lineTo(B.x, B.y);
          cx.stroke();
        }
      }
      // a soft halo where the pointer is
      if (ease > 0.02) {
        var g = cx.createRadialGradient(px, py, 0, px, py, reach * 0.9);
        g.addColorStop(0, "rgba(" + gold[0] + "," + gold[1] + "," + gold[2] + "," + (0.16 * ease).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + gold[0] + "," + gold[1] + "," + gold[2] + ",0)");
        cx.fillStyle = g;
        cx.fillRect(0, 0, w, h);
      }
      if (on) raf = requestAnimationFrame(draw);
    };
    var api = {
      start: function () {
        if (on) return;
        on = true;
        t0 = 0;
        if (!raf) raf = requestAnimationFrame(draw);
      },
      stop: function () {
        on = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        cx.clearRect(0, 0, w, h);
      },
    };
    size();
    window.addEventListener("resize", function () {
      size();
    });
    var evHost = opts.events || host;
    evHost.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var b = cv.getBoundingClientRect();
      px = e.clientX - b.left;
      py = e.clientY - b.top;
    });
    evHost.addEventListener("pointerleave", function () {
      px = -9999;
      py = -9999;
    });
    var seen = false;
    if ("IntersectionObserver" in window)
      new IntersectionObserver(function (es) {
        seen = es[0].isIntersecting;
        if (seen && moving()) api.start();
        else api.stop();
      }).observe(host);
    api.seen = function () {
      return seen;
    };
    return api;
  };
  var moving = function () {
    return root.classList.contains("motion") && !document.hidden;
  };
  var heroStage = d.querySelector("main > .stage");
  if (window.HTMLCanvasElement) {
    if (heroStage) skies.push(Sky(heroStage, { light: heroStage.classList.contains("stage-light"), density: 9000 }));
    var foSky = d.querySelector(".fo-sky");
    if (foSky) skies.push(Sky(foSky, { light: false, density: 7000, events: foSky.parentNode }));
  }
  var skyAll = function () {
    skies.forEach(function (s) {
      if (moving() && s.seen()) s.start();
      else s.stop();
    });
  };
  d.addEventListener("visibilitychange", skyAll);
  if (toggle) toggle.addEventListener("click", skyAll);

  // ---------- reviews: the gold thread draws when it arrives; its lights follow the motion switch ----------
  var thread = d.querySelector(".dlg-thread");
  if (thread) {
    var stage = thread.parentNode;
    var syncThread = function () {
      if (!thread.pauseAnimations) return;
      if (moving()) thread.unpauseAnimations();
      else thread.pauseAnimations();
    };
    syncThread();
    if (toggle) toggle.addEventListener("click", syncThread);
    if ("IntersectionObserver" in window)
      new IntersectionObserver(
        function (es, ob) {
          if (es[0].isIntersecting) {
            stage.classList.add("is-lit");
            ob.disconnect();
          }
        },
        { threshold: 0.3 },
      ).observe(stage);
    else stage.classList.add("is-lit");
  }

  // ---------- cards: a gold edge light that follows the pointer ----------
  var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine) {
    d.querySelectorAll(".route-works .gcard a, .svc-card, .tier, .quote-card, .hl-cards li, .cap-row li, .deliv-cards li, .card-soft, .card-night, .sel-caps a, .tale-hl li, .flow-orb, .pk-block, .fb-more .btn, .tale-next a").forEach(function (el) {
      el.classList.add("glow-edge");
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      var edge = d.createElement("span");
      edge.className = "edge";
      edge.setAttribute("aria-hidden", "true");
      el.appendChild(edge);
      el.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        var b = el.getBoundingClientRect();
        el.style.setProperty("--ex", (e.clientX - b.left).toFixed(0) + "px");
        el.style.setProperty("--ey", (e.clientY - b.top).toFixed(0) + "px");
      });
    });
  }

  // ---------- storybook figures count up when they come into view ----------
  var counts = d.querySelectorAll(".tale-count[data-to]");
  if (counts.length && "IntersectionObserver" in window) {
    var countIo = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          countIo.unobserve(e.target);
          var el = e.target;
          var to = Number(el.getAttribute("data-to")) || 0;
          if (!root.classList.contains("motion") || !to) return;
          var t0 = performance.now();
          var dur = 1600;
          var tick = function (now) {
            var p = Math.min(1, (now - t0) / dur);
            var eased = 1 - Math.pow(1 - p, 4);
            el.textContent = Math.round(to * eased).toLocaleString("ja-JP");
            if (p < 1) requestAnimationFrame(tick);
          };
          el.textContent = "0";
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.6 },
    );
    counts.forEach(function (el) {
      countIo.observe(el);
    });
  }

  // ---------- folded sections reached by a link (#price) open themselves ----------
  var openTarget = function () {
    var id = location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
    var el = id && d.getElementById(id);
    if (el && el.tagName === "DETAILS") el.open = true;
  };
  window.addEventListener("hashchange", openTarget);
  d.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var el = d.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    if (el && el.tagName === "DETAILS") el.open = true;
  });
  openTarget();
})();
