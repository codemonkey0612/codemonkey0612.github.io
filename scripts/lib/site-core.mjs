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

  const services = (profile.services ?? []).map((s) => {
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

  // Brand art and decoration (site/media.yml): emblem, AI character, showreel, banner gallery.
  const mediaFile = path.join(root, "site", "media.yml");
  const m = fs.existsSync(mediaFile) ? readYaml(mediaFile) : {};
  const art = {
    emblem: asset(m.emblem, "site/media.yml emblem"),
    navigator: asset(m.navigator, "site/media.yml navigator"),
    showreel: m.showreel
      ? {
          video: asset(m.showreel.video, "site/media.yml showreel.video"),
          poster: asset(m.showreel.poster, "site/media.yml showreel.poster"),
          full: asset(m.showreel.full, "site/media.yml showreel.full"),
          title: m.showreel.title ?? "紹介動画",
        }
      : null,
    gallery: (m.gallery ?? []).map((g, i) => ({
      ...g,
      image: asset(g.image, `site/media.yml gallery[${i}]`),
      service: g.service ? serviceById(g.service, `site/media.yml gallery[${i}]`) : null,
    })),
  };
  const iconDir = path.join(root, "site", "assets", "icons");
  art.icons = new Set(fs.existsSync(iconDir) ? fs.readdirSync(iconDir).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)) : []);
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
const KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const AI_NOTE = "画像・動画に登場する人物は、AIで生成したイメージキャラクターです。";

// Two-tone icons (24×24): .f = soft fill, .s = main stroke, .a = gold accent, .dot = accent dot.
// Colours come from CSS (currentColor, --ic-accent, --ic-fill), so one set works everywhere.
const SHIELD = "M12 3l7.5 3v5.6c0 4.4-3.1 7.7-7.5 9.4-4.4-1.7-7.5-5-7.5-9.4V6z";
const HEART = "M12 17.5s-6-3.8-6-8.4A3.4 3.4 0 0 1 12 7a3.4 3.4 0 0 1 6 2.1c0 4.6-6 8.4-6 8.4z";
const BUBBLE = "M3.5 6.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V11a3 3 0 0 1-3 3H10l-3.8 3v-3H6.5a3 3 0 0 1-3-3z";
const both = (d, tag = "path") => (tag === "path" ? `<path class="f" d="${d}"/><path class="s" d="${d}"/>` : `<${tag} class="f" ${d}/><${tag} class="s" ${d}/>`);
const ICON = {
  target: `${both('cx="11" cy="13" r="8"', "circle")}<circle class="s" cx="11" cy="13" r="4.2"/><circle class="dot" cx="11" cy="13" r="1.5"/><path class="a" d="M11 13l8.3-8.3M16.4 4.6h3v3"/>`,
  chat: `${both(BUBBLE)}<path class="a" d="M14.6 17.6h3.1l3 2.4v-2.6a2.4 2.4 0 0 0 1-2V12a2.4 2.4 0 0 0-1.4-2.2"/><circle class="dot" cx="7.8" cy="9" r=".95"/><circle class="dot" cx="10.5" cy="9" r=".95"/><circle class="dot" cx="13.2" cy="9" r=".95"/>`,
  search: `${both('cx="10.5" cy="10.5" r="6.5"', "circle")}<path class="s" d="M15.4 15.4l5 5"/><path class="a" d="M7.6 9.4a3.2 3.2 0 0 1 2.6-2.3"/>`,
  shield: `${both(SHIELD)}<path class="a" d="M8.6 12.1l2.4 2.4 4.6-4.8"/>`,
  heart: `${both(HEART)}<path class="a" d="M2.8 15.6c2.1 0 3.3 1 4.6 2.2 1.1 1 2.4 1.7 4.6 1.7h6.8"/>`,
  clipboard: `${both('x="5" y="4.5" width="14" height="16.5" rx="2.5"', "rect")}<path class="s" d="M9 3.2h6v3H9z"/><path class="a" d="M8.4 12l1.7 1.7 3.2-3.2M8.4 17h7.2"/>`,
  pen: `${both("M14.5 4.5l5 5-8.5 8.5H6v-5z")}<path class="s" d="M12.5 6.5l5 5"/><path class="a" d="M3.5 21h10"/>`,
  code: `${both('x="3.5" y="5" width="17" height="11" rx="2.2"', "rect")}<path class="s" d="M1.8 19.5h20.4"/><path class="a" d="M10 8.7l-2.3 2.3 2.3 2.3M14 8.7l2.3 2.3-2.3 2.3"/>`,
  rocket: `${both("M14.5 3.5c3.2.3 5.7 2.8 6 6l-6.8 6.8-6-6z")}<circle class="s" cx="15" cy="9" r="1.7"/><path class="a" d="M7.7 10.3l-3.2.7 2 2M13.7 16.3l-.7 3.2-2-2M6.6 17.4L3.8 20.2"/>`,
  trophy: `${both("M7 4h10v5a5 5 0 0 1-10 0z")}<path class="s" d="M7 6H4.6a2.6 2.6 0 0 0 2.7 3.5M17 6h2.4a2.6 2.6 0 0 1-2.7 3.5M12 14v3.4M8.4 20.6h7.2M9.6 17.5h4.8"/><path class="dot" d="M12 6.1l.8 1.6 1.8.3-1.3 1.2.3 1.8-1.6-.8-1.6.8.3-1.8-1.3-1.2 1.8-.3z"/>`,
  repeat: `<path class="f" d="${"M12 15.4s-3.2-2-3.2-4.4A1.8 1.8 0 0 1 12 9.9a1.8 1.8 0 0 1 3.2 1.1c0 2.4-3.2 4.4-3.2 4.4z"}"/><path class="s" d="M19 9.4A7.6 7.6 0 0 0 5.5 7.3M5 14.6a7.6 7.6 0 0 0 13.5 2.1"/><path class="a" d="M5.3 3.7v3.9h3.9M18.7 20.3v-3.9h-3.9"/><path class="s" d="M12 15.4s-3.2-2-3.2-4.4A1.8 1.8 0 0 1 12 9.9a1.8 1.8 0 0 1 3.2 1.1c0 2.4-3.2 4.4-3.2 4.4z"/>`,
  video: `${both('x="2.8" y="6.5" width="12.7" height="11" rx="2.6"', "rect")}<path class="a" d="M15.5 10.4l5.2-3v9.2l-5.2-3"/><circle class="dot" cx="6.4" cy="10" r="1"/>`,
  lock: `${both('x="5" y="10.5" width="14" height="10" rx="2.6"', "rect")}<path class="s" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path class="a" d="M12 14.2v2.8"/><circle class="dot" cx="12" cy="14" r="1.3"/>`,
  safe: `${both(SHIELD)}<path class="a" d="M9.4 8.4l2.6 3.3 2.6-3.3M12 11.7v4.6M9.9 12.9h4.2M9.9 14.8h4.2"/>`,
  sparkle: `${both("M12 2.6l2.1 5.8 5.8 2.1-5.8 2.1L12 18.4l-2.1-5.8-5.8-2.1 5.8-2.1z")}<path class="a" d="M19 16.4v4.2M16.9 18.5h4.2"/>`,
  play: '<path class="solid-cur" d="M8 5.8v12.4a1 1 0 0 0 1.5.86l10-6.2a1 1 0 0 0 0-1.72l-10-6.2A1 1 0 0 0 8 5.8z"/>',
  star: '<path class="solid" d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.86l-5.5 2.9 1.05-6.13L3.1 9.3l6.15-.9z"/>',
  arrow: '<path class="s" d="M4.5 12h14.5M13.6 6.5L19 12l-5.4 5.5"/>',
  external: '<path class="s" d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M17.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8.5A1.5 1.5 0 0 1 6 7h4.5"/>',
};
const icon = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
/** A feature icon: your own image from site/assets/icons/<name>.webp when it exists, else the built-in SVG. */
const fi = (site, base, name) =>
  site.art?.icons?.has(name)
    ? `<img class="ic-img" src="${base}assets/icons/${esc(name)}.webp" alt="" width="128" height="128" loading="lazy" decoding="async">`
    : icon(name, "ic ic-feature");
