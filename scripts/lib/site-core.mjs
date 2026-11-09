// Hub site: data loading and page rendering. Everything comes from profile.yml,
// site/ (service copy, works, Lancers packages, about text) and the published articles.
// The look and motion live in site/assets/style.css and site/assets/app.js; every
// page works without JavaScript, and motion is skipped for prefers-reduced-motion.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";
import YAML from "yaml";

const LANCERS_PACKAGE = (id) => `https://www.lancers.jp/menu/detail/${id}`;
const LANCERS_JOB = (id) => `https://www.lancers.jp/work/detail/${id}`;
const PLATFORM_LABEL = { zenn: "Zenn", qiita: "Qiita", note: "note" };

// ---------- data ----------

const isSet = (v) => typeof v === "string" && v.trim() !== "" && !/^\s*TODO\b/.test(v);

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, "utf8")) ?? {};
}

export function careerYears(start, today = new Date()) {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(String(start ?? ""));
  if (!m) return null;
  const months = (today.getFullYear() - Number(m[1])) * 12 + today.getMonth() + 1 - Number(m[2] ?? 1);
  return Math.floor(months / 12);
}

function gitFirstDate(root, file) {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--follow", "--format=%cs", "--", file], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().split("\n").filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

function articleDate(root, file, data) {
  const fm = data.published_at ?? data.date;
  if (fm) return String(fm instanceof Date ? fm.toISOString() : fm).slice(0, 10);
  return gitFirstDate(root, file) ?? fs.statSync(file).mtime.toISOString().slice(0, 10);
}

/** Published articles with their public URLs, newest first. */
export function listArticles(root, profile) {
  const p = profile.platforms ?? {};
  const out = [];
  const each = (dir, fn) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs).filter((n) => n.endsWith(".md")).sort()) {
      const file = path.join(abs, name);
      const { data } = matter(fs.readFileSync(file, "utf8"));
      const url = fn(data, path.basename(name, ".md"));
      if (url && data.title) out.push({ platform: dir, title: String(data.title), url, date: articleDate(root, file, data) });
    }
  };
  each("articles", (d, slug) => d.published === true && isSet(p.zenn) && `https://zenn.dev/${p.zenn}/articles/${slug}`);
  each("public", (d) => d.ignorePublish === false && d.private !== true && d.id && isSet(p.qiita) && `https://qiita.com/${p.qiita}/items/${d.id}`);
  each("notes", (d) => d.status === "ready" && typeof d.url === "string" && d.url.startsWith("https://note.com/") && d.url);
  for (const a of out) a.platform = { articles: "zenn", public: "qiita", notes: "note" }[a.platform];
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Pixel size of a WebP, PNG or JPEG file, read from its header (null if unknown). */
export function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 30) return null;
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") {
      const n = b.readUInt32LE(21);
      return [(n & 0x3fff) + 1, ((n >>> 14) & 0x3fff) + 1];
    }
  }
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

export function loadSite({ root, profile, today = new Date() }) {
  const packages = readYaml(path.join(root, "site", "packages.yml"));
  const byId = (list, kind) => {
    const map = new Map((list ?? []).map((x) => [x.id, x]));
    return (id, where) => {
      if (!map.has(id)) throw new Error(`${where}: unknown ${kind} "${id}" (profile.yml has: ${[...map.keys()].join(", ")})`);
      return map.get(id);
    };
  };
  const caseById = byId(profile.cases, "case");
  const testimonialById = byId(profile.testimonials, "testimonial");
  // Media paths in packages.yml and works.yml are relative to site/assets/; fail the build on a typo.
  const asset = (rel, where) => {
    if (rel == null) return null;
    if (!fs.existsSync(path.join(root, "site", "assets", rel))) throw new Error(`${where}: site/assets/${rel} does not exist`);
    return `assets/${rel}`;
  };
  const media = (id, p) => ({
    cover: asset(p.cover, `site/packages.yml ${id} cover`),
    video: asset(p.video, `site/packages.yml ${id} video`),
  });

  const services = (profile.services ?? []).map((s, i) => {
    const rel = `site/services/${s.id}.md`;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) throw new Error(`${rel} is missing: every service in profile.yml needs a page`);
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    const pkgs = (data.packages ?? []).map((id) => {
      const p = packages[String(id)];
      if (!p) throw new Error(`${rel}: package ${id} is not in site/packages.yml`);
      return { id: String(id), url: LANCERS_PACKAGE(id), title: p.title, plans: p.plans ?? [], ...media(id, p) };
    });
    const prices = pkgs.flatMap((p) => p.plans.map((x) => x.price)).filter(Number.isFinite);
    return {
      ...s,
      no: String(i + 1).padStart(2, "0"),
      description: data.description ?? s.summary,
      packages: pkgs,
      cover: pkgs.find((p) => p.cover)?.cover ?? null,
      priceFrom: prices.length ? Math.min(...prices) : null,
      cases: (data.cases ?? []).map((id) => caseById(id, rel)),
      testimonials: (data.testimonials ?? []).map((id) => testimonialById(id, rel)),
      faq: data.faq ?? [],
      html: marked.parse(content),
    };
  });
  const serviceById = byId(services, "service");

  // Works: live sites you helped build, and the Lancers portfolio items (each backed by reviews).
  const worksFile = path.join(root, "site", "works.yml");
  const worksRaw = fs.existsSync(worksFile) ? readYaml(worksFile) : {};
  const sites = (worksRaw.sites ?? []).map((w) => {
    const where = `site/works.yml ${w.id}`;
    return {
      ...w,
      kindOf: "site",
      service: w.service ? serviceById(w.service, where) : null,
      page: asset(w.page, `${where} page`),
      top: asset(w.top, `${where} top`),
      phone: asset(w.phone, `${where} phone`),
      host: new URL(w.url).host,
    };
  });
  const lancers = (worksRaw.lancers ?? []).map((w) => {
    const where = `site/works.yml ${w.id}`;
    return {
      ...w,
      kindOf: "lancers",
      service: w.service ? serviceById(w.service, where) : null,
      cover: asset(w.cover, `${where} cover`),
      reviews: (w.reviews ?? []).map((id) => testimonialById(id, where)),
      jobUrl: w.job ? LANCERS_JOB(w.job) : null,
    };
  });
  const works = [...sites, ...lancers];
  const seen = new Set();
  for (const w of works) {
    if (seen.has(w.id)) throw new Error(`site/works.yml: duplicate id "${w.id}"`);
    seen.add(w.id);
  }
  works.forEach((w, i) => (w.no = String(i + 1).padStart(2, "0")));
  // Each service's promo video: the first of its packages that has one.
  for (const s of services) s.video = s.packages.find((p) => p.video) ?? null;

  const years = careerYears(profile.facts?.career_start, today);
  const aboutFile = path.join(root, "site", "about.md");
  const aboutHtml = fs.existsSync(aboutFile)
    ? marked.parse(fs.readFileSync(aboutFile, "utf8").replaceAll("{{CAREER_YEARS}}", String(years ?? "")))
    : "";

  const serviceOf = new Map(services.flatMap((s) => s.packages.map((p) => [p.id, s])));
  const allPackages = Object.entries(packages).map(([id, p]) => {
    const plans = p.plans ?? [];
    const prices = plans.map((x) => x.price).filter(Number.isFinite);
    const days = plans.map((x) => x.days).filter(Number.isFinite);
    return {
      id,
      url: LANCERS_PACKAGE(id),
      title: p.title,
      plans,
      ...media(id, p),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      minDays: days.length ? Math.min(...days) : null,
      maxDays: days.length ? Math.max(...days) : null,
      service: serviceOf.get(id) ?? null,
    };
  });
  // Group by service (in profile order); packages no service page covers go last.
  // (Object keys that look like numbers come back sorted numerically, not in file order.)
  const rank = (p) => (p.service ? services.indexOf(p.service) : services.length);
  allPackages.sort((a, b) => rank(a) - rank(b) || (a.minPrice ?? 0) - (b.minPrice ?? 0));

  // A short hash of the stylesheet and script, added to their URLs so browsers
  // never keep an old copy after a deploy.
  const assetVersion = createHash("sha1")
    .update(["style.css", "app.js"].map((f) => {
      const file = path.join(root, "site", "assets", f);
      return fs.existsSync(file) ? fs.readFileSync(file) : "";
    }).join("\n"))
    .digest("hex")
    .slice(0, 8);

  // Image sizes go into width/height so nothing jumps while pictures load.
  const sizes = new Map();
  const size = (src) => {
    if (!sizes.has(src)) {
      const file = path.join(root, "site", src);
      sizes.set(src, fs.existsSync(file) ? imageSize(file) : null);
    }
    return sizes.get(src);
  };

  return {
    assetVersion,
    profile,
    services,
    packages: allPackages,
    works: { sites, lancers, all: works },
    years,
    aboutHtml,
    articles: listArticles(root, profile),
    size,
    today,
  };
}

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
const join = (xs) => xs.filter((x) => x !== false && x != null).join("\n"); // keeps blank lines
const ext = (url, text, cls = "") =>
  `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener">${text}<span class="sr-only">（新しいタブで開きます）</span></a>`;
