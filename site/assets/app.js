/* 匠 TAKUMI — the little the site needs from JavaScript. No libraries.
   Every page works without it: the menu, the fade-in and the video popup are extras. */
(() => {
  "use strict";
  const doc = document.documentElement;
  const $ = (s, root = document) => root.querySelector(s);
  window.TAKUMI = true;

  // Header: a hairline once the page is scrolled.
  const hd = $(".hd");
  const onScroll = () => hd?.classList.toggle("scrolled", scrollY > 4);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Mobile menu.
  const menuBtn = $(".menu-btn");
  const setMenu = (open) => {
    doc.classList.toggle("nav-open", open);
    menuBtn?.setAttribute("aria-expanded", String(open));
  };
  menuBtn?.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
  $("#nav")?.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && doc.classList.contains("nav-open")) {
      setMenu(false);
      menuBtn?.focus();
    }
  });

  // A gentle fade-in as sections come into view (skipped for reduced motion).
  if (doc.classList.contains("motion")) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -5% 0px" });
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
  }

  // Service videos open in a popup (without JavaScript the link opens the video itself).
  const modal = $(".vmodal");
  if (modal && typeof modal.showModal === "function") {
    const player = $("video", modal);
    const caption = $(".vmodal-t", modal);
    document.addEventListener("click", (e) => {
      const link = e.target.closest("[data-video]");
      if (!link) return;
      e.preventDefault();
      player.src = link.dataset.video;
      caption.textContent = link.dataset.videoTitle ?? "";
      modal.showModal();
      player.play().catch(() => {});
    });
    $(".vmodal-x", modal).addEventListener("click", () => modal.close());
    modal.addEventListener("click", (e) => e.target === modal && modal.close());
    modal.addEventListener("close", () => {
      player.pause();
      player.removeAttribute("src");
      player.load();
    });
  }
})();