const stars = (n = 5) => `<span class="stars" aria-hidden="true">${icon("star", "st").repeat(n)}</span>`;

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
  const { profile, art } = site;
  const depth = route.split("/").filter(Boolean).length;
  const base = absolute ? profile.site_url : depth ? "../".repeat(depth) : "./";
  const canonical = new URL(route, profile.site_url).href;
  const shareImage = image ?? "assets/og.jpg";
  const fullTitle = route === "" ? `${profile.brand}｜${profile.title}` : `${title}｜${profile.brand}`;
  const links = sameAs(profile);
  const label = (u) =>
    /lancers/.test(u) ? "Lancers" : /zenn/.test(u) ? "Zenn" : /qiita/.test(u) ? "Qiita" : /note\.com/.test(u) ? "note" : "GitHub";
  const nav = [
    ["works/", "Works", "実績"],
    ["#services", "Services", "サービス"],
    ["#movie", "Movie", "紹介動画"],
    ["prices/", "Price", "料金"],
    ["reviews/", "Voice", "お客さまの声"],
    ["about/", "About", "プロフィール"],
  ];
  const current = (href) => (route !== "" && !href.startsWith("#") && route.startsWith(href) ? ' aria-current="page"' : "");
  const emblemSmall = art.emblem ? `${base}assets/brand/emblem-160.webp` : `${base}assets/icon.svg`;
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
<link rel="icon" href="${base}assets/brand/favicon-64.png" type="image/png">
<link rel="apple-touch-icon" href="${base}assets/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Shippori+Mincho+B1:wght@600;800&display=swap">
<link rel="stylesheet" href="${base}assets/style.css?v=${site.assetVersion}">
<script>(function (d) { d.classList.replace("no-js", "js"); if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; d.classList.add("motion"); try { if (sessionStorage.getItem("tk-intro")) d.classList.add("intro-seen"); else sessionStorage.setItem("tk-intro", "1"); } catch (e) { d.classList.add("intro-seen"); } setTimeout(function () { if (!window.TAKUMI) d.classList.remove("motion"); }, 3000); })(document.documentElement);</script>
<script src="${base}assets/app.js?v=${site.assetVersion}" defer></script>
${ld.length ? jsonld({ "@context": "https://schema.org", "@graph": ld }) : ""}
</head>
<body class="page-${page}">
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><linearGradient id="tk-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4dc93"/><stop offset=".5" stop-color="#d2a84c"/><stop offset="1" stop-color="#a57a22"/></linearGradient></defs></svg>
<a class="skip" href="#main">本文へ移動</a>
<div class="intro" aria-hidden="true"><div class="intro-inner"><img src="${emblemSmall}" alt="" width="120" height="120"><p class="intro-word">TAKUMI</p><p class="intro-sub">AI・Webシステム開発</p></div></div>
<div class="progress" aria-hidden="true"></div>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${base}"><img class="brand-emblem" src="${emblemSmall}" alt="" width="44" height="44"><span class="brand-text"><span class="brand-name">匠<em>TAKUMI</em></span><small>AI・Webシステム開発</small></span></a>
    <nav class="nav" id="site-nav" aria-label="メインメニュー">
      <ul>
        ${nav.map(([href, en, ja], i) => `<li style="--i:${i}"><a href="${base}${href}"${current(href)}><span class="en" aria-hidden="true">${en}</span><span class="ja">${ja}</span></a></li>`).join("\n        ")}
      </ul>
      <a class="btn btn-gold nav-cta" href="${esc(profile.contact_url)}">ランサーズで無料相談${icon("arrow")}</a>
      <p class="nav-note">ご相談・ご契約はランサーズを通してお受けしています。</p>
    </nav>
    <a class="btn btn-gold btn-sm header-cta" href="${esc(profile.contact_url)}" data-magnetic>無料相談${icon("arrow")}</a>
    <button class="menu-btn" type="button" aria-controls="site-nav" aria-expanded="false"><span class="sr-only">メニューを開く</span><i></i><i></i><i></i></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <a class="brand brand-lg" href="${base}"><img class="brand-emblem" src="${emblemSmall}" alt="" width="64" height="64"><span class="brand-text"><span class="brand-name">匠<em>TAKUMI</em></span><small>AI・Webシステム開発</small></span></a>
      <p class="footer-tagline">${esc(profile.tagline)}</p>
      <p class="small muted">ご相談・ご契約は、ランサーズを通してお受けしています。</p>
      <a class="btn btn-navy btn-sm" href="${esc(profile.contact_url)}">ランサーズで無料相談${icon("arrow")}</a>
    </div>
    <nav class="footer-nav" aria-label="サイト内リンク">
      <ul>
        <li><a href="${base}works/">実績</a></li>
        <li><a href="${base}#services">サービス</a></li>
        <li><a href="${base}#movie">紹介動画</a></li>
        <li><a href="${base}prices/">料金</a></li>
        <li><a href="${base}reviews/">お客さまの声</a></li>
        <li><a href="${base}about/">プロフィール</a></li>
      </ul>
      <ul>
        ${links.map((u) => `<li>${ext(u, `${label(u)} ${icon("external", "ic ic-xs")}`)}</li>`).join("\n        ")}
      </ul>
    </nav>
  </div>
  <div class="wrap footer-bottom">
    <p class="small muted">© ${site.today.getFullYear()} ${esc(profile.name)}　${AI_NOTE}</p>
  </div>
</footer>
<a class="to-top" href="#main" aria-label="ページの先頭へ"><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="to-top-track" cx="24" cy="24" r="21"/><circle class="to-top-ring" cx="24" cy="24" r="21"/></svg><span aria-hidden="true">↑</span></a>
<dialog class="video-modal" aria-label="紹介動画">
  <div class="vm-inner">
    <button class="vm-close" type="button" aria-label="閉じる"><span aria-hidden="true">×</span></button>
    <video class="vm-video" controls playsinline preload="none"></video>
    <p class="vm-title"></p>
    <p class="vm-note small">紹介動画の案内役は、AIで生成したキャラクターです。</p>
  </div>
