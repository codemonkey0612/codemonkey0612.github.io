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
  gears: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.6 12.2l2.4 2.4 4.4-4.8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  layers: '<path d="M12 3.5 3 8.5l9 5 9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>',
  code: '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
  rocket: '<path d="M12 15c4-2.5 7-6.5 7.5-11.5C14.5 4 10.5 7 8 11z"/><path d="M8 11l-3.5.5L3 15l4-1M12 15l-.5 3.5L15 21l1-4M6 18c-1 1-1.5 2.5-1.5 2.5S6 20 7 19"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  bars: '<path d="M5 20v-5M10 20v-9M15 20V7M20 20V3"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="1.5"/><path d="M9.5 4.5V3h5v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.6v.01"/>',
  quill: '<path d="M20 4C11 4.5 6.5 9.5 5.5 19.5"/><path d="M5.5 19.5C12 19 16.5 15.5 18 9"/><path d="M4 21l2-2"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  cart: '<path d="M3 4h2.5l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6.4"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  box: '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.2c2.5.2 4.4 1.8 5 4.8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  pen: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
  chart: '<path d="M4 4v16h16"/><path d="M7.5 15l3.5-4 3 2.5 5-6"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  mobile: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9.5 14l2 2 3.5-4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 15.5M20 20v-4.5h-4.5"/>',
};
/** A line icon for a capability, step or deliverable, chosen from its own words. */
const ICON_RULES = [
  [/RAG|社内文書|資料の整理|資料の取り込み|手順書|マニュアル|手順/, "book"],
  [/根拠|検索/, "search"],
  [/推測で答えず|分からない/, "shield"],
  [/LINE|組み込み|連携/, "link"],
  [/権限|認証|アクセス/, "lock"],
  [/ログ|監視|利用量|費用対効果|SEO|導線|評価|結果/, "chart"],
  [/ChatGPT|OpenAI|生成AI|AI機能|AI活用|プロンプト/, "sparkle"],
  [/iOS|Android|スマホ/, "mobile"],
  [/Windows|Excel|帳票|レポート/, "file"],
  [/Python|データ収集|集計|データ/, "database"],
  [/不具合|修正/, "wrench"],
  [/コードレビュー|ソースコード|HTML|Figma|コーディング|実装|開発|試作/, "code"],
  [/セキュリティ|脆弱性/, "shield"],
  [/再テスト|移行|改善|定着/, "refresh"],
  [/Shopify|ネットショップ|ストア/, "cart"],
  [/決済|配送|商品/, "box"],
  [/予約|応募|マッチング|研修|ルール|体制/, "users"],
  [/業務システム|管理画面|環境|構築/, "monitor"],
  [/WordPress|サイト/, "browser"],
  [/更新しやすい|設計|デザイン|構成/, "layers"],
  [/サーバー|Linux|DNS|SSL|保守|Docker|CI\/CD|AWS|Azure|基盤/, "server"],
  [/整理|目的|現状|範囲|確認|分析/, "target"],
  [/選定|計画|ロードマップ|方針|道筋|PoC/, "compass"],
  [/公開|導入|拡張|広げて|引き渡し|引き継ぎ/, "rocket"],
];
const pickIcon = (text, fallback = "check") => ICON_RULES.find(([re]) => re.test(text))?.[1] ?? fallback;
/** "主文（補足）" → ["主文", "（補足）"]. */
const splitNote = (t) => {
  const i = t.indexOf("（");
  return i > 0 ? [t.slice(0, i), t.slice(i)] : [t, ""];
};
/** Measured video lengths (site/assets/media/durations.json, written with ffprobe). */
const DURATIONS = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../../site/assets/media/durations.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
})();
const videoLength = (path) => {
  const d = DURATIONS[path];
  return d ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : "";
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
  }<span class="brand-name" lang="en">TAKUMI</span><span class="brand-sub" lang="en">${sub}</span><span class="sr-only">匠（たくみ）トップへ</span></a>`;

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

/** A class per kind of page (route-works, route-work, route-service …) for the per-mockup geometry. */
const routeClass = (route) => {
  const parts = route.replace(/\.html$/, "").split("/").filter(Boolean);
  if (!parts.length) return "home";
  if (parts.length === 1) return parts[0];
  return { works: "work", services: "service" }[parts[0]] ?? parts[0];
};

const NAV = [
  ["works/", "Works", "実績"],
  ["services/", "Expertise", "サービス"],
  ["about/", "About", "私について"],
  ["contact/", "Contact", "お問い合わせ"],
];
/** The header's pages (Contact is the button beside them). */
const NAV_MAIN = [
  ["works/", "Works", "実績"],
  ["services/", "Expertise", "サービス"],
  ["about/", "About", "私について"],
  ["prices/", "Pricing", "料金"],
  ["reviews/", "Voices", "お客さまの声"],
];

function layout(site, { route, title, description, body, ld = [], absolute = false, image = null, page = "sub", tone = "dark", head = "", style = "" }) {
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
<body class="page-${page} hero-${tone} route-${routeClass(route)}" data-base="${base}" data-v="${site.assetVersion}"${style ? ` style="${esc(style)}"` : ""}>
<a class="skip" href="#main">本文へ移動</a>
<header class="hd">
  <div class="hd-in">
    ${brand(site, base)}
    <nav class="nav" aria-label="メインメニュー">
      <ul>
        ${NAV_MAIN.map(([href, en, ja]) => `<li><a href="${base}${href}"${current(href)} title="${ja}"><span lang="en">${en}</span><span class="nav-ja">${ja}</span></a></li>`).join("\n        ")}
      </ul>
    </nav>
    <a class="hd-cta" href="${contactHref(base)}"${current("contact/")}><span lang="en">Contact</span><span class="sr-only">（お問い合わせ）</span>${icon("arrow")}</a>
    <button class="menu-btn" type="button" aria-controls="menu" aria-expanded="false">${icon("menu")}<span class="sr-only">メニューを開く</span></button>
  </div>
</header>
<div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="メニュー" hidden>
  <div class="menu-in">
    <div class="menu-brand">${brand(site, base)}</div>
    <button class="menu-close" type="button">${icon("close")}<span class="sr-only">メニューを閉じる</span></button>
    <ul class="menu-list">
      <li><a href="${base}"><span lang="en">Home</span><span class="nav-ja">トップ</span></a></li>
      ${[...NAV_MAIN, ["contact/", "Contact", "お問い合わせ"]].map(([href, en, ja]) => `<li><a href="${base}${href}"${current(href)}><span lang="en">${en}</span><span class="nav-ja">${ja}</span></a></li>`).join("\n      ")}
    </ul>
    <p class="menu-actions"><a class="btn btn-gold btn-lg" href="${contactHref(base)}">相談する${icon("arrow")}</a><a class="btn btn-line btn-lg" href="${lancers}">Lancersで相談${icon("ext", "ic ic-xs")}</a></p>
  </div>
</div>
<main id="main">
${body}
</main>
<footer class="ft">
  <div class="ft-sky" aria-hidden="true"></div>
  <div class="wrap ft-top">
    <div class="ft-brand">
      ${brand(site, base)}
      <p class="ft-tag">想像を、<em>実装</em>する。</p>
      <p class="ft-lead">AIとWebで、ビジネスの次の景色へ。<br>構想の段階から、お気軽にご相談ください。</p>
      <p class="ft-actions"><a class="btn btn-gold" href="${contactHref(base)}">相談する${icon("arrow")}</a><a class="btn btn-line" href="${lancers}">Lancersで相談${icon("ext", "ic ic-xs")}</a></p>
    </div>
    <nav class="ft-cols" aria-label="サイト内のページ">
      <div class="ft-col">
        <h2 class="ft-h" lang="en">Pages</h2>
        <ul>
          <li><a href="${base}"><span lang="en">Home</span><small>トップ</small></a></li>
          ${[...NAV_MAIN, ["contact/", "Contact", "お問い合わせ"]].map(([href, en, ja]) => `<li><a href="${base}${href}"><span lang="en">${en}</span><small>${ja}</small></a></li>`).join("\n          ")}
        </ul>
      </div>
      <div class="ft-col">
        <h2 class="ft-h" lang="en">Expertise</h2>
        <ul>
          ${site.services.map((sv) => `<li><a href="${base}services/${esc(sv.id)}/">${esc(sv.short ?? sv.name)}</a></li>`).join("\n          ")}
        </ul>
      </div>
      <div class="ft-col">
        <h2 class="ft-h" lang="en">Elsewhere</h2>
        <ul>
          ${sameAs(profile).map((u) => `<li>${ext(u, `${linkLabel(u)}${icon("ext", "ic ic-xs")}`)}</li>`).join("\n          ")}
        </ul>
      </div>
    </nav>
  </div>
  <div class="wrap ft-bottom">
    <p class="ft-copy">© ${site.today.getFullYear()} ${esc(profile.name)}　<span lang="en">TAKUMI</span></p>
    <p class="ft-motto">技術に、美意識を。</p>
    <p class="ft-motion"><button class="motion-toggle" type="button" aria-pressed="false">動きを減らす</button></p>
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
/** A section image (decoration, alt="") when you've added it; "" until then. */
/** srcset + sizes for a section image that has an upscaled copy ("" otherwise). */
const sizesAttr = (a, base, sizes = "100vw") => (a?.src2x ? ` srcset="${base}${a.src} ${a.w}w, ${base}${a.src2x} ${a.w2}w" sizes="${sizes}"` : "");
const secImg = (site, base, name, cls = "sec-bg", sizes) => {
  const a = site.art.section(name);
  return a ? `<img class="${cls}" src="${base}${a.src}"${sizesAttr(a, base, sizes)} alt="" width="${a.w}" height="${a.h}" loading="lazy" decoding="async">` : "";
};
const hasSec = (site, name) => (site.art.section(name) ? " has-sec" : "");
/** The first of these section images that exists (the home pilot's art, else the older one). */
const pickSec = (site, ...names) => names.find((n) => site.art.section(n)) ?? names.at(-1);
/** A cut-out laid across the edge between two sections (decorative, hidden from assistive tech). */
const seam = (site, base, cls, ...decos) => {
  const imgs = decos.map(([name, c]) => secImg(site, base, name, `deco ${c}`)).filter(Boolean);
  return imgs.length ? `<div class="seam ${cls}" aria-hidden="true">${imgs.join("")}</div>` : "";
};

/** A scene's artwork as <picture>: the wide image, and the phone crop below `mq`. */
const artPicture = (a, base, { cls, eager = false, mq = "(max-width: 760px)" }) =>
  `<picture class="${cls}"><source media="${mq}" srcset="${base}${a.narrow}" width="${a.mw}" height="${a.mh}"><img src="${base}${a.wide}"${a.wide2x ? ` srcset="${base}${a.wide} ${a.w}w, ${base}${a.wide2x} ${a.w2}w" sizes="${a.sizes ?? "100vw"}"` : ""} alt="" width="${a.w}" height="${a.h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;

