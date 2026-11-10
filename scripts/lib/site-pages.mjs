// Hub site pages (the "Celestial Atelier" design, 2026-11-10): layout, shared blocks and
// all 31 routes. Data comes from loadSite() in site-core.mjs. Every page is complete
// without JavaScript; app.js adds motion, filters and video, and celestial.js the live 3D.
import fs from "node:fs";

let renderInquiryForm = null;
try {
  ({ renderInquiryForm } = await import("./contact-form.mjs"));
} catch {}

const LANCERS_JOB = (id) => `https://www.lancers.jp/work/detail/${id}`;
const PLATFORM_LABEL = { zenn: "Zenn", qiita: "Qiita", note: "note" };
const isSet = (v) => typeof v === "string" && v.trim() !== "" && !/^\s*TODO\b/.test(v);

// ---------- helpers ----------

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const yen = (n) => `${Number(n).toLocaleString("ja-JP")}円`;
const jaDate = (s) => {
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(String(s ?? ""));
  if (!m) return esc(s);
  return `${m[1]}年${Number(m[2])}月${m[3] ? `${Number(m[3])}日` : ""}`;
};
const dotDate = (s) => {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(s ?? ""));
  return m ? `${m[1]}.${m[2].padStart(2, "0")}` : esc(s);
};
const num = (s) => Number(/(\d+(?:\.\d+)?)/.exec(String(s ?? ""))?.[1] ?? NaN);
const pad2 = (n) => String(n).padStart(2, "0");
const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const join = (xs) => xs.filter((x) => x !== false && x != null).join("\n");
const ext = (url, text, cls = "") =>
  `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener">${text}<span class="sr-only">（新しいタブで開きます）</span></a>`;
const range = (a, b, unit) => (a == null ? "—" : a === b ? `${unit(a)}` : `${unit(a)}〜${unit(b)}`);
/** Line break points for display headings: "、" and "。" may end a line. */
const brk = (s) => esc(s).replace(/([、。])(?!$)/g, "$1<wbr>");

// Line icons (24×24, currentColor).
const ICON = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  ext: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path class="solid" d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z"/>',
  star: '<path class="solid" d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  quote: '<path class="solid" d="M4 18v-5.2C4 8.6 6.2 6.2 9.6 5.4l.6 1.5C8.2 7.7 7.3 9 7.2 11H10v7zm9.5 0v-5.2c0-4.2 2.2-6.6 5.6-7.4l.6 1.5c-2 .8-2.9 2.1-3 4.1h2.8v7z"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  speech: '<path d="M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.2 5-5 2.2 2.2-5z"/>',
  cloud: '<path d="M7 18.5h10.2a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.5 3.5 0 0 0 7 18.5z"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18M6.5 6.3h.01M9 6.3h.01"/>',
  bag: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  gears: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.6 12.2l2.4 2.4 4.4-4.8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
};
const SVC_ICON = { "ai-apps": "chip", "ai-chatbot": "speech", "ai-consulting": "compass", "ai-infra": "cloud", wordpress: "browser", shopify: "bag", system: "gears", quality: "shield" };
const CAT_LABEL = { ai: "AI", web: "Web", system: "System" };
const icon = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
const stars = (n = 5) => `<span class="stars" role="img" aria-label="5段階中${n}">${icon("star", "st").repeat(n)}</span>`;