</dialog>
</body>
</html>
`;
}

// ---------- shared blocks ----------

/** Section heading: an italic English word with an index, the Japanese heading and a lead. */
function sectionHead(no, en, ja, lead = "", { center = false, tag = "h2" } = {}) {
  return `<div class="sec-head${center ? " sec-head-center" : ""}">
      <p class="sec-en" aria-hidden="true">${no ? `<span class="sec-no">${esc(no)}</span>` : ""}<span class="sec-word" data-split>${esc(en)}</span></p>
      <${tag} class="sec-ja" data-reveal>${esc(ja)}</${tag}>
      ${lead ? `<p class="sec-lead" data-reveal>${lead}</p>` : ""}
    </div>`;
}

function pageHero(site, base, { en, title, lead = "", crumbs = [], kicker = "", aside = "" }) {
  return `<section class="page-hero${aside ? " page-hero-split" : ""}">
  <div class="aurora" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="wrap page-hero-inner">
    <div class="page-hero-copy">
      <nav class="crumbs" aria-label="パンくずリスト"><a href="${base}">トップ</a>${crumbs.map(([href, t]) => ` <span aria-hidden="true">/</span> ${href ? `<a href="${href}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}`).join("")}</nav>
      <p class="page-en" aria-hidden="true"><span data-split>${esc(en)}</span></p>
      ${kicker ? `<p class="kicker" data-reveal>${kicker}</p>` : ""}
      <h1 class="page-title" data-reveal>${title}</h1>
      ${lead ? `<p class="page-lead" data-reveal>${lead}</p>` : ""}
    </div>
    ${aside ? `<div class="page-hero-aside" data-reveal>${aside}</div>` : ""}
  </div>
</section>`;
}

function cta(site, base, heading = "まずは、お気軽にご相談ください。", text = "「こんなことは実現できる？」という段階からで大丈夫です。目的を伺い、進め方とお見積もりをご提案します。") {
  const { profile, art } = site;
  return `<section class="cta" aria-labelledby="cta-title">
  <div class="aurora" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="wrap cta-inner">
    <div class="cta-copy">
      <p class="cta-en" aria-hidden="true"><span data-split>Let's create together.</span></p>
      <h2 id="cta-title" class="cta-title" data-reveal>${esc(heading)}</h2>
      <p class="cta-text" data-reveal>${esc(text)}</p>
      <ul class="cta-points" data-reveal>
        <li>${fi(site, base, "safe")}ランサーズの仮払いで安心</li>
        <li>${fi(site, base, "video")}ビデオ通話にも対応</li>
        <li>${fi(site, base, "lock")}NDA（秘密保持契約）対応</li>
      </ul>
      <p class="actions" data-reveal>
        <a class="btn btn-gold btn-lg" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで無料相談する${icon("arrow")}</a>
        <a class="btn btn-ghost btn-lg" href="${base}reviews/">お客さまの声を見る</a>
      </p>
    </div>
    <div class="cta-visual" aria-hidden="true">
      ${art.emblem ? `<img class="cta-emblem" src="${base}${esc(art.emblem)}" alt="" width="640" height="640" loading="lazy" decoding="async">` : ""}
      ${art.navigator ? `<img class="cta-navigator" src="${base}${esc(art.navigator)}" alt="" width="900" height="887" loading="lazy" decoding="async">` : ""}
    </div>
  </div>
  ${art.navigator ? `<p class="wrap cta-ai small">${AI_NOTE}</p>` : ""}
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
  ].filter(([v]) => Number.isFinite(v));
}

function stats(site) {
  const l = site.profile.lancers;
  if (!l) return "";
  return `<section class="stats" aria-label="ランサーズでの実績">
  <div class="wrap">
    <ul class="stat-list">
      ${proofItems(site)
        .map(([v, unit, k]) => `<li data-reveal><span class="stat-value"><b data-count="${v}">${v}</b>${unit}</span><span class="stat-label">${esc(k)}</span></li>`)
        .join("\n      ")}
      ${l.rank ? `<li data-reveal><span class="stat-value stat-rank">${esc(l.rank)}</span><span class="stat-label">ランサーズ</span></li>` : ""}
    </ul>
    <p class="small muted stat-note">ランサーズの公開プロフィールより（${jaDate(l.as_of)}時点）。${ext(l.profile_url, "プロフィールを見る")}</p>
  </div>
</section>`;
}