const AI_NOTE = "画像・動画に登場する人物は、AIで生成したイメージキャラクターです。";

// Line icons (24×24, 1.5px stroke, currentColor). `solid` ones are filled.
const ICON = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
  ext: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  doc: '<path d="M7 3.5h6.5L18 8v12.5H7z"/><path d="M13.5 3.5V8H18M10 12.5h5M10 16h5"/>',
  sparkles: '<path d="M11 3.5l1.9 5.1L18 10.5l-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z"/><path d="M18.5 15.5v5M16 18h5"/>',
  chat: '<path d="M5.5 4.5h13a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5h0A1.5 1.5 0 0 1 4 15V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 9h8M8 12.2h5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M7.5 7.5h.01M7.5 16.5h.01M12 7.5h4.5M12 16.5h4.5"/>',
  layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9h17M9 9v10.5"/>',
  bag: '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  shield: '<path d="M12 3.5l7 2.8v5.4c0 4.2-3 7.4-7 9.3-4-1.9-7-5.1-7-9.3V6.3z"/><path d="M9 12l2.1 2.1 4-4.2"/>',
  play: '<path class="solid" d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z"/>',
  star: '<path class="solid" d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
};
const icon = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
const SERVICE_ICON = { "ai-apps": "sparkles", "ai-chatbot": "chat", "ai-consulting": "compass", "ai-infra": "server", wordpress: "layout", shopify: "bag", system: "grid", quality: "shield" };
const serviceIcon = (s) => icon(SERVICE_ICON[s.id] ?? "grid");
const stars = (n = 5) => `<span class="stars" role="img" aria-label="5段階中${n}">${icon("star", "st").repeat(n)}</span>`;

// The 匠 seal: Noto Sans JP Bold's 匠 outline (extracted with fontTools), white on vermilion.
const TAKUMI_GLYPH =
  "M370 451H906V347H370ZM595 423H709V98H595ZM309 634 448 606Q446 592 422 589V462Q422 424 418.0 376.0Q414 328 403.0 277.5Q392 227 371.5 178.5Q351 130 317 90Q309 103 294.0 118.5Q279 134 262.0 148.0Q245 162 232 169Q266 214 282.5 265.5Q299 317 304.0 368.5Q309 420 309 465ZM754 670 845 588Q779 568 699.0 553.5Q619 539 535.5 529.5Q452 520 374 514Q371 532 362.0 558.5Q353 585 344 602Q399 607 456.0 614.0Q513 621 567.5 629.5Q622 638 670.0 648.5Q718 659 754 670ZM82 803H938V690H201V-92H82ZM157 66H963V-47H157Z";
const seal = (cls = "seal") =>
  `<svg class="${cls}" viewBox="0 0 64 64" width="32" height="32" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="14" fill="currentColor"/><path fill="#fff" transform="matrix(.038 0 0 -.038 12.15 45.5)" d="${TAKUMI_GLYPH}"/></svg>`;