function stage(site, base, { scene, inner, cls = "", tone, over = "", art: own = null }) {
  const a = own ?? site.art.stage(scene);
  const t = tone ?? a.tone;
  const art = a.wide ? artPicture(a, base, { cls: "stage-art", eager: true }) : `<div class="stage-art stage-art-empty" aria-hidden="true"></div>`;
  return `<section class="stage stage-${t}${cls ? ` ${cls}` : ""}" data-scene="${esc(scene)}"${a.plate ? " data-plate" : ""}>
  ${art}
  ${over}
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
function inquiry(site, base, { title = "次の景色を、一緒に。", text = "アイデアの段階でも、まだ整理できていない構想でも大丈夫です。目的と現状を伺い、進め方とお見積もりをご提案します。", textHtml = null, query = "", label = "相談する", shape = "split", eyebrow = "Inquiry", art = null, light = false, compact = shape === "split", titleHtml = null, btnPre = null, btnCls = "btn-gold btn-lg", chev = false, lancers = true, plain = false } = {}) {
  const a = site.art.stage("portal");
  const own = art && site.art.section(art);
  return `<section class="band band-${shape}${own && light ? " band-light" : ""}${compact ? " band-compact" : ""}${plain ? " band-plain" : ""}" aria-labelledby="band-title">
  ${
    plain
      ? ""
      : own
      ? `<picture class="band-art">${secImg(site, base, art, "")}</picture>`
      : compact && a.wide
        ? `<div class="band-art band-duo" aria-hidden="true"><img class="duo-fill" src="${base}${a.wide}" alt="" width="${a.w}" height="${a.h}" loading="lazy" decoding="async"><img class="duo-main" src="${base}${a.wide}" alt="" width="${a.w}" height="${a.h}" loading="lazy" decoding="async"></div>`
        : a.wide
          ? artPicture(a, base, { cls: "band-art" })
          : ""
  }
  <div class="wrap band-in" data-reveal>
    <div class="band-copy">
      ${eyebrow ? `<p class="eyebrow" lang="en">${eyebrow}</p>` : ""}
      <h2 class="h2 band-title" id="band-title">${titleHtml ?? brk(title)}</h2>
      ${compact ? `<svg class="band-swoosh" viewBox="0 0 400 24" aria-hidden="true"><path d="M2 18 C 90 4, 200 2, 398 12"/></svg>` : ""}
      <p class="band-text">${textHtml ?? esc(text)}</p>
    </div>
    <p class="actions"><a class="btn ${btnCls}" href="${contactHref(base, query)}">${btnPre ? icon(btnPre, "ic btn-pre") : ""}${esc(label)}${icon(chev ? "chevron" : "arrow")}</a>${compact || !lancers ? "" : `<a class="link-sub" href="${esc(site.profile.contact_url)}">Lancersで相談する${icon("ext", "ic ic-xs")}</a>`}</p>
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
  `<div class="faq">${items.map((f) => `<details class="acc"><summary><span class="acc-q" aria-hidden="true">Q.</span><span class="acc-title">${esc(f.q)}</span></summary><p>${esc(f.a)}</p></details>`).join("")}</div>`;
const ldFaq = (items) => ({
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** A gold connector line through numbered steps (drawn as it enters the viewport). */
function steps(list, { cls = "" } = {}) {
  const rise = cls.includes("steps-rise");
  return `<ol class="steps${cls ? ` ${cls}` : ""}" data-draw>
      <li class="steps-line" aria-hidden="true"><svg viewBox="0 0 1000 ${rise ? 140 : 20}" preserveAspectRatio="none"><path d="${rise ? "M0 132 C 260 128, 420 96, 560 78 S 860 22, 1000 6" : "M0 10 C 250 -6, 500 26, 1000 10"}"/></svg></li>
      ${list.map((s, i) => `<li class="step" data-reveal><span class="step-no" lang="en">${pad2(i + 1)}</span>${rise ? "" : `<span class="step-ic" aria-hidden="true">${icon(s.i ?? ["search", "layers", "code", "rocket", "check"][i % 5])}</span>`}<h3 class="step-title">${esc(s.t)}</h3><p>${esc(s.d)}</p>${rise ? `<span class="step-dot" aria-hidden="true"></span><span class="step-glass" aria-hidden="true" style="--lvl:${i + 1}"><i></i><i></i><i></i></span>` : ""}</li>`).join("\n      ")}
    </ol>`;
}

/** A user-controlled film: poster in a frame; plays only when asked. */
function film(site, base, { video, poster, title, cls = "", ar = null, length = "", overlay = "" }) {
  const wh = site.size(poster) ?? [1600, 900];
  return `<figure class="film${cls ? ` ${cls}` : ""}" data-reveal>
      <div class="film-frame" style="--ar:${ar ?? `${wh[0]}/${wh[1]}`}">
        <video controls playsinline preload="none" poster="${base}${esc(poster)}" width="${wh[0]}" height="${wh[1]}" aria-label="${esc(title)}"><source src="${base}${esc(video)}" type="video/mp4"></video>
        ${overlay ? `<span class="film-over" aria-hidden="true">${overlay}</span>` : ""}
        ${length ? `<span class="film-bar" aria-hidden="true"><i class="fb-play"></i><span>0:00 / ${esc(length)}</span><i class="fb-line"></i>${icon("volume", "ic fbar-ic")}${icon("full", "ic fbar-ic")}</span>` : ""}
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

/** A card of the works gallery (the mockup's composition: text left, picture right;
 * large cards navy, small ones pearl). Pictures are shown whole, never cropped. */
const GALLERY = ["lg", "wide", "sm", "sm", "lg", "sm", "sm", "sm", "sm", "wide", "sm", "sm", "sm", "sm", "lg", "wide"];
const GALLERY_DARK = new Set([0, 4, 9, 14]);
function galleryCard(site, w, base, i) {
  const size = GALLERY[i % GALLERY.length];
  return `<li class="gcard gcard-${size}${GALLERY_DARK.has(i % GALLERY.length) ? " gcard-dark" : ""}" data-cat="${w.cat}" data-reveal>
        <a href="${base}works/${esc(w.id)}/" style="--accent:${esc(w.color ?? "#c9a24a")}">
          <span class="gcard-text">
            <span class="gcard-top"><span class="gcard-no" lang="en">${w.no}</span><span class="pill" lang="en">${CAT_LABEL[w.cat]}</span></span>
            <span class="gcard-title">${esc(workName(w))}</span>
            <span class="gcard-line">${esc(size === "sm" ? (w.kindOf === "site" ? w.kind : w.headline ?? w.subtitle) : w.kindOf === "site" ? w.summary.split("。")[0] + "。" : w.subtitle)}</span>
            <span class="gcard-go">${icon("arrow")}</span>
          </span>
          <span class="gcard-media"><span class="gdev" style="--ar:${(site.size(workImage(w)) ?? [16, 10]).join("/")}"><span class="gdev-screen">${img(site, workImage(w), base, { eager: i < 2 })}</span><span class="gdev-base" aria-hidden="true"></span></span></span>
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
  // The shortest client quote reads best as the home page's one-line voice.
  const quote = (profile.testimonials ?? []).filter((t) => t.quote).sort((x, y) => x.quote.length - y.quote.length)[0];
  const reel = art.showreel;
  const film1 = services.find((s) => s.id === "ai-apps")?.packages[0];
  const half = Math.ceil(services.length / 2);
  const svcItem = (s) => `<li><a href="${base}services/${esc(s.id)}/">${icon(SVC_ICON[s.id] ?? "chip", "ic svc-ic")}<span class="svc-name">${esc(s.short)}</span><span class="svc-desc">${s.card.map(esc).join("<br>")}</span></a></li>`;
  const [lead] = works.sites;
  const ex = site.art.stage("expertise");
  // The showreel's poster: the home artwork's bright lower half (clouds and pavilion), as in the mockup.
  const reelPoster = site.art.section("reel-poster")?.src ?? (site.art.stage("home").plate ? site.art.stage("home").wide : reel?.poster);
  // Each section is a short, wide strip filled with artwork, like the mockup; the detail
  // lives on the inner pages.
  // The home pilot: the mockup's own sections without their text (~/dev/note/mockup/home-pilot).
  const hero = art.section("sec-home-hero");
  const heroM = art.section("sec-home-hero-m") ?? hero;
  const heroArt = hero && { wide: hero.src, narrow: heroM.src, w: hero.w, h: hero.h, mw: heroM.w, mh: heroM.h, plate: true, tone: "dark", wide2x: hero.src2x, w2: hero.w2, sizes: "(min-width: 1024px) 112vw, 100vw" };
  const sel = art.section("sec-home-sel");
  const selOld = art.section("sec-home-selected");
  const exNew = art.section("sec-home-exp");
  const body = `${stage(site, base, {
    scene: "home",
    cls: `stage-home${hero ? " stage-pilot" : ""}`,
    art: heroArt,
    over: secImg(site, base, "deco-glints", "deco deco-glints"),
    inner: `    <div class="stage-copy">
      <h1 class="display">想像を、<br><em>実装</em>する。</h1>
      <p class="lead lead-one">AIとWebで、ビジネスの次の景色へ。</p>
      <p class="actions"><a class="btn btn-ghost btn-lg" href="#selected">実績を見る${icon("arrow")}</a><a class="btn btn-gold btn-lg" href="${contactHref(base)}">相談する${icon("arrow")}</a></p>
    </div>
    ${
      film1?.video
        ? `<button class="stage-film" type="button" data-video="${base}${esc(film1.video)}" data-video-title="${esc(film1.title)}"><span class="stage-film-img">${img(site, film1.cover, base, { alt: `${film1.title}（パッケージ画像）`, eager: true })}</span><span class="stage-film-cap">${icon("play", "ic play-ic")}<span class="sr-only">紹介動画を再生：${esc(services[0].name)}</span></span></button>`
        : ""
    }
`,
  })}
${seam(site, base, "seam-hero", ["deco-ribbon", "deco-ribbon-a"])}
<section class="strip strip-sel${selOld || sel ? " has-sec" : ""}${sel ? " sel-baked" : ""}" id="selected" aria-labelledby="selected-title">
  ${
    sel
      ? `<picture class="sec-pic"><source media="(min-width: 1024px)" srcset="${base}${sel.src}${sel.src2x ? ` ${sel.w}w, ${base}${sel.src2x} ${sel.w2}w" sizes="106vw` : ""}" width="${sel.w}" height="${sel.h}">${selOld ? `<img class="sec-bg" src="${base}${selOld.src}" alt="" width="${selOld.w}" height="${selOld.h}" loading="lazy" decoding="async">` : `<img class="sec-bg sec-bg-wide-only" src="${base}${sel.src}" alt="" width="${sel.w}" height="${sel.h}" loading="lazy" decoding="async">`}</picture>`
      : secImg(site, base, "sec-home-selected")
  }
  <div class="wrap strip-in sel-in">
    <div class="sel-copy" data-reveal>
      <p class="eyebrow" lang="en">Selected Work</p>
      <h2 class="strip-title" id="selected-title">実装で、<br><span class="nowrap"><em>成果</em>につなげる。</span></h2>
      <p class="sel-lead">${works.sites.map((w) => `<a href="${base}works/${esc(w.id)}/">${esc(workName(w))}</a>`).join("・")}など、<br>開発に参加したサイトと評価をいただいた案件。</p>
      <p class="sel-cta"><a class="btn btn-ghost" href="${base}works/">実績を見る${icon("arrow")}</a></p>
    </div>
    <div class="sel-devices" data-reveal>
      <a class="dev-laptop" href="${base}works/${esc(lead.id)}/"><span class="dev-screen">${img(site, workImage(lead), base, { alt: `${workName(lead)}のトップページ` })}</span><span class="dev-base" aria-hidden="true"></span></a>
      ${featured[0] ? `<a class="dev-tablet" href="${base}works/${esc(featured[0].id)}/"><span class="dev-screen">${img(site, workImage(featured[0]), base, { alt: `${workName(featured[0])}（イメージ）` })}</span></a>` : ""}
      <span class="sel-orb" aria-hidden="true"></span>
    </div>
    <ul class="sel-caps">${[lead, featured[0]].filter(Boolean).map((w) => `<li><a href="${base}works/${esc(w.id)}/"><b>${esc(workName(w))}</b><span>${esc(workLine(w))}</span>${icon("arrow", "ic sel-cap-ic")}</a></li>`).join("")}</ul>
  </div>
</section>
<section class="strip strip-exp${exNew ? " exp-pilot" : ""}" aria-labelledby="expertise-title">
  ${
    exNew
      ? `<div class="exp-art" aria-hidden="true"><img class="exp-bg" src="${base}${exNew.src}"${sizesAttr(exNew, base)} alt="" width="${exNew.w}" height="${exNew.h}" loading="lazy" decoding="async"></div>`
      : ex.wide
        ? `<div class="exp-art" aria-hidden="true"><img class="exp-fill" src="${base}${ex.wide}" alt="" width="${ex.w}" height="${ex.h}" loading="lazy" decoding="async"><img class="exp-main" src="${base}${ex.wide}" alt="" width="${ex.w}" height="${ex.h}" loading="lazy" decoding="async"></div>`
        : ""
  }
  <div class="wrap strip-in">
    <header class="exp-head" data-reveal>
      <h2 id="expertise-title"><span class="latin-title" lang="en">Expertise</span><span class="sh-ja">AIとWebの技術で、構想から実装・運用まで一貫して支援します。</span></h2>
    </header>
    <div class="exp-grid">
      <ul class="exp-col">${services.slice(0, half).map(svcItem).join("")}</ul>
      <div aria-hidden="true"></div>
      <ul class="exp-col">${services.slice(half).map(svcItem).join("")}</ul>
    </div>
  </div>
</section>
${
  reel
    ? `${seam(site, base, "seam-reel", ["deco-sakura-a", "deco-sakura-top"])}
<section class="strip strip-reel${hasSec(site, pickSec(site, "sec-home-reel", "sec-home-showreel"))}${art.section("sec-home-reel") ? " reel-pilot" : ""}" aria-labelledby="reel-title">
  ${secImg(site, base, pickSec(site, "sec-home-reel", "sec-home-showreel"))}
  <div class="wrap strip-in">
    <p class="eyebrow eyebrow-center" lang="en">Showreel</p>
    <h2 class="strip-title strip-title-sm" id="reel-title">実装の、その先へ。</h2>
    <p class="reel-sub">TAKUMIのものづくりを、映像でご覧ください。</p>
    ${film(site, base, { video: reel.video, poster: reelPoster, title: "紹介動画のダイジェスト（音声なし・18秒）", cls: "film-cine", ar: "3.9/1", length: "0:18" })}
  </div>
</section>`
    : ""
}
${
  quote
    ? `${seam(site, base, "seam-quote", ["deco-sakura-b", "deco-sakura-low"])}
<section class="strip strip-quote${hasSec(site, pickSec(site, "sec-home-quote", "sec-silk"))}" aria-label="ひとこと">
  ${secImg(site, base, pickSec(site, "sec-home-quote", "sec-silk"))}
  <div class="wrap strip-in quote-in" data-reveal>
    <p class="statement">AIとWebの力で、<br>ビジネスの可能性を広げる。</p>
    <figure class="quote-mini">
      <blockquote><p>${esc(reviewText(quote))}</p></blockquote>
      <figcaption>${dotDate(quote.date)} ランサーズの評価より　<a href="${base}reviews/">お客さまの声${icon("arrow", "ic ic-xs")}</a></figcaption>
    </figure>
  </div>
</section>`
    : ""
}
${seam(site, base, "seam-cta", ["deco-pearl", "deco-pearl-float"])}
${inquiry(site, base, { label: "プロジェクトを相談する", titleHtml: "次の景色を、<br><em>一緒</em>に。", art: art.section("sec-home-cta") ? "sec-home-cta" : null })}`;
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
  const body = `${stage(site, base, {
    scene: "works",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "実績"]])}
      <p class="kicker" lang="en">Works Gallery</p>
      <p class="kicker-ja">実績ギャラリー</p>
      <h1 class="display">作品の、<br><span class="d-ind">その<em>先</em>へ。</span></h1>
      <p class="lead">開発に参加した公開中のサイトと、<br>ランサーズで評価をいただいた案件です。</p>
    </div>`,
  })}
<section class="ch ch-pearl gallery${hasSec(site, "sec-silk")}" aria-labelledby="gallery-title">
  ${secImg(site, base, "sec-silk")}
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
    <ul class="ggrid wgrid-edit">
      ${works.all.map((w, i) => galleryCard(site, w, base, i)).join("\n      ")}
    </ul>
    <p class="fine">ランサーズの案件のカバー画像はイメージです（実際の画面ではありません）。公開中のサイトの画面は撮影時点のものです。</p>
  </div>
</section>
${seam(site, base, "seam-next", ["deco-silk-wave", "deco-silk-a"], ["deco-gold-leaves", "deco-leaves-a"])}
${inquiry(site, base, { title: "次の「作品」を、あなたと。", text: "課題の発見から、企画・デザイン・開発・運用まで。目的に合った進め方をご提案します。", textHtml: "課題の発見から、企画・デザイン・開発・運用まで。<br>目的に合った進め方をご提案します。", shape: "center", eyebrow: "Next Project", label: "プロジェクトを相談する", art: site.art.section("sec-works-next") ? "sec-works-next" : null, btnPre: "clipboard", chev: true, btnCls: "btn-gold btn-lg btn-wide" })}`;
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
  const l = profile.lancers ?? {};
  const art = site.art.stage(scene);
  const [sum1, ...sumRest] = isSite ? w.summary.split(/(?<=。)/) : [];
  const chapterList = isSite
    ? [
        `<div class="chapter" data-reveal><p class="chapter-no" lang="en">01</p><h2 class="h3">サイトの特長</h2><p>${esc(sumRest.join("") || w.summary)}</p><p class="chapter-link">${ext(w.url, `サイトを見る${icon("ext", "ic ic-xs")}`, "btn btn-ghost")}</p></div>`,
      ]
    : story.chapters.slice(0, 3).map((c, k) => `<div class="chapter prose" data-reveal><p class="chapter-no" lang="en">${pad2(k + 1)}</p><h2 class="h3">${esc(c.title)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</h2>${c.html}</div>`);
  // The second row has no picture of its own (the hero art would repeat), so its text runs full width.
  const rows = [
    { html: chapterList[0] ?? "", fig: media },
    ...(chapterList.length > 1 ? [{ html: chapterList.slice(1).join("\n"), fig: "" }] : []),
  ];
  const title = workName(w);
  const titleHtml = brk(title).replace(/-/g, "\u2011");
  const body = `${stage(site, base, {
    scene,
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[`${base}works/`, "実績"], [null, workName(w)]])}
      <p class="kicker" lang="en">Case Study ${w.no}</p>
      <h1 class="display display-md${[...title].length > 6 ? " display-long" : ""}">${titleHtml}</h1>
      <p class="accent-line" lang="en" style="--accent:${esc(w.color ?? "#c9a24a")}">${esc(w.en ?? "")}</p>
      <p class="lead">${esc(isSite ? workLine(w) : w.subtitle)}</p>
    </div>`,
  })}
<section class="ch ch-pearl case" aria-labelledby="overview-title">
  <div class="wrap">
    <div class="case-grid">
      <div class="case-context" data-reveal>
        <p class="eyebrow" lang="en">Project Overview</p>
        <h2 class="h2" id="overview-title">プロジェクト概要</h2>
        ${isSite ? "" : `<p class="case-headline">${esc(w.headline)}</p>`}
        ${isSite ? `<p>${esc(sum1)}</p>` : story.context.join("\n") || `<p>${esc(w.title)}</p>`}
      </div>
      <dl class="meta" data-reveal>
        ${meta.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("\n        ")}
      </dl>
    </div>
  </div>
</section>
<section class="ch ch-white chapters" aria-label="取り組み">
  <div class="wrap">
    ${(w.points ?? []).length ? `<ul class="hl-cards" aria-label="この案件のポイント">${w.points.map((x) => `<li data-reveal><span class="hl-ic" aria-hidden="true">${icon(pickIcon(x, "check"))}</span><span>${esc(x)}</span></li>`).join("")}</ul>` : ""}
    ${rows.map((r, k) => `<div class="crow${k % 2 ? " crow-flip" : ""}${r.fig ? "" : " crow-solo"}">
      <div class="crow-text">${r.html}</div>
      ${r.fig ? `<div class="crow-fig" data-reveal>${r.fig}</div>` : ""}
    </div>`).join("\n    ")}
  </div>
</section>
${
  isSite
    ? ""
    : w.reviews.some((t) => t.comment)
      ? `<section class="ch ch-mist case-voice" aria-labelledby="review-title">
  <div class="wrap narrow">
    <h2 class="sr-only" id="review-title">お客さまの評価</h2>
    <p class="eyebrow eyebrow-center" lang="en">Client Voice</p>
    ${w.reviews
      .map(
        (t) => `<figure class="quote quote-wide" data-reveal>
      ${icon("quote", "quote-mark")}
      ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="quote-none">（コメントは公開されていません。評価は「満足」です）</p>`}
      <figcaption>${stars()}<span class="quote-job">${esc(t.job)}</span><span class="quote-meta">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}・<a href="${base}reviews/#${esc(t.id)}">評価一覧で見る</a></span></figcaption>
    </figure>`,
      )
      .join("\n    ")}
    <p class="fine center">評価は${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}で確認できます。</p>
  </div>
</section>`
      : `<section class="ch ch-mist case-voice case-voice-min" aria-label="お客さまの評価">
  <div class="wrap">
    <p class="voice-min">${stars()}<span>評価「満足」</span>${w.reviews.map((t) => `<span>${esc(t.job)}・${jaDate(t.date)}</span>`).join("")}<a href="${base}reviews/#${esc(w.reviews[0].id)}">評価一覧で見る${icon("arrow", "ic ic-xs")}</a></p>
  </div>
</section>`
}
<nav class="next" aria-label="次の実績">
  <a class="next-in" href="${base}works/${esc(next.id)}/">
    <span class="next-media">${(() => {
      const na = site.art.stage(`work-${next.id}`);
      return na.wide ? `<img src="${base}${na.wide}" alt="" width="${na.w}" height="${na.h}" loading="lazy" decoding="async">` : img(site, workImage(next), base);
    })()}</span>
    <span class="next-body"><span class="eyebrow" lang="en">Next Project</span><span class="next-title">${esc(workName(next))}${icon("arrow", "ic next-ic")}</span><span class="next-line">${esc(workLine(next))}</span></span>
  </a>
</nav>
${inquiry(site, base, { title: "このような開発のご相談", text: "似た課題をお持ちでしたら、まずは現状をお聞かせください。進め方とお見積もりをご提案します。", textHtml: "似た課題をお持ちでしたら、まずは現状をお聞かせください。<br>進め方とお見積もりをご提案します。", query: `?work=${encodeURIComponent(w.id)}`, shape: "center", eyebrow: "", light: true, art: "sec-silk", label: "相談する", chev: true, lancers: false })}`;
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
    over: site.art.stage("services").plate
      ? `<div class="svc-labels" aria-hidden="true">${[
          ["ai-apps", 0.658, 0.362],
          ["ai-chatbot", 0.82, 0.385],
          ["ai-consulting", 0.713, 0.535],
          ["ai-infra", 0.545, 0.558],
          ["wordpress", 0.408, 0.655],
          ["shopify", 0.3, 0.728],
          ["system", 0.518, 0.755],
          ["quality", 0.199, 0.8],
        ]
          .map(([id, x, y]) => {
            const sv = site.services.find((o) => o.id === id);
            return sv ? `<a class="svc-label" href="${base}services/${id}/" tabindex="-1" style="--x:${x};--y:${y}">${esc(sv.en.replace(/^AI /, "").replace(/ & .*/, "").replace("BUSINESS ", ""))}</a>` : "";
          })
          .join("")}</div>`
      : "",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "サービス"]])}
      <p class="kicker" lang="en">Services Index</p>
      <h1 class="display display-line">可能性を、<em>かたち</em>に。</h1>
      <p class="lead">AI、クラウド、Webサイト、業務システム、そして品質まで。<br>構想から実装・運用・改善へ――<br>8つのサービスで、想いを確かな価値に変えていきます。</p>
    </div>`,
  })}