const chips = (xs, cls = "chips") => `<ul class="${cls}">${(xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

function caseCard(c, { full = false } = {}) {
  if (full) {
    return `<details class="acc" id="${esc(c.id)}">
      <summary><span class="acc-meta">${esc(c.period)}</span><span class="acc-title">${esc(c.title)}</span><span class="acc-icon" aria-hidden="true"></span></summary>
      <div class="acc-body">
        <dl class="case-detail">
          <dt>体制</dt><dd>${esc(c.team)}</dd>
          <dt>担当</dt><dd>${esc(c.role)}</dd>
          <dt>課題</dt><dd>${esc(c.challenge)}</dd>
          <dt>取り組み</dt><dd>${esc(c.actions)}</dd>
          <dt>成果</dt><dd>${esc(c.result)}</dd>
        </dl>
        ${chips(c.stack)}
      </div>
    </details>`;
  }
  return `<article class="card case" id="${esc(c.id)}" data-reveal>
      <p class="eyebrow">${esc(c.period)}</p>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.result)}</p>
      ${chips(c.stack)}
    </article>`;
}

const reviewText = (t, max = 0) => {
  const s = t.quote ?? t.comment ?? "";
  return max && [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
};

function quoteCard(t, { max = 0, cls = "quote" } = {}) {
  return `<figure class="${cls}">
        ${stars()}
        <blockquote><p>${esc(reviewText(t, max))}</p></blockquote>
        <figcaption><span class="q-job">${esc(t.job.replace(/^【[^】]*】/, ""))}</span><span class="q-date">${dotDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
      </figure>`;
}

function testimonialsBlock(site, list, base, heading = "お客さまの声") {
  list = list.filter((t) => t.quote ?? t.comment);
  if (!list.length) return "";
  const l = site.profile.lancers ?? {};
  const total = (site.profile.testimonials ?? []).length;
  return `<section class="section section-soft">
  <div class="wrap">
    ${sectionHead("", "Voice", heading)}
    <div class="grid grid-2">
      ${list.map((t) => `<div data-reveal>${quoteCard(t)}</div>`).join("\n      ")}
    </div>
    <p class="more-row"><a class="link-more" href="${base}reviews/">${total}件の評価をすべて見る${icon("arrow")}</a></p>
    <p class="small muted">ランサーズでいただいた評価から引用しています（${ext(l.reviews_url ?? l.profile_url, "ランサーズで見る")}）。</p>
  </div>
</section>`;
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

function faqBlock(items, { soft = false } = {}) {
  return `<section class="section${soft ? " section-soft" : ""}" id="faq">
  <div class="wrap narrow-wrap">
    ${sectionHead("", "FAQ", "よくある質問", "", { center: true })}
    <div class="faq-list">
    ${items.map((f) => `<details class="acc faq" data-reveal><summary><span class="faq-q" aria-hidden="true">Q</span><span class="acc-title">${esc(f.q)}</span><span class="acc-icon" aria-hidden="true"></span></summary><div class="acc-body"><p>${esc(f.a)}</p></div></details>`).join("\n    ")}
    </div>
  </div>
</section>`;
}

const img = (src, base, { alt = "", w, h, cls = "", eager = false } = {}) =>
  `<img${cls ? ` class="${cls}"` : ""} src="${base}${esc(src)}" alt="${esc(alt)}"${w ? ` width="${w}" height="${h}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
// Package covers are 16:9; width/height keep the layout from jumping while they load.
const coverImg = (src, base, alt = "", cls = "cover") => img(src, base, { alt, w: 1600, h: 900, cls });

/** A service card: banner image, and its promo video plays on hover (mouse) or in the player (tap). */
function serviceCard(s, base, { big = false } = {}) {
  const v = s.video;
  return `<a class="svc-card${big ? " svc-card-big" : ""}" href="${base}services/${esc(s.id)}/" data-spot${v ? ` data-hover-video="${base}${esc(v.video)}"` : ""} data-reveal>
        <span class="svc-media">${s.cover ? coverImg(s.cover, base) : ""}${v ? `<span class="svc-play">${icon("play")}動画あり</span>` : ""}</span>
        <span class="svc-body">
          <span class="svc-pillar">${esc(s.pillar ?? "")}</span>
          <span class="svc-name">${esc(s.name)}</span>
          <span class="svc-sum">${esc(s.summary)}</span>
          <span class="svc-foot">${s.priceFrom ? `<span class="svc-price"><small>料金の目安</small>${yen(s.priceFrom)}〜</span>` : "<span></span>"}<span class="svc-arrow">${icon("arrow")}</span></span>
        </span>
      </a>`;
}

// ---------- works ----------

const pillarOf = (w) => w.service?.pillar ?? "その他";
const workName = (w) => (w.kindOf === "site" ? w.name : w.headline);

/** A browser window and a phone showing a live site; the page scrolls inside the window. */
function siteFrames(w, base, { eager = false } = {}) {
  return `<div class="frames">
      <div class="browser">
        <div class="browser-bar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(w.host)}</span></div>
        <div class="browser-screen">${img(w.page, base, { alt: `${w.name}のトップページ`, cls: "scroll-shot", eager })}</div>
      </div>
      <div class="phone">${img(w.phone, base, { alt: `${w.name}のスマートフォン表示`, w: 780, h: 1688 })}</div>
    </div>`;
}

function siteFeature(w, base) {
  return `<article class="site-card" data-reveal>
    <a class="site-media" href="${base}works/${esc(w.id)}/" aria-label="${esc(w.name)}の詳細">${siteFrames(w, base)}</a>
    <div class="site-text">
      <p class="kicker"><span class="dot" aria-hidden="true"></span>Live site・${esc(w.kind)}</p>
      <h3 class="site-title">${esc(w.name)}</h3>
      <p class="site-sum">${esc(w.summary)}</p>
      <p class="site-role">${esc(w.role)}</p>
      <p class="site-links"><a class="link-more" href="${base}works/${esc(w.id)}/">詳しく見る${icon("arrow")}</a>${ext(w.url, `${esc(w.host)} ${icon("external", "ic ic-xs")}`, "link-ext")}</p>
    </div>
  </article>`;
}

function workCard(w, base, { tag = "li" } = {}) {
  const site = w.kindOf === "site";
  const thumb = site ? img(w.top, base, { alt: "", w: 1200, h: 750 }) : img(w.cover, base, { alt: "", w: 1200, h: 939 });
  const vt = site ? "" : ` style="view-transition-name: work-${esc(w.id)}"`;
  return `<${tag} class="work-card" data-cat="${esc(pillarOf(w))}" data-reveal>
        <a href="${base}works/${esc(w.id)}/" data-tilt>
          <span class="work-img${site ? " work-img-site" : ""}"${vt}>${thumb}<span class="work-view" aria-hidden="true">View${icon("arrow")}</span></span>
          <span class="work-meta"><span class="work-no">No.${w.no}</span><span class="work-cat">${esc(pillarOf(w))}</span>${site ? '<span class="work-badge work-badge-live">Live site</span>' : `<span class="work-badge">${icon("star", "ic ic-xs")}評価${w.reviews.length}件</span>`}</span>
          <span class="work-title">${esc(workName(w))}</span>
          <span class="work-sub">${esc(site ? w.kind : (w.industry ?? ""))}</span>
        </a>
      </${tag}>`;
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

const FLOW = [
  ["chat", "ランサーズで相談（無料）", "「こんなことは実現できる？」という段階からどうぞ。"],
  ["clipboard", "ヒアリング・ご提案", "目的と現状を伺い、進め方とお見積もりをご提案します。ビデオ通話にも対応します。"],
  ["pen", "ご契約", "ランサーズで契約します。代金はランサーズに仮払いされ、納品の確認後に支払われます。"],
  ["code", "開発・進捗の共有", "こまめに進捗を共有し、途中で確認していただきながら進めます。"],
  ["rocket", "納品・保守", "納品後の修正や、保守・運用のご依頼も続けてお受けします。"],
];
const VALUE_ICONS = ["target", "chat", "search", "shield", "heart"];

function techList(site) {
  const fromCases = (site.profile.cases ?? []).flatMap((c) => c.stack ?? []);
  return [...new Set(["ChatGPT", "OpenAI API", "RAG", "LangChain", "Python", "WordPress", "PHP", "Shopify", "AWS", "Azure", "Firebase", ...fromCases])];
}

function marquee(items, { cls = "", reverse = false, render, label = "" }) {
  const row = items.map((x) => render(x, false)).join("");
  const copy = items.map((x) => render(x, true)).join("");
  return `<div class="marquee${reverse ? " marquee-reverse" : ""} ${cls}"${label ? ` role="region" aria-label="${esc(label)}"` : ""}>
    <div class="marquee-track">
      <div class="marquee-group">${row}</div>
      <div class="marquee-group" aria-hidden="true">${copy}</div>
    </div>
  </div>`;
}

export function renderIndex(site) {
  const { profile, services, years, works, art } = site;
  const base = "./";
  const l = profile.lancers ?? {};
  const description = `${profile.title}の${profile.name}です。開発歴${years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムの開発を、要件の整理から保守まで担当します。`;
  const featured = works.lancers.filter((w) => w.featured);
  const reviews = (profile.testimonials ?? []).filter((t) => t.comment);
  const half = Math.ceil(reviews.length / 2);
  const reviewCard = (t) => quoteCard(t, { max: 92, cls: "quote quote-mq" });
  const big = new Set(services.slice(0, 2).map((s) => s.id));
  const theater = services.filter((s) => s.video);
  const first = theater[0];
  const galleryRow = (items, hidden) =>
    items
      .map(
        (g) =>
          `<a class="g-item" href="${g.service ? `services/${esc(g.service.id)}/` : "#services"}"${hidden ? ' tabindex="-1"' : ""}>${img(g.image, base, { alt: hidden ? "" : g.alt, w: 960, h: 540 })}</a>`,
      )
      .join("");
  const g = art.gallery;
  const gHalf = Math.ceil(g.length / 2);
  const rotator = ["生成AI・ChatGPTアプリ", "AIチャットボット（RAG）", "WordPress・Webサイト", "Shopify・ECサイト", "業務システム・スマホアプリ", "不具合調査・セキュリティ診断"];

  const body = `<section class="hero" data-hero>
  <div class="aurora" aria-hidden="true"><span></span><span></span><span></span></div>
  <canvas class="sparkles" aria-hidden="true"></canvas>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="hero-badge" data-hero-in><span class="badge-rank">${esc(l.rank ?? "Lancers")}</span>${stars()}<span>評価${num(l.reviews)}件すべて「満足」</span></p>
      <h1 class="hero-title"><span class="line" data-split>目的から考える、</span><span class="line line-gold" data-split>AI・Web</span><span class="line" data-split>システム開発。</span></h1>
      <p class="hero-rotator" data-hero-in><span class="rot-label">得意なこと</span><span class="rotator" data-rotator>${rotator.map((r, i) => `<span${i ? ' aria-hidden="true"' : ""}>${esc(r)}</span>`).join("")}</span></p>
      <p class="hero-lead" data-hero-in>ChatGPT・RAGを使った業務アプリやAIチャットボットから、WordPress・Shopifyのサイト、業務システムまで。要件の整理から納品後の保守まで、${esc(profile.name)}がひとりで担当します。</p>
      <p class="actions" data-hero-in>
        <a class="btn btn-gold btn-lg" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで無料相談する${icon("arrow")}</a>
        <a class="btn btn-ghost btn-lg" href="#works">実績を見る</a>
      </p>
    </div>
    ${
      art.showreel
        ? `<div class="hero-visual" data-hero-in>
      ${art.emblem ? `<img class="hero-emblem" src="${base}${esc(art.emblem)}" alt="" width="640" height="640" fetchpriority="high" aria-hidden="true">` : ""}
      <div class="reel" data-tilt-soft>
        <video class="reel-video" muted loop playsinline preload="metadata" poster="${base}${esc(art.showreel.poster)}" aria-label="紹介動画のダイジェスト（音声なし）"><source src="${base}${esc(art.showreel.video)}" type="video/mp4"></video>
        <span class="reel-tag"><i></i>Showreel</span>
        <a class="reel-play" href="${base}${esc(art.showreel.full)}" data-video="${base}${esc(art.showreel.full)}" data-video-title="${esc(art.showreel.title)}"><span class="reel-play-ic">${icon("play")}</span>音声付きで見る</a>
      </div>
      <div class="float-card fc-1" data-depth="18"><span class="fc-big"><b data-count="${num(l.reviews)}">${num(l.reviews)}</b>件</span><span>評価すべて「満足」${stars()}</span></div>
      <div class="float-card fc-2" data-depth="-14"><span class="fc-big"><b data-count="${years}">${years}</b>年</span><span>開発歴</span></div>
      <div class="float-card fc-3" data-depth="10">${fi(site, base, "sparkle")}<span>ChatGPT・RAG・WordPress・AWS</span></div>
    </div>`
        : ""
    }
  </div>
  <ul class="wrap hero-proof" aria-label="ランサーズでの実績（${jaDate(l.as_of)}時点）">
    ${proofItems(site)
      .map(([v, unit, k]) => `<li data-hero-in><span class="proof-value"><b data-count="${v}">${v}</b>${unit}</span><span class="proof-label">${esc(k)}</span></li>`)
      .join("\n    ")}
  </ul>
  <a class="scroll-cue" href="#strengths" aria-label="下へスクロール"><span></span></a>
</section>
${marquee(techList(site), { cls: "tech-marquee", render: (t) => `<span class="tech">${esc(t)}</span>` })}
<section class="section strengths" id="strengths">
  <div class="wrap">
    ${sectionHead("01", "Why Takumi", "選ばれる理由", "技術力だけでなく、目的の理解と、こまめな共有を大切にしています。ランサーズでいただいた評価は、すべて「満足」です。", { center: true })}
    <div class="strength-cards">
      <article class="s-card" data-reveal data-spot>
        <span class="s-ic">${fi(site, base, "trophy")}</span>
        <p class="s-num"><b data-count="${num(l.reviews)}">${num(l.reviews)}</b>件</p>
        <h3>すべての評価が「満足」</h3>
        <p>前任者からの引き継ぎや、仕様変更の多い案件でも、最後まで丁寧に対応してきました。</p>
      </article>
      <article class="s-card" data-reveal data-spot>
        <span class="s-ic">${fi(site, base, "repeat")}</span>
        <p class="s-num"><b data-count="${num(l.repeat_clients)}">${num(l.repeat_clients)}</b>人</p>
        <h3>リピーターのお客さま</h3>
        <p>同じお客さまから、追加開発・保守・次のフェーズを続けてご依頼いただいています。</p>
      </article>
      <article class="s-card" data-reveal data-spot>
        <span class="s-ic">${fi(site, base, "code")}</span>
        <p class="s-num"><b data-count="${years}">${years}</b>年</p>
        <h3>AIからWeb・業務システムまで</h3>
        <p>ChatGPT・RAG、WordPress・Shopify、業務システム、セキュリティ診断まで、ひとりで通して担当します。</p>
      </article>
    </div>
    <ol class="values">
      ${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="v-ic">${fi(site, base, VALUE_ICONS[i] ?? "sparkle")}</span><span class="v-no" aria-hidden="true">${KANJI[i] ?? i + 1}</span><p>${esc(v)}</p></li>`).join("\n      ")}
    </ol>
  </div>