const img = (site, src, base, { alt = "", cls = "", eager = false, sizes = "" } = {}) => {
  const wh = site.size(src);
  return `<img${cls ? ` class="${cls}"` : ""} src="${base}${esc(src)}" alt="${esc(alt)}"${wh ? ` width="${wh[0]}" height="${wh[1]}"` : ""}${sizes ? ` sizes="${sizes}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};

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
const linkLabel = (u) =>
  /lancers/.test(u) ? "Lancers" : /zenn/.test(u) ? "Zenn" : /qiita/.test(u) ? "Qiita" : /note\.com/.test(u) ? "note" : "GitHub";

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

// ---------- layout ----------

function layout(site, { route, title, description, body, ld = [], absolute = false, image = null, page = "sub" }) {
  const { profile, services } = site;
  const depth = route.split("/").filter(Boolean).length;
  const base = absolute ? profile.site_url : depth ? "../".repeat(depth) : "./";
  const canonical = new URL(route, profile.site_url).href;
  const shareImage = image ?? "assets/og.jpg";
  const fullTitle = route === "" ? `${profile.brand}｜${profile.title}` : `${title}｜${profile.brand}`;
  const contact = esc(profile.contact_url);
  const nav = [
    ["works/", "実績", "Works"],
    ["#services", "サービス", "Services"],
    ["prices/", "料金", "Pricing"],
    ["reviews/", "お客さまの声", "Voice"],
    ["about/", "プロフィール", "About"],
  ];
  const current = (href) => (route !== "" && !href.startsWith("#") && route.startsWith(href) ? ' aria-current="page"' : "");
  const logo = (cls = "") =>
    `<a class="logo${cls}" href="${base}">${seal()}<span class="logo-text"><span class="logo-word">TAKUMI</span><span class="logo-sub">AI &amp; Web Engineering</span></span><span class="sr-only">匠（たくみ）トップページ</span></a>`;
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
<meta name="theme-color" content="#ffffff">
<meta name="color-scheme" content="light">
<link rel="icon" href="${base}assets/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${base}assets/brand/favicon-64.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="${base}assets/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..500&family=Noto+Sans+JP:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${base}assets/style.css?v=${site.assetVersion}">
<script>(function (d) { d.classList.replace("no-js", "js"); if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; d.classList.add("motion"); setTimeout(function () { if (!window.TAKUMI) d.classList.remove("motion"); }, 3000); })(document.documentElement);</script>
<script src="${base}assets/app.js?v=${site.assetVersion}" defer></script>
${ld.length ? jsonld({ "@context": "https://schema.org", "@graph": ld }) : ""}
</head>
<body class="page-${page}">
<a class="skip" href="#main">本文へ移動</a>
<div class="progress" aria-hidden="true"></div>
<header class="hd" data-hd>
  <div class="wrap hd-in">
    ${logo()}
    <nav class="nav" id="nav" aria-label="メインメニュー">
      <ul class="nav-list">
        ${nav.map(([href, ja, en], i) => `<li style="--i:${i}"><a href="${base}${href}"${current(href)}><span class="nav-en" aria-hidden="true">${en}</span><span class="nav-ja">${ja}</span></a></li>`).join("\n        ")}
      </ul>
      <div class="nav-foot">
        <a class="btn btn-accent" href="${contact}">ランサーズで相談する${icon("arrow")}</a>
        <p>ご相談・ご契約は、ランサーズを通してお受けしています。</p>
      </div>
    </nav>
    <div class="hd-act">
      <span class="status"><i aria-hidden="true"></i>ご相談受付中</span>
      <a class="btn btn-ink btn-sm hd-cta" href="${contact}">相談する${icon("arrow")}</a>
      <button class="menu-btn" type="button" aria-controls="nav" aria-expanded="false"><span class="sr-only">メニュー</span><i></i><i></i></button>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="ft">
  <div class="wrap">
    <div class="ft-top">
      <div class="ft-brand">
        ${logo(" logo-lg")}
        <p class="ft-tag">${esc(profile.tagline)}</p>
        <p class="ft-note">ご相談・ご契約は、ランサーズを通してお受けしています。</p>
      </div>
      <nav class="ft-nav" aria-label="サイト内リンク">
        <div>
          <p class="ft-h">Site</p>
          <ul>
            <li><a href="${base}works/">実績</a></li>
            <li><a href="${base}prices/">料金一覧</a></li>
            <li><a href="${base}reviews/">お客さまの声</a></li>
            <li><a href="${base}about/">プロフィール</a></li>
            <li><a href="${contact}">ご相談（ランサーズ）</a></li>
          </ul>
        </div>
        <div>
          <p class="ft-h">Services</p>
          <ul>
            ${services.map((s) => `<li><a href="${base}services/${esc(s.id)}/">${esc(s.name)}</a></li>`).join("\n            ")}
          </ul>
        </div>
        <div>
          <p class="ft-h">Elsewhere</p>
          <ul>
            ${sameAs(profile).map((u) => `<li>${ext(u, `${linkLabel(u)}${icon("ext", "ic ic-xs")}`)}</li>`).join("\n            ")}
          </ul>
        </div>
      </nav>
    </div>
    <p class="ft-colophon"><span class="mono">Colophon</span>このサイトは、Node.jsで書いた静的サイトジェネレーターで生成しています。ブラウザで動くJavaScriptとCSSのアニメーションは、ライブラリを使わずに書いています。</p>
    <div class="ft-bottom">
      <p>© ${site.today.getFullYear()} ${esc(profile.name)}</p>
      <p>${AI_NOTE}</p>
      <a class="to-top" href="#main">Back to top${icon("arrow-up", "ic ic-xs")}</a>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- shared blocks ----------

/** Section heading: an index and English label, the Japanese title, a lead and an optional link. */
function secHead({ no, en, title, lead = "", link = "", id = "" }) {
  return `<header class="sec-hd">
      <p class="sec-idx" data-reveal><span>${esc(no)}</span>${esc(en)}</p>
      <h2 class="sec-title" data-reveal${id ? ` id="${id}"` : ""}><span>${title}</span></h2>
      ${lead ? `<p class="sec-lead" data-reveal>${lead}</p>` : ""}
      ${link ? `<p class="sec-link" data-reveal>${link}</p>` : ""}
    </header>`;
}

function crumbs(base, list) {
  return `<nav class="crumbs" aria-label="パンくずリスト"><a href="${base}">Top</a>${list
    .map(([href, t]) => `<span aria-hidden="true">/</span>${href ? `<a href="${href}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}`)
    .join("")}</nav>`;
}

function pageHero(base, { idx, title, lead = "", trail = [], meta = "", aside = "" }) {
  return `<section class="ph${aside ? " ph-split" : ""}">
  <div class="wrap ph-in">
    <div class="ph-copy">
      ${crumbs(base, trail)}
      <p class="ph-idx" data-reveal>${idx}</p>
      <h1 class="ph-title" data-reveal><span>${title}</span></h1>
      ${lead ? `<p class="ph-lead" data-reveal>${lead}</p>` : ""}
      ${meta}
    </div>
    ${aside ? `<div class="ph-aside" data-reveal>${aside}</div>` : ""}
  </div>
</section>`;
}

function cta(site, { title = "まずは、目的をお聞かせください。", text = "「こんなことは実現できる？」という段階からで大丈夫です。目的と現状を伺い、進め方とお見積もりをご提案します。" } = {}) {
  const { profile } = site;
  const l = profile.lancers ?? {};
  return `<section class="cta" aria-labelledby="cta-title">
  <div class="wrap cta-in">
    <p class="cta-idx" data-reveal><i aria-hidden="true"></i>Available for new projects</p>
    <h2 class="cta-title" id="cta-title" data-reveal><span>${esc(title)}</span></h2>
    <div class="cta-row">
      <p class="cta-text" data-reveal>${esc(text)}</p>
      <a class="btn btn-accent btn-xl" href="${esc(profile.contact_url)}" data-reveal data-magnetic>ランサーズで無料相談する${icon("arrow")}</a>
    </div>
    <ul class="cta-points" data-reveal>
      ${l.reply_rate_24h ? `<li>${icon("check")}24時間以内の返信率 ${esc(l.reply_rate_24h)}</li>` : ""}
      <li>${icon("check")}代金はランサーズの仮払いで安心</li>
      <li>${icon("check")}NDA（秘密保持契約）対応</li>
      <li>${icon("check")}ビデオ通話での打ち合わせ</li>
    </ul>
  </div>
</section>`;
}

/** The headline numbers, read from profile.yml (Lancers) and the career start. */
function proofItems(site) {
  const l = site.profile.lancers ?? {};
  return [
    [site.years, "年", "開発歴"],
    [num(l.reviews), "件", "評価すべて「満足」"],
    [num(l.completion_rate), "%", "プロジェクト完了率"],
    [num(l.repeat_clients), "人", "リピーターのお客さま"],
    [(site.profile.certifications ?? []).length, "件", "AI・クラウドの資格"],
  ].filter(([v]) => Number.isFinite(v) && v > 0);
}

function proofList(site, cls = "proof") {
  const l = site.profile.lancers ?? {};
  return `<div class="${cls}">
    <ul class="proof-list">
      ${proofItems(site)
        .map(([v, unit, k]) => `<li data-reveal><span class="proof-v"><b data-count="${v}">${v}</b>${unit}</span><span class="proof-k">${esc(k)}</span></li>`)
        .join("\n      ")}
    </ul>
    <p class="proof-note">ランサーズの公開プロフィールより（${jaDate(l.as_of)}時点）・${ext(l.profile_url, "プロフィールを見る")}</p>
  </div>`;
}

const chips = (xs, cls = "chips") => `<ul class="${cls}">${(xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

const reviewText = (t, max = 0) => {
  const s = t.quote ?? t.comment ?? "";
  return max && [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
};
const jobName = (t) => t.job.replace(/^【[^】]*】/, "");

function caseItem(c) {
  return `<details class="acc case" id="${esc(c.id)}">
      <summary><span class="acc-meta">${esc(c.period)}</span><span class="acc-title">${esc(c.title)}</span><span class="acc-icon" aria-hidden="true"></span></summary>
      <div class="acc-body">
        <dl class="case-dl">
          <div><dt>体制</dt><dd>${esc(c.team)}</dd></div>
          <div><dt>担当</dt><dd>${esc(c.role)}</dd></div>
          <div><dt>課題</dt><dd>${esc(c.challenge)}</dd></div>
          <div><dt>取り組み</dt><dd>${esc(c.actions)}</dd></div>
          <div class="case-result"><dt>成果</dt><dd>${esc(c.result)}</dd></div>
        </dl>
        ${chips(c.stack, "chips chips-mono")}
      </div>
    </details>`;
}

function caseCard(c) {
  return `<article class="pcard" data-reveal>
      <p class="pcard-meta">${esc(c.period)}</p>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.result)}</p>
      ${chips(c.stack, "chips chips-mono")}
    </article>`;
}

function quoteCard(t, { max = 0 } = {}) {
  return `<figure class="qcard">
        ${stars()}
        <blockquote><p>${esc(reviewText(t, max))}</p></blockquote>
        <figcaption><span>${esc(jobName(t))}</span><span class="mono">${dotDate(t.date)}${t.repeat ? ` · ${esc(t.repeat)}` : ""}</span></figcaption>
      </figure>`;
}

const COMMON_FAQ = [
  { q: "秘密保持契約（NDA）は結べますか？", a: "はい、対応しています。ご相談の段階から、お預かりする情報は秘密として扱います。" },
  {
    q: "契約と支払いはどうなりますか？",
    a: "ランサーズを通してご契約いただきます。代金はいったんランサーズに仮払いされ、納品をご確認いただいてから支払われます。",
  },
  { q: "打ち合わせはできますか？", a: "はい。メッセージでのやり取りのほか、ビデオ通話での打ち合わせにも対応しています。" },
  { q: "仕様が決まっていなくても相談できますか？", a: "はい。「こんなことは実現できる？」という段階から、目的を伺って一緒に整理します。" },
];

function faqList(items) {
  return `<div class="faq">
      ${items.map((f) => `<details class="acc" data-reveal><summary><span class="acc-q" aria-hidden="true">Q</span><span class="acc-title">${esc(f.q)}</span><span class="acc-icon" aria-hidden="true"></span></summary><div class="acc-body"><p>${esc(f.a)}</p></div></details>`).join("\n      ")}
    </div>`;
}

function faqSection(no, items, { alt = false } = {}) {
  return `<section class="sec${alt ? " sec-alt" : ""}" id="faq">
  <div class="wrap split">
    ${secHead({ no, en: "FAQ", title: "よくある質問" })}
    ${faqList(items)}
  </div>
</section>`;
}

const ldFaq = (items) => ({
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** A service tile: number, icon, field, name, summary and the starting price. */
function serviceTile(s, base, { compact = false } = {}) {
  return `<a class="svc" href="${base}services/${esc(s.id)}/" data-reveal>
        <span class="svc-top"><span class="svc-no">${s.no}</span><span class="svc-ic">${serviceIcon(s)}</span></span>
        <span class="svc-pillar">${esc(s.pillar ?? "")}</span>
        <span class="svc-name">${esc(s.name)}</span>
        ${compact ? "" : `<span class="svc-sum">${esc(s.summary)}</span>`}
        <span class="svc-foot"><span class="svc-price">${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"}</span><span class="svc-go">${icon("arrow")}</span></span>
      </a>`;
}

// ---------- works ----------

const pillarOf = (w) => w.service?.pillar ?? "その他";
const workName = (w) => (w.kindOf === "site" ? w.name : w.headline);

/** A browser window and a phone showing a live site; the page scrolls inside the window on hover. */
function siteFrames(site, w, base, { eager = false } = {}) {
  return `<div class="frames">
      <div class="browser">
        <div class="browser-bar" aria-hidden="true"><i></i><i></i><i></i><span class="browser-url">${icon("lock", "ic ic-xs")}${esc(w.host)}</span></div>
        <div class="browser-screen">${img(site, w.page, base, { alt: `${w.name}のトップページ`, cls: "scroll-shot", eager })}</div>
      </div>
      <div class="phone"><div class="phone-screen">${img(site, w.phone, base, { alt: `${w.name}のスマートフォン表示` })}</div></div>
    </div>`;
}

function siteFeature(site, w, base) {
  return `<article class="feature" data-reveal>
      <a class="feature-media" href="${base}works/${esc(w.id)}/" tabindex="-1" aria-hidden="true" data-cursor="View">${siteFrames(site, w, base)}</a>
      <div class="feature-body">
        <p class="meta"><span class="mono">No.${w.no}</span><span class="tag tag-live"><i aria-hidden="true"></i>Live site</span><span>${esc(w.kind)}</span></p>
        <h3 class="feature-title"><a href="${base}works/${esc(w.id)}/">${esc(w.name)}</a></h3>
        <p class="feature-sum">${esc(w.summary)}</p>
        <p class="feature-role">${esc(w.role)}</p>
        <p class="feature-links"><a class="link" href="${base}works/${esc(w.id)}/">詳しく見る${icon("arrow")}</a>${ext(w.url, `${esc(w.host)}${icon("ext", "ic ic-xs")}`, "link link-muted")}</p>
      </div>
    </article>`;
}

/** One row of the Lancers works index; the cover follows the cursor on hover (desktop). */
function workRow(site, w, base) {
  return `<li data-reveal><a class="wrow" href="${base}works/${esc(w.id)}/" data-preview="${base}${esc(w.cover)}">
        <span class="wrow-no mono">${w.no}</span>
        <span class="wrow-thumb">${img(site, w.cover, base)}</span>
        <span class="wrow-title">${esc(w.headline)}</span>
        <span class="wrow-ind">${esc(w.industry ?? "")}</span>
        <span class="wrow-cat">${esc(pillarOf(w))}</span>
        <span class="wrow-rv">${icon("star", "st")}評価${w.reviews.length}件</span>
        <span class="wrow-go">${icon("arrow")}</span>
      </a></li>`;
}

function workCard(site, w, base) {
  const isSite = w.kindOf === "site";
  return `<li class="wcard" data-cat="${esc(pillarOf(w))}" data-reveal>
        <a href="${base}works/${esc(w.id)}/">
          <span class="wcard-media${isSite ? " wcard-site" : ""}" data-cursor="View">${isSite ? img(site, w.top, base) : img(site, w.cover, base)}</span>
          <span class="wcard-meta"><span class="mono">No.${w.no}</span><span>${esc(pillarOf(w))}</span>${isSite ? '<span class="tag tag-live"><i aria-hidden="true"></i>Live site</span>' : `<span class="tag">${icon("star", "st")}評価${w.reviews.length}件</span>`}</span>
          <span class="wcard-title">${esc(workName(w))}</span>
          <span class="wcard-sub">${esc(isSite ? w.kind : (w.industry ?? ""))}</span>
        </a>
      </li>`;
}

/** Lancers portfolio text → HTML. Review quotes and the image list are left out: the page
 * shows the full reviews instead, and the images only exist on Lancers. */
function workBody(text) {
  const out = [];
  let stack = null;
  for (const block of String(text ?? "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const h = /^【(.+?)】(.*)$/.exec(lines[0]);
    if (h && /評価|掲載画像/.test(h[1])) continue;
    if (h) out.push(`<h2>${esc(h[1])}${h[2] ? `<small>${esc(h[2])}</small>` : ""}</h2>`);
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(esc).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((x) => `<li>${esc(x)}</li>`).join("")}</${list.tag}>`);
      list = null;
    };
    for (const line of h ? lines.slice(1) : lines) {
      let m;
      if ((m = /^使用技術：(.+)$/.exec(line))) {
        stack = m[1].split("／");
        continue;
      }
      if (/^制作期間：/.test(line)) continue;
      const item = (m = /^・(.+)$/.exec(line)) ? ["ul", m[1]] : (m = /^\d+\.\s*(.+)$/.exec(line)) ? ["ol", m[1]] : null;
      if (item) {
        flushPara();
        if (list?.tag !== item[0]) flushList();
        list ??= { tag: item[0], items: [] };
        list.items.push(item[1]);
      } else {
        flushList();
        if (line.trim()) para.push(line);
      }
    }
    flushPara();
    flushList();
  }
  return { html: out.join("\n"), stack };
}

/** Markdown HTML split at each <h2> into rows: heading on the left, content on the right. */
const splitProse = (html) =>
  html
    .split(/(?=<h2)/)
    .filter((x) => x.trim())
    .map((part) => `<section class="prose-row" data-reveal>${part}</section>`)
    .join("\n");

// ---------- hero demo: code on the left, the screen it builds on the right ----------

const TS_TOKENS =
  /(?<cm>\/\/.*$)|(?<st>"[^"]*"|'[^']*')|(?<tg><\/?[A-Z]\w*>?|\/>|>$)|(?<kw>\b(?:import|from|export|async|function|const|await|if|return)\b)|(?<nm>\b\d+(?:\.\d+)?\b)|(?<fn>\b[a-zA-Z_]\w*(?=\())|(?<pr>\b[a-zA-Z_]\w*(?==|:\s))|(?<ty>\b(?:[A-Z]\w*|string|number)\b)/g;

function highlight(line, lang) {
  if (lang === "yml") {
    const m = /^(\s*)(- )?([\w-]+)(:)(.*)$/.exec(line);
    if (!m) return esc(line);
    const [, ind, dash, key, , rest] = m;
    const val = rest.trimStart();
    const gap = rest.slice(0, rest.length - val.length);
    const v = val.startsWith("[")
      ? val.replace(/[^[\],\s]+/g, (w) => `<span class="tk-st">${esc(w)}</span>`).replace(/[[\],]/g, (c) => `<span class="tk-p">${c}</span>`)
      : val && `<span class="tk-st">${esc(val)}</span>`;
    return `${ind}${dash ? '<span class="tk-p">-</span> ' : ""}<span class="tk-pr">${key}</span><span class="tk-p">:</span>${gap}${v}`;
  }
  let out = "";
  let at = 0;
  for (const m of line.matchAll(TS_TOKENS)) {
    const kind = Object.entries(m.groups).find(([, v]) => v !== undefined)[0];
    out += `${esc(line.slice(at, m.index))}<span class="tk-${kind}">${esc(m[0])}</span>`;
    at = m.index + m[0].length;
  }
  return out + esc(line.slice(at));
}
// Width in monospace cells (Japanese characters take two), used to pace the typing.
const cells = (s) => [...s].reduce((n, c) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);

const DEMO = [
  {
    file: "rag.ts",
    lang: "ts",
    label: "TypeScript",
    url: "assistant.example.jp",
    code: [
      'import { llm, search } from "./lib";',
      "",
      "export async function answer(q: string) {",
      "  const docs = await search(q, { topK: 4 });",
      "  if (!docs.length) {",
      '    return { text: "資料に記載がありません。" };',
      "  }",
      "  const res = await llm.generate({",
      '    system: "参照資料だけを根拠に答える",',
      "    input: { q, docs },",
      "  });",
      "  return { text: res.text, sources: docs };",
      "}",
    ],
    ui: () => `<div class="ui ui-chat">
          <div class="ui-hd"><span class="ui-av">${icon("sparkles")}</span><span class="ui-hd-t"><b>社内アシスタント</b><small>社内資料をもとに回答します</small></span></div>
          <div class="chat">
            <p class="bub bub-me" data-at="2">有給休暇は、何日前までに申請が必要ですか？</p>
            <p class="chat-note" data-at="3">${icon("doc")}社内資料を検索しました — 4件を参照</p>
            <div class="bub bub-ai" data-at="9"><p data-stream>原則として、取得日の3営業日前までに勤怠システムから申請してください。急な体調不良の場合は、当日の連絡でも取得できます。</p></div>
            <p class="srcs" data-at="11"><span>${icon("doc")}就業規則 第24条</span><span>${icon("doc")}勤怠マニュアル p.8</span></p>
          </div>
          <div class="ui-input"><span>質問を入力…</span><span class="ui-send">${icon("arrow-up")}</span></div>
        </div>`,
  },
  {
    file: "Sales.tsx",
    lang: "ts",
    label: "React · TSX",
    url: "admin.example.jp/sales",
    code: [
      "export function Sales({ orders }: Props) {",
      "  const total = sum(orders, (o) => o.amount);",
      "  const avg = total / orders.length;",
      "",
      "  return (",
      "    <Grid cols={3}>",
      '      <Kpi label="売上" value={yen(total)} />',
      '      <Kpi label="受注件数" value={orders.length} />',
      '      <Kpi label="平均単価" value={yen(avg)} />',
      "      <BarChart data={byMonth(orders)} />",
      "    </Grid>",
      "  );",
      "}",
    ],
    ui: () => {
      const bars = [
        ["1月", 52],
        ["2月", 61],
        ["3月", 57],
        ["4月", 70],
        ["5月", 79],
        ["6月", 94],
      ];
      return `<div class="ui ui-dash">
          <div class="ui-hd"><span class="ui-hd-t"><b>売上ダッシュボード</b><small>2026年 上半期</small></span><span class="ui-chip">月次</span></div>
          <div class="kpis">
            <div class="kpi" data-at="6"><small>売上</small><b>¥<span data-to="4820000">4,820,000</span></b><em>+12.4%</em></div>
            <div class="kpi" data-at="7"><small>受注件数</small><b><span data-to="1284">1,284</span><i>件</i></b><em>+8.1%</em></div>
            <div class="kpi" data-at="8"><small>平均単価</small><b>¥<span data-to="3754">3,754</span></b><em>+4.0%</em></div>
          </div>
          <div class="chart" data-at="9">
            <div class="chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="bars">${bars.map(([m, h], i) => `<span class="bar" style="--h:${h}%;--i:${i}"><i></i><small>${m}</small></span>`).join("")}</div>
          </div>
        </div>`;
    },
  },
  {
    file: "ci.yml",
    lang: "yml",
    label: "YAML",
    url: "ci.example.jp/runs/482",
    code: [
      "name: ci",
      "on: [push, pull_request]",
      "",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: npm ci",
      "      - run: npm run lint",
      "      - run: npm test -- --coverage",
      "      - run: npm run audit:security",
      "      - run: npx playwright test",
      "      - run: npm run deploy",
    ],
    ui: (n) => {
      const rows = [
        [8, "Install", "npm ci", "12s"],
        [9, "Lint", "0 problems", "4s"],
        [10, "Unit tests", "214 passed · coverage 92%", "31s"],
        [11, "Security audit", "0 vulnerabilities", "9s"],
        [12, "E2E tests", "36 passed", "1m 04s"],
        [13, "Deploy", "production", "22s"],
      ];
      return `<div class="ui ui-ci">
          <div class="ui-hd"><span class="ui-hd-t"><b>Checks</b><small class="mono">main · a1c9f3e</small></span><span class="ci-badge" data-at="${n}">${icon("check")}All checks passed</span></div>
          <ul class="ci">
            ${rows.map(([at, name, note, time]) => `<li data-at="${at}"><span class="ci-st"><i class="spin"></i>${icon("check")}</span><b>${name}</b><small>${note}</small><em class="mono">${time}</em></li>`).join("\n            ")}
          </ul>
        </div>`;
    },
  },
];

function heroDemo() {
  const tabs = DEMO.map((d, i) => `<button class="demo-tab" type="button" aria-pressed="${i === 0}" data-scene="${i}">${esc(d.file)}</button>`).join("");
  const codes = DEMO.map(
    (d, i) => `<div class="code-scene" data-i="${i}"${i ? " hidden" : ""}>
        <pre class="code"><code>${d.code.map((line, k) => `<span class="ln"><span class="lno">${k + 1}</span><span class="cl" data-len="${cells(line)}">${highlight(line, d.lang) || " "}</span></span>`).join("")}</code></pre>
        <p class="code-status"><span><i aria-hidden="true"></i>main</span><span>${esc(d.label)}</span><span>UTF-8</span><span class="code-pos">Ln ${d.code.length}, Col 2</span></p>
      </div>`,
  ).join("\n      ");
  const uis = DEMO.map(
    (d, i) => `<div class="ui-scene" data-i="${i}" data-url="${esc(d.url)}"${i ? " hidden" : ""}>
        ${d.ui(d.code.length)}
      </div>`,
  ).join("\n      ");
  return `<div class="demo" data-demo>
    <p class="sr-only">コードを書くと、右側の画面ができあがる様子のデモです。社内文書から答えるAIチャットボット、売上ダッシュボード、テストと公開を自動で行う仕組みの3つを切り替えられます。</p>
    <div class="demo-win demo-code">
      <div class="win-bar"><span class="win-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="demo-tabs" role="group" aria-label="デモを切り替える">${tabs}</span></div>
      <div class="code-wrap" aria-hidden="true">
      ${codes}
      </div>
    </div>
    <div class="demo-win demo-ui" aria-hidden="true">
      <div class="win-bar win-bar-light"><span class="win-dots"><i></i><i></i><i></i></span><span class="win-url">${icon("lock", "ic ic-xs")}<span data-url>${esc(DEMO[0].url)}</span></span></div>
      <div class="ui-wrap">
      ${uis}
      </div>
    </div>
  </div>`;
}

// ---------- pages ----------

const FLOW = [
  ["ランサーズで相談", "「こんなことは実現できる？」という段階からどうぞ。ご相談は無料です。"],
  ["ヒアリング・ご提案", "目的と現状を伺い、進め方とお見積もりをご提案します。"],
  ["ご契約", "ランサーズで契約します。代金は仮払いされ、納品の確認後に支払われます。"],
  ["開発・進捗の共有", "こまめに進捗を共有し、途中で確認していただきながら進めます。"],
  ["納品・保守", "納品後の修正や、保守・運用のご依頼も続けてお受けします。"],
];

// The stack, grouped. Everything here appears in profile.yml (projects, certifications) or works.yml.
const STACK = [
  ["AI・LLM", ["OpenAI API", "ChatGPT", "RAG", "LangChain", "ベクトル検索", "AIエージェント"]],
  ["Backend", ["Python", "FastAPI", "Django", "Node.js", "TypeScript", "PHP"]],
  ["Frontend", ["React", "Next.js", "JavaScript", "HTML / CSS", "WebRTC"]],
  ["CMS・EC", ["WordPress", "Elementor", "Shopify"]],
  ["Data", ["PostgreSQL", "MySQL", "Elasticsearch", "SQLite"]],
  ["Cloud・Infra", ["AWS", "Azure", "Google Cloud", "Firebase", "Docker", "Kubernetes", "Terraform"]],
  ["Security", ["OAuth 2.0", "JWT", "OWASP", "脆弱性診断"]],
];

function expertise(site) {
  const certs = site.profile.certifications ?? [];
  return `<div class="exp">
      <div class="stack">
        ${STACK.map(([k, xs]) => `<div class="stack-row" data-reveal><p class="stack-k">${esc(k)}</p>${chips(xs, "chips chips-mono")}</div>`).join("\n        ")}
      </div>
      <div class="certs" data-reveal>
        <p class="certs-h"><span>Certifications</span><span class="mono">${certs.length}</span></p>
        <ol class="cert-list">
          ${certs.map((c) => `<li><time class="mono" datetime="${esc(c.date)}">${dotDate(c.date)}</time><span>${esc(c.name)}</span></li>`).join("\n          ")}
        </ol>
      </div>
    </div>`;
}

export function renderIndex(site) {
  const { profile, services, years, works } = site;
  const base = "./";
  const l = profile.lancers ?? {};
  const description = `${profile.title}の${profile.name}です。開発歴${years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムの開発を、要件の整理から保守まで担当します。`;
  const featured = works.lancers.filter((w) => w.featured);
  const tts = (profile.testimonials ?? []).filter((t) => t.quote ?? t.comment);
  const lead = tts.find((t) => t.featured) ?? tts[0];
  const rest = tts.filter((t) => t !== lead);
  const since = /^(\d{4})/.exec(String(profile.facts?.career_start ?? ""))?.[1];
  let n = 0;
  const no = () => pad2(++n);

  const body = `<section class="hero" data-hero>
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap">
    <div class="hero-top">
      <p class="eyebrow" data-hero-in><i aria-hidden="true"></i>${esc(profile.title)}${since ? `<span class="sep">/</span><span class="mono">Since ${since}</span>` : ""}</p>
      <h1 class="hero-title"><span class="ln"><span>目的から設計する、</span></span><span class="ln"><span><span class="nw">AI・Webシステム</span><span class="nw">開発。</span></span></span></h1>
      <div class="hero-side">
        <p class="hero-lead" data-hero-in>ChatGPT・RAGを使った業務アプリから、WordPress・Shopifyのサイト、業務システムまで。要件の整理から納品後の保守まで、ひとりで通して担当します。</p>
        <p class="hero-cta" data-hero-in>
          <a class="btn btn-ink btn-lg" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで相談する${icon("arrow")}</a>
          <a class="btn btn-line btn-lg" href="#works">実績を見る</a>
        </p>
      </div>
    </div>
    <div class="hero-demo" data-hero-in>
      ${heroDemo()}
    </div>
    ${proofList(site, "proof hero-proof")}
  </div>
</section>
<section class="sec" id="works">
  <div class="wrap">
    ${secHead({ no: no(), en: "Selected Work", title: "実績", lead: "開発に参加した公開中のサイトと、ランサーズで評価をいただいた案件です。", link: `<a class="link" href="works/">すべての実績<span class="mono">${works.all.length}</span>${icon("arrow")}</a>` })}
    <div class="features">
      ${works.sites.map((w) => siteFeature(site, w, base)).join("\n      ")}
    </div>
    <div class="windex">
      <div class="windex-hd" data-reveal>
        <h3>ランサーズでの受注案件</h3>
        <p>${stars()}<span>すべてお客さまの評価つき</span></p>
      </div>
      <ol class="wrows" data-preview-list>
        ${featured.map((w) => workRow(site, w, base)).join("\n        ")}
      </ol>
      <p class="windex-more" data-reveal><a class="btn btn-line" href="works/">すべての実績を見る（${works.all.length}件）${icon("arrow")}</a></p>
    </div>
  </div>
</section>
<section class="sec sec-alt" id="services">
  <div class="wrap">
    ${secHead({ no: no(), en: "Services", title: "サービス", lead: `AIの導入から、サイト・業務システムの開発、引き継いだシステムの不具合調査まで。ランサーズで${site.packages.length}のパッケージを出品しています。`, link: `<a class="link" href="prices/">料金一覧${icon("arrow")}</a>` })}
    <div class="svc-grid">
      ${services.map((s) => serviceTile(s, base)).join("\n      ")}
    </div>
  </div>
</section>
<section class="sec" id="approach">
  <div class="wrap">
    <div class="split">
      ${secHead({ no: no(), en: "Approach", title: "進め方", lead: "技術だけでなく、目的の理解と、こまめな共有を大切にしています。" })}
      <ol class="principles">
        ${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="mono">${pad2(i + 1)}</span><p>${esc(v)}</p></li>`).join("\n        ")}
      </ol>
    </div>
    <ol class="flow" data-flow>
      ${FLOW.map(([h, t], i) => `<li data-reveal><span class="flow-no mono">Step ${pad2(i + 1)}</span><h3>${esc(h)}</h3><p>${esc(t)}</p></li>`).join("\n      ")}
    </ol>
  </div>
</section>
<section class="sec sec-alt" id="voice">
  <div class="wrap">
    ${secHead({ no: no(), en: "Voice", title: "お客さまの声", link: `<a class="link" href="reviews/">${(profile.testimonials ?? []).length}件の評価を読む${icon("arrow")}</a>` })}
    <div class="voice">
      <div class="score" data-reveal>
        <p class="score-n"><b data-count="${num(l.reviews)}">${num(l.reviews)}</b><span>/${num(l.reviews)}</span></p>
        ${stars()}
        <p class="score-k">ランサーズの評価が、すべて「満足」</p>
      </div>
      ${
        lead
          ? `<figure class="voice-lead" data-reveal>
        <blockquote><p>${esc(reviewText(lead))}</p></blockquote>
        <figcaption><span>${esc(jobName(lead))}</span><span class="mono">${dotDate(lead.date)}${lead.repeat ? ` · ${esc(lead.repeat)}` : ""}</span></figcaption>
      </figure>`
          : ""
      }
    </div>
    <div class="carousel" data-carousel>
      <ul class="car-track" tabindex="0" aria-label="お客さまの声の一覧（横にスクロールできます）">
        ${rest.map((t) => `<li>${quoteCard(t, { max: 110 })}</li>`).join("\n        ")}
      </ul>
      <div class="car-ctrl">
        <span class="car-bar" aria-hidden="true"><i></i></span>
        <button class="car-btn" type="button" data-dir="-1"><span class="sr-only">前へ</span>${icon("arrow")}</button>
        <button class="car-btn" type="button" data-dir="1"><span class="sr-only">次へ</span>${icon("arrow")}</button>
      </div>
    </div>
  </div>
</section>
<section class="sec" id="expertise">
  <div class="wrap">
    ${secHead({ no: no(), en: "Expertise", title: "技術と資格", lead: `AIとクラウド、Web、セキュリティまで。開発歴${years}年で使ってきた技術と、保有している資格です。` })}
    ${expertise(site)}
  </div>
</section>
${
  site.articles.length
    ? `<section class="sec sec-alt" id="articles">
  <div class="wrap">
    ${secHead({ no: no(), en: "Writing", title: "最近の記事" })}
    <ul class="articles">
      ${site.articles
        .slice(0, 6)
        .map((a) => `<li data-reveal><a href="${esc(a.url)}"><span class="tag">${PLATFORM_LABEL[a.platform]}</span><span class="article-title">${esc(a.title)}</span><time class="mono" datetime="${esc(a.date)}">${dotDate(a.date)}</time></a></li>`)
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
${faqSection(no(), COMMON_FAQ, { alt: !site.articles.length })}
${cta(site)}`;
  const ld = [
    personLd(site),
    { "@type": "WebSite", "@id": `${profile.site_url}#website`, url: profile.site_url, name: profile.brand, inLanguage: "ja" },
    ldFaq(COMMON_FAQ),
  ];
  return layout(site, { route: "", title: profile.brand, description, body, ld, page: "home" });
}

export function renderService(site, s) {
  const { profile, services } = site;
  const base = "../../";
  const route = `services/${s.id}/`;
  const url = new URL(route, profile.site_url).href;
  const media = (p) =>
    p.video
      ? `<video class="pkg-video" controls preload="none" playsinline poster="${base}${esc(p.cover ?? "")}" width="1280" height="720" aria-label="${esc(p.title)}の紹介動画"><source src="${base}${esc(p.video)}" type="video/mp4"></video>`
      : p.cover
        ? img(site, p.cover, base, { alt: p.title })
        : "";
  const packages = s.packages
    .map(
      (p) => `<article class="pkg" data-reveal>
      <div class="pkg-media">${media(p)}</div>
      <div class="pkg-body">
        <p class="pkg-k mono">Lancers package${p.video ? " · 紹介動画つき" : ""}</p>
        <h3 class="pkg-title">${ext(p.url, `${esc(p.title)}${icon("ext", "ic ic-xs")}`)}</h3>
        <div class="table-scroll"><table class="plans">
          <thead><tr><th scope="col">プラン</th><th scope="col">料金</th><th scope="col">納期の目安</th><th scope="col">内容</th></tr></thead>
          <tbody>
            ${p.plans
              .map(
                (x) =>
                  `<tr><th scope="row">${esc(x.name)}</th><td class="num" data-label="料金">${yen(x.price)}</td><td class="num" data-label="納期の目安">${x.days ? `${x.days}日` : "—"}</td><td data-label="内容">${x.desc ? esc(x.desc) : ext(p.url, "ランサーズで確認")}</td></tr>`,
              )
              .join("\n            ")}
          </tbody>
        </table></div>
      </div>
    </article>`,
    )
    .join("\n    ");
  const related = site.works.all.filter((w) => w.service?.id === s.id);
  const faq = [...s.faq, ...COMMON_FAQ];
  const facts = `<dl class="facts" data-reveal>
        <div><dt>料金の目安</dt><dd>${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"}</dd></div>
        <div><dt>分野</dt><dd>${esc(s.pillar ?? "")}</dd></div>
        <div><dt>パッケージ</dt><dd>${s.packages.length}件</dd></div>
        ${related.length ? `<div><dt>実績</dt><dd>${related.length}件</dd></div>` : ""}
      </dl>
      <p class="ph-cta" data-reveal><a class="btn btn-ink btn-lg" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで相談する${icon("arrow")}</a>${s.packages.length ? `<a class="btn btn-line btn-lg" href="#price">料金を見る</a>` : ""}</p>`;
  let n = 0;
  const no = () => pad2(++n);
  const body = `${pageHero(base, {
    idx: `<span class="mono">Service ${s.no} / ${pad2(services.length)}</span>`,
    title: esc(s.name),
    lead: esc(s.description),
    trail: [[`${base}#services`, "サービス"], [null, s.name]],
    meta: facts,
    aside: `<div class="ph-mark">${serviceIcon(s)}</div>`,
  })}
<section class="sec sec-tight">
  <div class="wrap prose prose-split">
    ${splitProse(s.html)}
  </div>
</section>
${
  s.packages.length
    ? `<section class="sec sec-alt" id="price">
  <div class="wrap">
    ${secHead({ no: no(), en: "Pricing", title: "料金の目安", lead: `ランサーズで出品しているパッケージの料金です（${jaDate(profile.lancers?.as_of)}時点）。内容に合わせた個別のお見積もりもできます。${s.packages.some((p) => p.video) ? "紹介動画の案内役は、AIで生成したキャラクターです。" : ""}` })}
    <div class="pkgs">
    ${packages}
    </div>
  </div>
</section>`
    : ""
}
${
  related.length
    ? `<section class="sec">
  <div class="wrap">
    ${secHead({ no: no(), en: "Work", title: "このサービスの実績" })}
    <ul class="wgrid">
      ${related.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
${
  s.cases.length
    ? `<section class="sec${related.length ? " sec-alt" : ""}">
  <div class="wrap">
    ${secHead({ no: no(), en: "Projects", title: "関連する開発実績", link: `<a class="link" href="${base}works/#projects">すべてのプロジェクト${icon("arrow")}</a>` })}
    <div class="pgrid">
      ${s.cases.map((c) => caseCard(c)).join("\n      ")}
    </div>
  </div>
</section>`
    : ""
}
${
  s.testimonials.filter((t) => t.quote ?? t.comment).length
    ? `<section class="sec">
  <div class="wrap">
    ${secHead({ no: no(), en: "Voice", title: "お客さまの声", link: `<a class="link" href="${base}reviews/">${(profile.testimonials ?? []).length}件の評価を読む${icon("arrow")}</a>` })}
    <div class="qgrid">
      ${s.testimonials
        .filter((t) => t.quote ?? t.comment)
        .map((t) => `<div data-reveal>${quoteCard(t)}</div>`)
        .join("\n      ")}
    </div>
  </div>
</section>`
    : ""
}
${faqSection(no(), faq, { alt: true })}
<section class="sec">
  <div class="wrap">
    ${secHead({ no: no(), en: "Other services", title: "ほかのサービス" })}
    <div class="svc-grid svc-grid-compact">
      ${services.filter((o) => o.id !== s.id).map((o) => serviceTile(o, base, { compact: true })).join("\n      ")}
    </div>
  </div>
</section>
${cta(site, { title: `${s.name}のご相談`, text: "目的と現状を伺い、進め方とお見積もりをご提案します。仕様が決まっていない段階でも大丈夫です。" })}`;
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
      ...(s.priceFrom && {
        offers: { "@type": "AggregateOffer", priceCurrency: "JPY", lowPrice: s.priceFrom, url: s.packages[0]?.url },
      }),
    },
    ldFaq(faq),
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "トップ", item: profile.site_url },
        { "@type": "ListItem", position: 2, name: s.name, item: url },
      ],
    },
  ];
  return layout(site, { route, title: s.name, description: s.description, body, ld });
}

export function renderWorks(site) {
  const { profile, works } = site;
  const base = "../";
  const cats = [...new Set(works.all.map(pillarOf))];
  const cases = profile.cases ?? [];
  const description = `${profile.name}の実績。開発に参加した公開中のサイト${works.sites.length}件と、ランサーズで評価をいただいた案件${works.lancers.length}件、これまでのプロジェクト${cases.length}件を紹介します。`;
  const body = `${pageHero(base, {
    idx: `<span class="mono">Works — ${works.all.length + cases.length}</span>`,
    title: "実績",
    lead: "開発に参加した公開中のサイトと、ランサーズでお受けした案件です。ランサーズの案件は、お客さまの評価とあわせて掲載しています。お客さまの名前は伏せています。",
    trail: [[null, "実績"]],
  })}
<section class="sec sec-tight">
  <div class="wrap">
    <div class="filters" role="group" aria-label="分野で絞り込む" data-filters>
      <button type="button" aria-pressed="true" data-filter="all">すべて<span class="mono">${works.all.length}</span></button>
      ${cats.map((c) => `<button type="button" aria-pressed="false" data-filter="${esc(c)}">${esc(c)}<span class="mono">${works.all.filter((w) => pillarOf(w) === c).length}</span></button>`).join("\n      ")}
    </div>
    <p class="sr-only" aria-live="polite" data-filter-status></p>
    <ul class="wgrid" data-filter-list>
      ${works.all.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
    <p class="fine">ランサーズの案件のカバー画像はイメージです（実際の画面ではありません）。${AI_NOTE}</p>
  </div>
</section>
${
  cases.length
    ? `<section class="sec sec-alt" id="projects">
  <div class="wrap split">
    ${secHead({ no: "", en: "Projects", title: "これまでの開発実績", lead: "ランサーズを始める前から担当してきた主なプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です）。" })}
    <div class="acc-list">
    ${cases.map((c) => caseItem(c)).join("\n    ")}
    </div>
  </div>
</section>`
    : ""
}
${cta(site)}`;
  return layout(site, { route: "works/", title: "実績", description, body, ld: [personLd(site)] });
}

export function renderWork(site, w) {
  const { profile, works } = site;
  const base = "../../";
  const route = `works/${w.id}/`;
  const i = works.all.indexOf(w);
  const prev = works.all[(i - 1 + works.all.length) % works.all.length];
  const next = works.all[(i + 1) % works.all.length];
  const pager = `<nav class="pager" aria-label="ほかの実績">
  <div class="wrap pager-in">
    <a class="pager-prev" href="${base}works/${esc(prev.id)}/"><span class="mono">← Previous</span><span class="pager-t">${esc(workName(prev))}</span></a>
    <a class="pager-next" href="${base}works/${esc(next.id)}/"><span class="mono">Next →</span><span class="pager-t">${esc(workName(next))}</span></a>
  </div>
</nav>`;
  const serviceLink = w.service ? `<a href="${base}services/${esc(w.service.id)}/">${esc(w.service.name)}</a>` : "";
  let body;
  let description;
  let image;
  if (w.kindOf === "site") {
    description = `${w.name}（${w.host}）。${w.summary}`;
    image = w.top;
    body = `${pageHero(base, {
      idx: `<span class="mono">No.${w.no}</span><span class="tag tag-live"><i aria-hidden="true"></i>Live site</span><span>${esc(w.kind)}</span>`,
      title: esc(w.name),
      lead: esc(w.summary),
      trail: [[`${base}works/`, "実績"], [null, w.name]],
    })}
<section class="sec sec-tight">
  <div class="wrap">
    <div class="stage" data-reveal>${siteFrames(site, w, base, { eager: true })}</div>
    <dl class="meta-table" data-reveal>
      <div><dt>サイト</dt><dd>${ext(w.url, `${esc(w.host)}${icon("ext", "ic ic-xs")}`)}</dd></div>
      <div><dt>種類</dt><dd>${esc(w.kind)}</dd></div>
      <div><dt>担当</dt><dd>${esc(w.role)}</dd></div>
      ${serviceLink ? `<div><dt>関連するサービス</dt><dd>${serviceLink}</dd></div>` : ""}
    </dl>
    <p class="fine">画面は${jaDate(site.today.toISOString())}に撮影したものです。最新の内容はサイトでご確認ください。</p>
  </div>
</section>`;
  } else {
    const { html, stack } = workBody(w.body);
    description = `${w.title}。${w.subtitle}`;
    image = w.cover;
    const l = profile.lancers ?? {};
    body = `${pageHero(base, {
      idx: `<span class="mono">No.${w.no}</span><span>${esc(pillarOf(w))}</span><span class="tag">${icon("star", "st")}評価${w.reviews.length}件</span>`,
      title: esc(w.headline),
      lead: esc(w.title),
      trail: [[`${base}works/`, "実績"], [null, w.headline]],
    })}
<section class="sec sec-tight">
  <div class="wrap case">
    <div class="case-main">
      <figure class="case-cover" data-reveal>${img(site, w.cover, base, { alt: w.headline, eager: true })}<figcaption>画像はイメージです（実際の画面ではありません）。</figcaption></figure>
      <p class="case-sub" data-reveal>${esc(w.subtitle)}</p>
      <div class="prose case-body" data-reveal>
        ${html}
      </div>
    </div>
    <aside class="case-side" data-reveal>
      <dl class="meta-table">
        ${w.industry ? `<div><dt>業種</dt><dd>${esc(w.industry)}</dd></div>` : ""}
        <div><dt>カテゴリー</dt><dd>${esc(w.category)}</dd></div>
        ${w.days ? `<div><dt>制作期間</dt><dd>${w.days}日</dd></div>` : ""}
        ${w.price ? `<div><dt>参考価格</dt><dd>${yen(w.price)}〜</dd></div>` : ""}
        ${stack ? `<div><dt>使用技術</dt><dd>${chips(stack, "chips chips-mono")}</dd></div>` : ""}
        ${serviceLink ? `<div><dt>関連するサービス</dt><dd>${serviceLink}</dd></div>` : ""}
      </dl>
      ${w.jobUrl ? `<p class="case-job">${ext(w.jobUrl, `ランサーズの募集ページ${icon("ext", "ic ic-xs")}`)}</p>` : `<p class="case-job fine">非公開のご依頼です。</p>`}
    </aside>
  </div>
</section>
<section class="sec sec-alt">
  <div class="wrap split">
    ${secHead({ no: "", en: "Review", title: "お客さまの評価" })}
    <div class="case-reviews">
    ${w.reviews
      .map(
        (t) => `<figure class="case-review" data-reveal>
      ${stars()}
      ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません。評価は「満足」です）</p>`}
      <figcaption><span class="pill">満足</span><span>${jaDate(t.date)}・${esc(t.job)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span><a href="${base}reviews/#${esc(t.id)}">評価一覧で見る</a></figcaption>
    </figure>`,
      )
      .join("\n    ")}
      <p class="fine">評価は${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}で確認できます。</p>
      ${chips(w.keywords, "chips chips-line")}
    </div>
  </div>
</section>`;
  }
  body += `\n${pager}\n${cta(site)}`;
  const ld = [
    personLd(site),
    {
      "@type": "CreativeWork",
      name: workName(w),
      description,
      url: new URL(route, profile.site_url).href,
      ...(w.kindOf === "site" && { sameAs: w.url }),
      creator: { "@id": `${profile.site_url}#person` },
      inLanguage: "ja",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "トップ", item: profile.site_url },
        { "@type": "ListItem", position: 2, name: "実績", item: new URL("works/", profile.site_url).href },
        { "@type": "ListItem", position: 3, name: workName(w), item: new URL(route, profile.site_url).href },
      ],
    },
  ];
  return layout(site, { route, title: workName(w), description, body, ld, image });
}