const img = (site, src, base, { alt = "", cls = "", eager = false, sizes = "" } = {}) => {
  const wh = site.size(src);
  return `<img${cls ? ` class="${cls}"` : ""} src="${base}${esc(src)}" alt="${esc(alt)}"${wh ? ` width="${wh[0]}" height="${wh[1]}"` : ""}${sizes ? ` sizes="${sizes}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};

/** The brand: gold 匠 emblem + TAKUMI wordmark. */
const brand = (site, base, sub = "AI &amp; Web Engineering Studio") =>
  `<a class="brand" href="${base}">${
    site.art.emblemSmall
      ? `<img class="mark" src="${base}${esc(site.art.emblemSmall)}" alt="" width="44" height="44">`
      : '<span class="mark mark-text" aria-hidden="true">匠</span>'
  }<span class="brand-text"><span class="brand-name" lang="en">TAKUMI</span><span class="brand-sub" lang="en">${sub}</span></span><span class="sr-only">匠（たくみ）トップへ</span></a>`;

function sameAs(profile) {
  const p = profile.platforms ?? {};
  return [
    profile.lancers?.profile_url,
    isSet(p.zenn) && `https://zenn.dev/${p.zenn}`,
    isSet(p.qiita) && `https://qiita.com/${p.qiita}`,
    isSet(p.note) && `https://note.com/${p.note}`,
    isSet(p.github) && `https://github.com/${p.github}`,
  ].filter(Boolean);
}
const linkLabel = (u) => (/lancers/.test(u) ? "Lancers" : /zenn/.test(u) ? "Zenn" : /qiita/.test(u) ? "Qiita" : /note\.com/.test(u) ? "note" : "GitHub");

function personLd(site) {
  const { profile } = site;
  return {
    "@type": "Person",
    "@id": `${profile.site_url}#person`,
    name: profile.name,
    jobTitle: profile.title,
    url: profile.site_url,
    sameAs: sameAs(profile),
    hasCredential: (profile.certifications ?? []).map((c) => ({ "@type": "EducationalOccupationalCredential", name: c.name })),
  };
}
const crumbLd = (site, list) => ({
  "@type": "BreadcrumbList",
  itemListElement: [["トップ", ""], ...list].map(([name, route], i) => ({ "@type": "ListItem", position: i + 1, name, item: new URL(route, site.profile.site_url).href })),
});

/** /contact/ with optional context (?service=… or ?work=…). */
const contactHref = (base, q = "") => `${base}contact/${q}`;

// ---------- layout ----------

const NAV = [
  ["works/", "Works", "実績"],
  ["services/", "Expertise", "サービス"],
  ["about/", "About", "私について"],
  ["contact/", "Contact", "お問い合わせ"],
];

function layout(site, { route, title, description, body, ld = [], absolute = false, image = null, page = "sub", tone = "dark", head = "" }) {
  const { profile } = site;
  const depth = route.split("/").filter(Boolean).length;
  const base = absolute ? profile.site_url : depth ? "../".repeat(depth) : "./";
  const canonical = new URL(route, profile.site_url).href;
  const shareImage = image ?? "assets/og.jpg";
  const fullTitle = route === "" ? `${profile.brand}｜${profile.title}` : `${title}｜${profile.brand}`;
  const current = (href) => (route !== "" && route.startsWith(href) ? ' aria-current="page"' : "");
  const lancers = esc(profile.contact_url);
  return `<!doctype html>
<html lang="ja" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${route === "" ? "website" : "article"}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(profile.brand)}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${esc(new URL(shareImage, profile.site_url).href)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#081521">
<link rel="icon" href="${base}assets/brand/favicon-64.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="${base}assets/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Noto+Sans+JP:wght@400;500;700&family=Shippori+Mincho:wght@500;600;700&display=swap">
<link rel="stylesheet" href="${base}assets/style.css?v=${site.assetVersion}">
${head}<script>(function (d) { d.classList.replace("no-js", "js"); var off = false; try { off = localStorage.getItem("takumi-motion") === "off"; } catch (e) {} if (off || matchMedia("(prefers-reduced-motion: reduce)").matches) return; d.classList.add("motion"); setTimeout(function () { if (!window.TAKUMI) d.classList.remove("motion"); }, 3000); })(document.documentElement);</script>
<script src="${base}assets/app.js?v=${site.assetVersion}" defer></script>
${ld.length ? jsonld({ "@context": "https://schema.org", "@graph": ld }) : ""}
</head>
<body class="page-${page} hero-${tone}" data-base="${base}" data-v="${site.assetVersion}">
<a class="skip" href="#main">本文へ移動</a>
<header class="hd">
  <div class="hd-in">
    ${brand(site, base)}
    <nav class="nav" aria-label="メインメニュー">
      <ul>
        ${NAV.map(([href, en, ja]) => `<li><a href="${base}${href}"${current(href)}><span lang="en">${en}</span><span class="nav-ja">${ja}</span></a></li>`).join("\n        ")}
      </ul>
    </nav>
    <a class="btn btn-gold btn-sm hd-cta" href="${contactHref(base)}">相談する${icon("arrow")}</a>
    <button class="menu-btn" type="button" aria-controls="menu" aria-expanded="false">${icon("menu")}<span class="sr-only">メニューを開く</span></button>
  </div>
</header>
<div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="メニュー" hidden>
  <div class="menu-in">
    <button class="menu-close" type="button">${icon("close")}<span class="sr-only">メニューを閉じる</span></button>
    <ul class="menu-list">
      <li><a href="${base}"><span lang="en">Home</span><span class="nav-ja">トップ</span></a></li>
      ${NAV.map(([href, en, ja]) => `<li><a href="${base}${href}"${current(href)}><span lang="en">${en}</span><span class="nav-ja">${ja}</span></a></li>`).join("\n      ")}
      <li><a href="${base}prices/"${current("prices/")}><span lang="en">Pricing</span><span class="nav-ja">料金</span></a></li>
      <li><a href="${base}reviews/"${current("reviews/")}><span lang="en">Voices</span><span class="nav-ja">お客さまの声</span></a></li>
    </ul>
    <p><a class="btn btn-gold btn-lg" href="${contactHref(base)}">相談する${icon("arrow")}</a></p>
  </div>
</div>
<main id="main">
${body}
</main>
<footer class="ft">
  <div class="wrap">
    <div class="ft-top">
      <div class="ft-brand">
        ${brand(site, base, "Japanese AI &amp; Web Engineering Studio")}
        <p class="ft-tag">${esc(profile.tagline)}</p>
      </div>
      <nav class="ft-nav" aria-label="サイト内のページ">
        <ul>
          <li><a href="${base}works/">実績</a></li>
          <li><a href="${base}services/">サービス</a></li>
          <li><a href="${base}prices/">料金</a></li>
          <li><a href="${base}reviews/">お客さまの声</a></li>
          <li><a href="${base}about/">私について</a></li>
          <li><a href="${contactHref(base)}">お問い合わせ</a></li>
        </ul>
        <ul>
          ${sameAs(profile).map((u) => `<li>${ext(u, `${linkLabel(u)}${icon("ext", "ic ic-xs")}`)}</li>`).join("\n          ")}
        </ul>
      </nav>
      <div class="ft-alt">
        <p>ランサーズからのご相談も受け付けています。</p>
        <p><a class="btn btn-ghost btn-sm" href="${lancers}">Lancersで相談${icon("ext", "ic ic-xs")}</a></p>
      </div>
    </div>
    <div class="ft-bottom">
      <p>© ${site.today.getFullYear()} ${esc(profile.name)}</p>
      <button class="motion-toggle" type="button" aria-pressed="true">動きを減らす</button>
    </div>
  </div>
</footer>
<dialog class="vmodal" aria-label="紹介動画">
  <button class="vmodal-x" type="button">${icon("close")}<span class="sr-only">閉じる</span></button>
  <video controls playsinline preload="none"></video>
  <p class="vmodal-meta"><span class="vmodal-t"></span></p>
</dialog>
</body>
</html>
`;
}

// ---------- shared blocks ----------

/** Breadcrumbs. */
function crumbs(base, list) {
  return `<nav class="crumbs" aria-label="パンくずリスト"><a href="${base}">ホーム</a>${list
    .map(([href, t]) => `<span aria-hidden="true">›</span>${href ? `<a href="${href}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}`)
    .join("")}</nav>`;
}

/** A hero stage: the scene's still (wide behind the text, narrow below it on phones),
 * which app.js may replace with the live 3D canvas. */
/** A scene's artwork as <picture>: the wide image, and the phone crop below `mq`. */
const artPicture = (a, base, { cls, eager = false, mq = "(max-width: 760px)" }) =>
  `<picture class="${cls}"><source media="${mq}" srcset="${base}${a.narrow}" width="${a.mw}" height="${a.mh}"><img src="${base}${a.wide}" alt="" width="${a.w}" height="${a.h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;

function stage(site, base, { scene, inner, cls = "", tone }) {
  const a = site.art.stage(scene);
  const t = tone ?? a.tone;
  const art = a.wide ? artPicture(a, base, { cls: "stage-art", eager: true }) : `<div class="stage-art stage-art-empty" aria-hidden="true"></div>`;
  return `<section class="stage stage-${t}${cls ? ` ${cls}` : ""}" data-scene="${esc(scene)}"${a.plate ? " data-plate" : ""}>
  ${art}
  <div class="stage-in wrap">
${inner}
  </div>
</section>`;
}

/** Eyebrow (spaced Latin caps with a gold rule) + serif heading + lead. */
function heading(eyebrow, title, { lead = "", tag = "h2", id = "", cls = "" } = {}) {
  return `<header class="sh${cls ? ` ${cls}` : ""}" data-reveal>
      <p class="eyebrow" lang="en">${eyebrow}</p>
      <${tag} class="h2"${id ? ` id="${id}"` : ""}>${title}</${tag}>
      ${lead ? `<p class="sh-lead">${lead}</p>` : ""}
    </header>`;
}
const more = (href, text) => `<a class="more" href="${href}">${text}${icon("arrow")}</a>`;

/** The inquiry band: the gold portal behind a headline and the consultation button. */
function inquiry(site, base, { title = "次の景色を、一緒に。", text = "アイデアの段階でも、まだ整理できていない構想でも大丈夫です。目的と現状を伺い、進め方とお見積もりをご提案します。", query = "", label = "相談する" } = {}) {
  const a = site.art.stage("portal");
  return `<section class="band" aria-labelledby="band-title">
  ${a.wide ? artPicture(a, base, { cls: "band-art" }) : ""}
  <div class="wrap band-in" data-reveal>
    <p class="eyebrow" lang="en">Inquiry</p>
    <h2 class="h2 band-title" id="band-title">${brk(title)}</h2>
    <p class="band-text">${esc(text)}</p>
    <p class="actions"><a class="btn btn-gold btn-lg" href="${contactHref(base, query)}">${esc(label)}${icon("arrow")}</a><a class="link-sub" href="${esc(site.profile.contact_url)}">Lancersで相談する${icon("ext", "ic ic-xs")}</a></p>
  </div>
</section>`;
}

/** Headline numbers from profile.yml (Lancers) and the career start. */
function proofItems(site) {
  const l = site.profile.lancers ?? {};
  return [
    [site.years, "年", "開発歴"],
    [num(l.reviews), "件", "評価すべて「満足」"],
    [num(l.completion_rate), "%", "完了率"],
    [num(l.repeat_clients), "人", "リピーター"],
  ].filter(([v]) => Number.isFinite(v) && v > 0);
}
const proof = (site) =>
  `<ul class="proof">${proofItems(site).map(([v, unit, k]) => `<li><b>${v}<small>${unit}</small></b><span>${esc(k)}</span></li>`).join("")}</ul>
      <p class="fine proof-src">ランサーズの公開プロフィールより（${jaDate(site.profile.lancers?.as_of)}時点）</p>`;

const chips = (xs) => `<ul class="chips">${(xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
const reviewText = (t) => t.quote ?? t.comment ?? "";
const jobName = (t) => t.job.replace(/^【[^】]*】/, "");

function quoteCard(t, { full = false, cls = "", base = "" } = {}) {
  const text = full ? t.comment : reviewText(t);
  return `<figure class="quote${cls ? ` ${cls}` : ""}"${full ? ` id="${esc(t.id)}"` : ""} data-reveal>
        ${icon("quote", "quote-mark")}
        ${text ? `<blockquote><p>${esc(text)}</p></blockquote>` : `<p class="quote-none">（コメントは公開されていません。評価は「満足」です）</p>`}
        <figcaption>${stars()}<span class="quote-job">${esc(jobName(t))}</span><span class="quote-meta">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}${!full && base ? `・<a href="${base}reviews/#${esc(t.id)}">原文</a>` : ""}</span></figcaption>
      </figure>`;
}

function caseItem(c) {
  return `<details class="acc" id="${esc(c.id)}">
      <summary><span class="acc-meta">${esc(c.period)}</span><span class="acc-title">${esc(c.title)}</span></summary>
      <dl class="dl">
        <div><dt>体制</dt><dd>${esc(c.team)}</dd></div>
        <div><dt>担当</dt><dd>${esc(c.role)}</dd></div>
        <div><dt>課題</dt><dd>${esc(c.challenge)}</dd></div>
        <div><dt>取り組み</dt><dd>${esc(c.actions)}</dd></div>
        <div><dt>成果</dt><dd><strong>${esc(c.result)}</strong></dd></div>
        <div><dt>技術</dt><dd>${chips(c.stack)}</dd></div>
      </dl>
    </details>`;
}

const COMMON_FAQ = [
  { q: "秘密保持契約（NDA）は結べますか？", a: "はい、対応しています。ご相談の段階から、お預かりする情報は秘密として扱います。" },
  { q: "打ち合わせはできますか？", a: "はい。メッセージでのやり取りのほか、ビデオ通話での打ち合わせにも対応しています。" },
  { q: "仕様が決まっていなくても相談できますか？", a: "はい。「こんなことは実現できる？」という段階から、目的を伺って一緒に整理します。" },
  { q: "ランサーズから依頼することもできますか？", a: "はい。ランサーズでパッケージを出品しているほか、メッセージからのご相談も受け付けています。" },
];
const faqList = (items) =>
  `<div class="faq">${items.map((f) => `<details class="acc"><summary><span class="acc-q" aria-hidden="true">Q</span><span class="acc-title">${esc(f.q)}</span></summary><p>${esc(f.a)}</p></details>`).join("")}</div>`;
const ldFaq = (items) => ({
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** A gold connector line through numbered steps (drawn as it enters the viewport). */
function steps(list, { cls = "" } = {}) {
  return `<ol class="steps${cls ? ` ${cls}` : ""}" data-draw>
      <li class="steps-line" aria-hidden="true"><svg viewBox="0 0 1000 20" preserveAspectRatio="none"><path d="M0 10 C 250 -6, 500 26, 1000 10"/></svg></li>
      ${list.map((s, i) => `<li class="step" data-reveal><span class="step-no" lang="en">${pad2(i + 1)}</span><span class="step-dot" aria-hidden="true"></span><h3 class="step-title">${esc(s.t)}</h3><p>${esc(s.d)}</p></li>`).join("\n      ")}
    </ol>`;
}

/** A user-controlled film: poster in a frame; plays only when asked. */
function film(site, base, { video, poster, title, cls = "" }) {
  const wh = site.size(poster) ?? [1600, 900];
  return `<figure class="film${cls ? ` ${cls}` : ""}" data-reveal>
      <div class="film-frame" style="--ar:${wh[0]}/${wh[1]}">
        <video controls playsinline preload="none" poster="${base}${esc(poster)}" width="${wh[0]}" height="${wh[1]}" aria-label="${esc(title)}"><source src="${base}${esc(video)}" type="video/mp4"></video>
      </div>
      <figcaption class="film-cap">${esc(title)}</figcaption>
    </figure>`;
}

// ---------- works ----------

const workName = (w) => w.title_;
const workImage = (w) => (w.kindOf === "site" ? w.top : w.cover);
const workLine = (w) => (w.kindOf === "site" ? `公開中のサイト・${w.kind}` : w.headline);

function workCard(site, w, base, { size = "", eager = false } = {}) {
  // The frame takes the picture's own shape, so text inside a cover is never cropped.
  const wh = site.size(workImage(w)) ?? [16, 10];
  return `<li class="wcard${size ? ` wcard-${size}` : ""}" data-cat="${w.cat}" data-reveal>
        <a href="${base}works/${esc(w.id)}/" style="--accent:${esc(w.color ?? "#c9a24a")};--ar:${wh[0]}/${wh[1]}">
          <span class="wcard-media">${img(site, workImage(w), base, { eager })}</span>
          <span class="wcard-body">
            <span class="wcard-top"><span class="wcard-no" lang="en">${w.no}</span><span class="pill" lang="en">${CAT_LABEL[w.cat]}</span></span>
            <span class="wcard-title">${esc(workName(w))}</span>
            <span class="wcard-line">${esc(workLine(w))}</span>
            <span class="wcard-go">${icon("arrow")}</span>
          </span>
        </a>
      </li>`;
}

/** Lancers portfolio text → { context paragraphs, chapters: [{title, html}], stack }. */
function workStory(text) {
  const blocks = String(text ?? "").split(/\n{2,}/);
  const context = [];
  const chapters = [];
  let stack = null;
  for (const block of blocks) {
    const lines = block.split("\n");
    const h = /^【(.+?)】(.*)$/.exec(lines[0]);
    if (h && /評価|掲載画像/.test(h[1])) continue;
    const body = [];
    let list = null;
    const flush = () => {
      if (list) body.push(`<${list.tag}>${list.items.map((x) => `<li>${esc(x)}</li>`).join("")}</${list.tag}>`);
      list = null;
    };
    for (const line of h ? lines.slice(1) : lines) {
      let m;
      if ((m = /^使用技術：(.+)$/.exec(line))) {
        stack = m[1].split("／");
        continue;
      }
      if (/^制作期間：/.test(line) || !line.trim()) continue;
      const item = (m = /^・(.+)$/.exec(line)) ? ["ul", m[1]] : (m = /^\d+\.\s*(.+)$/.exec(line)) ? ["ol", m[1]] : null;
      if (item) {
        if (list?.tag !== item[0]) flush();
        list ??= { tag: item[0], items: [] };
        list.items.push(item[1]);
      } else {
        flush();
        body.push(`<p>${esc(line)}</p>`);
      }
    }
    flush();
    if (!body.length) continue;
    if (h) chapters.push({ title: h[1], note: h[2], html: body.join("\n") });
    else if (chapters.length) chapters[chapters.length - 1].html += `\n${body.join("\n")}`;
    else context.push(body.join("\n"));
  }
  return { context, chapters, stack };
}

// ---------- pages ----------

export function renderIndex(site) {
  const { profile, services, years, works, art } = site;
  const base = "./";
  const description = `${profile.title}の${profile.name}です。開発歴${years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムの開発を、要件の整理から保守まで担当します。`;
  const featured = works.lancers.filter((w) => w.featured);
  const quote = (profile.testimonials ?? []).find((t) => t.featured && reviewText(t));
  const reel = art.showreel;
  const film1 = services.find((s) => s.id === "ai-apps")?.packages[0];
  const half = Math.ceil(services.length / 2);
  const svcItem = (s) =>
    `<li data-reveal><a href="${base}services/${esc(s.id)}/">${icon(SVC_ICON[s.id] ?? "chip", "ic svc-ic")}<span><span class="svc-name">${esc(s.name)}</span><span class="svc-en" lang="en">${esc(s.en)}</span></span></a></li>`;
  const [lead, second] = works.sites;
  const body = `${stage(site, base, {
    scene: "home",
    cls: "stage-home",
    inner: `    <div class="stage-copy">
      <p class="kicker" lang="en">Japanese AI &amp; Web Engineering Studio</p>
      <h1 class="display">想像を、<wbr><em>実装</em>する。</h1>
      <p class="lead">AIとWebで、ビジネスの次の景色へ。<br>ChatGPT・RAGを使った業務アプリから、WordPress・Shopifyのサイト、業務システムまで。要件の整理から納品後の保守まで、ひとりで担当します。</p>
      <p class="actions"><a class="btn btn-ghost btn-lg" href="#selected">実績を見る${icon("arrow")}</a><a class="btn btn-gold btn-lg" href="${contactHref(base)}">相談する${icon("arrow")}</a></p>
    </div>
    ${
      film1?.video
        ? `<button class="stage-film" type="button" data-video="${base}${esc(film1.video)}" data-video-title="${esc(film1.title)}"><span class="stage-film-img">${img(site, film1.cover, base, { alt: `${film1.title}（パッケージ画像）`, eager: true })}</span><span class="stage-film-cap">${icon("play", "ic play-ic")}<span>紹介動画<small>${esc(services[0].name)}</small></span></span></button>`
        : ""
    }
    <div class="stage-proof">${proof(site)}</div>`,
  })}
<section class="ch ch-pearl" id="selected" aria-labelledby="selected-title">
  <div class="wrap">
    ${heading("Selected Work", "実装で、<wbr>成果につなげる。", { id: "selected-title", lead: "開発に参加した公開中のサイトと、ランサーズで評価をいただいた案件から。" })}
    <div class="feature" data-reveal>
      <a class="feature-media" href="${base}works/${esc(lead.id)}/">${img(site, workImage(lead), base, { alt: `${workName(lead)}のトップページ` })}</a>
      <div class="feature-body">
        <p class="pill" lang="en">${CAT_LABEL[lead.cat]}</p>
        <h3 class="h3">${esc(workName(lead))}</h3>
        <p>${esc(lead.summary ?? lead.subtitle ?? "")}</p>
        ${more(`${base}works/${esc(lead.id)}/`, "この実績を見る")}
        ${
          second
            ? `<a class="feature-also" href="${base}works/${esc(second.id)}/"><span class="feature-also-img">${img(site, workImage(second), base)}</span><span><small>もうひとつの公開中のサイト</small>${esc(workName(second))}</span>${icon("arrow")}</a>`
            : ""
        }
      </div>
    </div>
    <ul class="wgrid wgrid-3">
      ${featured.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
    <p class="center">${more(`${base}works/`, `すべての実績（${works.all.length}件）`)}</p>
  </div>
</section>
<section class="ch ch-night expertise" aria-labelledby="expertise-title">
  ${site.art.stage("expertise").wide ? artPicture(site.art.stage("expertise"), base, { cls: "expertise-art", mq: "(max-width: 860px)" }) : ""}
  <div class="wrap">
    ${heading("Expertise", "構想から、<wbr>実装・運用まで。", { id: "expertise-title", lead: "AIとWebの技術で、8つのサービスを提供しています。", cls: "sh-center" })}
    <div class="constellation">
      <ul class="svc-col">${services.slice(0, half).map(svcItem).join("")}</ul>
      <div class="constellation-gap" aria-hidden="true"></div>
      <ul class="svc-col">${services.slice(half).map(svcItem).join("")}</ul>
    </div>
    <p class="center">${more(`${base}services/`, "サービス一覧へ")}</p>
  </div>
</section>
${
  reel
    ? `<section class="ch ch-pearl reel" aria-labelledby="reel-title">
  <div class="wrap">
    ${heading("Showreel", "実装の、<wbr>その先へ。", { id: "reel-title", lead: "サービスの紹介動画をまとめたダイジェストです。再生ボタンを押すと始まります。", cls: "sh-center" })}
    ${film(site, base, { video: reel.video, poster: reel.poster, title: "紹介動画のダイジェスト（音声なし・18秒）", cls: "film-wide" })}
    ${reel.full ? `<p class="center"><button class="link-sub" type="button" data-video="${base}${esc(reel.full)}" data-video-title="${esc(reel.title)}">${icon("play", "ic ic-xs")}音声付きの紹介動画を見る</button></p>` : ""}
  </div>
</section>`
    : ""
}
${
  quote
    ? `<section class="ch ch-mist voice" aria-label="お客さまの声">
  <div class="wrap voice-in" data-reveal>
    ${icon("quote", "voice-mark")}
    <blockquote class="voice-q"><p>${esc(reviewText(quote))}</p></blockquote>
    <p class="voice-src">${stars()}<span>${esc(jobName(quote))}・${jaDate(quote.date)}</span></p>
    <p>${more(`${base}reviews/`, `お客さまの声（${(profile.testimonials ?? []).length}件）を読む`)}</p>
  </div>
</section>`
    : ""
}
${inquiry(site, base)}`;
  const ld = [personLd(site), { "@type": "WebSite", "@id": `${profile.site_url}#website`, url: profile.site_url, name: profile.brand, inLanguage: "ja" }];
  return layout(site, { route: "", title: profile.brand, description, body, ld, page: "home", tone: site.art.stage("home").tone });
}

export function renderWorks(site) {
  const { profile, works } = site;
  const base = "../";
  const description = `${profile.name}の実績。開発に参加した公開中のサイト${works.sites.length}件と、ランサーズで評価をいただいた案件${works.lancers.length}件を紹介します。`;
  const counts = { all: works.all.length };
  for (const w of works.all) counts[w.cat] = (counts[w.cat] ?? 0) + 1;
  // Editorial rhythm: a large card, then two, then three; repeat.
  const sizes = ["lg", "md", "sm", "sm", "sm", "md", "lg", "sm", "sm", "sm"];
  const body = `${stage(site, base, {
    scene: "works",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "実績"]])}
      <p class="kicker" lang="en">Work Index</p>
      <h1 class="display">作品の、<wbr><em>その先</em>へ。</h1>
      <p class="lead">開発に参加した公開中のサイト${works.sites.length}件と、ランサーズで評価をいただいた${works.lancers.length}件。担当した範囲とお客さまの評価をあわせて掲載しています。お客さまの名前は伏せています。</p>
    </div>`,
  })}