</section>
<section class="section section-soft services-home" id="services">
  <div class="wrap">
    ${sectionHead("02", "Services", "サービス", `AIの導入から、サイト・業務システムの開発、引き継いだシステムの不具合調査まで。ランサーズで${site.packages.length}のパッケージを出品しています。カードにマウスを乗せると、紹介動画が流れます。`)}
    <div class="svc-grid">
      ${services.map((s) => serviceCard(s, base, { big: big.has(s.id) })).join("\n      ")}
    </div>
    <p class="more-row center"><a class="btn btn-ghost" href="prices/">${site.packages.length}のパッケージと料金をすべて見る${icon("arrow")}</a></p>
  </div>
</section>
${
  g.length
    ? `<section class="gallery" aria-label="サービスのバナー">
  <div class="gallery-tilt">
    ${marquee(g.slice(0, gHalf), { cls: "g-row", render: (x, hidden) => galleryRow([x], hidden) })}
    ${marquee(g.slice(gHalf), { cls: "g-row", reverse: true, render: (x, hidden) => galleryRow([x], hidden) })}
  </div>
</section>`
    : ""
}
<section class="section works-home" id="works">
  <div class="wrap">
    ${sectionHead("03", "Works", "実績", "開発に参加した公開中のサイトと、ランサーズでお受けした案件です。ランサーズの案件は、すべてお客さまの評価とあわせて紹介しています。")}
    <div class="site-cards">
      ${works.sites.map((w) => siteFeature(w, base)).join("\n      ")}
    </div>
    <div class="works-sub">
      <p class="works-sub-title" data-reveal><span class="en">Lancers works</span>評価をいただいた案件から</p>
      <a class="link-more" href="works/" data-reveal>すべての実績（${works.all.length}件）${icon("arrow")}</a>
    </div>
    <ul class="work-grid">
      ${featured.map((w) => workCard(w, base)).join("\n      ")}
    </ul>
    <p class="more-row center"><a class="btn btn-navy btn-lg" href="works/" data-magnetic>すべての実績を見る（${works.all.length}件）${icon("arrow")}</a></p>
  </div>