export function renderAbout(site) {
  const { profile } = site;
  const base = "../";
  const l = profile.lancers ?? {};
  const f = profile.facts ?? {};
  const description = `${profile.title}、${profile.name}のプロフィール。開発歴${site.years}年、保有資格、大切にしていること。`;
  const aside = `<dl class="facts facts-card">
        <div><dt>開発歴</dt><dd>${site.years}年</dd></div>
        ${f.work_style ? `<div><dt>働き方</dt><dd>${esc(f.work_style)}</dd></div>` : ""}
        ${f.nda ? `<div><dt>NDA</dt><dd>${esc(f.nda)}</dd></div>` : ""}
        ${l.rank ? `<div><dt>ランサーズ</dt><dd>${esc(l.rank)}</dd></div>` : ""}
        ${(l.verified ?? []).length ? `<div><dt>確認済み</dt><dd>${esc(l.verified.join("・"))}</dd></div>` : ""}
        <div><dt>ご契約</dt><dd>ランサーズを通してお受けしています</dd></div>
      </dl>`;
  const body = `${pageHero(base, {
    idx: `<span class="mono">About</span><span>${esc(profile.title)}</span>`,
    title: esc(profile.name),
    lead: esc(profile.tagline),
    trail: [[null, "プロフィール"]],
    aside,
  })}
<section class="sec sec-tight">
  <div class="wrap split">
    <p class="about-k" data-reveal>Profile</p>
    <div class="prose about-prose" data-reveal>
      ${site.aboutHtml}
    </div>
  </div>
  <div class="wrap">${proofList(site)}</div>
</section>
<section class="sec sec-alt">
  <div class="wrap split">
    ${secHead({ no: "01", en: "Principles", title: "大切にしていること" })}
    <ol class="principles">
      ${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="mono">${pad2(i + 1)}</span><p>${esc(v)}</p></li>`).join("\n      ")}
    </ol>
  </div>