<section class="ch ch-pearl" aria-labelledby="svc-title">
  <div class="wrap">
    <header class="svc-head" data-reveal><h2 id="svc-title">提供する8つのサービス</h2><p class="eyebrow eyebrow-center" lang="en">Our Services</p></header>
    <ul class="svc-grid">
      ${services
        .map(
          (s, i) => {
            const a = site.art.stage(`svc-${s.id}`);
            const tone = i % 4 === 0 || i % 4 === 3 ? "light" : "dark";
            return `<li class="svc-card svc-card-${tone}" style="--accent:${esc(s.accent)}" data-reveal>
        ${a.wide ? `<img class="svc-bg" src="${base}${a.wide}" alt="" width="${a.w}" height="${a.h}" loading="lazy" decoding="async">` : s.cover ? img(site, s.cover, base, { cls: "svc-bg" }) : ""}
        <p class="svc-no" lang="en" aria-hidden="true">${s.no}</p>
        <div class="svc-body">
          <h3 class="svc-card-en" lang="en"><a class="svc-link" href="${base}services/${esc(s.id)}/">${esc(s.en.replace(/ & .*/, "")).replace(/^(BUSINESS) /, "$1<br>")}<span class="sr-only">：${esc(s.name)}</span></a></h3>
          <p class="svc-card-desc">${s.card.map(esc).join("<br>")}</p>
          <p class="svc-card-foot"><a class="btn ${tone === "light" ? "btn-gold" : "btn-ghost"} btn-sm" href="${contactHref(base, `?service=${encodeURIComponent(s.id)}`)}">お問い合わせ${icon("arrow")}<span class="sr-only">（${esc(s.name)}）</span></a></p>
        </div>
        ${s.video ? `<button class="play-ring" type="button" data-video="${base}${esc(s.video.video)}" data-video-title="${esc(s.video.title)}">${icon("play")}<span class="sr-only">${esc(s.name)}の紹介動画を再生</span></button>` : ""}
      </li>`;
          },
        )
        .join("\n      ")}
    </ul>
  </div>