</section>
${
  first
    ? `<section class="section section-soft theater" id="movie">
  <div class="wrap">
    ${sectionHead("04", "Movie", "紹介動画", "サービスごとの紹介動画です。一覧から選ぶと再生できます。案内役は、AIで生成したキャラクターです。")}
    <div class="theater-grid" data-theater>
      <div class="theater-main" data-reveal>
        <div class="theater-screen">
          <video class="theater-video" controls playsinline preload="none" poster="${base}${esc(first.cover)}"><source src="${base}${esc(first.video.video)}" type="video/mp4"></video>
        </div>
        <div class="theater-caption">
          <p class="theater-pillar">${esc(first.pillar)}</p>
          <p class="theater-title">${esc(first.video.title)}</p>
          <a class="link-more theater-link" href="services/${esc(first.id)}/">${esc(first.name)}を見る${icon("arrow")}</a>
        </div>
      </div>
      <ol class="theater-list">
        ${theater
          .map(
            (s, i) => `<li data-reveal><button type="button" class="t-item" aria-pressed="${i === 0}" data-src="${base}${esc(s.video.video)}" data-poster="${base}${esc(s.cover)}" data-title="${esc(s.video.title)}" data-pillar="${esc(s.pillar)}" data-href="services/${esc(s.id)}/" data-name="${esc(s.name)}">
          <span class="t-thumb">${coverImg(s.cover, base)}<span class="t-ic">${icon("play")}</span></span>
          <span class="t-text"><span class="t-pillar">${esc(s.pillar)}</span><span class="t-name">${esc(s.name)}</span></span>
        </button></li>`,
          )
          .join("\n        ")}
      </ol>
    </div>
  </div>
</section>`
    : ""
}
<section class="section voice" id="voice">
  <div class="wrap voice-head">
    ${sectionHead("05", "Voice", "お客さまの声")}
    <div class="voice-score" data-reveal>
      <p class="vs-num"><b data-count="${num(l.reviews)}">${num(l.reviews)}</b><span>/ ${num(l.reviews)}</span></p>
      ${stars()}
      <p class="vs-label">ランサーズの評価が、すべて「満足」</p>
    </div>
  </div>
  ${marquee(reviews.slice(0, half), { render: (t) => reviewCard(t), label: "お客さまの声（1）" })}
  ${marquee(reviews.slice(half), { render: (t) => reviewCard(t), reverse: true, label: "お客さまの声（2）" })}
  <div class="wrap">
    <p class="more-row center"><a class="btn btn-ghost" href="reviews/">${(profile.testimonials ?? []).length}件の評価を原文のまま読む${icon("arrow")}</a></p>
  </div>
</section>
<section class="section section-soft flow-sec">
  <div class="wrap">
    ${sectionHead("06", "Flow", "ご相談の流れ", "契約と支払いはランサーズを通して行います。代金は納品をご確認いただいてから支払われるので、はじめての方も安心です。", { center: true })}
    <ol class="flow" data-flow>
      ${FLOW.map(([ic, h, t], i) => `<li data-reveal><span class="flow-ic">${fi(site, base, ic)}<span class="flow-no">${pad2(i + 1)}</span></span><h3>${esc(h)}</h3><p>${esc(t)}</p></li>`).join("\n      ")}
    </ol>
  </div>
</section>
${
  site.articles.length
    ? `<section class="section" id="articles">
  <div class="wrap">
    ${sectionHead("", "Articles", "最近の記事")}
    <ul class="articles">
      ${site.articles
        .slice(0, 6)
        .map(
          (a) =>
            `<li data-reveal><a href="${esc(a.url)}"><span class="badge badge-${a.platform}">${PLATFORM_LABEL[a.platform]}</span><span class="article-title">${esc(a.title)}</span><time datetime="${esc(a.date)}">${jaDate(a.date)}</time></a></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
<section class="section creds">
  <div class="wrap">
    ${sectionHead("07", "Credentials", "保有資格", `AI・クラウド・セキュリティの資格を${(profile.certifications ?? []).length}件保有しています。`)}
    <ul class="cred-grid">
      ${(profile.certifications ?? []).map((c) => `<li data-reveal data-spot><time datetime="${esc(c.date)}">${dotDate(c.date)}</time><span>${esc(c.name)}</span></li>`).join("\n      ")}
    </ul>
  </div>
</section>
${faqBlock(COMMON_FAQ, { soft: true })}
${cta(site, base)}`;
  const ld = [
    personLd(site),
    { "@type": "WebSite", "@id": `${profile.site_url}#website`, url: profile.site_url, name: profile.brand, inLanguage: "ja" },
    { "@type": "FAQPage", mainEntity: COMMON_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
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
      ? `<video class="cover" controls preload="none" playsinline poster="${base}${esc(p.cover ?? "")}" width="1280" height="720" aria-label="${esc(p.title)}の紹介動画"><source src="${base}${esc(p.video)}" type="video/mp4"></video>`
      : p.cover
        ? coverImg(p.cover, base, p.title)
        : "";
  const packages = s.packages
    .map(
      (p) => `<div class="package" data-reveal>
      <div class="package-intro">
        ${media(p)}
        <div>
          <p class="eyebrow">Lancers package</p>
          <h3>${ext(p.url, esc(p.title))}</h3>
          <p class="small muted">${p.video ? "紹介動画つき・" : ""}${ext(p.url, "ランサーズでパッケージを見る")}</p>
        </div>
      </div>
      <div class="table-scroll"><table class="plans">
        <thead><tr><th scope="col">プラン</th><th scope="col">料金</th><th scope="col">納期の目安</th><th scope="col">内容</th></tr></thead>
        <tbody>
          ${p.plans
            .map(
              (x) =>
                `<tr><th scope="row">${esc(x.name)}</th><td class="num" data-label="料金">${yen(x.price)}</td><td class="num" data-label="納期の目安">${x.days ? `${x.days}日` : "—"}</td><td data-label="内容">${x.desc ? esc(x.desc) : ext(p.url, "ランサーズで確認")}</td></tr>`,
            )
            .join("\n          ")}
        </tbody>
      </table></div>
    </div>`,
    )
    .join("\n    ");
  const related = site.works.all.filter((w) => w.service?.id === s.id);
  const faq = [...s.faq, ...COMMON_FAQ];
  const aside = s.cover
    ? `<div class="hero-media">${coverImg(s.cover, base, "")}${s.video ? `<a class="reel-play" href="${base}${esc(s.video.video)}" data-video="${base}${esc(s.video.video)}" data-video-title="${esc(s.video.title)}"><span class="reel-play-ic">${icon("play")}</span>紹介動画を見る</a>` : ""}</div>`
    : "";
  const body = `${pageHero(site, base, {
    en: s.pillar === "AI" ? "AI Service" : "Service",
    title: esc(s.name),
    lead: esc(s.description),
    crumbs: [[`${base}#services`, "サービス"], [null, s.name]],
    kicker: `<span class="dot" aria-hidden="true"></span>${esc(s.pillar)}${s.priceFrom ? `・料金の目安 ${yen(s.priceFrom)}〜` : ""}`,
    aside,
  })}
<div class="wrap page-actions">
  <a class="btn btn-gold" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで無料相談する${icon("arrow")}</a>
  ${s.packages.length ? `<a class="btn btn-ghost" href="#price">料金を見る</a>` : ""}
</div>
<section class="section">
  <div class="wrap narrow-wrap prose" data-reveal>
    ${s.html}
  </div>