</section>
<section class="sec">
  <div class="wrap">
    ${secHead({ no: "02", en: "Expertise", title: "技術と資格" })}
    ${expertise(site)}
  </div>
</section>
${cta(site)}`;
  return layout(site, { route: "about/", title: "プロフィール", description, body, ld: [personLd(site)] });
}

const range = (a, b, unit) => (a == null ? "—" : a === b ? `${unit(a)}` : `${unit(a)}〜${unit(b)}`);

export function renderPrices(site) {
  const { profile } = site;
  const base = "../";
  const n = site.packages.length;
  const description = `${profile.name}がランサーズで出品している${n}のパッケージの料金と納期の一覧です。AI開発、WordPress・Shopify、業務システム、セキュリティ診断など。`;
  let group = undefined;
  const rows = site.packages.map((p) => {
    const head = p.service !== group ? `<tr class="grp"><th colspan="3" scope="colgroup">${p.service ? `<a href="../services/${esc(p.service.id)}/">${esc(p.service.name)}${icon("arrow", "ic ic-xs")}</a>` : "そのほか"}</th></tr>` : "";
    group = p.service;
    return `${head}<tr><th scope="row">${ext(p.url, esc(p.title))}</th><td class="num" data-label="料金">${range(p.minPrice, p.maxPrice, yen)}</td><td class="num" data-label="納期の目安">${range(p.minDays, p.maxDays, (d) => `${d}日`)}</td></tr>`;
  });
  const body = `${pageHero(base, {
    idx: `<span class="mono">Pricing — ${n} packages</span>`,
    title: "料金一覧",
    lead: `ランサーズで出品している${n}のパッケージです（${jaDate(profile.lancers?.as_of)}時点）。ベーシック・スタンダード・プレミアムの3プランから選べます。内容に合わせた個別のお見積もりもできます。`,
    trail: [[null, "料金"]],
  })}