</section>
<section class="ch ch-mist" aria-labelledby="find-title">
  <div class="wrap two-cards">
    <div class="card-soft${hasSec(site, "sec-services-discovery")}" data-reveal>
      ${secImg(site, base, "sec-services-discovery", "card-art")}
      <p class="eyebrow" lang="en">Service Discovery</p>
      <h2 class="h3" id="find-title">サービスを見つける</h2>
      <p class="card-lead">目的や課題から、<br>最適なサービスをご案内します。</p>
      <ul class="finder">
        <li><a href="${base}services/ai-consulting/">AIを使いたいが、何から始めればいいか分からない${icon("arrow")}</a></li>
        <li><a href="${base}services/ai-chatbot/">社内の資料に答えるAIがほしい${icon("arrow")}</a></li>
        <li><a href="${base}services/wordpress/">自分たちで更新できるサイトにしたい${icon("arrow")}</a></li>
        <li><a href="${base}services/system/">Excelや紙の管理を、システムにしたい${icon("arrow")}</a></li>
        <li><a href="${base}services/quality/">引き継いだシステムの不具合を直したい${icon("arrow")}</a></li>
      </ul>
      <p>${more(`${base}prices/`, "料金と進め方を見る")}</p>
    </div>
    <div class="card-night${hasSec(site, "sec-services-inquiry")}" data-reveal>
      ${secImg(site, base, "sec-services-inquiry", "card-art")}
      <p class="eyebrow" lang="en">Inquiry</p>
      <h2 class="h3">まずはご相談ください</h2>
      <p>やりたいこと、課題、構想の段階でも構いません。<br>目的に合った進め方をご提案します。</p>
      <p><a class="btn btn-gold btn-wide-sm" href="${contactHref(base)}">お問い合わせはこちら${icon("arrow")}</a></p>
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
  const isAI = s.pillar === "AI";
  // Two lines, split at the first 、; the board-6 pages set the second phrase in gold.
  const [h1a, ...h1b] = s.headline.split("、");
  const h1 = h1b.length ? `${esc(h1a)}、<br>${isAI ? esc(h1b.join("、")) : `<em>${esc(h1b.join("、"))}</em>`}` : brk(s.headline);
  const plate = site.art.stage(scene);
  const flow = { system: "開発の流れ", quality: "対応の流れ", "ai-apps": "開発の流れ", "ai-chatbot": "構築の流れ", "ai-consulting": "支援の流れ", "ai-infra": "構築の流れ" }[s.id] ?? "制作の流れ";
  // Real screens for the two services with a live site of their own; the others show their artwork.
  const live = site.works.sites.find((w) => w.service?.id === s.id);
  const body = `${stage(site, base, {
    scene,
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[`${base}services/`, "サービス"], [null, s.name]])}
      <p class="kicker${isAI ? " kicker-pill" : ""}" lang="en" style="--accent:${esc(s.accent)}">${esc(s.en)}</p>
      <h1 class="display display-md">${h1}</h1>
      <p class="lead">${esc(s.lead)}</p>
      <p class="actions"><a class="btn btn-gold btn-lg" href="${contactHref(base, q)}">相談する${icon("arrow")}</a>${s.packages.length ? `<a class="btn btn-ghost btn-lg" href="#price">料金を見る</a>` : ""}</p>
    </div>`,
  })}
