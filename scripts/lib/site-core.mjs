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
import { isLive } from "./schedule.mjs";

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
  each("articles", (d, slug) => isLive(d) && isSet(p.zenn) && `https://zenn.dev/${p.zenn}/articles/${slug}`);
  each("public", (d) => d.ignorePublish === false && d.private !== true && d.id && isSet(p.qiita) && `https://qiita.com/${p.qiita}/items/${d.id}`);
  each("notes", (d) => d.status === "ready" && typeof d.url === "string" && d.url.startsWith("https://note.com/") && d.url);
  for (const a of out) a.platform = { articles: "zenn", public: "qiita", notes: "note" }[a.platform];
  // A post you publish on Zenn, Qiita and note is listed once (Zenn first).
  const order = { zenn: 0, qiita: 1, note: 2 };
  const seen = new Set();
  return out
    .sort((a, b) => order[a.platform] - order[b.platform])
    .filter((a) => !seen.has(a.title) && seen.add(a.title))
    .sort((a, b) => b.date.localeCompare(a.date));
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

  // Brand art (site/media.yml): the emblem and the showreel.
  const mediaFile = path.join(root, "site", "media.yml");
  const m = fs.existsSync(mediaFile) ? readYaml(mediaFile) : {};
  const art = {
    emblem: asset(m.emblem, "site/media.yml emblem"),
    emblemSmall: asset(m.emblem_small ?? m.emblem, "site/media.yml emblem_small"),
    showreel: m.showreel
      ? {
          video: asset(m.showreel.video, "site/media.yml showreel.video"),
          poster: asset(m.showreel.poster, "site/media.yml showreel.poster"),
          full: asset(m.showreel.full, "site/media.yml showreel.full"),
          title: m.showreel.title ?? "紹介動画",
        }
      : null,
  };

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
    art,
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
const AI_VIDEO_NOTE = "紹介動画の案内役は、AIで生成したキャラクターです。";

// Line icons (24×24, currentColor).
const ICON = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  ext: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path class="solid" d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z"/>',
  star: '<path class="solid" d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
};
const icon = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
const stars = (n = 5) => `<span class="stars" role="img" aria-label="5段階中${n}">${icon("star", "st").repeat(n)}</span>`;

