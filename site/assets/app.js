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

  // ---------- storybook: headings written in light, letter by letter ----------
  // The words stay whole for screen readers (a hidden copy); the letters are decoration.
  var inkTargets = d.querySelectorAll("main .sh .h2, main .band-title, main .bio-motto, main .strip-title, main .svc-head h2, main > .stage .display, main .tale-statement, main .tale-h2, main .tale-next-title");
  var inkIo =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          function (entries) {
            entries.forEach(function (e) {
              if (e.isIntersecting) {
                e.target.classList.add("ink-on");
                inkIo.unobserve(e.target);
              }
            });
          },
          { rootMargin: "0px 0px -10% 0px", threshold: 0.2 },
        )
      : null;
  inkTargets.forEach(function (el) {
    if (el.classList.contains("is-split") || !el.textContent.trim()) return;
    var n = 0;
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = d.createDocumentFragment();
          Array.from(c.nodeValue).forEach(function (ch) {
            if (/\s/.test(ch)) return frag.appendChild(d.createTextNode(ch));
            var sp = d.createElement("span");
            sp.className = "c";
            sp.style.setProperty("--ci", n++);
            sp.textContent = ch;
            frag.appendChild(sp);
          });
          c.parentNode.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== "BR") {
          if (c.tagName === "EM") {
            // Gold words keep their own light; they arrive as one.
            var w = d.createElement("span");
            w.className = "c";
            w.style.setProperty("--ci", n);
            n += Math.max(1, c.textContent.length);
            c.parentNode.insertBefore(w, c);
            w.appendChild(c);
          } else walk(c);
        }
      });
    };
    var text = el.textContent.replace(/\s+/g, " ").trim();
    var shown = d.createElement("span");
    shown.setAttribute("aria-hidden", "true");
    while (el.firstChild) shown.appendChild(el.firstChild);
    walk(shown);
    var said = d.createElement("span");
    said.className = "sr-only";
    said.textContent = text;
    el.appendChild(said);
    el.appendChild(shown);
    el.classList.add("is-split");
    if (el.closest(".stage") || !inkIo) el.classList.add("ink-on");
    else inkIo.observe(el);
  });

  // ---------- hero: drifting sparks ----------
  var heroStage = d.querySelector("main > .stage");
  if (heroStage) {
    var sparks = d.createElement("span");
    sparks.className = "sparks";
    sparks.setAttribute("aria-hidden", "true");
    for (var k = 0; k < 22; k++) {
      var sp = d.createElement("i");
      sp.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "%");
      sp.style.setProperty("--y", (25 + Math.random() * 70).toFixed(1) + "%");
      sp.style.setProperty("--s", (2 + Math.random() * 3.5).toFixed(1) + "px");
      sp.style.setProperty("--t", (6 + Math.random() * 8).toFixed(1) + "s");
      sp.style.setProperty("--d", (-Math.random() * 12).toFixed(1) + "s");
      sparks.appendChild(sp);
    }
    heroStage.appendChild(sparks);
  }

  // ---------- cursor: only for a mouse, only with motion on ----------
  var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  var moving = function () {
    return root.classList.contains("motion");
  };
  if (fine) {
    // A gold ring that trails the pointer and opens over things you can press.
    var cur = d.createElement("div");
    cur.className = "cursor";
    cur.setAttribute("aria-hidden", "true");
    cur.innerHTML = '<span class="cursor-ring"></span><span class="cursor-dot"></span>';
    body.appendChild(cur);
    var ring = cur.firstChild;
    var dot = cur.lastChild;
    var px = 0, py = 0, rx = 0, ry = 0, ringRun = false;
    var ringStep = function () {
      rx += (px - rx) * 0.2;
      ry += (py - ry) * 0.2;
      ring.style.transform = "translate3d(" + rx.toFixed(1) + "px," + ry.toFixed(1) + "px,0)";
      if (Math.abs(px - rx) > 0.2 || Math.abs(py - ry) > 0.2) requestAnimationFrame(ringStep);
      else ringRun = false;
    };
    var gx = 0, gy = 0;
    d.addEventListener(
      "pointermove",
      function (e) {
        if (e.pointerType !== "mouse") return;
        px = e.clientX;
        py = e.clientY;
        if (!cur.classList.contains("is-on")) {
          rx = px;
          ry = py;
          cur.classList.add("is-on");
        }
        cur.classList.remove("is-out");
        dot.style.transform = "translate3d(" + px + "px," + py + "px,0)";
        var t = e.target.closest ? e.target : e.target.parentElement;
        cur.classList.toggle("is-text", !!(t && t.closest("input, textarea, select")));
        cur.classList.toggle("is-link", !!(t && t.closest("a, button, summary, label, [role='button']")));
        cur.classList.toggle("is-dark", !!(t && t.closest(".stage-dark, .ch-night, .band:not(.band-light), .ft, .strip-exp, .gcard-dark, .svc-card-dark, .card-night, .quote-hero, .scope, .next")));
        if (!ringRun) {
          ringRun = true;
          requestAnimationFrame(ringStep);
        }
        // the page's decorations float a little with the pointer
        var nx = (px / window.innerWidth - 0.5) * 2;
        var ny = (py / window.innerHeight - 0.5) * 2;
        if (Math.abs(nx - gx) > 0.02 || Math.abs(ny - gy) > 0.02) {
          gx = nx;
          gy = ny;
          root.style.setProperty("--gx", gx.toFixed(2));
          root.style.setProperty("--gy", gy.toFixed(2));
        }
      },
      { passive: true },
    );
    root.addEventListener("mouseleave", function () {
      cur.classList.add("is-out");
    });
    d.addEventListener("pointerdown", function () {
      cur.classList.add("is-down");
    });
    d.addEventListener("pointerup", function () {
      cur.classList.remove("is-down");
    });

    // Cards tilt toward the pointer and catch a light where it is.
    d.querySelectorAll(".route-works .gcard a, .svc-card, .tier, .quote-card, .hl-cards li, .cap-row li, .deliv-cards li, .card-soft, .card-night, .sel-caps a, .cs-points li, .cs-next, .tale-hl li").forEach(function (el) {
      var sheen = d.createElement("span");
      sheen.className = "sheen";
      sheen.setAttribute("aria-hidden", "true");
      el.appendChild(sheen);
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.classList.add("has-tilt");
      el.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse" || !moving()) return;
        var b = el.getBoundingClientRect();
        var x = (e.clientX - b.left) / b.width;
        var y = (e.clientY - b.top) / b.height;
        var dx = x - 0.5, dy = y - 0.5;
        var m = Math.hypot(dx, dy) || 0.0001;
        var max = b.width > 560 ? 2.5 : 5;
        el.style.setProperty("--tilt", (-dy / m).toFixed(3) + " " + (dx / m).toFixed(3) + " 0 " + (max * Math.min(1, m * 2)).toFixed(2) + "deg");
        el.style.setProperty("--sx", (x * 100).toFixed(1) + "%");
        el.style.setProperty("--sy", (y * 100).toFixed(1) + "%");
        el.classList.add("is-tilt");
      });
      el.addEventListener("pointerleave", function () {
        el.style.removeProperty("--tilt");
        el.classList.remove("is-tilt");
      });
    });

    // Buttons lean toward the pointer.
    d.querySelectorAll(".btn-gold, .hd-cta, .btn-frame, .btn-plate, .play-ring, .next-ic").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse" || !moving()) return;
        var b = el.getBoundingClientRect();
        var dx = (e.clientX - b.left - b.width / 2) / (b.width / 2);
        var dy = (e.clientY - b.top - b.height / 2) / (b.height / 2);
        el.style.translate = (dx * 6).toFixed(1) + "px " + (dy * 4).toFixed(1) + "px";
      });
      el.addEventListener("pointerleave", function () {
        el.style.translate = "";
      });
    });

    // The hero answers the pointer: depth between art, copy and sparks; a soft light where it is.
    if (heroStage) {
      var light = d.createElement("span");
      light.className = "hero-glow";
      light.setAttribute("aria-hidden", "true");
      heroStage.appendChild(light);
      var tx = 0, ty = 0, cx = 0, cy = 0, heroRun = false;
      var heroStep = function () {
        cx += (tx - cx) * 0.07;
        cy += (ty - cy) * 0.07;
        heroStage.style.setProperty("--mx", cx.toFixed(3));
        heroStage.style.setProperty("--my", cy.toFixed(3));
        if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) requestAnimationFrame(heroStep);
        else heroRun = false;
      };
      var heroKick = function () {
        if (!heroRun) {
          heroRun = true;
          requestAnimationFrame(heroStep);
        }
      };
      heroStage.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse" || !moving()) return;
        var b = heroStage.getBoundingClientRect();
        tx = ((e.clientX - b.left) / b.width - 0.5) * 2;
        ty = ((e.clientY - b.top) / b.height - 0.5) * 2;
        heroStage.style.setProperty("--lx", (e.clientX - b.left).toFixed(0) + "px");
        heroStage.style.setProperty("--ly", (e.clientY - b.top).toFixed(0) + "px");
        heroStage.classList.add("is-lit");
        heroKick();
      });
      heroStage.addEventListener("pointerleave", function () {
        tx = 0;
        ty = 0;
        heroStage.classList.remove("is-lit");
        heroKick();
      });
    }
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