<section class="ch ch-pearl gallery" aria-labelledby="gallery-title">
  <div class="filters-bar">
    <div class="wrap filters-in">
      <h2 class="sr-only" id="gallery-title">実績の一覧</h2>
      <div class="filters" role="group" aria-label="分野で絞り込む">
        <button type="button" data-filter="all" aria-pressed="true"><span lang="en">All</span><small>${counts.all}</small></button>
        ${["ai", "web", "system"].map((k) => `<button type="button" data-filter="${k}" aria-pressed="false"><span lang="en">${CAT_LABEL[k]}</span><small>${counts[k] ?? 0}</small></button>`).join("\n        ")}
      </div>
      <p class="filter-count" aria-live="polite">${counts.all}件を表示しています</p>
    </div>
  </div>
  <div class="wrap">
    <ul class="wgrid wgrid-edit">
      ${works.all.map((w, i) => workCard(site, w, base, { size: sizes[i % sizes.length], eager: i < 2 })).join("\n      ")}
    </ul>
    <p class="fine">ランサーズの案件のカバー画像はイメージです（実際の画面ではありません）。公開中のサイトの画面は撮影時点のものです。</p>
  </div>
</section>
${inquiry(site, base, { title: "次の「作品」を、あなたと。", text: "課題の整理から、企画・デザイン・開発・運用まで。目的に合った進め方をご提案します。" })}`;
  return layout(site, { route: "works/", title: "実績", description, body, ld: [personLd(site), crumbLd(site, [["実績", "works/"]])], tone: site.art.stage("works").tone });
}

export function renderWork(site, w) {
  const { profile, works } = site;
  const base = "../../";
  const route = `works/${w.id}/`;
  const i = works.all.indexOf(w);
  const next = works.all[(i + 1) % works.all.length];
  const scene = `work-${w.id}`;
  const serviceLink = w.service ? `<a href="${base}services/${esc(w.service.id)}/">${esc(w.service.name)}</a>` : "";
  const isSite = w.kindOf === "site";
  const story = isSite ? null : workStory(w.body);
  const description = isSite ? `${w.name}（${w.host}）。${w.summary}` : `${w.title}。${w.subtitle}`;
  const meta = isSite
    ? [
        ["サイト", ext(w.url, `${esc(w.host)}${icon("ext", "ic ic-xs")}`)],
        ["種類", esc(w.kind)],
        ["担当", esc(w.role)],
        serviceLink && ["関連するサービス", serviceLink],
      ]
    : [
        w.industry && ["業種", esc(w.industry)],
        ["カテゴリー", esc(w.category)],
        w.days && ["制作期間", `${w.days}日`],
        w.price && ["参考価格", `${yen(w.price)}〜`],
        story.stack && ["使用技術", chips(story.stack)],
        serviceLink && ["関連するサービス", serviceLink],
        ["募集ページ", w.job ? ext(LANCERS_JOB(w.job), `ランサーズで見る${icon("ext", "ic ic-xs")}`) : "非公開のご依頼です"],
      ];
  const media = isSite
    ? `<div class="showcase" data-reveal>
      <figure class="device device-desktop"><span class="device-bar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(w.host)}</span></span><div class="device-scroll" tabindex="0" aria-label="${esc(w.name)}のページ全体（スクロールできます）">${img(site, w.page, base, { alt: `${w.name}のページ全体` })}</div></figure>
      <figure class="device device-phone">${img(site, w.phone, base, { alt: `${w.name}のスマートフォン表示` })}</figure>
    </div>
    <p class="fine center">画面は${jaDate(site.today.toISOString())}に撮影したものです。最新の内容は${ext(w.url, "サイト")}でご確認ください。</p>`
    : `<figure class="hero-media" data-expand>${img(site, w.cover, base, { alt: `${w.headline}（イメージ）`, eager: true })}<figcaption>画像はイメージです（実際の画面ではありません）。</figcaption></figure>`;
  const chapters = isSite
    ? `<div class="chapter" data-reveal><p class="chapter-no" lang="en">01</p><h2 class="h3">サイトについて</h2><p>${esc(w.summary)}</p></div>
      <div class="chapter" data-reveal><p class="chapter-no" lang="en">02</p><h2 class="h3">担当</h2><p>${esc(w.role)}担当した範囲の詳細は、公開できる内容がまとまり次第ここに追記します。</p></div>`
    : story.chapters
        .slice(0, 3)
        .map((c, k) => `<div class="chapter prose" data-reveal><p class="chapter-no" lang="en">${pad2(k + 1)}</p><h2 class="h3">${esc(c.title)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</h2>${c.html}</div>`)
        .join("\n      ");
  const l = profile.lancers ?? {};
  const body = `${stage(site, base, {
    scene,
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[`${base}works/`, "実績"], [null, workName(w)]])}
      <p class="kicker" lang="en">Case Study ${w.no}</p>
      <h1 class="display display-md">${brk(workName(w))}</h1>
      <p class="accent-line" lang="en" style="--accent:${esc(w.color ?? "#c9a24a")}">${esc(w.en ?? "")}</p>
      <p class="lead">${esc(isSite ? w.summary : w.subtitle)}</p>
    </div>`,
  })}
<section class="ch ch-pearl case" aria-label="概要">
  <div class="wrap">
    ${media}
    <div class="case-grid">
      <div class="case-context" data-reveal>
        <p class="eyebrow" lang="en">Context</p>
        <h2 class="h2">${esc(isSite ? w.name : w.headline)}</h2>
        ${isSite ? `<p>${esc(w.summary)}</p>` : story.context.join("\n") || `<p>${esc(w.title)}</p>`}
      </div>
      <dl class="meta" data-reveal>
        ${meta.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("\n        ")}
      </dl>
    </div>
  </div>
</section>
<section class="ch ch-white chapters" aria-label="取り組み">
  <div class="wrap chapters-in">
      ${chapters}
  </div>
</section>
${
  isSite
    ? ""
    : `<section class="ch ch-mist" aria-labelledby="review-title">
  <div class="wrap narrow">
    ${heading("Client Voice", "お客さまの評価", { id: "review-title" })}
    ${w.reviews
      .map(
        (t) => `<figure class="quote quote-wide" data-reveal>
      ${icon("quote", "quote-mark")}
      ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="quote-none">（コメントは公開されていません。評価は「満足」です）</p>`}
      <figcaption>${stars()}<span class="quote-job">${esc(t.job)}</span><span class="quote-meta">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}・<a href="${base}reviews/#${esc(t.id)}">評価一覧で見る</a></span></figcaption>
    </figure>`,
      )
      .join("\n    ")}
    <p class="fine">評価は${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}で確認できます。</p>
  </div>
</section>`
}
<nav class="next" aria-label="次の実績">
  <a class="next-in" href="${base}works/${esc(next.id)}/">
    <span class="next-media">${img(site, workImage(next), base)}</span>
    <span class="next-body"><span class="eyebrow" lang="en">Next Project</span><span class="next-title">${esc(workName(next))}</span><span class="next-line">${esc(workLine(next))}</span>${icon("arrow", "ic next-ic")}</span>
  </a>