<section class="ch ch-pearl svc-intro" aria-labelledby="intro-title">
  <div class="wrap">
    <div class="svc-intro-top">
      <div data-reveal>
        <p class="eyebrow" lang="en">Service ${s.no}</p>
        <h2 class="h2" id="intro-title">${esc(s.name)}</h2>
        <p class="intro-text">${esc(s.description)}</p>
      </div>
      ${s.problems.length ? `<div class="svc-points-box" data-reveal><p class="svc-points-label">こんな課題に</p><ul class="svc-points">${s.problems.map((p) => `<li>${icon("check")}${esc(p)}</li>`).join("")}</ul></div>` : ""}
    </div>
    ${
      s.video
        ? `<h2 class="sr-only" id="film-title">紹介動画</h2>
    ${film(site, base, { video: s.video.video, poster: plate.plate ? plate.wide : s.video.cover ?? s.cover, title: s.video.title, cls: "film-svc", ar: "16/9", length: videoLength(s.video.video), overlay: `<b lang="en">${esc(s.en.replace(/ & .*/, ""))}</b><small lang="en">Service Film</small>` })}`
        : ""
    }
  </div>
</section>
<section class="ch ch-night scope" style="--accent:${esc(s.accent)}" aria-labelledby="scope-title">
  <div class="wrap scope-in">
    <div>
      ${heading("Capabilities", "できること", { id: "scope-title", cls: "sh-inline" })}
      ${s.approach.map((p) => `<p class="scope-lead">${esc(p)}</p>`).join("")}
      ${s.scopeNote.map((p) => `<p class="scope-note">${icon("shield", "ic")}<span>${esc(p)}</span></p>`).join("")}
    </div>
    ${
      live
        ? `<div class="scope-device scope-device-live"><a class="dev-laptop" href="${base}works/${esc(live.id)}/"><span class="dev-screen">${img(site, live.top, base, { alt: `${workName(live)}のトップページ` })}</span><span class="dev-base" aria-hidden="true"></span></a>${live.phone ? `<span class="dev-phone" aria-hidden="true">${img(site, live.phone, base)}</span>` : ""}</div>`
        : ""
    }
    <ul class="cap-row">
      ${s.scope
        .map((x) => {
          const [t, note] = splitNote(x);
          return `<li data-reveal><span class="cap-ic" aria-hidden="true">${icon(pickIcon(x))}</span><b>${esc(t)}</b>${note ? `<small>${esc(note)}</small>` : ""}</li>`;
        })
        .join("\n      ")}
    </ul>
  </div>