const img = (site, src, base, { alt = "", cls = "", eager = false } = {}) => {
  const wh = site.size(src);
  return `<img${cls ? ` class="${cls}"` : ""} src="${base}${esc(src)}" alt="${esc(alt)}"${wh ? ` width="${wh[0]}" height="${wh[1]}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};

/** A package image shown whole in a 16:9 frame (Lancers images come in more than one
 * shape); a blurred copy of the same image fills any space around it. */
const pic = (site, src, base, opts = {}) => `<span class="pic">${img(site, src, base, { cls: "pic-fill" })}${img(site, src, base, opts)}</span>`;

/** The brand mark: your gold 匠 emblem (a text 匠 if site/media.yml has none). */
const mark = (site, base, size = 40) =>
  site.art.emblemSmall
    ? `<img class="mark" src="${base}${esc(site.art.emblemSmall)}" alt="" width="${size}" height="${size}">`
    : '<span class="mark mark-text" aria-hidden="true">匠</span>';

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
  const { profile } = site;
  const depth = route.split("/").filter(Boolean).length;
  const base = absolute ? profile.site_url : depth ? "../".repeat(depth) : "./";
  const canonical = new URL(route, profile.site_url).href;
  const shareImage = image ?? "assets/og.jpg";
  const fullTitle = route === "" ? `${profile.brand}｜${profile.title}` : `${title}｜${profile.brand}`;
  const contact = esc(profile.contact_url);
  const nav = [
    ["works/", "実績"],
    ["#services", "サービス"],
    ["prices/", "料金"],
    ["reviews/", "お客さまの声"],
    ["about/", "プロフィール"],
  ];
  const current = (href) => (route !== "" && !href.startsWith("#") && route.startsWith(href) ? ' aria-current="page"' : "");
  const logo = `<a class="logo" href="${base}">${mark(site, base)}<span class="logo-text"><span class="logo-name">匠 TAKUMI</span><span class="logo-sub">AI・Webシステム開発</span></span></a>`;
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
<link rel="icon" href="${base}assets/brand/favicon-64.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="${base}assets/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..600&family=Noto+Sans+JP:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${base}assets/style.css?v=${site.assetVersion}">
<script>(function (d) { d.classList.replace("no-js", "js"); if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; d.classList.add("motion"); setTimeout(function () { if (!window.TAKUMI) d.classList.remove("motion"); }, 3000); })(document.documentElement);</script>
<script src="${base}assets/app.js?v=${site.assetVersion}" defer></script>
${ld.length ? jsonld({ "@context": "https://schema.org", "@graph": ld }) : ""}
</head>
<body class="page-${page}">
<a class="skip" href="#main">本文へ移動</a>
<header class="hd">
  <div class="wrap hd-in">
    ${logo}
    <nav class="nav" id="nav" aria-label="メインメニュー">
      <ul>
        ${nav.map(([href, label]) => `<li><a href="${base}${href}"${current(href)}>${label}</a></li>`).join("\n        ")}
      </ul>
      <a class="btn btn-primary nav-cta" href="${contact}">ランサーズで相談する</a>
    </nav>
    <a class="btn btn-primary btn-sm hd-cta" href="${contact}">相談する</a>
    <button class="menu-btn" type="button" aria-controls="nav" aria-expanded="false"><span class="sr-only">メニュー</span><i></i><i></i></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="ft">
  <div class="wrap">
    <div class="ft-top">
      <div>
        ${logo}
        <p class="ft-tag">${esc(profile.tagline)}</p>
      </div>
      <ul class="ft-nav">
        <li><a href="${base}works/">実績</a></li>
        <li><a href="${base}#services">サービス</a></li>
        <li><a href="${base}prices/">料金</a></li>
        <li><a href="${base}reviews/">お客さまの声</a></li>
        <li><a href="${base}about/">プロフィール</a></li>
        ${sameAs(profile).map((u) => `<li>${ext(u, `${linkLabel(u)}${icon("ext", "ic ic-xs")}`)}</li>`).join("\n        ")}
      </ul>
    </div>
    <div class="ft-bottom">
      <p>© ${site.today.getFullYear()} ${esc(profile.name)}　ご相談・ご契約は、<a href="${contact}">ランサーズ</a>を通してお受けしています。</p>
      <p>${AI_NOTE}</p>
    </div>
  </div>
</footer>
<dialog class="vmodal" aria-label="紹介動画">
  <button class="vmodal-x" type="button"><span class="sr-only">閉じる</span>${icon("close")}</button>
  <video controls playsinline preload="none"></video>
  <p class="vmodal-meta"><span class="vmodal-t"></span><span>${AI_VIDEO_NOTE}</span></p>
</dialog>
</body>
</html>
`;
}

// ---------- shared blocks ----------

/** Section heading: a small English label, the Japanese title, an optional lead and link. */
function head(label, title, { lead = "", link = "" } = {}) {
  return `<div class="sh" data-reveal>
      <div>
        <p class="label">${esc(label)}</p>
        <h2 class="sh-title">${title}</h2>
        ${lead ? `<p class="sh-lead">${lead}</p>` : ""}
      </div>
      ${link}
    </div>`;
}
const more = (href, text) => `<a class="more" href="${href}">${text}${icon("arrow")}</a>`;

function crumbs(base, list) {
  return `<nav class="crumbs" aria-label="パンくずリスト"><a href="${base}">トップ</a>${list
    .map(([href, t]) => `<span aria-hidden="true">/</span>${href ? `<a href="${href}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}`)
    .join("")}</nav>`;
}

function pageHero(base, { label, title, lead = "", trail = [], extra = "", aside = "" }) {
  return `<section class="ph">
  <div class="wrap${aside ? " ph-split" : ""}">
    <div>
      ${crumbs(base, trail)}
      <p class="label">${label}</p>
      <h1 class="ph-title">${title}</h1>
      ${lead ? `<p class="ph-lead">${lead}</p>` : ""}
      ${extra}
    </div>
    ${aside ? `<div class="ph-aside">${aside}</div>` : ""}
  </div>
</section>`;
}

function contact(site, { title = "まずは、お気軽にご相談ください。", text = "「こんなことは実現できる？」という段階からで大丈夫です。目的と現状を伺い、進め方とお見積もりをご提案します。" } = {}) {
  const l = site.profile.lancers ?? {};
  return `<section class="contact" aria-labelledby="contact-title">
  <div class="wrap contact-in" data-reveal>
    <p class="label">Contact</p>
    <h2 class="contact-title" id="contact-title">${esc(title)}</h2>
    <p class="contact-text">${esc(text)}</p>
    <p><a class="btn btn-gold btn-lg" href="${esc(site.profile.contact_url)}">ランサーズで無料相談する${icon("arrow")}</a></p>
    <ul class="contact-notes">
      ${l.reply_rate_24h ? `<li>${icon("check")}24時間以内の返信率 ${esc(l.reply_rate_24h)}</li>` : ""}
      <li>${icon("check")}代金はランサーズの仮払いで安心</li>
      <li>${icon("check")}NDA（秘密保持契約）対応</li>
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
    [num(l.completion_rate), "%", "完了率"],
    [num(l.repeat_clients), "人", "リピーター"],
  ].filter(([v]) => Number.isFinite(v) && v > 0);
}
const proof = (site) =>
  `<ul class="proof">${proofItems(site).map(([v, unit, k]) => `<li><b>${v}<small>${unit}</small></b><span>${esc(k)}</span></li>`).join("")}</ul>`;