</nav>
${inquiry(site, base, { title: "このような開発のご相談", text: "似た課題をお持ちでしたら、まずは現状をお聞かせください。進め方とお見積もりをご提案します。", query: `?work=${encodeURIComponent(w.id)}` })}`;
  const ld = [
    personLd(site),
    { "@type": "CreativeWork", name: workName(w), description, url: new URL(route, profile.site_url).href, ...(isSite && { sameAs: w.url }), creator: { "@id": `${profile.site_url}#person` }, inLanguage: "ja" },
    crumbLd(site, [["実績", "works/"], [workName(w), route]]),
  ];
  return layout(site, { route, title: workName(w), description, body, ld, image: workImage(w), tone: site.art.stage(scene).tone });
}

export function renderServices(site) {
  const { profile, services } = site;
  const base = "../";
  const description = `${profile.name}が提供する8つのサービス。生成AIアプリ、AIチャットボット、AI導入コンサルティング、クラウド基盤、WordPress、Shopify、業務システム、品質・セキュリティ。`;
  const body = `${stage(site, base, {
    scene: "services",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "サービス"]])}
      <p class="kicker" lang="en">Services Index</p>
      <h1 class="display">可能性を、<wbr><em>かたち</em>に。</h1>
      <p class="lead">AI、クラウド、Webサイト、業務システム、そして品質とセキュリティまで。構想から実装・運用まで、8つのサービスでお手伝いします。</p>
    </div>`,
  })}