</section>
${
  s.process.length
    ? `<section class="ch ch-pearl svc-process" aria-labelledby="process-title">
  <div class="wrap">
    ${heading("Workflow", flow, { id: "process-title", cls: "sh-inline" })}
    ${steps(s.process.map((x) => ({ ...x, i: pickIcon(x.t, null) })))}
    ${
      s.deliverables.length
        ? `<div class="deliv" data-reveal>
      <h3 class="deliv-h">主な成果物<span lang="en">Deliverables</span></h3>
      <ul class="deliv-cards">${s.deliverables.map((d) => `<li>${icon(pickIcon(d, "doc"))}<span>${esc(d)}</span></li>`).join("")}</ul>
      <p class="deliv-note">内容はご依頼の範囲によって変わります。</p>
    </div>`
        : ""
    }
  </div>
</section>`
    : ""
}
<section class="ch ch-white svc-faq" aria-labelledby="faq-title">
  <div class="wrap">
    ${heading("FAQ", "よくある質問", { id: "faq-title", cls: "sh-inline" })}
    ${faqList(faq)}
    ${
      s.packages.length
        ? `<details class="pk-more svc-more" id="price">
      <summary><span id="price-title">料金の目安（ランサーズのパッケージ ${s.packages.length}件・${jaDate(profile.lancers?.as_of)}時点）</span>${icon("arrow")}</summary>
      <div class="svc-more-in">
    ${s.packages
      .map(
        (p) => `<article class="pkg">
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
    </details>`
        : ""
    }
    ${
      related.length || s.testimonials.some(reviewText) || s.cases.length
        ? `<details class="pk-more svc-more">
      <summary><span>このサービスの実績・お客さまの声・開発経験</span>${icon("arrow")}</summary>
      <div class="svc-more-in">
        ${related.length ? `<h3 class="h3">このサービスの実績</h3><ul class="wgrid wgrid-3">${related.map((w) => workCard(site, w, base)).join("")}</ul>` : ""}
        ${s.testimonials.some(reviewText) ? `<h3 class="h3">お客さまの声</h3><div class="quotes">${s.testimonials.filter(reviewText).map((t) => quoteCard(t, { base })).join("")}</div>` : ""}
        ${s.cases.length ? `<h3 class="h3">関連する開発経験</h3><p class="fine">ランサーズを始める前から担当してきたプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です）。</p><div class="acc-list">${s.cases.map(caseItem).join("")}</div>` : ""}
      </div>
    </details>`
        : ""
    }
  </div>
</section>
${inquiry(site, base, { title: `${s.short}のご相談`, text: "目的と現状を伺い、進め方とお見積もりをご提案します。仕様が決まっていない段階でも大丈夫です。", textHtml: "目的と現状を伺い、進め方とお見積もりをご提案します。<br>仕様が決まっていない段階でも大丈夫です。", query: q, art: isAI ? "sec-service-cta" : null, plain: !isAI, label: "相談する", chev: true })}`;
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
  return layout(site, { route, title: s.name, description: s.description, body, ld, image: s.cover, tone: site.art.stage(scene).tone, style: `--accent:${s.accent};--svc-accent:${s.accent}` });
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
      <h1 class="display display-line">技術に、<em>美意識</em>を。</h1>
      <p class="lead">${esc(profile.tagline)}<br>一つひとつの仕事にこだわり、<br>技術と誠実さで、期待を超えるものを。<br>それが「匠」という名前に込めた想いです。</p>
      <p class="hero-caption" lang="en">TAKUMI / Independent Engineer</p>
    </div>`,
  })}
<section class="ch ch-pearl bio${hasSec(site, "sec-about-bio")}" aria-labelledby="bio-title">
  ${secImg(site, base, "sec-about-bio")}
  <svg class="bio-art bio-art-r" viewBox="0 0 300 300" aria-hidden="true"><circle cx="150" cy="150" r="118"/><circle cx="150" cy="150" r="82"/><circle cx="196" cy="118" r="58"/><circle cx="104" cy="182" r="40"/><path d="M20 150h260M150 20v260M58 58l184 184M242 58 58 242"/><circle cx="150" cy="150" r="3" class="dot"/><circle cx="268" cy="150" r="3" class="dot"/><circle cx="150" cy="32" r="3" class="dot"/></svg>
  <svg class="bio-art bio-art-l" viewBox="0 0 300 300" aria-hidden="true"><circle cx="150" cy="150" r="118"/><circle cx="150" cy="150" r="70"/><path d="M32 150h236M150 32v236"/><circle cx="150" cy="80" r="3" class="dot"/></svg>
  <div class="wrap bio-in">
    <div data-reveal>
      <p class="eyebrow" lang="en">Biography</p>
      <h2 class="bio-motto" id="bio-title">考える。<br>つくる。<br>磨き続ける。</h2>
    </div>
    <div class="prose" data-reveal>
      ${site.aboutHtml}
      <ul class="facts-line">
        <li>開発歴 ${site.years}年</li>
        ${f.work_style ? `<li>${esc(f.work_style)}</li>` : ""}
        ${f.nda ? `<li>NDA ${esc(f.nda)}</li>` : ""}
        ${l.rank ? `<li>ランサーズ ${esc(l.rank)}</li>` : ""}
        ${(l.verified ?? []).length ? `<li>${esc(l.verified.join("・"))}済み</li>` : ""}
      </ul>
    </div>
  </div>
</section>
<section class="ch ch-night manifesto${hasSec(site, "sec-manifesto")}" aria-labelledby="values-title">
  ${secImg(site, base, "sec-manifesto")}
  <div class="wrap">
    <header class="man-head"><p class="eyebrow" lang="en">Craft Manifesto</p><h2 id="values-title">大切に<br>していること</h2></header>
    <ol class="values values-3">
      ${(() => {
        const v = profile.values ?? [];
        const groups = [
          ['<svg viewBox="0 0 40 40"><path d="M14 9c7 2 12 8 13 15 .6 4-1.6 7-4.6 7-3.2 0-4.6-2.7-4.8-6-.3-5.2-2.1-10.6-3.6-16z"/></svg>', "深く考える", [0, 2]],
          ['<svg viewBox="0 0 40 40"><circle cx="20" cy="21" r="10" fill="none" stroke-width="3.2"/></svg>', "丁寧につくる", [3, 1]],
          ['<svg viewBox="0 0 40 40"><path d="M21.5 6h6l-5.5 19h-4z"/><circle cx="18" cy="32" r="3"/></svg>', "そして、磨き続ける", [4]],
        ];
        // Your values, grouped under the mockup's three headings; any extra values go last.
        const used = new Set(groups.flatMap((g) => g[2]));
        const rest = v.map((_, i) => i).filter((i) => !used.has(i));
        if (rest.length) groups[2][2].push(...rest);
        return groups
          .map(([mark, t, ix]) => `<li data-reveal><span class="values-mark" aria-hidden="true">${mark}</span><h3 class="values-title">${t}</h3><p>${ix.filter((i) => v[i]).map((i) => esc(v[i])).join("。<br>")}。</p></li>`)
          .join("\n      ");
      })()}
    </ol>
  </div>
</section>
${
  cases.length
    ? `<section class="ch ch-mist journey" aria-labelledby="journey-title">
  <div class="wrap">
    ${secImg(site, base, "sec-about-steps", "journey-bg")}
    <div class="journey-head">
      ${heading("Experience", "これまでの歩み", { id: "journey-title", lead: `開発歴${site.years}年。AI・Webシステムの開発を中心に、さまざまな業種のプロジェクトを担当してきました。` })}
    </div>
    <details class="pk-more journey-more">
      <summary><span>これまでのプロジェクト（${cases.length}件）を見る</span>${icon("arrow")}</summary>
      <p class="fine journey-note">ランサーズのプロフィールの「ビジネス経験」と同じ内容です。お客さまの名前は伏せています。</p>
    <ol class="timeline">
      ${cases.map((c) => `<li data-reveal><span class="timeline-stone" aria-hidden="true"></span>${caseItem(c)}</li>`).join("\n      ")}
      ${l.joined ? `<li data-reveal><span class="timeline-stone" aria-hidden="true"></span><div class="acc acc-static"><span class="acc-meta">${dotDate(l.joined)} –</span><span class="acc-title">ランサーズで活動を開始（${esc(l.rank ?? "")}・評価${esc(String(l.reviews ?? "").replace(/（.*$/, ""))}）</span></div></li>` : ""}
    </ol>
    </details>
  </div>
</section>`
    : ""
}
<section class="ch ch-pearl stackch" aria-labelledby="stack-title">
  <div class="wrap stack-band">
    <div class="stack-copy">
      ${heading("Tools &amp; Technology", "ものづくりを支える、<br>技術の星座", { id: "stack-title", lead: "目的に合わせて最適な技術を選び、<br>組み合わせながら、<br>柔軟で拡張性のあるものづくりを行います。" })}
      <p class="stack-certs">保有資格 ${(profile.certifications ?? []).length}件<br>（AWS・Google Cloud・Azure・情報処理安全確保支援士 ほか）</p>
    </div>
    <div class="constel${hasSec(site, "sec-about-constellation")}" aria-hidden="true">
      ${secImg(site, base, "sec-about-constellation", "constel-art")}
      <svg viewBox="0 0 600 360" preserveAspectRatio="xMidYMid meet"><ellipse cx="300" cy="180" rx="250" ry="92"/><ellipse cx="300" cy="180" rx="190" ry="140" transform="rotate(-18 300 180)"/><ellipse cx="300" cy="180" rx="150" ry="60" transform="rotate(24 300 180)"/></svg>
      <span class="constel-core"></span>
      ${(() => {
        // The names around the painted sphere (centre 58.6% / 49%), each with a gold leader to the rings.
        const stars = [["Next.js", 47, 26], ["React", 33, 36], ["Python", 30, 55], ["Docker", 38, 70], ["AWS", 61, 76], ["Shopify", 82, 69], ["OpenAI", 89, 52], ["WordPress", 85, 31]];
        const cx = 58.6, cy = 49, rx = 18, ry = 14.5;
        const lines = stars.map(([, x, y]) => {
          const a = Math.atan2((y - cy) / ry, (x - cx) / rx);
          const ex = cx + rx * Math.cos(a), ey = cy + ry * Math.sin(a);
          const dx = ex - x, dy = (ey - y) / 1.5, len = Math.hypot(dx, dy);
          const sx = x + (dx / len) * 4.2, sy = y + ((dy / len) * 4.2) * 1.5;
          return `<line x1="${(sx * 1.5).toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(ex * 1.5).toFixed(1)}" y2="${ey.toFixed(1)}"/><circle cx="${(ex * 1.5).toFixed(1)}" cy="${ey.toFixed(1)}" r="0.55"/>`;
        });
        return `<svg class="constel-leaders" viewBox="0 0 150 100" preserveAspectRatio="none" aria-hidden="true">${lines.join("")}</svg>${stars.map(([t, x, y]) => `<span class="constel-star constel-${x < cx ? "l" : "r"}" style="left:${x}%;top:${y}%">${t}</span>`).join("")}`;
      })()}
    </div>
  </div>
  <div class="wrap">
    <details class="pk-more stack-more">
      <summary><span>使っている技術と保有資格の一覧を見る</span>${icon("arrow")}</summary>
      <div class="two stack-lists">
        <div>
          <h3 class="h3">主な技術</h3>
          <dl class="stack">
            ${STACK.map(([k, xs]) => `<div><dt lang="en">${esc(k)}</dt><dd>${chips(xs)}</dd></div>`).join("\n            ")}
          </dl>
        </div>
        <div>
          <h3 class="h3">保有資格</h3>
          <ul class="certs">
            ${(profile.certifications ?? []).map((c) => `<li><time datetime="${esc(c.date)}">${dotDate(c.date)}</time>${esc(c.name)}</li>`).join("\n            ")}
          </ul>
        </div>
      </div>
    </details>
  </div>
</section>
${inquiry(site, base, { title: "一緒に、価値あるものをつくりませんか。", titleHtml: "一緒に、価値あるものをつくりませんか。", text: "ご相談・ご依頼・ご質問など、お気軽にお問い合わせください。", textHtml: "ご相談・ご依頼・ご質問など、<br>お気軽にお問い合わせください。", shape: "center", eyebrow: "", art: "sec-about-cta", light: true, label: "Contact", btnCls: "btn-frame btn-frame-dark", lancers: false })}`;
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
      <h1 class="display">小さく始めて、<br><em>大きく</em>育てる。</h1>
      <p class="lead">いきなり大きな投資は必要ありません。<br>まずは課題の見極めと検証から。<br>確かめながら、段階的に広げていく進め方をおすすめしています。</p>
    </div>`,
  })}
<section class="ch ch-pearl" aria-labelledby="eng-title">
  <div class="wrap">
    <header class="sh sh-center sh-latin" data-reveal>
      <h2 id="eng-title"><span class="latin-title" lang="en">Engagement</span><span class="sh-ja">課題の整理から実装、そして成果の最大化まで。<br>フェーズに応じて、必要な支援を最適なかたちでご提供します。</span></h2>
    </header>
    <ol class="tiers">
      ${tiers
        .map(
          (t, i) => `<li class="tier" data-reveal style="--rise:${i}">
        ${secImg(site, base, `sec-tier-${i + 1}`, "tier-orn")}
        <span class="tier-no" lang="en">${t.no}</span>
        <h3 class="h3">${t.t}</h3>
        <p>${t.d}</p>
        <p class="tier-actions"><a class="btn btn-ghost btn-sm tier-btn" href="${contactHref(base, "?topic=estimate")}">個別お見積もり</a><a class="more" href="${base}${t.href}">関連するサービス${icon("arrow")}</a></p>
      </li>`,
        )
        .join("\n      ")}
    </ol>
    <div class="compare" data-reveal>
      <div class="compare-head"><h3 class="h3 compare-title">支援内容の比較</h3><p class="compare-note">各フェーズでご提供する主な支援の内容を、比較形式でご確認いただけます。</p></div>
      <table class="matrix">
        <thead><tr><th scope="col">主な支援内容</th>${tiers.map((t) => `<th scope="col">${t.t}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map(([k, v]) => `<tr><th scope="row">${k}</th>${v.map((x, i) => `<td data-label="${tiers[i].t}">${x ? `<span class="dot" role="img" aria-label="対応"></span>` : `<span class="dash" role="img" aria-label="対象外">—</span>`}</td>`).join("")}</tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
    <div class="pk-block" id="packages" data-reveal>
      <div class="pk-head"><p class="eyebrow" lang="en">Packages</p><h3 class="h3 pk-title" id="pk-title">パッケージ料金</h3><p class="pk-lead">${`ランサーズで出品している${n}のパッケージです（${jaDate(profile.lancers?.as_of)}時点）。ベーシック・スタンダード・プレミアムの3プランから選べます。`}</p></div>
      <details class="pk-more" id="pk-list">
      <summary><span>${n}のパッケージの料金と納期を見る</span>${icon("arrow")}</summary>
      <div class="table-scroll"><table class="table table-prices">
        <thead><tr><th scope="col">パッケージ</th><th scope="col">料金</th><th scope="col">納期の目安</th></tr></thead>
        <tbody>
          ${pkRows.join("\n          ")}
        </tbody>
      </table></div>
      <p class="fine">パッケージ名を押すと、ランサーズで各プランの内容を確認できます。</p>
    </details>
    </div>
  </div>
</section>
<section class="ch ch-mist plan${hasSec(site, "sec-silk")}${site.art.section("sec-prices-steps") ? " plan-pilot" : ""}" aria-labelledby="plan-title">
  ${secImg(site, base, "sec-silk")}
  <div class="wrap">
    ${heading("Scope Planning", "プロジェクトの進め方", { id: "plan-title", lead: "課題や目的に合わせて範囲と体制を決め、段階的に積み上げていきます。" })}
  </div>
  <div class="plan-stage">
    ${secImg(site, base, "sec-prices-steps", "plan-art")}
    ${steps([
      { t: "課題の整理", d: "現状と目指す姿を整理し、取り組むテーマを決めます。" },
      { t: "スコープ設計", d: "検証の内容・成果物・進め方を決め、計画にします。" },
      { t: "実行・検証", d: "設計・開発・テストを通じて、解決策を確かめます。" },
      { t: "展開・拡張", d: "運用と改善を重ね、対象の業務や機能を広げます。" },
    ], { cls: "steps-rise" })}
  </div>
</section>
<section class="ch ch-night slogan${hasSec(site, "sec-pricing-band")}" aria-label="ご提案">
  ${secImg(site, base, "sec-pricing-band")}
  <div class="wrap center" data-reveal>
    <h2 class="h2">必要なものを、<wbr>必要なだけ。</h2>
    <p>目的や状況に合わせて、支援の内容と体制をご提案します。<br>まずは現在の課題や構想をお聞かせください。</p>
    <p><a class="btn btn-frame" href="${contactHref(base, "?topic=estimate")}">${icon("doc")}提案のご相談・お見積もりのご依頼${icon("arrow")}</a></p>
  </div>
</section>
<section class="ch ch-pearl" aria-labelledby="faq-title">
  <div class="wrap faq-split">
    ${heading("FAQ", "よくあるご質問", { id: "faq-title", lead: "ご相談前に多くいただくご質問をまとめました。<br>その他のご不明点も、どうぞお気軽にお問い合わせください。" })}
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
      <h1 class="display">信頼は、<br><em>仕事のあと</em>に残る。</h1>
      <p class="lead">ランサーズでいただいた評価${list.length}件は、すべて「満足」です。案件名と日付を添えて、原文のまま掲載しています。</p>
    </div>`,
  })}