<section class="sec sec-tight">
  <div class="wrap">
    <div class="table-scroll" data-reveal><table class="plans price-list">
      <thead><tr><th scope="col">パッケージ</th><th scope="col">料金</th><th scope="col">納期の目安</th></tr></thead>
      <tbody>
        ${rows.join("\n        ")}
      </tbody>
    </table></div>
    <p class="fine">パッケージ名をクリックすると、ランサーズで各プランの内容を確認できます。</p>
  </div>
</section>
${cta(site)}`;
  return layout(site, { route: "prices/", title: "料金一覧", description, body, ld: [personLd(site)] });
}

export function renderReviews(site) {
  const { profile } = site;
  const base = "../";
  const list = profile.testimonials ?? [];
  const l = profile.lancers ?? {};
  const workOf = new Map(site.works.lancers.flatMap((w) => w.reviews.map((t) => [t.id, w])));
  const description = `${profile.name}がランサーズでいただいた評価${list.length}件を、原文のまま掲載しています。`;
  const body = `${pageHero(base, {
    idx: `<span class="mono">Voice — ${list.length}</span>`,
    title: "お客さまの声",
    lead: `ランサーズでいただいた評価${list.length}件を、新しい順に原文のまま掲載しています。`,
    trail: [[null, "お客さまの声"]],
    aside: `<div class="score score-lg"><p class="score-n"><b data-count="${num(l.reviews)}">${num(l.reviews)}</b><span>/${num(l.reviews)}</span></p>${stars()}<p class="score-k">すべて「満足」</p></div>`,
  })}