</section>
${
  s.packages.length
    ? `<section class="section section-soft" id="price">
  <div class="wrap">
    ${sectionHead("", "Price", "料金の目安", `ランサーズで出品しているパッケージの料金です（${jaDate(profile.lancers?.as_of)}時点）。内容に合わせた個別のお見積もりもできます。${s.packages.some((p) => p.video) ? "紹介動画の案内役は、AIで生成したキャラクターです。" : ""}`)}
    ${packages}
  </div>
</section>`
    : ""
}
${
  related.length
    ? `<section class="section">
  <div class="wrap">
    ${sectionHead("", "Works", "このサービスの実績")}
    <ul class="work-grid">
      ${related.map((w) => workCard(w, base)).join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
${
  s.cases.length
    ? `<section class="section section-soft">
  <div class="wrap">
    ${sectionHead("", "Projects", "関連する開発実績")}
    <div class="grid grid-2">
      ${s.cases.map((c) => caseCard(c)).join("\n      ")}
    </div>
    <p class="more-row"><a class="link-more" href="${base}works/">すべての実績を見る${icon("arrow")}</a></p>
  </div>
</section>`
    : ""
}
${testimonialsBlock(site, s.testimonials, base)}
${faqBlock(faq)}
${cta(site, base, `${s.name}のご相談`)}
<section class="section section-soft">
  <div class="wrap">
    ${sectionHead("", "Other services", "ほかのサービス")}
    <div class="svc-grid svc-grid-3">
      ${services.filter((o) => o.id !== s.id).map((o) => serviceCard(o, base)).join("\n      ")}
    </div>
  </div>
</section>`;
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
    {
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
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
  const cats = [...new Set(works.all.map(pillarOf))];
  const description = `${profile.name}の実績。開発に参加した公開中のサイト${works.sites.length}件と、ランサーズで評価をいただいた案件${works.lancers.length}件、これまでのプロジェクト${(profile.cases ?? []).length}件を紹介します。`;
  const body = `${pageHero(site, base, {
    en: "Works",
    title: "実績",
    lead: `開発に参加した公開中のサイトと、ランサーズでお受けした案件です。ランサーズの案件は、お客さまの評価とあわせて掲載しています。お客さまの名前は伏せています。`,
    crumbs: [[null, "実績"]],
  })}
<section class="section works-index">
  <div class="wrap">
    <div class="filters" role="group" aria-label="分野で絞り込む" data-filters>
      <button type="button" aria-pressed="true" data-filter="all">すべて<span>${works.all.length}</span></button>
      ${cats.map((c) => `<button type="button" aria-pressed="false" data-filter="${esc(c)}">${esc(c)}<span>${works.all.filter((w) => pillarOf(w) === c).length}</span></button>`).join("\n      ")}
    </div>
    <p class="sr-only" aria-live="polite" data-filter-status></p>
    <ul class="work-grid" data-filter-list>
      ${works.all.map((w) => workCard(w, base)).join("\n      ")}
    </ul>
    <p class="small muted works-note">ランサーズの案件のカバー画像はイメージです（実際の画面ではありません）。${AI_NOTE}</p>
  </div>
</section>
${
  (profile.cases ?? []).length
    ? `<section class="section section-soft">
  <div class="wrap narrow-wrap">
    ${sectionHead("", "Projects", "これまでの開発実績", `ランサーズを始める前から担当してきた主なプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です）。`)}
    <div class="acc-list">
    ${(profile.cases ?? []).map((c) => caseCard(c, { full: true })).join("\n    ")}
    </div>
    <p class="small muted">${ext(profile.lancers?.profile_url, "ランサーズのプロフィールを見る")}</p>
  </div>
</section>`
    : ""
}
${cta(site, base)}`;
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
  <a class="pager-prev" href="${base}works/${esc(prev.id)}/"><span class="en">← Prev</span><span>${esc(workName(prev))}</span></a>
  <a class="pager-all" href="${base}works/">実績一覧</a>
  <a class="pager-next" href="${base}works/${esc(next.id)}/"><span class="en">Next →</span><span>${esc(workName(next))}</span></a>
</nav>`;
  const serviceLink = w.service
    ? `<p class="case-service">関連するサービス：<a href="${base}services/${esc(w.service.id)}/">${esc(w.service.name)}</a></p>`
    : "";
  let body;
  let description;
  let image;
  if (w.kindOf === "site") {
    description = `${w.name}（${w.host}）。${w.summary}`;
    image = w.top;
    body = `${pageHero(site, base, {
      en: "Live site",
      title: esc(w.name),
      lead: esc(w.summary),
      crumbs: [[`${base}works/`, "実績"], [null, w.name]],
      kicker: `<span class="dot" aria-hidden="true"></span>No.${w.no}・${esc(w.kind)}`,
    })}
<section class="section case-site">
  <div class="wrap">
    <div class="case-frames" data-reveal>${siteFrames(w, base, { eager: true })}</div>
    <dl class="case-meta" data-reveal>
      <div><dt>サイト</dt><dd>${ext(w.url, `${esc(w.host)} ${icon("external", "ic ic-xs")}`)}</dd></div>
      <div><dt>種類</dt><dd>${esc(w.kind)}</dd></div>
      <div><dt>担当</dt><dd>${esc(w.role)}</dd></div>
      ${w.service ? `<div><dt>分野</dt><dd>${esc(pillarOf(w))}</dd></div>` : ""}
    </dl>
    ${serviceLink}
    <p class="small muted">画面は${jaDate(site.today.toISOString())}に撮影したものです。最新の内容はサイトでご確認ください。</p>
  </div>
</section>`;
  } else {
    const { html, stack } = workBody(w.body);
    description = `${w.title}。${w.subtitle}`;
    image = w.cover;
    const l = profile.lancers ?? {};
    body = `${pageHero(site, base, {
      en: "Case study",
      title: esc(w.headline),
      lead: esc(w.title),
      crumbs: [[`${base}works/`, "実績"], [null, w.headline]],
      kicker: `<span class="dot" aria-hidden="true"></span>No.${w.no}・${esc(pillarOf(w))}・ランサーズでの受注案件`,
    })}
<section class="section case">
  <div class="wrap case-grid">
    <figure class="case-cover"><span class="case-cover-img" style="view-transition-name: work-${esc(w.id)}">${img(w.cover, base, { alt: w.headline, w: 1200, h: 939, eager: true })}</span><figcaption class="small muted">画像はイメージです（実際の画面ではありません）。</figcaption></figure>
    <aside class="case-aside" data-reveal>
      <p class="case-sub">${esc(w.subtitle)}</p>
      <dl class="case-meta">
        ${w.industry ? `<div><dt>業種</dt><dd>${esc(w.industry)}</dd></div>` : ""}
        <div><dt>カテゴリー</dt><dd>${esc(w.category)}</dd></div>
        ${w.days ? `<div><dt>制作期間</dt><dd>${w.days}日</dd></div>` : ""}
        ${w.price ? `<div><dt>参考価格</dt><dd>${yen(w.price)}〜</dd></div>` : ""}
        ${stack ? `<div><dt>使用技術</dt><dd>${esc(stack.join("・"))}</dd></div>` : ""}
      </dl>
      ${w.jobUrl ? `<p class="small">${ext(w.jobUrl, `ランサーズの募集ページを見る ${icon("external", "ic ic-xs")}`)}</p>` : `<p class="small muted">非公開のご依頼です。</p>`}
    </aside>
  </div>
  <div class="wrap narrow-wrap prose case-body" data-reveal>
    ${html}
  </div>
</section>
<section class="section section-soft case-reviews">
  <div class="wrap narrow-wrap">
    ${sectionHead("", "Review", "お客さまの評価")}
    ${w.reviews
      .map(
        (t) => `<figure class="case-review" data-reveal>
      ${stars()}
      ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません。評価は「満足」です）</p>`}
      <figcaption><span class="pill">満足</span>${jaDate(t.date)}・${esc(t.job)}${t.repeat ? `・${esc(t.repeat)}` : ""} <a href="${base}reviews/#${esc(t.id)}">評価一覧で見る</a></figcaption>
    </figure>`,
      )
      .join("\n    ")}
    <p class="small muted">評価は${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}で確認できます。</p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap narrow-wrap">
    ${chips(w.keywords, "chips chips-outline")}
    ${serviceLink}
  </div>
</section>`;
  }
  body += `\n${pager}\n${cta(site, base)}`;
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
  const { profile, art } = site;
  const base = "../";
  const description = `${profile.title}、${profile.name}のプロフィール。開発歴${site.years}年、保有資格、大切にしていること。`;
  const stack = [...new Set((profile.cases ?? []).flatMap((c) => c.stack ?? []))];
  const body = `${pageHero(site, base, {
    en: "About",
    title: esc(profile.name),
    lead: esc(profile.tagline),
    crumbs: [[null, "プロフィール"]],
    kicker: `<span class="dot" aria-hidden="true"></span>${esc(profile.title)}`,
    aside: art.emblem ? `<img class="about-emblem" src="${base}${esc(art.emblem)}" alt="匠のエンブレム" width="640" height="640">` : "",
  })}
<section class="section">
  <div class="wrap narrow-wrap prose" data-reveal>
    ${site.aboutHtml}
  </div>
</section>
${stats(site)}
<section class="section section-soft">
  <div class="wrap narrow-wrap">
    ${sectionHead("", "Approach", "大切にしていること")}
    <ol class="values values-col">
      ${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="v-ic">${fi(site, base, VALUE_ICONS[i] ?? "sparkle")}</span><span class="v-no" aria-hidden="true">${KANJI[i] ?? i + 1}</span><p>${esc(v)}</p></li>`).join("\n      ")}
    </ol>
  </div>