<section class="ch ch-pearl" aria-labelledby="svc-title">
  <div class="wrap">
    ${heading("Our Services", "提供する8つのサービス", { id: "svc-title", cls: "sh-center" })}
    <ul class="svc-grid">
      ${services
        .map(
          (s, i) => `<li class="svc-card svc-card-${i % 4 === 0 || i % 4 === 3 ? "light" : "dark"}" style="--accent:${esc(s.accent)}" data-reveal>
        <div class="svc-media">${s.cover ? img(site, s.cover, base, { alt: `${s.packages[0]?.title ?? s.name}（パッケージ画像）` }) : ""}${s.video ? `<button class="play-ring" type="button" data-video="${base}${esc(s.video.video)}" data-video-title="${esc(s.video.title)}">${icon("play")}<span class="sr-only">${esc(s.name)}の紹介動画を再生</span></button>` : ""}</div>
        <div class="svc-body">
          <p class="svc-no" lang="en">${s.no}</p>
          <h3 class="svc-card-en" lang="en">${esc(s.en)}</h3>
          <p class="svc-card-name">${esc(s.name)}</p>
          <p class="svc-card-sum">${esc(s.summary)}</p>
          <p class="svc-card-foot"><span>${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"}</span><a class="btn btn-ghost btn-sm" href="${base}services/${esc(s.id)}/">詳細を見る${icon("arrow")}<span class="sr-only">（${esc(s.name)}）</span></a></p>
        </div>
      </li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>
<section class="ch ch-mist" aria-labelledby="find-title">
  <div class="wrap two-cards">
    <div class="card-soft" data-reveal>
      <p class="eyebrow" lang="en">Service Discovery</p>
      <h2 class="h3" id="find-title">目的から、サービスを選ぶ</h2>
      <ul class="finder">
        <li><a href="${base}services/ai-consulting/">AIを使いたいが、何から始めればいいか分からない${icon("arrow")}</a></li>
        <li><a href="${base}services/ai-chatbot/">社内の資料に答えるAIがほしい${icon("arrow")}</a></li>
        <li><a href="${base}services/wordpress/">自分たちで更新できるサイトにしたい${icon("arrow")}</a></li>
        <li><a href="${base}services/system/">Excelや紙の管理を、システムにしたい${icon("arrow")}</a></li>
        <li><a href="${base}services/quality/">引き継いだシステムの不具合を直したい${icon("arrow")}</a></li>
      </ul>
      <p>${more(`${base}prices/`, "料金と進め方を見る")}</p>
    </div>
    <div class="card-night" data-reveal>
      <p class="eyebrow" lang="en">Inquiry</p>
      <h2 class="h3">まずはご相談ください</h2>
      <p>やりたいこと、課題、構想の段階でも構いません。目的に合った進め方をご提案します。</p>
      <p><a class="btn btn-gold" href="${contactHref(base)}">相談する${icon("arrow")}</a></p>
    </div>
  </div>
</section>`;
  return layout(site, { route: "services/", title: "サービス", description, body, ld: [personLd(site), crumbLd(site, [["サービス", "services/"]])], tone: site.art.stage("services").tone });
}

export function renderService(site, s) {
  const { profile, services } = site;
  const base = "../../";
  const route = `services/${s.id}/`;
  const url = new URL(route, profile.site_url).href;
  const scene = `svc-${s.id}`;
  const related = site.works.all.filter((w) => w.service?.id === s.id);
  const faq = [...s.faq, ...COMMON_FAQ];
  const q = `?service=${encodeURIComponent(s.id)}`;
  const body = `${stage(site, base, {
    scene,
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[`${base}services/`, "サービス"], [null, s.name]])}
      <p class="kicker" lang="en" style="--accent:${esc(s.accent)}">${esc(s.en)}</p>
      <h1 class="display display-md">${brk(s.headline)}</h1>
      <p class="lead">${esc(s.lead)}</p>
      <p class="actions"><a class="btn btn-gold btn-lg" href="${contactHref(base, q)}">相談する${icon("arrow")}</a>${s.packages.length ? `<a class="btn btn-ghost btn-lg" href="#price">料金を見る</a>` : ""}</p>
    </div>`,
  })}
<section class="ch ch-pearl" aria-labelledby="intro-title">
  <div class="wrap intro">
    <div data-reveal>
      <p class="eyebrow" lang="en">Service ${s.no}</p>
      <h2 class="h2" id="intro-title">${esc(s.name)}</h2>
      <p class="intro-text">${esc(s.description)}</p>
      ${s.approach.map((p) => `<p>${esc(p)}</p>`).join("")}
    </div>
    ${
      s.problems.length
        ? `<div class="problems" data-reveal>
      <h3 class="problems-title">こんな課題に</h3>
      <ul>${s.problems.map((p) => `<li>${icon("check")}${esc(p)}</li>`).join("")}</ul>
    </div>`
        : ""
    }
  </div>
</section>
${
  s.video
    ? `<section class="ch ch-white" aria-labelledby="film-title">
  <div class="wrap narrow-wide">
    ${heading("Service Film", "紹介動画", { id: "film-title", lead: "再生ボタンを押すと始まります（音声あり）。", cls: "sh-center" })}
    ${film(site, base, { video: s.video.video, poster: s.video.cover ?? s.cover, title: s.video.title, cls: "film-corner" })}
  </div>
</section>`
    : ""
}
<section class="ch ch-night scope" style="--accent:${esc(s.accent)}" aria-labelledby="scope-title">
  <div class="wrap">
    ${heading("Capabilities", "できること", { id: "scope-title" })}
    <ul class="scope-grid">
      ${s.scope.map((x, i) => `<li data-reveal><span class="scope-no" lang="en">${pad2(i + 1)}</span>${esc(x)}</li>`).join("\n      ")}
    </ul>
    ${s.scopeNote.map((p) => `<p class="scope-note">${esc(p)}</p>`).join("")}
  </div>