<section class="sec sec-tight">
  <div class="wrap">
    <div class="reviews">
      ${list
        .map((t) => {
          const w = workOf.get(t.id);
          return `<figure class="rv" id="${esc(t.id)}" data-reveal>
        <p class="rv-top">${stars()}<span class="mono">${dotDate(t.date)}</span>${t.repeat ? `<span class="pill">${esc(t.repeat)}</span>` : ""}</p>
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません）</p>`}
        <figcaption>${esc(t.job)}</figcaption>
        ${w ? `<p class="rv-work"><a class="link" href="${base}works/${esc(w.id)}/">この案件の実績：${esc(w.headline)}${icon("arrow")}</a></p>` : ""}
      </figure>`;
        })
        .join("\n      ")}
    </div>
    <p class="fine">評価はランサーズでも確認できます。${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}</p>
  </div>
</section>
${cta(site)}`;
  return layout(site, { route: "reviews/", title: "お客さまの声", description, body, ld: [personLd(site)] });
}

export function render404(site) {
  const root = site.profile.site_url;
  const body = `<section class="nf">
  <div class="wrap nf-in">
    <p class="nf-code mono" aria-hidden="true">404</p>
    <h1 class="ph-title">ページが見つかりません</h1>
    <p class="ph-lead">URLが変わったか、ページが削除された可能性があります。</p>
    <p class="ph-cta"><a class="btn btn-ink btn-lg" href="${esc(root)}">トップへ戻る</a><a class="btn btn-line btn-lg" href="${esc(new URL("works/", root).href)}">実績を見る</a></p>
  </div>
</section>`;
  return layout(site, { route: "404.html", title: "ページが見つかりません", description: "ページが見つかりません。", body, absolute: true });
}

export function renderLlmsTxt(site) {
  const { profile, services, works } = site;
  return join([
    `# ${profile.brand}`,
    "",
    `> ${profile.title}の${profile.name}。開発歴${site.years}年。AI（ChatGPT・RAG・AIエージェント）とWeb・業務システムの開発を、要件の整理から保守まで担当。ご相談・ご契約はランサーズ経由: ${profile.contact_url}`,
    "",
    "## サービス",
    ...services.map((s) => `- [${s.name}](${new URL(`services/${s.id}/`, profile.site_url).href}): ${s.summary}${s.priceFrom ? `（${yen(s.priceFrom)}〜）` : ""}`),
    "",
    "## 実績",
    ...works.all.map(
      (w) =>
        `- [${workName(w)}](${new URL(`works/${w.id}/`, profile.site_url).href}): ${w.kindOf === "site" ? `${w.url} ${w.role}` : `${w.title}（ランサーズ・評価${w.reviews.length}件）`}`,
    ),
    "",
    "## ほか",
    `- [料金一覧（${site.packages.length}パッケージ）](${new URL("prices/", profile.site_url).href})`,
    `- [お客さまの声（${(profile.testimonials ?? []).length}件）](${new URL("reviews/", profile.site_url).href})`,
    `- [プロフィール](${new URL("about/", profile.site_url).href})`,
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
    `- 💬 お仕事のご相談: [ランサーズ](${l.profile_url ?? profile.contact_url})（${[l.rank, l.reviews && `評価${l.reviews.replace(/（.*$/, "")}すべて満足`].filter(Boolean).join("・")}）`,
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
    ...site.works.lancers.filter((w) => w.featured).slice(0, 5).map((w) => `- **${w.headline}**: ${w.title}`),
    "",
    `[すべての実績](${url("works/")})`,
    "",
    "## 資格",
    "",
    ...(profile.certifications ?? []).map((c) => `- ${c.name}（${c.date}）`),
    ...(site.articles.length
      ? ["", "## 最近の記事", "", ...site.articles.slice(0, 5).map((a) => `- [${a.title}](${a.url})（${PLATFORM_LABEL[a.platform]}）`)]
      : []),
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
    "about/index.html": renderAbout(site),
    "prices/index.html": renderPrices(site),
    "reviews/index.html": renderReviews(site),
    "404.html": render404(site),
    "llms.txt": renderLlmsTxt(site),
  };
  for (const s of site.services) files[`services/${s.id}/index.html`] = renderService(site, s);
  for (const w of site.works.all) files[`works/${w.id}/index.html`] = renderWork(site, w);
  const routes = [
    "",
    ...site.services.map((s) => `services/${s.id}/`),
    "works/",
    ...site.works.all.map((w) => `works/${w.id}/`),
    "prices/",
    "reviews/",
    "about/",
  ];
  files["sitemap.xml"] = renderSitemap(site, routes);
  files["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", site.profile.site_url).href}\n`;
  return files;
}