</section>
<section class="section">
  <div class="wrap">
    ${sectionHead("", "Credentials", "保有資格")}
    <ul class="cred-grid">
      ${(profile.certifications ?? []).map((c) => `<li data-reveal data-spot><time datetime="${esc(c.date)}">${dotDate(c.date)}</time><span>${esc(c.name)}</span></li>`).join("\n      ")}
    </ul>
  </div>
</section>
<section class="section section-soft">
  <div class="wrap narrow-wrap">
    ${sectionHead("", "Skills", "主な技術")}
    ${chips(stack, "chips chips-outline")}
    <h3 class="sub-h">働き方</h3>
    <ul class="plain">
      ${profile.facts?.work_style ? `<li>${esc(profile.facts.work_style)}</li>` : ""}
      ${profile.facts?.nda ? `<li>秘密保持契約（NDA）：${esc(profile.facts.nda)}</li>` : ""}
      <li>ご相談・ご契約はランサーズを通してお受けしています</li>
    </ul>
  </div>
</section>
${cta(site, base)}`;
  return layout(site, { route: "about/", title: "プロフィール", description, body, ld: [personLd(site)] });
}

const range = (a, b, unit) => (a == null ? "—" : a === b ? `${unit(a)}` : `${unit(a)}〜${unit(b)}`);

export function renderPrices(site) {
  const { profile } = site;
  const base = "../";
  const n = site.packages.length;
  const description = `${profile.name}がランサーズで出品している${n}のパッケージの料金と納期の一覧です。AI開発、WordPress・Shopify、業務システム、セキュリティ診断など。`;
  const body = `${pageHero(site, base, {
    en: "Price",
    title: "料金一覧",
    lead: `ランサーズで出品している${n}のパッケージです（${jaDate(profile.lancers?.as_of)}時点）。ベーシック・スタンダード・プレミアムの3プランから選べます。内容に合わせた個別のお見積もりもできます。`,
    crumbs: [[null, "料金"]],
  })}
<section class="section">
  <div class="wrap">
    <div class="table-scroll" data-reveal><table class="plans price-list">
      <thead><tr><th scope="col">パッケージ</th><th scope="col">料金</th><th scope="col">納期の目安</th><th scope="col">詳しい説明</th></tr></thead>
      <tbody>
        ${site.packages
          .map(
            (p) =>
              `<tr><th scope="row">${ext(p.url, esc(p.title))}</th><td class="num" data-label="料金">${range(p.minPrice, p.maxPrice, yen)}</td><td class="num" data-label="納期の目安">${range(p.minDays, p.maxDays, (d) => `${d}日`)}</td><td data-label="詳しい説明">${p.service ? `<a href="../services/${esc(p.service.id)}/">${esc(p.service.name)}</a>` : "—"}</td></tr>`,
          )
          .join("\n        ")}
      </tbody>
    </table></div>
    <p class="small muted">パッケージ名をクリックすると、ランサーズで各プランの内容を確認できます。</p>
  </div>
</section>
${cta(site, base)}`;
  return layout(site, { route: "prices/", title: "料金一覧", description, body, ld: [personLd(site)] });
}

export function renderReviews(site) {
  const { profile } = site;
  const base = "../";
  const list = profile.testimonials ?? [];
  const l = profile.lancers ?? {};
  const workOf = new Map(site.works.lancers.flatMap((w) => w.reviews.map((t) => [t.id, w])));
  const description = `${profile.name}がランサーズでいただいた評価${list.length}件を、原文のまま掲載しています。`;
  const body = `${pageHero(site, base, {
    en: "Voice",
    title: "お客さまの声",
    lead: `ランサーズでいただいた評価${list.length}件を、新しい順に原文のまま掲載しています。`,
    crumbs: [[null, "お客さまの声"]],
  })}
${stats(site)}
<section class="section section-soft">
  <div class="wrap">
    <div class="review-list">
      ${list
        .map((t) => {
          const w = workOf.get(t.id);
          return `<figure class="review" id="${esc(t.id)}" data-reveal>
        ${stars()}
        <figcaption><span class="review-date">${jaDate(t.date)}${t.repeat ? `<span class="pill pill-soft">${esc(t.repeat)}</span>` : ""}</span><span class="review-job">${esc(t.job)}</span></figcaption>
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません）</p>`}
        ${w ? `<p class="review-work"><a href="${base}works/${esc(w.id)}/">この案件の実績を見る：${esc(w.headline)}${icon("arrow", "ic ic-xs")}</a></p>` : ""}
      </figure>`;
        })
        .join("\n      ")}
    </div>
    <p class="small muted">評価はランサーズでも確認できます。${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}</p>
  </div>
</section>
${cta(site, base)}`;
  return layout(site, { route: "reviews/", title: "お客さまの声", description, body, ld: [personLd(site)] });
}

export function render404(site) {
  const body = `${pageHero(site, site.profile.site_url, {
    en: "404",
    title: "ページが見つかりません",
    lead: "URLが変わったか、ページが削除された可能性があります。",
  })}
<div class="wrap page-actions page-actions-404"><a class="btn btn-gold" href="${esc(site.profile.site_url)}">トップへ戻る</a> <a class="btn btn-ghost" href="${esc(new URL("works/", site.profile.site_url).href)}">実績を見る</a></div>`;
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