</section>
${
  s.process.length
    ? `<section class="ch ch-pearl" aria-labelledby="process-title">
  <div class="wrap">
    ${heading("Process", "進め方", { id: "process-title" })}
    ${steps(s.process)}
    ${
      s.deliverables.length
        ? `<div class="deliver" data-reveal><h3 class="deliver-title">主な成果物</h3><ul>${s.deliverables.map((d) => `<li>${icon("doc")}${esc(d)}</li>`).join("")}</ul><p class="fine">内容はご依頼の範囲によって変わります。</p></div>`
        : ""
    }
  </div>
</section>`
    : ""
}
${
  s.packages.length
    ? `<section class="ch ch-white" id="price" aria-labelledby="price-title">
  <div class="wrap">
    ${heading("Packages", "料金の目安", { id: "price-title", lead: `ランサーズで出品しているパッケージの料金です（${jaDate(profile.lancers?.as_of)}時点）。内容に合わせた個別のお見積もりもできます。` })}
    ${s.packages
      .map(
        (p) => `<article class="pkg" data-reveal>
      <div class="pkg-media">${p.cover ? img(site, p.cover, base, { alt: `${p.title}（パッケージ画像）` }) : ""}${p.video ? `<button class="play-ring" type="button" data-video="${base}${esc(p.video)}" data-video-title="${esc(p.title)}">${icon("play")}<span class="sr-only">紹介動画を再生</span></button>` : ""}</div>
      <div class="pkg-body">
        <h3 class="pkg-title">${ext(p.url, `${esc(p.title)}${icon("ext", "ic ic-xs")}`)}</h3>
        <ul class="plans">
          ${p.plans.map((x) => `<li><span class="plan-name">${esc(x.name)}</span><span class="plan-price">${yen(x.price)}</span><span class="plan-days">${x.days ? `納期の目安 ${x.days}日` : ""}</span>${x.desc ? `<span class="plan-desc">${esc(x.desc)}</span>` : ""}</li>`).join("\n          ")}
        </ul>
      </div>
    </article>`,
      )
      .join("\n    ")}
  </div>
</section>`
    : ""
}
${
  related.length
    ? `<section class="ch ch-pearl" aria-labelledby="rel-title">
  <div class="wrap">
    ${heading("Works", "このサービスの実績", { id: "rel-title" })}
    <ul class="wgrid wgrid-3">
      ${related.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
${
  s.testimonials.some(reviewText)
    ? `<section class="ch ch-mist" aria-labelledby="voice-title">
  <div class="wrap">
    ${heading("Client Voice", "お客さまの声", { id: "voice-title" })}
    <div class="quotes">
      ${s.testimonials.filter(reviewText).map((t) => quoteCard(t, { base })).join("\n      ")}
    </div>
  </div>
</section>`
    : ""
}
${
  s.cases.length
    ? `<section class="ch ch-white" aria-labelledby="cases-title">
  <div class="wrap narrow">
    ${heading("Background", "関連する開発経験", { id: "cases-title", lead: "ランサーズを始める前から担当してきたプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です）。" })}
    <div class="acc-list">
    ${s.cases.map(caseItem).join("\n    ")}
    </div>
  </div>
</section>`
    : ""
}
<section class="ch ch-pearl" aria-labelledby="faq-title">
  <div class="wrap narrow">
    ${heading("FAQ", "よくある質問", { id: "faq-title" })}
    ${faqList(faq)}
  </div>
</section>
<nav class="ch ch-white others" aria-label="ほかのサービス">
  <div class="wrap">
    <p class="eyebrow" lang="en">Other Services</p>
    <ul class="links">
      ${services.filter((o) => o.id !== s.id).map((o) => `<li><a href="${base}services/${esc(o.id)}/">${icon(SVC_ICON[o.id] ?? "chip", "ic svc-ic")}<span>${esc(o.name)}</span>${icon("arrow")}</a></li>`).join("\n      ")}
    </ul>
  </div>
</nav>
${inquiry(site, base, { title: `${s.name}のご相談`, text: "目的と現状を伺い、進め方とお見積もりをご提案します。仕様が決まっていない段階でも大丈夫です。", query: q })}`;
  const ld = [
    personLd(site),
    {
      "@type": "Service",
      "@id": `${url}#service`,
      name: s.name,
      description: s.description,
      url,
      provider: { "@id": `${profile.site_url}#person` },
      areaServed: "JP",
      ...(s.priceFrom && { offers: { "@type": "AggregateOffer", priceCurrency: "JPY", lowPrice: s.priceFrom, url: s.packages[0]?.url } }),
    },
    ldFaq(faq),
    crumbLd(site, [["サービス", "services/"], [s.name, route]]),
  ];
  return layout(site, { route, title: s.name, description: s.description, body, ld, image: s.cover, tone: site.art.stage(scene).tone });
}

// The technologies, grouped. Everything here appears in profile.yml (projects, certifications) or works.yml.
const STACK = [
  ["AI・LLM", ["OpenAI API", "ChatGPT", "RAG", "LangChain", "ベクトル検索", "AIエージェント"]],
  ["Backend", ["Python", "FastAPI", "Django", "Node.js", "TypeScript", "PHP"]],
  ["Frontend", ["React", "Next.js", "JavaScript", "HTML / CSS"]],
  ["CMS・EC", ["WordPress", "Elementor", "Shopify"]],
  ["Cloud・Infra", ["AWS", "Azure", "Google Cloud", "Firebase", "Docker", "Kubernetes", "Terraform"]],
  ["Data・Security", ["PostgreSQL", "MySQL", "Elasticsearch", "OAuth 2.0", "OWASP"]],
];

export function renderAbout(site) {
  const { profile } = site;
  const base = "../";
  const l = profile.lancers ?? {};
  const f = profile.facts ?? {};
  const cases = profile.cases ?? [];
  const description = `${profile.title}、${profile.name}のプロフィール。開発歴${site.years}年、これまでの歩み、保有資格、大切にしていること。`;
  const body = `${stage(site, base, {
    scene: "about",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "私について"]])}
      <p class="kicker" lang="en">About</p>
      <h1 class="display">技術に、<wbr><em>美意識</em>を。</h1>
      <p class="lead">${esc(profile.tagline)}<br>「匠（たくみ）」の名前で活動する、フリーランスのAI・Webエンジニアです。</p>
    </div>`,
  })}
<section class="ch ch-pearl bio" aria-labelledby="bio-title">
  <div class="wrap bio-in">
    <div data-reveal>
      <p class="eyebrow" lang="en">Biography</p>
      <h2 class="bio-motto" id="bio-title">考える。<br>つくる。<br>磨き続ける。</h2>
    </div>
    <div class="prose" data-reveal>
      ${site.aboutHtml}
      <dl class="meta meta-inline">
        <div><dt>開発歴</dt><dd>${site.years}年</dd></div>
        ${f.work_style ? `<div><dt>働き方</dt><dd>${esc(f.work_style)}</dd></div>` : ""}
        ${f.nda ? `<div><dt>NDA</dt><dd>${esc(f.nda)}</dd></div>` : ""}
        ${l.rank ? `<div><dt>ランサーズ</dt><dd>${esc(l.rank)}</dd></div>` : ""}
        ${(l.verified ?? []).length ? `<div><dt>確認済み</dt><dd>${esc(l.verified.join("・"))}</dd></div>` : ""}
      </dl>
    </div>
  </div>
</section>
<section class="ch ch-night manifesto" aria-labelledby="values-title">
  <div class="wrap">
    ${heading("Craft Manifesto", "大切にしていること", { id: "values-title" })}
    <ol class="values">
      ${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="values-no" lang="en">${pad2(i + 1)}</span><span>${esc(v)}</span></li>`).join("\n      ")}
    </ol>
  </div>
</section>
${
  cases.length
    ? `<section class="ch ch-mist journey" aria-labelledby="journey-title">
  <div class="wrap">
    ${heading("Experience", "これまでの歩み", { id: "journey-title", lead: "ランサーズを始める前から担当してきた主なプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です。お客さまの名前は伏せています）。" })}
    <ol class="timeline">
      ${cases.map((c) => `<li data-reveal><span class="timeline-stone" aria-hidden="true"></span>${caseItem(c)}</li>`).join("\n      ")}
      ${l.joined ? `<li data-reveal><span class="timeline-stone" aria-hidden="true"></span><div class="acc acc-static"><span class="acc-meta">${dotDate(l.joined)} –</span><span class="acc-title">ランサーズで活動を開始（${esc(l.rank ?? "")}・評価${esc(String(l.reviews ?? "").replace(/（.*$/, ""))}）</span></div></li>` : ""}
    </ol>
  </div>
</section>`
    : ""
}
<section class="ch ch-pearl stackch" aria-labelledby="stack-title">
  <div class="wrap two">
    <div>
      ${heading("Tools &amp; Technology", "ものづくりを支える、<wbr>技術の星座", { id: "stack-title" })}
      <dl class="stack">
        ${STACK.map(([k, xs]) => `<div data-reveal><dt lang="en">${esc(k)}</dt><dd>${chips(xs)}</dd></div>`).join("\n        ")}
      </dl>
    </div>
    <div>
      ${heading("Credentials", "保有資格")}
      <ul class="certs">
        ${(profile.certifications ?? []).map((c) => `<li><time datetime="${esc(c.date)}">${dotDate(c.date)}</time>${esc(c.name)}</li>`).join("\n        ")}
      </ul>
    </div>
  </div>
</section>
${inquiry(site, base, { title: "一緒に、価値あるものをつくりませんか。", text: "ご相談・ご依頼・ご質問など、お気軽にお問い合わせください。" })}`;
  return layout(site, { route: "about/", title: "私について", description, body, ld: [personLd(site), crumbLd(site, [["私について", "about/"]])], tone: site.art.stage("about").tone });
}

