// Hub site: data loading and page rendering. Everything comes from profile.yml,
// site/ (service copy, works, Lancers packages, about text) and the published articles.
// The look and motion live in site/assets/style.css and site/assets/app.js; every
// page works without JavaScript, and motion is skipped for prefers-reduced-motion.
import { execFileSync } from "node:child_process";
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

  return {
    profile,
    services,
    packages: allPackages,
    works: { sites, lancers, all: works },
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
const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const join = (xs) => xs.filter((x) => x !== false && x != null).join("\n"); // keeps blank lines
const ext = (url, text, cls = "") =>
  `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener">${text}<span class="sr-only">（新しいタブで開きます）</span></a>`;
const KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

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
  const { profile } = site;
  const depth = route.split("/").filter(Boolean).length;
  const base = absolute ? profile.site_url : depth ? "../".repeat(depth) : "./";
  const canonical = new URL(route, profile.site_url).href;
  const shareImage = image ?? "assets/og.png";
  const fullTitle = route === "" ? `${profile.brand}｜${profile.title}` : `${title}｜${profile.brand}`;
  const links = sameAs(profile);
  const label = (u) =>
    /lancers/.test(u) ? "Lancers" : /zenn/.test(u) ? "Zenn" : /qiita/.test(u) ? "Qiita" : /note\.com/.test(u) ? "note" : "GitHub";
  const nav = [
    ["works/", "Works", "実績"],
    ["#services", "Services", "サービス"],
    ["prices/", "Price", "料金"],
    ["reviews/", "Voice", "評価"],
    ["about/", "About", "プロフィール"],
    site.articles.length && ["#articles", "Articles", "記事"],
  ].filter(Boolean);
  const current = (href) => (route !== "" && href !== "#services" && route.startsWith(href) ? ' aria-current="page"' : "");
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
<meta name="theme-color" content="#0d1624">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${base}assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&family=Shippori+Mincho+B1:wght@600;800&display=swap">
<link rel="stylesheet" href="${base}assets/style.css">
<script>(function (d) { d.classList.replace("no-js", "js"); if (!matchMedia("(prefers-reduced-motion: reduce)").matches) { d.classList.add("motion"); setTimeout(function () { if (!window.TAKUMI) d.classList.remove("motion"); }, 3000); } })(document.documentElement);</script>
<script src="${base}assets/app.js" defer></script>
${ld.length ? jsonld({ "@context": "https://schema.org", "@graph": ld }) : ""}
</head>
<body class="page-${page}">
<a class="skip" href="#main">本文へ移動</a>
<div class="progress" aria-hidden="true"></div>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${base}"><span class="seal" aria-hidden="true">匠</span><span class="brand-text">匠<small>AI・Webシステム開発</small></span></a>
    <nav class="nav" id="site-nav" aria-label="メインメニュー">
      <ul>
        ${nav.map(([href, en, ja]) => `<li><a href="${base}${href}"${current(href)}><span class="en" aria-hidden="true">${en}</span><span class="ja">${ja}</span></a></li>`).join("\n        ")}
      </ul>
      <a class="btn btn-accent nav-cta" href="${esc(profile.contact_url)}">ランサーズで相談する</a>
    </nav>
    <a class="btn btn-accent btn-sm header-cta" href="${esc(profile.contact_url)}" data-magnetic>相談する</a>
    <button class="menu-btn" type="button" aria-controls="site-nav" aria-expanded="false"><span class="sr-only">メニューを開く</span><i></i><i></i></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <p class="footer-mark"><span class="seal" aria-hidden="true">匠</span>${esc(profile.brand)}</p>
      <p class="footer-tagline">${esc(profile.tagline)}</p>
      <p class="small">ご相談・ご契約は、ランサーズを通してお受けしています。</p>
    </div>
    <nav class="footer-nav" aria-label="サイト内リンク">
      <ul>
        <li><a href="${base}works/">実績</a></li>
        <li><a href="${base}#services">サービス</a></li>
        <li><a href="${base}prices/">料金</a></li>
        <li><a href="${base}reviews/">評価</a></li>
        <li><a href="${base}about/">プロフィール</a></li>
      </ul>
      <ul>
        ${links.map((u) => `<li>${ext(u, label(u))}</li>`).join("\n        ")}
      </ul>
    </nav>
  </div>
  <div class="wrap footer-bottom">
    <p class="small">© ${site.today.getFullYear()} ${esc(profile.name)}</p>
    <a class="small to-top" href="#main">Page top ↑</a>
  </div>
</footer>
<div class="cursor" aria-hidden="true"><span class="cursor-label"></span></div>
</body>
</html>
`;
}

// ---------- shared blocks ----------

/** Section heading: index number, a large English word, the Japanese heading and a lead. */
function sectionHead(no, en, ja, lead = "", { tag = "h2", light = false } = {}) {
  return `<div class="sec-head${light ? " sec-head-light" : ""}${no === "—" ? " sec-head-sm" : ""}">
      <p class="sec-en" aria-hidden="true"><span class="sec-no">${esc(no)}</span><span class="sec-word" data-split>${esc(en)}</span></p>
      <${tag} class="sec-ja">${esc(ja)}</${tag}>
      ${lead ? `<p class="sec-lead">${lead}</p>` : ""}
    </div>`;
}

function pageHero(site, base, { en, title, lead = "", crumbs = [], kicker = "" }) {
  return `<section class="page-hero">
  <div class="hero-lines" aria-hidden="true"></div>
  <div class="wrap">
    <nav class="crumbs" aria-label="パンくずリスト"><a href="${base}">トップ</a>${crumbs.map(([href, t]) => ` <span aria-hidden="true">/</span> ${href ? `<a href="${href}">${esc(t)}</a>` : `<span>${esc(t)}</span>`}`).join("")}</nav>
    <p class="page-en" aria-hidden="true"><span data-split>${esc(en)}</span></p>
    ${kicker ? `<p class="kicker">${kicker}</p>` : ""}
    <h1 class="page-title">${title}</h1>
    ${lead ? `<p class="page-lead">${lead}</p>` : ""}
  </div>
</section>`;
}

function cta(site, base, heading = "まずは、ご相談ください。", text = "「こんなことは実現できる？」という段階からで大丈夫です。目的を伺い、進め方とお見積もりをご提案します。") {
  const { profile } = site;
  return `<section class="cta" aria-labelledby="cta-title">
  <div class="cta-seal" aria-hidden="true" data-reveal>匠</div>
  <div class="wrap cta-inner">
    <p class="cta-en" aria-hidden="true"><span data-split>Let's talk.</span></p>
    <h2 id="cta-title" class="cta-title">${esc(heading)}</h2>
    <p class="cta-text">${esc(text)}</p>
    <p class="actions">
      <a class="btn btn-accent btn-lg" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで無料相談する<span class="btn-arrow" aria-hidden="true">→</span></a>
      <a class="btn btn-ghost-light btn-lg" href="${base}reviews/">評価を見る</a>
    </p>
    <p class="small cta-note">ランサーズの仮払いを使うため、代金は納品をご確認いただいてから支払われます。</p>
  </div>
</section>`;
}

/** The headline numbers, read from profile.yml (Lancers) and the career start. */
function proofItems(site) {
  const l = site.profile.lancers ?? {};
  return [
    [site.years, "年", "開発歴"],
    [num(l.reviews), "件", "ランサーズの評価（すべて満足）"],
    [num(l.completion_rate), "%", "プロジェクト完了率"],
    [num(l.repeat_clients), "人", "リピーターのお客さま"],
  ].filter(([v]) => Number.isFinite(v));
}

function stats(site, { dark = false } = {}) {
  const l = site.profile.lancers;
  if (!l) return "";
  return `<section class="stats${dark ? " stats-dark" : ""}" aria-label="ランサーズでの実績">
  <div class="wrap">
    <ul class="stat-list">
      ${proofItems(site)
        .map(([v, unit, k]) => `<li data-reveal><span class="stat-value"><b data-count="${v}">${v}</b>${unit}</span><span class="stat-label">${esc(k)}</span></li>`)
        .join("\n      ")}
      ${l.rank ? `<li data-reveal><span class="stat-value stat-rank">${esc(l.rank)}</span><span class="stat-label">ランサーズの認定</span></li>` : ""}
    </ul>
    <p class="small stat-note">ランサーズの公開プロフィールより（${jaDate(l.as_of)}時点）。${ext(l.profile_url, "プロフィールを見る")}</p>
  </div>
</section>`;
}

const chips = (xs, cls = "chips") => `<ul class="${cls}">${(xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

function caseCard(c, { full = false } = {}) {
  if (full) {
    return `<details class="past" id="${esc(c.id)}">
      <summary><span class="past-period">${esc(c.period)}</span><span class="past-title">${esc(c.title)}</span><span class="past-icon" aria-hidden="true"></span></summary>
      <div class="past-body">
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

function testimonialsBlock(site, list, base, heading = "お客さまの声") {
  list = list.filter((t) => t.quote ?? t.comment);
  if (!list.length) return "";
  const l = site.profile.lancers ?? {};
  const total = (site.profile.testimonials ?? []).length;
  return `<section class="section">
  <div class="wrap">
    ${sectionHead("—", "Voice", heading)}
    <div class="grid grid-quotes">
      ${list
        .map(
          (t) => `<figure class="quote" data-reveal>
        <blockquote><p>${esc(reviewText(t))}</p></blockquote>
        <figcaption>${esc(t.job)}<span>${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span></figcaption>
      </figure>`,
        )
        .join("\n      ")}
    </div>
    <p class="more-row"><a class="link-more" href="${base}reviews/">${total}件の評価をすべて見る</a></p>
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
];

function faqBlock(items) {
  return `<section class="section">
  <div class="wrap narrow-wrap">
    ${sectionHead("—", "FAQ", "よくある質問")}
    <div class="faq-list">
    ${items.map((f) => `<details class="faq"><summary><span class="faq-q" aria-hidden="true">Q</span>${esc(f.q)}<span class="faq-icon" aria-hidden="true"></span></summary><div class="faq-a"><p>${esc(f.a)}</p></div></details>`).join("\n    ")}
    </div>
  </div>
</section>`;
}

const img = (src, base, { alt = "", w, h, cls = "", eager = false } = {}) =>
  `<img${cls ? ` class="${cls}"` : ""} src="${base}${esc(src)}" alt="${esc(alt)}"${w ? ` width="${w}" height="${h}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
// Package covers are 1000×563 (16:9); width/height keep the layout from jumping while they load.
const coverImg = (src, base, alt = "", cls = "cover") => img(src, base, { alt, w: 1000, h: 563, cls });

function serviceCard(s, base) {
  return `<a class="card service" href="${base}services/${esc(s.id)}/" data-reveal>
        ${s.cover ? `<span class="service-img">${coverImg(s.cover, base)}</span>` : ""}
        <span class="eyebrow">${esc(s.pillar ?? "")}</span>
        <span class="service-name">${esc(s.name)}</span>
        <span class="service-sum">${esc(s.summary)}</span>
        ${s.priceFrom ? `<span class="price">${yen(s.priceFrom)}〜</span>` : ""}
      </a>`;
}

// ---------- works ----------

const pillarOf = (w) => w.service?.pillar ?? "その他";

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

function siteFeature(w, base, i) {
  return `<article class="feature${i % 2 ? " feature-flip" : ""}" data-reveal>
    <a class="feature-media" href="${base}works/${esc(w.id)}/" data-cursor="View" aria-label="${esc(w.name)}の詳細">
      ${siteFrames(w, base)}
    </a>
    <div class="feature-text">
      <p class="kicker"><span class="dot" aria-hidden="true"></span>Live site・${esc(w.kind)}</p>
      <h3 class="feature-title">${esc(w.name)}</h3>
      <p>${esc(w.summary)}</p>
      <p class="feature-role">${esc(w.role)}</p>
      <p class="feature-links"><a class="link-more" href="${base}works/${esc(w.id)}/">詳しく見る</a>${ext(w.url, `${esc(w.host)} ↗`, "link-ext")}</p>
    </div>
  </article>`;
}

function workCard(w, base, { tag = "li" } = {}) {
  const thumb = w.kindOf === "site" ? img(w.top, base, { alt: "", w: 1200, h: 750 }) : img(w.cover, base, { alt: "", w: 1000, h: 782 });
  const vt = w.kindOf === "lancers" ? ` style="view-transition-name: work-${esc(w.id)}"` : "";
  return `<${tag} class="work-card" data-cat="${esc(pillarOf(w))}" data-reveal>
        <a href="${base}works/${esc(w.id)}/" data-cursor="View">
          <span class="work-img${w.kindOf === "site" ? " work-img-site" : ""}"${vt}>${thumb}</span>
          <span class="work-meta"><span class="work-no">No.${w.no}</span><span class="work-cat">${esc(pillarOf(w))}</span>${w.kindOf === "site" ? '<span class="work-badge">Live site</span>' : `<span class="work-badge">評価${w.reviews.length}件</span>`}</span>
          <span class="work-title">${esc(w.kindOf === "site" ? w.name : w.headline)}</span>
          <span class="work-sub">${esc(w.kindOf === "site" ? w.kind : w.industry ?? "")}</span>
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
  ["ランサーズで相談（無料）", "「こんなことは実現できる？」という段階からどうぞ。"],
  ["ヒアリング・ご提案", "目的と現状を伺い、進め方とお見積もりをご提案します。ビデオ通話にも対応します。"],
  ["ご契約", "ランサーズで契約します。代金はランサーズに仮払いされ、納品の確認後に支払われます。"],
  ["開発・進捗の共有", "こまめに進捗を共有し、途中で確認していただきながら進めます。"],
  ["納品・保守", "納品後の修正や、保守・運用のご依頼も続けてお受けします。"],
];

function techList(site) {
  const fromCases = (site.profile.cases ?? []).flatMap((c) => c.stack ?? []);
  return [...new Set(["OpenAI API", "RAG", "LangChain", "Python", "WordPress", "PHP", "AWS", "Azure", ...fromCases, "Shopify", "Firebase"])];
}

function marquee(items, { cls = "", reverse = false, render }) {
  const row = items.map(render).join("");
  return `<div class="marquee${reverse ? " marquee-reverse" : ""} ${cls}">
    <div class="marquee-track">
      <div class="marquee-group">${row}</div>
      <div class="marquee-group" aria-hidden="true">${row}</div>
    </div>
  </div>`;
}

export function renderIndex(site) {
  const { profile, services, years, works } = site;
  const base = "./";
  const description = `${profile.title}の${profile.name}です。開発歴${years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムの開発を、要件の整理から保守まで担当します。`;
  const featured = works.lancers.filter((w) => w.featured);
  const reviews = (profile.testimonials ?? []).filter((t) => t.comment);
  const half = Math.ceil(reviews.length / 2);
  const reviewCard = (t) =>
    `<figure class="voice-card"><blockquote><p>${esc(reviewText(t, 96))}</p></blockquote><figcaption>${esc(t.job.replace(/^【[^】]*】/, ""))}<span>${dotDate(t.date)}</span></figcaption></figure>`;
  const l = profile.lancers ?? {};

  const body = `<section class="hero" data-hero>
  <canvas class="hero-canvas" aria-hidden="true"></canvas>
  <div class="hero-lines" aria-hidden="true"></div>
  <div class="hero-glyph" aria-hidden="true"></div>
  <div class="wrap hero-inner">
    <p class="hero-eyebrow"><span class="en">Freelance AI &amp; Web Engineer</span><span class="hero-years">開発歴${years}年</span></p>
    <h1 class="hero-title"><span class="line" data-split>目的から考える、</span><span class="line" data-split>AI・Web</span><span class="line" data-split>システム開発。</span></h1>
    <p class="hero-lead">ChatGPT・RAGを使った業務アプリやAIチャットボットから、WordPress・Shopifyのサイト、業務システムまで。要件の整理から納品後の保守まで、${esc(profile.name)}がひとりで担当します。</p>
    <p class="actions hero-actions">
      <a class="btn btn-accent btn-lg" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで無料相談する<span class="btn-arrow" aria-hidden="true">→</span></a>
      <a class="btn btn-ghost-light btn-lg" href="#works">実績を見る</a>
    </p>
  </div>
  <p class="hero-vertical">${esc(profile.tagline)}</p>
  <ul class="hero-proof" aria-label="ランサーズでの実績（${jaDate(l.as_of)}時点）">
    ${proofItems(site)
      .map(([v, unit, k]) => `<li><span class="proof-value"><b data-count="${v}">${v}</b>${unit}</span><span class="proof-label">${esc(k)}</span></li>`)
      .join("\n    ")}
    ${l.rank ? `<li><span class="proof-value proof-rank">${esc(l.rank)}</span><span class="proof-label">ランサーズ</span></li>` : ""}
  </ul>
  <a class="scroll-cue" href="#works"><span>Scroll</span></a>
</section>
${marquee(techList(site), { cls: "tech-marquee", render: (t) => `<span class="tech">${esc(t)}</span>` })}
<section class="section works-home" id="works">
  <div class="wrap">
    ${sectionHead("01", "Works", "実績", `開発に参加した公開中のサイトと、ランサーズでお受けした案件です。ランサーズの案件は、すべてお客さまの評価とあわせて紹介しています。`)}
  </div>
  <div class="wrap features">
    ${works.sites.map((w, i) => siteFeature(w, base, i)).join("\n    ")}
  </div>
  <div class="hscroll" data-hscroll>
    <div class="hscroll-sticky">
      <div class="wrap hscroll-head">
        <p class="hscroll-title"><span class="en">Lancers works</span>評価をいただいた案件から</p>
        <p class="hscroll-count" aria-hidden="true"><span data-hscroll-index>01</span> / ${String(featured.length).padStart(2, "0")}</p>
      </div>
      <ul class="hscroll-track">
        ${featured.map((w) => workCard(w, base)).join("\n        ")}
        <li class="work-card work-more"><a href="works/"><span class="work-more-num">${works.all.length}</span><span>すべての実績を見る</span><span class="btn-arrow" aria-hidden="true">→</span></a></li>
      </ul>
      <div class="wrap hscroll-bar" aria-hidden="true"><span></span></div>
    </div>
  </div>
</section>
<section class="section services-home" id="services">
  <div class="wrap">
    ${sectionHead("02", "Services", "サービス", "AIの導入から、サイト・業務システムの開発、引き継いだシステムの不具合調査まで。ランサーズのパッケージで、料金と納期の目安を公開しています。")}
    <ol class="svc-list">
      ${services
        .map(
          (s, i) => `<li data-reveal>
        <a class="svc-row" href="services/${esc(s.id)}/"${s.cover ? ` data-preview="${base}${esc(s.cover)}"` : ""}>
          <span class="svc-no">${String(i + 1).padStart(2, "0")}</span>
          <span class="svc-main"><span class="svc-pillar">${esc(s.pillar ?? "")}</span><span class="svc-name">${esc(s.name)}</span><span class="svc-sum">${esc(s.summary)}</span></span>
          ${s.priceFrom ? `<span class="svc-price">${yen(s.priceFrom)}<small>〜</small></span>` : ""}
          <span class="svc-arrow" aria-hidden="true"></span>
          ${s.cover ? coverImg(s.cover, base, "", "svc-thumb") : ""}
        </a>
      </li>`,
        )
        .join("\n      ")}
    </ol>
    <p class="more-row"><a class="link-more" href="prices/">${site.packages.length}のパッケージと料金をすべて見る</a></p>
  </div>
</section>
<section class="section voice" id="voice">
  <div class="wrap voice-head">
    ${sectionHead("03", "Voice", "お客さまの声", "", { light: true })}
    <p class="voice-score" data-reveal><b data-count="${num(l.reviews)}">${num(l.reviews)}</b><span>件の評価が、すべて「満足」。</span></p>
  </div>
  ${marquee(reviews.slice(0, half), { render: reviewCard })}
  ${marquee(reviews.slice(half), { render: reviewCard, reverse: true })}
  <div class="wrap">
    <p class="more-row"><a class="link-more link-light" href="reviews/">${(profile.testimonials ?? []).length}件の評価を原文のまま読む</a></p>
  </div>
</section>
<section class="section approach">
  <div class="wrap approach-grid">
    <div class="approach-side">
      ${sectionHead("04", "Approach", "大切にしていること")}
      <p class="approach-tagline" data-reveal>${esc(profile.tagline).replace("。", "。<br>")}</p>
    </div>
    <ol class="values-list">
      ${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="kanji" aria-hidden="true">${KANJI[i] ?? i + 1}</span><p>${esc(v)}</p></li>`).join("\n      ")}
    </ol>
  </div>
</section>
<section class="section flow-sec">
  <div class="wrap">
    ${sectionHead("05", "Flow", "ご相談の流れ", "契約と支払いは、ランサーズを通して行います。代金は納品をご確認いただいてから支払われるので、はじめての方も安心です。")}
    <ol class="flow" data-flow>
      ${FLOW.map(([h, t], i) => `<li data-reveal><span class="flow-no">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(h)}</h3><p>${esc(t)}</p></div></li>`).join("\n      ")}
    </ol>
  </div>
</section>
${
  site.articles.length
    ? `<section class="section" id="articles">
  <div class="wrap">
    ${sectionHead("06", "Articles", "最近の記事")}
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
    ${sectionHead(site.articles.length ? "07" : "06", "Credentials", "保有資格", `AI・クラウド・セキュリティの資格を${(profile.certifications ?? []).length}件保有しています。`)}
    <ul class="cred-list">
      ${(profile.certifications ?? []).map((c) => `<li data-reveal><time datetime="${esc(c.date)}">${dotDate(c.date)}</time><span>${esc(c.name)}</span></li>`).join("\n      ")}
    </ul>
  </div>
</section>
${cta(site, base)}`;
  const ld = [
    personLd(site),
    { "@type": "WebSite", "@id": `${profile.site_url}#website`, url: profile.site_url, name: profile.brand, inLanguage: "ja" },
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
  const body = `${pageHero(site, base, {
    en: s.pillar === "AI" ? "AI Service" : "Service",
    title: esc(s.name),
    lead: esc(s.description),
    crumbs: [[`${base}#services`, "サービス"], [null, s.name]],
    kicker: `<span class="dot" aria-hidden="true"></span>${esc(s.pillar)}${s.priceFrom ? `・${yen(s.priceFrom)}〜` : ""}`,
  })}
<div class="page-actions wrap">
  <a class="btn btn-accent" href="${esc(profile.contact_url)}" data-magnetic>ランサーズで無料相談する<span class="btn-arrow" aria-hidden="true">→</span></a>
  ${s.packages.length ? `<a class="btn btn-ghost" href="#price">料金を見る</a>` : ""}
</div>
<section class="section">
  <div class="wrap narrow-wrap prose" data-reveal>
    ${s.html}
  </div>
</section>
${
  s.packages.length
    ? `<section class="section alt" id="price">
  <div class="wrap">
    ${sectionHead("—", "Price", "料金の目安", `ランサーズで出品しているパッケージの料金です（${jaDate(profile.lancers?.as_of)}時点）。内容に合わせた個別のお見積もりもできます。${s.packages.some((p) => p.video) ? "紹介動画の案内役は、AIで生成したキャラクターです。" : ""}`)}
    ${packages}
  </div>
</section>`
    : ""
}
${
  related.length
    ? `<section class="section">
  <div class="wrap">
    ${sectionHead("—", "Works", "このサービスの実績")}
    <ul class="work-grid">
      ${related.map((w) => workCard(w, base)).join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
${
  s.cases.length
    ? `<section class="section alt">
  <div class="wrap">
    ${sectionHead("—", "Projects", "関連する開発実績")}
    <div class="grid">
      ${s.cases.map((c) => caseCard(c)).join("\n      ")}
    </div>
    <p class="more-row"><a class="link-more" href="${base}works/">すべての実績を見る</a></p>
  </div>
</section>`
    : ""
}
${testimonialsBlock(site, s.testimonials, base)}
${faqBlock(faq)}
${cta(site, base, `${s.name}のご相談`)}
<section class="section">
  <div class="wrap">
    ${sectionHead("—", "Other services", "ほかのサービス")}
    <div class="grid grid-services">
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
  </div>
</section>
${
  (profile.cases ?? []).length
    ? `<section class="section alt">
  <div class="wrap narrow-wrap">
    ${sectionHead("—", "Projects", "これまでの開発実績", `ランサーズを始める前から担当してきた主なプロジェクトです（ランサーズのプロフィールの「ビジネス経験」と同じ内容です）。`)}
    <div class="past-list">
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
  const pager = `<nav class="pager wrap" aria-label="ほかの実績">
  <a class="pager-prev" href="${base}works/${esc(prev.id)}/"><span class="en">Prev</span><span>${esc(prev.kindOf === "site" ? prev.name : prev.headline)}</span></a>
  <a class="pager-all" href="${base}works/">実績一覧</a>
  <a class="pager-next" href="${base}works/${esc(next.id)}/"><span class="en">Next</span><span>${esc(next.kindOf === "site" ? next.name : next.headline)}</span></a>
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
      <div><dt>サイト</dt><dd>${ext(w.url, `${esc(w.host)} ↗`)}</dd></div>
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
    <figure class="case-cover" style="view-transition-name: work-${esc(w.id)}">${img(w.cover, base, { alt: w.headline, w: 1000, h: 782, eager: true })}</figure>
    <aside class="case-aside" data-reveal>
      <p class="case-sub">${esc(w.subtitle)}</p>
      <dl class="case-meta">
        ${w.industry ? `<div><dt>業種</dt><dd>${esc(w.industry)}</dd></div>` : ""}
        <div><dt>カテゴリー</dt><dd>${esc(w.category)}</dd></div>
        ${w.days ? `<div><dt>制作期間</dt><dd>${w.days}日</dd></div>` : ""}
        ${w.price ? `<div><dt>参考価格</dt><dd>${yen(w.price)}〜</dd></div>` : ""}
        ${stack ? `<div><dt>使用技術</dt><dd>${esc(stack.join("・"))}</dd></div>` : ""}
      </dl>
      ${w.jobUrl ? `<p class="small">${ext(w.jobUrl, "ランサーズの募集ページを見る ↗")}</p>` : `<p class="small muted">非公開のご依頼です。</p>`}
    </aside>
  </div>
  <div class="wrap narrow-wrap prose case-body" data-reveal>
    ${html}
  </div>
</section>
<section class="section case-reviews">
  <div class="wrap narrow-wrap">
    ${sectionHead("—", "Review", "お客さまの評価", "", { light: true })}
    ${w.reviews
      .map(
        (t) => `<figure class="case-review" data-reveal>
      ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted-light">（コメントは公開されていません。評価は「満足」です）</p>`}
      <figcaption><span class="stars" aria-label="満足">満足</span>${jaDate(t.date)}・${esc(t.job)}${t.repeat ? `・${esc(t.repeat)}` : ""} <a href="${base}reviews/#${esc(t.id)}">評価一覧で見る</a></figcaption>
    </figure>`,
      )
      .join("\n    ")}
    <p class="small muted-light">評価は${ext(l.reviews_url ?? l.profile_url, "ランサーズの評価ページ")}で確認できます。</p>
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
      name: w.kindOf === "site" ? w.name : w.headline,
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
        { "@type": "ListItem", position: 3, name: w.kindOf === "site" ? w.name : w.headline, item: new URL(route, profile.site_url).href },
      ],
    },
  ];
  return layout(site, { route, title: w.kindOf === "site" ? w.name : w.headline, description, body, ld, image });
}

export function renderAbout(site) {
  const { profile } = site;
  const base = "../";
  const description = `${profile.title}、${profile.name}のプロフィール。開発歴${site.years}年、保有資格、大切にしていること。`;
  const stack = [...new Set((profile.cases ?? []).flatMap((c) => c.stack ?? []))];
  const body = `${pageHero(site, base, {
    en: "About",
    title: esc(profile.name),
    lead: esc(profile.tagline),
    crumbs: [[null, "プロフィール"]],
    kicker: `<span class="dot" aria-hidden="true"></span>${esc(profile.title)}`,
  })}
<section class="section">
  <div class="wrap about-grid">
    <div class="about-seal" aria-hidden="true" data-reveal><span>匠</span></div>
    <div class="prose" data-reveal>
      ${site.aboutHtml}
    </div>
  </div>
</section>
${stats(site)}
<section class="section">
  <div class="wrap narrow-wrap">
    ${sectionHead("—", "Approach", "大切にしていること")}
    <ol class="values-list values-compact">${(profile.values ?? []).map((v, i) => `<li data-reveal><span class="kanji" aria-hidden="true">${KANJI[i] ?? i + 1}</span><p>${esc(v)}</p></li>`).join("")}</ol>
  </div>
</section>
<section class="section alt">
  <div class="wrap narrow-wrap">
    ${sectionHead("—", "Credentials", "保有資格")}
    <ul class="cred-list">
      ${(profile.certifications ?? []).map((c) => `<li data-reveal><time datetime="${esc(c.date)}">${dotDate(c.date)}</time><span>${esc(c.name)}</span></li>`).join("\n      ")}
    </ul>
  </div>
</section>
<section class="section">
  <div class="wrap narrow-wrap">
    ${sectionHead("—", "Skills", "主な技術")}
    ${chips(stack, "chips chips-outline")}
    ${sectionHead("—", "Style", "働き方")}
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
    crumbs: [[null, "評価"]],
  })}
${stats(site)}
<section class="section">
  <div class="wrap">
    <div class="review-list">
      ${list
        .map((t) => {
          const w = workOf.get(t.id);
          return `<figure class="review" id="${esc(t.id)}" data-reveal>
        <figcaption><span class="review-date">${jaDate(t.date)}${t.repeat ? `<span class="review-repeat">${esc(t.repeat)}</span>` : ""}</span><span class="review-job">${esc(t.job)}</span></figcaption>
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません）</p>`}
        ${w ? `<p class="review-work"><a href="${base}works/${esc(w.id)}/">この案件の実績を見る：${esc(w.headline)}</a></p>` : ""}
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
  const body = `<section class="page-hero page-hero-404">
  <div class="hero-lines" aria-hidden="true"></div>
  <div class="wrap">
    <p class="page-en" aria-hidden="true"><span data-split>404</span></p>
    <h1 class="page-title">ページが見つかりません</h1>
    <p class="page-lead">URLが変わったか、ページが削除された可能性があります。</p>
    <p class="actions"><a class="btn btn-accent" href="${esc(site.profile.site_url)}">トップへ戻る</a> <a class="btn btn-ghost-light" href="${esc(new URL("works/", site.profile.site_url).href)}">実績を見る</a></p>
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
        `- [${w.kindOf === "site" ? w.name : w.headline}](${new URL(`works/${w.id}/`, profile.site_url).href}): ${w.kindOf === "site" ? `${w.url} ${w.role}` : `${w.title}（ランサーズ・評価${w.reviews.length}件）`}`,
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