const chips = (xs) => `<ul class="chips">${(xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

const reviewText = (t) => t.quote ?? t.comment ?? "";
const jobName = (t) => t.job.replace(/^【[^】]*】/, "");

function quoteCard(t) {
  return `<figure class="quote" data-reveal>
        ${stars()}
        <blockquote><p>${esc(reviewText(t))}</p></blockquote>
        <figcaption>${esc(jobName(t))}<span>${dotDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
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
  {
    q: "契約と支払いはどうなりますか？",
    a: "ランサーズを通してご契約いただきます。代金はいったんランサーズに仮払いされ、納品をご確認いただいてから支払われます。",
  },
  { q: "打ち合わせはできますか？", a: "はい。メッセージでのやり取りのほか、ビデオ通話での打ち合わせにも対応しています。" },
  { q: "仕様が決まっていなくても相談できますか？", a: "はい。「こんなことは実現できる？」という段階から、目的を伺って一緒に整理します。" },
];
const faqList = (items) =>
  `<div class="faq">${items.map((f) => `<details class="acc"><summary><span class="acc-title">${esc(f.q)}</span></summary><p>${esc(f.a)}</p></details>`).join("")}</div>`;
const ldFaq = (items) => ({
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** A service card: its Lancers package image, field, name and starting price. */
function serviceCard(site, s, base) {
  return `<li data-reveal><a class="card" href="${base}services/${esc(s.id)}/">
        ${s.cover ? `<span class="card-img card-img-pkg">${pic(site, s.cover, base, { alt: s.name })}</span>` : ""}
        <span class="card-meta">${esc(s.pillar ?? "")}</span>
        <span class="card-title">${esc(s.name)}</span>
        <span class="card-foot">${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"}${icon("arrow")}</span>
      </a></li>`;
}

// ---------- works ----------

const pillarOf = (w) => w.service?.pillar ?? "その他";
const workName = (w) => (w.kindOf === "site" ? w.name : w.headline);

function workCard(site, w, base) {
  const isSite = w.kindOf === "site";
  return `<li data-reveal><a class="card" href="${base}works/${esc(w.id)}/">
        <span class="card-img${isSite ? " card-img-site" : ""}">${img(site, isSite ? w.top : w.cover, base)}</span>
        <span class="card-meta">${isSite ? `公開中のサイト・${esc(w.kind)}` : `${esc(pillarOf(w))}・評価${w.reviews.length}件`}</span>
        <span class="card-title">${esc(workName(w))}</span>
        ${isSite ? `<span class="card-sub">${esc(w.host)}</span>` : `<span class="card-sub">${esc(w.industry ?? "")}</span>`}
      </a></li>`;
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

// ---------- pages ----------

export function renderIndex(site) {
  const { profile, services, years, works, art } = site;
  const base = "./";
  const l = profile.lancers ?? {};
  const description = `${profile.title}の${profile.name}です。開発歴${years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムの開発を、要件の整理から保守まで担当します。`;
  const featured = works.lancers.filter((w) => w.featured);
  const quotes = (profile.testimonials ?? []).filter((t) => t.featured && reviewText(t)).slice(0, 3);
  const reel = art.showreel;
  const body = `<section class="hero">
  <div class="wrap hero-in">
    <div class="hero-text">
      <p class="label">${esc(profile.title)}</p>
      <h1 class="hero-title"><span class="nw">目的から設計する、</span><span class="nw">AI・Webシステム</span><span class="nw">開発。</span></h1>
      <p class="hero-lead">ChatGPT・RAGを使った業務アプリから、WordPress・Shopifyのサイト、業務システムまで。要件の整理から納品後の保守まで、ひとりで担当します。</p>
      <p class="actions">
        <a class="btn btn-primary btn-lg" href="${esc(profile.contact_url)}">ランサーズで相談する${icon("arrow")}</a>
        <a class="btn btn-secondary btn-lg" href="#works">実績を見る</a>
      </p>
      ${proof(site)}
      <p class="fine">ランサーズの公開プロフィールより（${jaDate(l.as_of)}時点）</p>
    </div>
    ${art.emblem ? `<div class="hero-mark"><img src="${base}${esc(art.emblem)}" alt="匠のエンブレム" width="640" height="640" fetchpriority="high" decoding="async"></div>` : ""}
  </div>
</section>
<section class="sec" id="works">
  <div class="wrap">
    ${head("Works", "実績", { lead: "開発に参加した公開中のサイトと、ランサーズで評価をいただいた案件です。", link: more("works/", `すべての実績（${works.all.length}件）`) })}
    <ul class="grid grid-2">
      ${works.sites.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
    <ul class="grid grid-3">
      ${featured.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
  </div>
</section>
<section class="sec sec-gray" id="services">
  <div class="wrap">
    ${head("Services", "サービス", { lead: `ランサーズで${site.packages.length}のパッケージを出品しています。`, link: more("prices/", "料金一覧") })}
    <ul class="grid grid-4">
      ${services.map((s) => serviceCard(site, s, base)).join("\n      ")}
    </ul>
  </div>
</section>
${
  reel
    ? `<section class="sec" id="movie">
  <div class="wrap">
    ${head("Movie", "紹介動画", { lead: `サービスの紹介動画をまとめたダイジェストです。各サービスの紹介動画は、サービスのページでご覧いただけます。${AI_VIDEO_NOTE}` })}
    <div class="video" data-reveal><video controls playsinline preload="none" poster="${base}${esc(reel.poster)}" aria-label="紹介動画のダイジェスト"><source src="${base}${esc(reel.video)}" type="video/mp4"></video></div>
  </div>
</section>`
    : ""
}
<section class="sec${reel ? " sec-gray" : ""}" id="voice">
  <div class="wrap">
    ${head("Voice", "お客さまの声", { lead: `ランサーズでいただいた評価${num(l.reviews)}件は、すべて「満足」です。`, link: more("reviews/", "すべての評価を読む") })}
    <div class="grid grid-3">
      ${quotes.map(quoteCard).join("\n      ")}
    </div>
  </div>
</section>
${contact(site)}`;
  const ld = [personLd(site), { "@type": "WebSite", "@id": `${profile.site_url}#website`, url: profile.site_url, name: profile.brand, inLanguage: "ja" }];
  return layout(site, { route: "", title: profile.brand, description, body, ld, page: "home" });
}

export function renderService(site, s) {
  const { profile, services } = site;
  const base = "../../";
  const route = `services/${s.id}/`;
  const url = new URL(route, profile.site_url).href;
  // The package image, whole; its promo video opens in the popup (or plays on its own without JavaScript).
  const media = (p) =>
    p.cover
      ? `${pic(site, p.cover, base, { alt: p.title })}${p.video ? `<a class="play" href="${base}${esc(p.video)}" data-video="${base}${esc(p.video)}" data-video-title="${esc(p.title)}">${icon("play")}紹介動画を見る</a>` : ""}`
      : p.video
        ? `<video controls preload="none" playsinline width="1280" height="720" aria-label="${esc(p.title)}の紹介動画"><source src="${base}${esc(p.video)}" type="video/mp4"></video>`
        : "";
  const related = site.works.all.filter((w) => w.service?.id === s.id);
  const faq = [...s.faq, ...COMMON_FAQ];
  const extra = `<dl class="facts">
        <div><dt>料金の目安</dt><dd>${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"}</dd></div>
        <div><dt>分野</dt><dd>${esc(s.pillar ?? "")}</dd></div>
        ${related.length ? `<div><dt>実績</dt><dd>${related.length}件</dd></div>` : ""}
      </dl>
      <p class="actions"><a class="btn btn-primary btn-lg" href="${esc(profile.contact_url)}">ランサーズで相談する${icon("arrow")}</a>${s.packages.length ? `<a class="btn btn-secondary btn-lg" href="#price">料金を見る</a>` : ""}</p>`;
  const aside = s.cover
    ? `<figure class="ph-art">${pic(site, s.cover, base, { alt: s.name, eager: true })}${s.video ? `<a class="play" href="${base}${esc(s.video.video)}" data-video="${base}${esc(s.video.video)}" data-video-title="${esc(s.video.title)}">${icon("play")}紹介動画を見る</a>` : ""}</figure>`
    : "";
  const body = `${pageHero(base, { label: `Service ${s.no}`, title: esc(s.name), lead: esc(s.description), trail: [[`${base}#services`, "サービス"], [null, s.name]], extra, aside })}
<section class="sec">
  <div class="wrap narrow prose" data-reveal>
    ${s.html}
  </div>
</section>
${
  s.packages.length
    ? `<section class="sec sec-gray" id="price">
  <div class="wrap">
    ${head("Price", "料金の目安", { lead: `ランサーズで出品しているパッケージの料金です（${jaDate(profile.lancers?.as_of)}時点）。内容に合わせた個別のお見積もりもできます。${s.packages.some((p) => p.video) ? AI_VIDEO_NOTE : ""}` })}
    ${s.packages
      .map(
        (p) => `<article class="pkg" data-reveal>
      <div class="pkg-media">${media(p)}</div>
      <div>
        <h3 class="pkg-title">${ext(p.url, `${esc(p.title)}${icon("ext", "ic ic-xs")}`)}</h3>
        <div class="table-scroll"><table class="table">
          <thead><tr><th scope="col">プラン</th><th scope="col">料金</th><th scope="col">納期の目安</th><th scope="col">内容</th></tr></thead>
          <tbody>
            ${p.plans.map((x) => `<tr><th scope="row">${esc(x.name)}</th><td class="num" data-label="料金">${yen(x.price)}</td><td class="num" data-label="納期の目安">${x.days ? `${x.days}日` : "—"}</td><td data-label="内容">${x.desc ? esc(x.desc) : ext(p.url, "ランサーズで確認")}</td></tr>`).join("\n            ")}
          </tbody>
        </table></div>
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
    ? `<section class="sec">
  <div class="wrap">
    ${head("Works", "このサービスの実績")}
    <ul class="grid grid-3">
      ${related.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
${
  s.cases.length
    ? `<section class="sec${related.length ? " sec-gray" : ""}">
  <div class="wrap narrow">
    ${head("Projects", "関連する開発実績")}
    <div class="acc-list">
    ${s.cases.map(caseItem).join("\n    ")}
    </div>
  </div>
</section>`
    : ""
}
${
  s.testimonials.some(reviewText)
    ? `<section class="sec">
  <div class="wrap">
    ${head("Voice", "お客さまの声", { link: more(`${base}reviews/`, "すべての評価を読む") })}
    <div class="grid grid-2">
      ${s.testimonials.filter(reviewText).map(quoteCard).join("\n      ")}
    </div>
  </div>
</section>`
    : ""
}
<section class="sec sec-gray">
  <div class="wrap narrow">
    ${head("FAQ", "よくある質問")}
    ${faqList(faq)}
  </div>
</section>
<section class="sec">
  <div class="wrap">
    ${head("Services", "ほかのサービス")}
    <ul class="links">
      ${services.filter((o) => o.id !== s.id).map((o) => `<li><a href="${base}services/${esc(o.id)}/"><span>${esc(o.name)}</span>${icon("arrow")}</a></li>`).join("\n      ")}
    </ul>
  </div>
</section>
${contact(site, { title: `${s.name}のご相談`, text: "目的と現状を伺い、進め方とお見積もりをご提案します。仕様が決まっていない段階でも大丈夫です。" })}`;
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
  return layout(site, { route, title: s.name, description: s.description, body, ld, image: s.cover });
}

export function renderWorks(site) {
  const { profile, works } = site;
  const base = "../";
  const cases = profile.cases ?? [];
  const description = `${profile.name}の実績。開発に参加した公開中のサイト${works.sites.length}件と、ランサーズで評価をいただいた案件${works.lancers.length}件、これまでのプロジェクト${cases.length}件を紹介します。`;
  const body = `${pageHero(base, {
    label: "Works",
    title: "実績",
    lead: "開発に参加した公開中のサイトと、ランサーズでお受けした案件です。ランサーズの案件は、お客さまの評価とあわせて掲載しています。お客さまの名前は伏せています。",
    trail: [[null, "実績"]],
  })}
<section class="sec">
  <div class="wrap">
    <h2 class="sub-title" data-reveal>公開中のサイト</h2>
    <ul class="grid grid-2">
      ${works.sites.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
    <h2 class="sub-title" data-reveal>ランサーズでの受注案件<span>${works.lancers.length}件</span></h2>
    <ul class="grid grid-3">
      ${works.lancers.map((w) => workCard(site, w, base)).join("\n      ")}
    </ul>
    <p class="fine">ランサーズの案件のカバー画像はイメージです（実際の画面ではありません）。${AI_NOTE}</p>
  </div>
</section>
${
  cases.length
    ? `<section class="sec sec-gray" id="projects">
  <div class="wrap narrow">
    ${head("Projects", "これまでの開発実績", { lead: "ランサーズを始める前から担当してきた主なプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です）。" })}
    <div class="acc-list">
    ${cases.map(caseItem).join("\n    ")}
    </div>
  </div>
</section>`
    : ""
}
${contact(site)}`;
  return layout(site, { route: "works/", title: "実績", description, body, ld: [personLd(site)] });
}

export function renderWork(site, w) {
  const { profile, works } = site;
  const base = "../../";
  const route = `works/${w.id}/`;
  const i = works.all.indexOf(w);
  const prev = works.all[(i - 1 + works.all.length) % works.all.length];
  const next = works.all[(i + 1) % works.all.length];
  const pager = `<nav class="wrap pager" aria-label="ほかの実績">
  <a href="${base}works/${esc(prev.id)}/"><small>前の実績</small>${esc(workName(prev))}</a>
  <a href="${base}works/${esc(next.id)}/"><small>次の実績</small>${esc(workName(next))}</a>
</nav>`;
  const serviceLink = w.service ? `<a href="${base}services/${esc(w.service.id)}/">${esc(w.service.name)}</a>` : "";
  let body;
  let description;
  let image;
  if (w.kindOf === "site") {
    description = `${w.name}（${w.host}）。${w.summary}`;
    image = w.top;
    body = `${pageHero(base, { label: `Live site・${esc(w.kind)}`, title: esc(w.name), lead: esc(w.summary), trail: [[`${base}works/`, "実績"], [null, w.name]] })}
<section class="sec">
  <div class="wrap">
    <figure class="shot" data-reveal>${img(site, w.top, base, { alt: `${w.name}のトップページ`, eager: true })}</figure>
    <dl class="dl narrow" data-reveal>
      <div><dt>サイト</dt><dd>${ext(w.url, `${esc(w.host)}${icon("ext", "ic ic-xs")}`)}</dd></div>
      <div><dt>種類</dt><dd>${esc(w.kind)}</dd></div>
      <div><dt>担当</dt><dd>${esc(w.role)}</dd></div>
      ${serviceLink ? `<div><dt>関連するサービス</dt><dd>${serviceLink}</dd></div>` : ""}
    </dl>
    <p class="fine narrow">画面は${jaDate(site.today.toISOString())}に撮影したものです。最新の内容はサイトでご確認ください。</p>
  </div>
</section>`;
  } else {
    const { html, stack } = workBody(w.body);
    description = `${w.title}。${w.subtitle}`;
    image = w.cover;
    const l = profile.lancers ?? {};
    body = `${pageHero(base, { label: `${esc(pillarOf(w))}・ランサーズでの受注案件`, title: esc(w.headline), lead: esc(w.title), trail: [[`${base}works/`, "実績"], [null, w.headline]] })}
<section class="sec">
  <div class="wrap case">
    <div>
      <figure class="shot" data-reveal>${img(site, w.cover, base, { alt: w.headline, eager: true })}<figcaption>画像はイメージです（実際の画面ではありません）。</figcaption></figure>
      <p class="case-sub">${esc(w.subtitle)}</p>
      <div class="prose">
        ${html}
      </div>
    </div>
    <aside class="case-side">
      <dl class="dl">
        ${w.industry ? `<div><dt>業種</dt><dd>${esc(w.industry)}</dd></div>` : ""}
        <div><dt>カテゴリー</dt><dd>${esc(w.category)}</dd></div>
        ${w.days ? `<div><dt>制作期間</dt><dd>${w.days}日</dd></div>` : ""}
        ${w.price ? `<div><dt>参考価格</dt><dd>${yen(w.price)}〜</dd></div>` : ""}
        ${stack ? `<div><dt>使用技術</dt><dd>${chips(stack)}</dd></div>` : ""}
        ${serviceLink ? `<div><dt>関連するサービス</dt><dd>${serviceLink}</dd></div>` : ""}
      </dl>
      ${w.jobUrl ? `<p class="fine">${ext(w.jobUrl, "ランサーズの募集ページを見る")}</p>` : `<p class="fine">非公開のご依頼です。</p>`}
    </aside>
  </div>
</section>
<section class="sec sec-gray">
  <div class="wrap narrow">
    ${head("Review", "お客さまの評価")}
    ${w.reviews
      .map(
        (t) => `<figure class="quote quote-full" data-reveal>
      ${stars()}
      ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません。評価は「満足」です）</p>`}
      <figcaption>${esc(t.job)}<span>${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}・<a href="${base}reviews/#${esc(t.id)}">評価一覧で見る</a></span></figcaption>
    </figure>`,
      )
      .join("\n    ")}
    <p class="fine">評価は${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}で確認できます。</p>
    ${chips(w.keywords)}
  </div>
</section>`;
  }
  body += `\n${pager}\n${contact(site)}`;
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
  const { profile, art } = site;
  const base = "../";
  const l = profile.lancers ?? {};
  const f = profile.facts ?? {};
  const description = `${profile.title}、${profile.name}のプロフィール。開発歴${site.years}年、保有資格、大切にしていること。`;
  const body = `${pageHero(base, {
    label: esc(profile.title),
    title: esc(profile.name),
    lead: esc(profile.tagline),
    trail: [[null, "プロフィール"]],
    aside: art.emblem ? `<img class="ph-mark" src="${base}${esc(art.emblem)}" alt="匠のエンブレム" width="640" height="640" fetchpriority="high" decoding="async">` : "",
  })}
<section class="sec">
  <div class="wrap about">
    <div class="prose" data-reveal>
      ${site.aboutHtml}
    </div>
    <dl class="dl" data-reveal>
      <div><dt>開発歴</dt><dd>${site.years}年</dd></div>
      ${f.work_style ? `<div><dt>働き方</dt><dd>${esc(f.work_style)}</dd></div>` : ""}
      ${f.nda ? `<div><dt>NDA</dt><dd>${esc(f.nda)}</dd></div>` : ""}
      ${l.rank ? `<div><dt>ランサーズ</dt><dd>${esc(l.rank)}</dd></div>` : ""}
      ${(l.verified ?? []).length ? `<div><dt>確認済み</dt><dd>${esc(l.verified.join("・"))}</dd></div>` : ""}
      <div><dt>ご契約</dt><dd>ランサーズを通してお受けしています</dd></div>
    </dl>
  </div>
  <div class="wrap">${proof(site)}</div>
</section>
<section class="sec sec-gray">
  <div class="wrap narrow">
    ${head("Values", "大切にしていること")}
    <ol class="values">
      ${(profile.values ?? []).map((v, i) => `<li data-reveal><span>${pad2(i + 1)}</span>${esc(v)}</li>`).join("\n      ")}
    </ol>
  </div>
</section>
<section class="sec">
  <div class="wrap two">
    <div>
      ${head("Credentials", "保有資格")}
      <ul class="certs">
        ${(profile.certifications ?? []).map((c) => `<li><time datetime="${esc(c.date)}">${dotDate(c.date)}</time>${esc(c.name)}</li>`).join("\n        ")}
      </ul>
    </div>
    <div>
      ${head("Skills", "主な技術")}
      <dl class="stack">
        ${STACK.map(([k, xs]) => `<div><dt>${esc(k)}</dt><dd>${chips(xs)}</dd></div>`).join("\n        ")}
      </dl>
    </div>
  </div>
</section>
${contact(site)}`;
  return layout(site, { route: "about/", title: "プロフィール", description, body, ld: [personLd(site)] });
}

const range = (a, b, unit) => (a == null ? "—" : a === b ? `${unit(a)}` : `${unit(a)}〜${unit(b)}`);

export function renderPrices(site) {
  const { profile } = site;
  const base = "../";
  const n = site.packages.length;
  const description = `${profile.name}がランサーズで出品している${n}のパッケージの料金と納期の一覧です。AI開発、WordPress・Shopify、業務システム、セキュリティ診断など。`;
  let group;
  const rows = site.packages.map((p) => {
    const head = p.service !== group ? `<tr class="grp"><th colspan="3" scope="colgroup">${p.service ? `<a href="../services/${esc(p.service.id)}/">${esc(p.service.name)}</a>` : "そのほか"}</th></tr>` : "";
    group = p.service;
    return `${head}<tr><th scope="row">${ext(p.url, esc(p.title))}</th><td class="num" data-label="料金">${range(p.minPrice, p.maxPrice, yen)}</td><td class="num" data-label="納期の目安">${range(p.minDays, p.maxDays, (d) => `${d}日`)}</td></tr>`;
  });
  const body = `${pageHero(base, {
    label: "Price",
    title: "料金一覧",
    lead: `ランサーズで出品している${n}のパッケージです（${jaDate(profile.lancers?.as_of)}時点）。ベーシック・スタンダード・プレミアムの3プランから選べます。内容に合わせた個別のお見積もりもできます。`,
    trail: [[null, "料金"]],
  })}
<section class="sec">
  <div class="wrap">
    <div class="table-scroll" data-reveal><table class="table table-prices">
      <thead><tr><th scope="col">パッケージ</th><th scope="col">料金</th><th scope="col">納期の目安</th></tr></thead>
      <tbody>
        ${rows.join("\n        ")}
      </tbody>
    </table></div>
    <p class="fine">パッケージ名をクリックすると、ランサーズで各プランの内容を確認できます。</p>
  </div>
</section>
${contact(site)}`;
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
    label: "Voice",
    title: "お客さまの声",
    lead: `ランサーズでいただいた評価${list.length}件を、新しい順に原文のまま掲載しています。評価はすべて「満足」です。`,
    trail: [[null, "お客さまの声"]],
  })}
<section class="sec">
  <div class="wrap">
    <div class="reviews">
      ${list
        .map((t) => {
          const w = workOf.get(t.id);
          return `<figure class="quote quote-full" id="${esc(t.id)}">
        ${stars()}
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません）</p>`}
        <figcaption>${esc(t.job)}<span>${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
        ${w ? `<p class="quote-link"><a href="${base}works/${esc(w.id)}/">この案件の実績：${esc(w.headline)}</a></p>` : ""}
      </figure>`;
        })
        .join("\n      ")}
    </div>
    <p class="fine">評価はランサーズでも確認できます。${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}</p>
  </div>
</section>
${contact(site)}`;
  return layout(site, { route: "reviews/", title: "お客さまの声", description, body, ld: [personLd(site)] });
}

export function render404(site) {
  const root = site.profile.site_url;
  const body = `<section class="ph">
  <div class="wrap">
    <p class="label">404</p>
    <h1 class="ph-title">ページが見つかりません</h1>
    <p class="ph-lead">URLが変わったか、ページが削除された可能性があります。</p>
    <p class="actions"><a class="btn btn-primary btn-lg" href="${esc(root)}">トップへ戻る</a><a class="btn btn-secondary btn-lg" href="${esc(new URL("works/", root).href)}">実績を見る</a></p>
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