export function renderPrices(site) {
  const { profile, services } = site;
  const base = "../";
  const n = site.packages.length;
  const description = `${profile.name}の料金と進め方。相談・検証から設計・開発、運用・改善まで。ランサーズで出品している${n}のパッケージの料金と納期の一覧です。`;
  const from = (ids) => {
    const xs = site.packages.filter((p) => ids.includes(p.id)).map((p) => p.minPrice).filter(Number.isFinite);
    return xs.length ? Math.min(...xs) : null;
  };
  const svcPk = (ids) => services.filter((s) => ids.includes(s.id)).flatMap((s) => s.packages.map((p) => p.id));
  const tiers = [
    { no: "01", t: "相談・検証", d: "課題の整理と打ち手の検討を通じて、取り組むべきテーマと実現性を見極めます。", price: from(svcPk(["ai-consulting"])), href: "services/ai-consulting/" },
    { no: "02", t: "設計・開発", d: "要件定義から設計・実装・検証まで。業務やシステムに合った仕組みを作ります。", price: from(svcPk(["ai-apps", "ai-chatbot", "wordpress", "shopify", "system"])), href: "services/" },
    { no: "03", t: "運用・改善", d: "公開後の保守や不具合の調査・修正、サーバー移行など、使い続けるための支援です。", price: from(svcPk(["quality", "ai-infra"])), href: "services/quality/" },
  ];
  const rows = [
    ["課題のヒアリング・現状の整理", [1, 1, 1]],
    ["方針・進め方のご提案", [1, 1, 1]],
    ["要件定義・設計", [0, 1, 1]],
    ["実装・構築・テスト", [0, 1, 1]],
    ["導入・引き継ぎ（手順書など）", [0, 1, 1]],
    ["保守・不具合対応・改善", [0, 0, 1]],
  ];
  let group;
  const pkRows = site.packages.map((p) => {
    const h = p.service !== group ? `<tr class="grp"><th colspan="3" scope="colgroup">${p.service ? `<a href="../services/${esc(p.service.id)}/">${esc(p.service.name)}</a>` : "そのほか"}</th></tr>` : "";
    group = p.service;
    return `${h}<tr><th scope="row">${ext(p.url, esc(p.title))}</th><td class="num" data-label="料金">${range(p.minPrice, p.maxPrice, yen)}</td><td class="num" data-label="納期の目安">${range(p.minDays, p.maxDays, (d) => `${d}日`)}</td></tr>`;
  });
  const faq = [
    { q: "パッケージにない内容も相談できますか？", a: "はい。内容に合わせて、個別にお見積もりします。" },
    { q: "どのプランを選べばいいか分かりません。", a: "目的と現状を伺ったうえで、合ったプランや進め方をご提案します。" },
    ...COMMON_FAQ,
  ];
  const body = `${stage(site, base, {
    scene: "pricing",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "料金"]])}
      <p class="kicker" lang="en">Pricing</p>
      <h1 class="display">小さく始めて、<wbr><em>大きく</em>育てる。</h1>
      <p class="lead">いきなり大きな投資は必要ありません。まずは課題の見極めと検証から。確かめながら、段階的に広げていく進め方をおすすめしています。</p>
    </div>`,
  })}
<section class="ch ch-pearl" aria-labelledby="eng-title">
  <div class="wrap">
    ${heading("Engagement", "3つの関わり方", { id: "eng-title", lead: "フェーズに合わせて、必要な支援を必要なだけご提供します。料金は内容に合わせて個別にお見積もりします。", cls: "sh-center" })}
    <ol class="tiers">
      ${tiers
        .map(
          (t, i) => `<li class="tier" data-reveal style="--rise:${i}">
        <span class="tier-no" lang="en">${t.no}</span>
        <h3 class="h3">${t.t}</h3>
        <p>${t.d}</p>
        <p class="tier-price">${t.price ? `パッケージ ${yen(t.price)}〜` : "個別お見積もり"}</p>
        <a class="more" href="${base}${t.href}">関連するサービス${icon("arrow")}</a>
      </li>`,
        )
        .join("\n      ")}
    </ol>
    <div class="compare" data-reveal>
      <h3 class="h3 compare-title">支援内容の比較</h3>
      <table class="matrix">
        <thead><tr><th scope="col">主な支援内容</th>${tiers.map((t) => `<th scope="col">${t.t}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map(([k, v]) => `<tr><th scope="row">${k}</th>${v.map((x, i) => `<td data-label="${tiers[i].t}">${x ? `<span class="dot" role="img" aria-label="対応"></span>` : `<span class="dash" role="img" aria-label="対象外">—</span>`}</td>`).join("")}</tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
  </div>
</section>
<section class="ch ch-mist" aria-labelledby="plan-title">
  <div class="wrap">
    ${heading("Scope Planning", "プロジェクトの進め方", { id: "plan-title", lead: "課題や目的に合わせて範囲と体制を決め、段階的に積み上げていきます。" })}
    ${steps([
      { t: "課題の整理", d: "現状と目指す姿を整理し、取り組むテーマを決めます。" },
      { t: "スコープ設計", d: "検証の内容・成果物・進め方を決め、計画にします。" },
      { t: "実行・検証", d: "設計・開発・テストを通じて、解決策を確かめます。" },
      { t: "展開・拡張", d: "運用と改善を重ね、対象の業務や機能を広げます。" },
    ])}
  </div>
</section>
<section class="ch ch-white" id="packages" aria-labelledby="pk-title">
  <div class="wrap">
    ${heading("Packages", "パッケージ料金", { id: "pk-title", lead: `ランサーズで出品している${n}のパッケージです（${jaDate(profile.lancers?.as_of)}時点）。ベーシック・スタンダード・プレミアムの3プランから選べます。` })}
    <div class="table-scroll" data-reveal><table class="table table-prices">
      <thead><tr><th scope="col">パッケージ</th><th scope="col">料金</th><th scope="col">納期の目安</th></tr></thead>
      <tbody>
        ${pkRows.join("\n        ")}
      </tbody>
    </table></div>
    <p class="fine">パッケージ名を押すと、ランサーズで各プランの内容を確認できます。</p>
  </div>
</section>
<section class="ch ch-night slogan" aria-label="ご提案">
  <div class="wrap center" data-reveal>
    <h2 class="h2">必要なものを、<wbr>必要なだけ。</h2>
    <p>目的や状況に合わせて、支援の内容と体制をご提案します。まずは現在の課題や構想をお聞かせください。</p>
    <p><a class="btn btn-gold btn-lg" href="${contactHref(base, "?topic=estimate")}">提案・お見積もりを相談する${icon("arrow")}</a></p>
  </div>
</section>
<section class="ch ch-pearl" aria-labelledby="faq-title">
  <div class="wrap narrow">
    ${heading("FAQ", "よくあるご質問", { id: "faq-title" })}
    ${faqList(faq)}
  </div>
</section>`;
  return layout(site, { route: "prices/", title: "料金", description, body, ld: [personLd(site), ldFaq(faq), crumbLd(site, [["料金", "prices/"]])], tone: site.art.stage("pricing").tone });
}

export function renderReviews(site) {
  const { profile } = site;
  const base = "../";
  const list = profile.testimonials ?? [];
  const l = profile.lancers ?? {};
  const workOf = new Map(site.works.lancers.flatMap((w) => w.reviews.map((t) => [t.id, w])));
  const featured = list.find((t) => t.id === "lancers-5413213") ?? list.find((t) => t.featured);
  const values = profile.values ?? [];
  const description = `${profile.name}がランサーズでいただいた評価${list.length}件を、原文のまま掲載しています。`;
  const body = `${stage(site, base, {
    scene: "reviews",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "お客さまの声"]])}
      <p class="kicker" lang="en">Client Voices</p>
      <h1 class="display">信頼は、<wbr><em>仕事のあと</em>に残る。</h1>
      <p class="lead">ランサーズでいただいた評価${list.length}件は、すべて「満足」です。案件名と日付を添えて、原文のまま掲載しています。</p>
    </div>`,
  })}
<section class="ch ch-pearl" aria-labelledby="rv-title">
  <div class="wrap">
    <p class="value-line" data-reveal>いただいた声は、これからの仕事を<wbr>さらに良くするための道しるべです。</p>
    ${
      featured
        ? `<figure class="quote-hero" data-reveal>
      ${icon("quote", "quote-mark")}
      <blockquote><p>${esc(featured.comment)}</p></blockquote>
      <figcaption>${stars()}<span class="quote-job">${esc(featured.job)}</span><span class="quote-meta">${jaDate(featured.date)}${featured.repeat ? `・${esc(featured.repeat)}` : ""}</span></figcaption>
    </figure>`
        : ""
    }
    <h2 class="sr-only" id="rv-title">いただいた評価（新しい順）</h2>
    <div class="reviews" data-more="9">
      ${list
        .map((t) => {
          const w = workOf.get(t.id);
          return `<figure class="quote quote-full${t.comment ? "" : " quote-quiet"}" id="${esc(t.id)}">
        ${icon("quote", "quote-mark")}
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="quote-none">（コメントは公開されていません。評価は「満足」です）</p>`}
        <figcaption>${stars()}<span class="quote-job">${esc(t.job)}</span><span class="quote-meta">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
        ${w ? `<p class="quote-link"><a href="${base}works/${esc(w.id)}/">この案件の実績：${esc(workName(w))}${icon("arrow", "ic ic-xs")}</a></p>` : ""}
      </figure>`;
        })
        .join("\n      ")}
    </div>
  </div>