<section class="ch ch-pearl rv${hasSec(site, "sec-silk")}" aria-labelledby="rv-title">
  ${secImg(site, base, "sec-silk")}
  <div class="wrap">
    <div class="value-band" data-reveal><p class="value-label" lang="en">Client Voices<br>Our Value</p><p class="value-line">いただいた信頼の声は、<br>これからの仕事を、さらに良くするための道しるべです。</p></div>
    <h2 class="sr-only" id="rv-title">いただいた評価（新しい順）</h2>
    <div class="reviews" data-more="7" data-step="6">
      ${(() => {
        const card = (t) => {
          const w = workOf.get(t.id);
          if (featured && t.id === featured.id)
            return `<figure class="quote quote-hero" id="${esc(t.id)}">
        ${site.art.stage("reviews").plate ? `<span class="qh-art" aria-hidden="true"><img src="${base}${site.art.stage("reviews").wide}" alt="" loading="lazy" decoding="async" width="${site.art.stage("reviews").w}" height="${site.art.stage("reviews").h}"></span>` : ""}
        <div class="qh-head">${icon("quote", "quote-mark")}<p class="qh-title">${esc(jobName(t))}</p></div>
        <div class="qh-body">
          <blockquote><p>${esc(t.comment)}</p></blockquote>
          <figcaption>${stars()}<span class="quote-meta">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
          ${w ? `<p class="quote-link"><a href="${base}works/${esc(w.id)}/">この案件の実績：${esc(workName(w))}${icon("arrow", "ic ic-xs")}</a></p>` : ""}
        </div>
      </figure>`;
          // A picture for every card: the project's own, else the artwork of the matching service.
          const thumb = w ? workImage(w) : (() => {
            const id = /脆弱性|バグ|不具合|修正|セキュリティ/.test(t.job) ? "quality" : /AI|機械学習|エージェント|ChatGPT/.test(t.job) ? "ai-apps" : /WordPress|CMS|サイト|HTML|LP|コーディング|Elementor|Firebase/.test(t.job) ? "wordpress" : "system";
            const pa = site.art.stage(`svc-${id}`);
            return pa.plate ? pa.narrow : null;
          })();
          const thumbAr = thumb ? (site.size(thumb) ?? [1000, 860]).join("/") : "";
          return `<figure class="quote quote-full quote-card${t.comment ? "" : " quote-quiet"}${thumb ? " has-art" : ""}" id="${esc(t.id)}">
        ${thumb ? `<span class="qc-art" aria-hidden="true"><img src="${base}${esc(thumb)}" alt="" loading="lazy" decoding="async"${(() => { const wh = site.size(thumb); return wh ? ` width="${wh[0]}" height="${wh[1]}"` : ""; })()}></span>` : ""}
        <div class="qc-head">
          <div class="qc-title">${icon("quote", "quote-mark")}<p>${esc(jobName(t))}</p></div>
        </div>
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="quote-none">（コメントは公開されていません。評価は「満足」です）</p>`}
        <figcaption>${stars()}<span class="quote-meta">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
        ${w ? `<p class="quote-link"><a href="${base}works/${esc(w.id)}/">この案件の実績：${esc(workName(w))}${icon("arrow", "ic ic-xs")}</a></p>` : `<p class="quote-link quote-link-none" aria-hidden="true"></p>`}
      </figure>`;
        };
        // As in the mockup: three cards, the featured voice across the row, then the rest.
        const rest = list.filter((t) => !featured || t.id !== featured.id);
        const ordered = featured ? [...rest.slice(0, 3), featured, ...rest.slice(3)] : rest;
        return ordered.map(card).join("\n      ");
      })()}
    </div>
  </div>
</section>
<section class="ch ch-mist dialog" aria-labelledby="dlg-title">
  <div class="wrap">
    ${heading("Our Communication", "対話から、<br>品質が生まれる。", { id: "dlg-title", lead: "ご依頼の前後を通じた、ていねいな対話を大切にしています。<br>その積み重ねが、安心と、より良い成果につながると考えています。" })}
    <ul class="bubbles${hasSec(site, "sec-bubble")}">
      ${values.slice(0, 3).map((v, i) => `<li data-reveal style="--i:${i}">${secImg(site, base, "sec-bubble", "bubble-bg")}${icon(["speech", "gears", "shield"][i], "ic bubble-ic")}<b class="bubble-title">${["丁寧なヒアリング", "こまめな共有・確認", "原因からの改善"][i]}</b><span>${esc(v)}</span></li>`).join("\n      ")}
    </ul>
    <div class="feedback" data-reveal>
      <span class="fb-ic" aria-hidden="true">${icon("bars")}</span>
      <div class="fb-head"><h3 class="h3">ご意見を、<br>次の改善へ。</h3><p class="fb-label" lang="en">Feedback &amp; Improvement</p></div>
      <p class="fb-text">納品後のご意見やご要望も、改善の機会として大切にしています。<br>いただいた評価は、ランサーズでも確認できます。</p>
    </div>
    <p class="fb-more">${ext(l.reviews_url ?? l.profile_url, `${icon("ext", "ic btn-pre")}Lancersで評価を見る${icon("chevron")}`, "btn btn-plate")}</p>
  </div>
</section>
${inquiry(site, base, { title: "ご相談からでも、お気軽にお問い合わせください。", titleHtml: "ご相談からでも、<br>お気軽に<span class=\"nowrap\">お問い合わせください。</span>", text: "ご要望の整理や、どのような進め方がよいかのご相談だけでも歓迎です。", label: "Webサイトからお問い合わせ", compact: false, eyebrow: "Contact", art: site.art.section("sec-reviews-cta") ? "sec-reviews-cta" : null, btnPre: "mail", chev: true })}`;
  return layout(site, { route: "reviews/", title: "お客さまの声", description, body, ld: [personLd(site), crumbLd(site, [["お客さまの声", "reviews/"]])], tone: site.art.stage("reviews").tone });
}

export function renderContact(site) {
  const { profile, services, works } = site;
  const base = "../";
  const endpoint = profile.contact_form?.endpoint ?? "";
  const description = `${profile.name}へのお問い合わせ。AI開発・Web制作・システム開発のご相談を、このページのフォームから受け付けています。`;
  const form = renderInquiryForm
    ? renderInquiryForm({ endpoint, lancersUrl: profile.contact_url, services, works: works.all, base }).replace('<div class="inq-intro">', `<div class="inq-intro">${secImg(site, base, "sec-contact-side", "inq-art")}`)
    : `<p class="fine">フォームを準備しています。<a href="${esc(profile.contact_url)}">Lancersからご相談ください。</a></p>`;
  const css = fs.existsSync(new URL("../../site/assets/contact.css", import.meta.url)) ? `<link rel="stylesheet" href="${base}assets/contact.css?v=${site.assetVersion}">\n` : "";
  const js = fs.existsSync(new URL("../../site/assets/contact.js", import.meta.url)) ? `<script src="${base}assets/contact.js?v=${site.assetVersion}" defer></script>\n` : "";
  const body = `${stage(site, base, {
    scene: "contact",
    inner: `    <div class="stage-copy">
      ${crumbs(base, [[null, "お問い合わせ"]])}
      <p class="kicker" lang="en">Contact</p>
      <h1 class="display display-line">まだ、言葉にならない<em>構想</em>から。</h1>
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

