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
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    d.querySelectorAll("[data-reveal], [data-draw], [data-expand]").forEach(function (el) {
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