</section>
<section class="ch ch-mist dialog" aria-labelledby="dlg-title">
  <div class="wrap">
    ${heading("Our Communication", "対話から、<wbr>品質が生まれる。", { id: "dlg-title", lead: "ご依頼の前後を通じた、ていねいな対話を大切にしています。" })}
    <ul class="bubbles">
      ${values.slice(0, 3).map((v, i) => `<li data-reveal style="--i:${i}">${icon(["speech", "gears", "shield"][i], "ic bubble-ic")}<span>${esc(v)}</span></li>`).join("\n      ")}
    </ul>
    <div class="feedback" data-reveal>
      <h3 class="h3">ご意見を、次の改善へ。</h3>
      <p>納品後のご意見やご要望も、改善の機会として大切にしています。評価はランサーズでも確認できます。</p>
      <p>${ext(l.reviews_url ?? l.profile_url, `Lancersで評価を見る${icon("ext", "ic ic-xs")}`, "btn btn-ghost")}</p>
    </div>
  </div>
</section>
${inquiry(site, base, { title: "ご相談からでも、お気軽に。", text: "ご要望の整理や、どのような進め方がよいかのご相談だけでも歓迎です。" })}`;
  return layout(site, { route: "reviews/", title: "お客さまの声", description, body, ld: [personLd(site), crumbLd(site, [["お客さまの声", "reviews/"]])], tone: site.art.stage("reviews").tone });
}

export function renderContact(site) {
  const { profile, services, works } = site;
  const base = "../";
  const endpoint = profile.contact_form?.endpoint ?? "";
  const description = `${profile.name}へのお問い合わせ。AI開発・Web制作・システム開発のご相談を、このページのフォームから受け付けています。`;
  const form = renderInquiryForm
    ? renderInquiryForm({ endpoint, lancersUrl: profile.contact_url, services, works: works.all, base })
    : `<p class="fine">フォームを準備しています。<a href="${esc(profile.contact_url)}">Lancersからご相談ください。</a></p>`;
  const css = fs.existsSync(new URL("../../site/assets/contact.css", import.meta.url)) ? `<link rel="stylesheet" href="${base}assets/contact.css?v=${site.assetVersion}">\n` : "";
  const js = fs.existsSync(new URL("../../site/assets/contact.js", import.meta.url)) ? `<script src="${base}assets/contact.js?v=${site.assetVersion}" defer></script>\n` : "";
  const body = `${stage(site, base, {
    scene: "contact",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "お問い合わせ"]])}
      <p class="kicker" lang="en">Contact</p>
      <h1 class="display">まだ、言葉にならない<wbr><em>構想</em>から。</h1>
      <p class="lead">AI開発・Web制作・システム開発のご相談を受け付けています。まずはお気軽にお聞かせください。</p>
    </div>`,
  })}
<section class="ch ch-pearl inq-sec" aria-label="お問い合わせフォーム">
  <div class="wrap">
${form}
  </div>
</section>`;
  return layout(site, { route: "contact/", title: "お問い合わせ", description, body, ld: [personLd(site), crumbLd(site, [["お問い合わせ", "contact/"]])], tone: site.art.stage("contact").tone, head: css + js, page: "contact" });
}

export function render404(site) {
  const root = site.profile.site_url;
  const body = `<section class="stage stage-dark stage-plain">
  <div class="stage-in wrap">
    <div class="stage-copy">
      <p class="kicker" lang="en">404</p>
      <h1 class="display display-md">ページが見つかりません</h1>
      <p class="lead">URLが変わったか、ページが削除された可能性があります。</p>
      <p class="actions"><a class="btn btn-gold btn-lg" href="${esc(root)}">トップへ戻る</a><a class="btn btn-ghost btn-lg" href="${esc(new URL("works/", root).href)}">実績を見る</a></p>
    </div>
  </div>
</section>`;
  return layout(site, { route: "404.html", title: "ページが見つかりません", description: "ページが見つかりません。", body, absolute: true });
}

export function renderLlmsTxt(site) {
  const { profile, services, works } = site;
  return join([
    `# ${profile.brand}`,
    "",
    `> ${profile.title}の${profile.name}。開発歴${site.years}年。AI（ChatGPT・RAG・AIエージェント）とWeb・業務システムの開発を、要件の整理から保守まで担当。ご相談: ${new URL("contact/", profile.site_url).href}（ランサーズ: ${profile.contact_url}）`,
    "",
    "## サービス",
    ...services.map((s) => `- [${s.name}](${new URL(`services/${s.id}/`, profile.site_url).href}): ${s.summary}${s.priceFrom ? `（${yen(s.priceFrom)}〜）` : ""}`),
    "",
    "## 実績",
    ...works.all.map((w) => `- [${workName(w)}](${new URL(`works/${w.id}/`, profile.site_url).href}): ${w.kindOf === "site" ? `${w.url} ${w.role}` : `${w.title}（ランサーズ・評価${w.reviews.length}件）`}`),
    "",
    "## ほか",
    `- [料金（${site.packages.length}パッケージ）](${new URL("prices/", profile.site_url).href})`,
    `- [お客さまの声（${(profile.testimonials ?? []).length}件）](${new URL("reviews/", profile.site_url).href})`,
    `- [私について](${new URL("about/", profile.site_url).href})`,
    `- [お問い合わせ](${new URL("contact/", profile.site_url).href})`,
    ...sameAs(profile).map((u) => `- ${u}`),
    "",
  ]);
}

export function renderGithubReadme(site) {
  const { profile, services } = site;
  const p = profile.platforms ?? {};
  const l = profile.lancers ?? {};
  const url = (r) => new URL(r, profile.site_url).href;
  return join([
    `# ${profile.name}｜${profile.brand.replace(/^.*?｜/, "")}`,
    "",
    `${profile.title}。開発歴${site.years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムを、要件の整理から保守まで担当しています。`,
    "",
    `- 🌐 ポートフォリオ: ${profile.site_url}`,
    `- 🗂 実績（${site.works.all.length}件）: ${url("works/")}`,
    `- ⭐ お客さまの声（${(profile.testimonials ?? []).length}件）: ${url("reviews/")}`,
    `- 💬 お仕事のご相談: ${url("contact/")}（[ランサーズ](${l.profile_url ?? profile.contact_url})からも。${[l.rank, l.reviews && `評価${l.reviews.replace(/（.*$/, "")}すべて満足`].filter(Boolean).join("・")}）`,
    isSet(p.zenn) && `- ✍️ Zenn: https://zenn.dev/${p.zenn}`,
    isSet(p.qiita) && `- ✍️ Qiita: https://qiita.com/${p.qiita}`,
    isSet(p.note) && `- ✍️ note: https://note.com/${p.note}`,
    "",
    "## できること",
    "",
    "| サービス | 料金の目安 |",
    "|---|---|",
    ...services.map((s) => `| [${s.name}](${url(`services/${s.id}/`)}) | ${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"} |`),
    "",
    "## 実績（抜粋）",
    "",
    ...site.works.sites.map((w) => `- **${w.name}**（${w.url}）: ${w.role}`),
    ...site.works.lancers
      .filter((w) => w.featured)
      .slice(0, 5)
      .map((w) => `- **${w.headline}**: ${w.title}`),
    "",
    `[すべての実績](${url("works/")})`,
    "",
    "## 資格",
    "",
    ...(profile.certifications ?? []).map((c) => `- ${c.name}（${c.date}）`),
    ...(site.articles.length ? ["", "## 最近の記事", "", ...site.articles.slice(0, 5).map((a) => `- [${a.title}](${a.url})（${PLATFORM_LABEL[a.platform]}）`)] : []),
    "",
  ]);
}

export function renderSitemap(site, routes) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((r) => `  <url><loc>${esc(new URL(r, site.profile.site_url).href)}</loc></url>`).join("\n")}
</urlset>
`;
}

/** Render every file of the site: returns { "relative/path": contents }. */
export function renderSite(site) {
  const files = {
    "index.html": renderIndex(site),
    "works/index.html": renderWorks(site),
    "services/index.html": renderServices(site),
    "about/index.html": renderAbout(site),
    "prices/index.html": renderPrices(site),
    "reviews/index.html": renderReviews(site),
    "contact/index.html": renderContact(site),
    "404.html": render404(site),
    "llms.txt": renderLlmsTxt(site),
  };
  for (const s of site.services) files[`services/${s.id}/index.html`] = renderService(site, s);
  for (const w of site.works.all) files[`works/${w.id}/index.html`] = renderWork(site, w);
  const routes = ["", "works/", ...site.works.all.map((w) => `works/${w.id}/`), "services/", ...site.services.map((s) => `services/${s.id}/`), "prices/", "about/", "reviews/", "contact/"];
  files["sitemap.xml"] = renderSitemap(site, routes);
  files["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", site.profile.site_url).href}\n`;
  return files;
}

