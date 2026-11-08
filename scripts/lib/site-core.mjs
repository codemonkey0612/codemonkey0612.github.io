// Hub site: data loading and page rendering. Everything comes from profile.yml,
// site/ (service copy, Lancers packages, about text) and the published articles.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";
import YAML from "yaml";

const LANCERS_PACKAGE = (id) => `https://www.lancers.jp/menu/detail/${id}`;
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
  // Media paths in packages.yml are relative to site/assets/; fail the build on a typo.
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

  return { profile, services, packages: allPackages, years, aboutHtml, articles: listArticles(root, profile), today };
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
const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const join = (xs) => xs.filter((x) => x !== false && x != null).join("\n"); // keeps blank lines

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

function layout(site, { route, title, description, body, ld = [], absolute = false, image = null }) {
  const { profile } = site;
  const depth = route.split("/").filter(Boolean).length;
  const base = absolute ? profile.site_url : depth ? "../".repeat(depth) : "./";
  const canonical = new URL(route, profile.site_url).href;
  // Share image: the page's own, else the first service's cover.
  const shareImage = image ?? site.services.find((s) => s.cover)?.cover;
  const fullTitle = route === "" ? `${profile.brand}｜${profile.title}` : `${title}｜${profile.brand}`;
  const links = sameAs(profile);
  const label = (u) =>
    /lancers/.test(u) ? "ランサーズ" : /zenn/.test(u) ? "Zenn" : /qiita/.test(u) ? "Qiita" : /note\.com/.test(u) ? "note" : "GitHub";
  return `<!doctype html>
<html lang="ja">
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
${shareImage ? `<meta property="og:image" content="${esc(new URL(shareImage, profile.site_url).href)}">\n<meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${base}assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;800&display=swap">
<link rel="stylesheet" href="${base}assets/style.css">
${ld.length ? jsonld({ "@context": "https://schema.org", "@graph": ld }) : ""}
</head>
<body>
<a class="skip" href="#main">本文へ移動</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${base}"><span class="brand-mark" aria-hidden="true">匠</span><span class="brand-text">${esc(profile.brand)}</span></a>
    <nav class="nav" aria-label="メインメニュー">
      <a href="${base}#services">サービス</a>
      <a href="${base}prices/">料金</a>
      <a href="${base}works/">実績</a>
      <a href="${base}reviews/">評価</a>
      <a href="${base}about/">プロフィール</a>
      ${site.articles.length ? `<a href="${base}#articles">記事</a>` : ""}
    </nav>
    <a class="btn btn-small header-cta" href="${esc(profile.contact_url)}">相談する</a>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <p class="footer-brand">${esc(profile.brand)}</p>
      <p class="muted">${esc(profile.tagline)}</p>
      <p class="muted small">ご相談・ご契約は、ランサーズを通してお受けしています。</p>
    </div>
    <ul class="footer-links">
      ${links.map((u) => `<li><a href="${esc(u)}">${label(u)}</a></li>`).join("\n      ")}
    </ul>
  </div>
  <div class="wrap"><p class="muted small">© ${site.today.getFullYear()} ${esc(profile.name)}</p></div>
</footer>
</body>
</html>
`;
}

// ---------- shared blocks ----------

function cta(site, heading = "まずは、ご相談ください", text = "「こんなことは実現できる？」という段階からで大丈夫です。目的を伺い、進め方とお見積もりをご提案します。") {
  const { profile } = site;
  return `<section class="cta-band">
  <div class="wrap">
    <h2>${esc(heading)}</h2>
    <p>${esc(text)}</p>
    <p class="actions">
      <a class="btn btn-accent" href="${esc(profile.contact_url)}">ランサーズで無料相談する</a>
      <a class="btn btn-ghost-light" href="${esc(profile.lancers?.reviews_url ?? profile.lancers?.profile_url)}">評価・実績を見る</a>
    </p>
    <p class="small">ランサーズの仮払いを使うため、代金は納品をご確認いただいてから支払われます。</p>
  </div>
</section>`;
}

function stats(site) {
  const l = site.profile.lancers;
  if (!l) return "";
  const items = [
    [l.rank, "ランサーズの認定"],
    [l.reviews?.replace(/（.*$/, ""), "評価（すべて満足）"],
    [l.completion_rate, "完了率"],
    [l.repeat_clients, "リピーター"],
    [l.reply_rate_24h, "24時間以内の返信率"],
  ].filter(([v]) => v);
  return `<section class="stats" aria-label="ランサーズでの実績">
  <div class="wrap">
    <ul class="stat-list">
      ${items.map(([v, k]) => `<li><span class="stat-value">${esc(v)}</span><span class="stat-label">${esc(k)}</span></li>`).join("\n      ")}
    </ul>
    <p class="muted small">ランサーズの公開プロフィールより（${jaDate(l.as_of)}時点）。<a href="${esc(l.profile_url)}">プロフィールを見る</a></p>
  </div>
</section>`;
}

const chips = (xs) => `<ul class="chips">${(xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

function caseCard(c, { full = false } = {}) {
  const rows = full
    ? `<dl class="case-detail">
        <dt>体制</dt><dd>${esc(c.team)}</dd>
        <dt>担当</dt><dd>${esc(c.role)}</dd>
        <dt>課題</dt><dd>${esc(c.challenge)}</dd>
        <dt>取り組み</dt><dd>${esc(c.actions)}</dd>
        <dt>成果</dt><dd>${esc(c.result)}</dd>
      </dl>`
    : `<p>${esc(c.result)}</p>`;
  return `<article class="card case" id="${esc(c.id)}">
      <p class="eyebrow">${esc(c.period)}</p>
      <h3>${esc(c.title)}</h3>
      ${rows}
      ${chips(c.stack)}
    </article>`;
}

function testimonialsBlock(site, list, base, heading = "お客さまの声") {
  list = list.filter((t) => t.quote ?? t.comment);
  if (!list.length) return "";
  const l = site.profile.lancers ?? {};
  const total = (site.profile.testimonials ?? []).length;
  return `<section class="section">
  <div class="wrap">
    <h2>${esc(heading)}</h2>
    <div class="grid grid-quotes">
      ${list
        .map(
          (t) => `<figure class="card quote">
        <blockquote><p>${esc(t.quote ?? t.comment)}</p></blockquote>
        <figcaption>${esc(t.job)}<span class="muted">（${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}）</span></figcaption>
      </figure>`,
        )
        .join("\n      ")}
    </div>
    <p><a class="link-more" href="${base}reviews/">${total}件の評価をすべて見る →</a></p>
    <p class="muted small">ランサーズでいただいた評価から引用しています（<a href="${esc(l.reviews_url ?? l.profile_url)}">ランサーズで見る</a>）。</p>
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
  <div class="wrap narrow">
    <h2>よくある質問</h2>
    ${items.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n    ")}
  </div>
</section>`;
}

// Covers are 1000×563 (16:9); width/height keep the layout from jumping while they load.
const coverImg = (src, base, alt = "", cls = "cover") =>
  `<img class="${cls}" src="${base}${esc(src)}" alt="${esc(alt)}" width="1000" height="563" loading="lazy" decoding="async">`;

function serviceCard(s, base) {
  return `<a class="card service" href="${base}services/${esc(s.id)}/">
        ${s.cover ? coverImg(s.cover, base) : ""}
        ${s.pillar ? `<p class="eyebrow">${esc(s.pillar)}</p>` : ""}
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.summary)}</p>
        ${s.priceFrom ? `<p class="price">${yen(s.priceFrom)}〜</p>` : ""}
        <span class="more" aria-hidden="true">詳しく見る →</span>
      </a>`;
}

// ---------- pages ----------

const FLOW = [
  ["ランサーズで相談（無料）", "「こんなことは実現できる？」という段階からどうぞ。"],
  ["ヒアリング・ご提案", "目的と現状を伺い、進め方とお見積もりをご提案します。ビデオ通話にも対応します。"],
  ["ご契約", "ランサーズで契約します。代金はランサーズに仮払いされ、納品の確認後に支払われます。"],
  ["開発・進捗の共有", "こまめに進捗を共有し、途中で確認していただきながら進めます。"],
  ["納品・保守", "納品後の修正や、保守・運用のご依頼も続けてお受けします。"],
];

export function renderIndex(site) {
  const { profile, services, years } = site;
  const base = "./";
  const description = `${profile.title}の${profile.name}です。開発歴${years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムの開発を、要件の整理から保守まで担当します。`;
  const body = `<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(profile.title)}・開発歴${years}年</p>
    <h1><span class="phrase">目的から一緒に考える、</span><span class="phrase">AI・Webシステム開発。</span></h1>
    <p class="lead">ChatGPT・RAGを使った業務アプリやAIチャットボットから、WordPress・Shopifyのサイト、業務システムまで。要件の整理から納品後の保守まで、${esc(profile.name)}が担当します。</p>
    <p class="actions">
      <a class="btn btn-accent" href="${esc(profile.contact_url)}">ランサーズで無料相談する</a>
      <a class="btn btn-ghost" href="#services">サービスを見る</a>
    </p>
    <p class="tagline">${esc(profile.tagline)}</p>
  </div>
</section>
${stats(site)}
<section class="section" id="services">
  <div class="wrap">
    <h2>サービス</h2>
    <div class="grid grid-services">
      ${services.map((s) => serviceCard(s, base)).join("\n      ")}
    </div>
    <p><a class="link-more" href="prices/">${site.packages.length}のパッケージと料金をすべて見る →</a></p>
  </div>
</section>
<section class="section alt">
  <div class="wrap">
    <h2>これまでの実績</h2>
    <div class="grid">
      ${(profile.cases ?? []).slice(0, 3).map((c) => caseCard(c)).join("\n      ")}
    </div>
    <p><a class="link-more" href="works/">すべての実績を見る →</a></p>
  </div>
</section>
${testimonialsBlock(site, (profile.testimonials ?? []).filter((t) => t.featured), base)}
<section class="section alt">
  <div class="wrap two-col">
    <div>
      <h2>大切にしていること</h2>
      <ol class="values">${(profile.values ?? []).map((v) => `<li>${esc(v)}</li>`).join("")}</ol>
    </div>
    <div>
      <h2>ご相談の流れ</h2>
      <ol class="flow">${FLOW.map(([h, t]) => `<li><strong>${esc(h)}</strong><span>${esc(t)}</span></li>`).join("")}</ol>
    </div>
  </div>
</section>
${
  site.articles.length
    ? `<section class="section" id="articles">
  <div class="wrap">
    <h2>最近の記事</h2>
    <ul class="articles">
      ${site.articles
        .slice(0, 6)
        .map(
          (a) =>
            `<li><a href="${esc(a.url)}"><span class="badge badge-${a.platform}">${PLATFORM_LABEL[a.platform]}</span><span class="article-title">${esc(a.title)}</span><time datetime="${esc(a.date)}">${jaDate(a.date)}</time></a></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : ""
}
<section class="section">
  <div class="wrap">
    <h2>保有資格</h2>
    ${chips((profile.certifications ?? []).map((c) => c.name))}
  </div>
</section>
${cta(site)}`;
  const ld = [
    personLd(site),
    { "@type": "WebSite", "@id": `${profile.site_url}#website`, url: profile.site_url, name: profile.brand, inLanguage: "ja" },
  ];
  return layout(site, { route: "", title: profile.brand, description, body, ld });
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
      (p) => `<div class="package">
      <div class="package-intro">
        ${media(p)}
        <div>
          <h3><a href="${esc(p.url)}">${esc(p.title)}</a></h3>
          <p class="muted small">${p.video ? "紹介動画つき・" : ""}<a href="${esc(p.url)}">ランサーズでパッケージを見る</a></p>
        </div>
      </div>
      <div class="table-scroll"><table class="plans">
        <thead><tr><th scope="col">プラン</th><th scope="col">料金</th><th scope="col">納期の目安</th><th scope="col">内容</th></tr></thead>
        <tbody>
          ${p.plans
            .map(
              (x) =>
                `<tr><th scope="row">${esc(x.name)}</th><td class="num" data-label="料金">${yen(x.price)}</td><td class="num" data-label="納期の目安">${x.days ? `${x.days}日` : "—"}</td><td data-label="内容">${x.desc ? esc(x.desc) : `<a href="${esc(p.url)}">ランサーズで確認</a>`}</td></tr>`,
            )
            .join("\n          ")}
        </tbody>
      </table></div>
    </div>`,
    )
    .join("\n    ");
  const faq = [...s.faq, ...COMMON_FAQ];
  const body = `<nav class="crumbs wrap" aria-label="パンくずリスト"><a href="${base}">トップ</a> › <a href="${base}#services">サービス</a> › <span>${esc(s.name)}</span></nav>
<section class="hero hero-sub">
  <div class="wrap">
    <p class="eyebrow">${esc(s.pillar)}</p>
    <h1>${esc(s.name)}</h1>
    <p class="lead">${esc(s.description)}</p>
    <p class="actions">
      <a class="btn btn-accent" href="${esc(profile.contact_url)}">ランサーズで無料相談する</a>
      ${s.packages[0] ? `<a class="btn btn-ghost" href="${esc(s.packages[0].url)}">パッケージを見る</a>` : ""}
    </p>
  </div>
</section>
<section class="section">
  <div class="wrap narrow prose">
    ${s.html}
  </div>
</section>
${
  s.packages.length
    ? `<section class="section alt" id="price">
  <div class="wrap">
    <h2>料金の目安</h2>
    <p class="muted">ランサーズで出品しているパッケージの料金です（${jaDate(profile.lancers?.as_of)}時点）。内容に合わせた個別のお見積もりもできます。${s.packages.some((p) => p.video) ? "紹介動画の案内役は、AIで生成したキャラクターです。" : ""}</p>
    ${packages}
  </div>
</section>`
    : ""
}
${
  s.cases.length
    ? `<section class="section">
  <div class="wrap">
    <h2>関連する実績</h2>
    <div class="grid">
      ${s.cases.map((c) => caseCard(c)).join("\n      ")}
    </div>
    <p><a class="link-more" href="${base}works/">すべての実績を見る →</a></p>
  </div>
</section>`
    : ""
}
${testimonialsBlock(site, s.testimonials, base)}
${faqBlock(faq)}
${cta(site, `${s.name}のご相談`)}
<section class="section">
  <div class="wrap">
    <h2>ほかのサービス</h2>
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
  const { profile } = site;
  const description = `${profile.name}の開発実績。AIエージェント・RAG、業務システム、WordPress、EC、セキュリティ強化など、${(profile.cases ?? []).length}件のプロジェクトの課題・取り組み・成果を紹介します。`;
  const body = `<nav class="crumbs wrap" aria-label="パンくずリスト"><a href="../">トップ</a> › <span>実績</span></nav>
<section class="hero hero-sub">
  <div class="wrap">
    <h1>実績</h1>
    <p class="lead">これまでに担当した主なプロジェクトです。お客さまの名前は伏せています。</p>
  </div>
</section>
<section class="section">
  <div class="wrap narrow">
    ${(profile.cases ?? []).map((c) => caseCard(c, { full: true })).join("\n    ")}
    <p class="muted small">ランサーズのプロフィールにも掲載しています。<a href="${esc(profile.lancers?.portfolio_url ?? profile.lancers?.profile_url)}">ポートフォリオを見る</a></p>
  </div>
</section>
${testimonialsBlock(site, (profile.testimonials ?? []).filter((t) => t.featured), "../")}
${cta(site)}`;
  return layout(site, { route: "works/", title: "実績", description, body, ld: [personLd(site)] });
}

export function renderAbout(site) {
  const { profile } = site;
  const description = `${profile.title}、${profile.name}のプロフィール。開発歴${site.years}年、保有資格、大切にしていること。`;
  const stack = [...new Set((profile.cases ?? []).flatMap((c) => c.stack ?? []))];
  const body = `<nav class="crumbs wrap" aria-label="パンくずリスト"><a href="../">トップ</a> › <span>プロフィール</span></nav>
<section class="hero hero-sub">
  <div class="wrap">
    <p class="eyebrow">${esc(profile.title)}</p>
    <h1>${esc(profile.name)}</h1>
    <p class="tagline">${esc(profile.tagline)}</p>
  </div>
</section>
<section class="section">
  <div class="wrap narrow prose">
    ${site.aboutHtml}
  </div>
</section>
${stats(site)}
<section class="section">
  <div class="wrap narrow">
    <h2>大切にしていること</h2>
    <ol class="values">${(profile.values ?? []).map((v) => `<li>${esc(v)}</li>`).join("")}</ol>
    <h2>保有資格</h2>
    <table class="certs">
      <tbody>${(profile.certifications ?? []).map((c) => `<tr><th scope="row">${esc(c.name)}</th><td class="num">${jaDate(c.date)}</td></tr>`).join("")}</tbody>
    </table>
    <h2>主な技術</h2>
    ${chips(stack)}
    <h2>働き方</h2>
    <ul class="plain">
      ${profile.facts?.work_style ? `<li>${esc(profile.facts.work_style)}</li>` : ""}
      ${profile.facts?.nda ? `<li>秘密保持契約（NDA）：${esc(profile.facts.nda)}</li>` : ""}
      <li>ご相談・ご契約はランサーズを通してお受けしています</li>
    </ul>
  </div>
</section>
${cta(site)}`;
  return layout(site, { route: "about/", title: "プロフィール", description, body, ld: [personLd(site)] });
}

const range = (a, b, unit) => (a == null ? "—" : a === b ? `${unit(a)}` : `${unit(a)}〜${unit(b)}`);

export function renderPrices(site) {
  const { profile } = site;
  const n = site.packages.length;
  const description = `${profile.name}がランサーズで出品している${n}のパッケージの料金と納期の一覧です。AI開発、WordPress・Shopify、業務システム、セキュリティ診断など。`;
  const body = `<nav class="crumbs wrap" aria-label="パンくずリスト"><a href="../">トップ</a> › <span>料金</span></nav>
<section class="hero hero-sub">
  <div class="wrap">
    <h1>料金一覧</h1>
    <p class="lead">ランサーズで出品している${n}のパッケージです（${jaDate(profile.lancers?.as_of)}時点）。ベーシック・スタンダード・プレミアムの3プランから選べます。内容に合わせた個別のお見積もりもできます。</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="table-scroll"><table class="plans price-list">
      <thead><tr><th scope="col">パッケージ</th><th scope="col">料金</th><th scope="col">納期の目安</th><th scope="col">詳しい説明</th></tr></thead>
      <tbody>
        ${site.packages
          .map(
            (p) =>
              `<tr><th scope="row"><a href="${esc(p.url)}">${esc(p.title)}</a></th><td class="num" data-label="料金">${range(p.minPrice, p.maxPrice, yen)}</td><td class="num" data-label="納期の目安">${range(p.minDays, p.maxDays, (d) => `${d}日`)}</td><td data-label="詳しい説明">${p.service ? `<a href="../services/${esc(p.service.id)}/">${esc(p.service.name)}</a>` : "—"}</td></tr>`,
          )
          .join("\n        ")}
      </tbody>
    </table></div>
    <p class="muted small">パッケージ名をクリックすると、ランサーズで各プランの内容を確認できます。</p>
  </div>
</section>
${cta(site)}`;
  return layout(site, { route: "prices/", title: "料金一覧", description, body, ld: [personLd(site)] });
}

export function renderReviews(site) {
  const { profile } = site;
  const list = profile.testimonials ?? [];
  const l = profile.lancers ?? {};
  const description = `${profile.name}がランサーズでいただいた評価${list.length}件を、原文のまま掲載しています。`;
  const body = `<nav class="crumbs wrap" aria-label="パンくずリスト"><a href="../">トップ</a> › <span>評価</span></nav>
<section class="hero hero-sub">
  <div class="wrap">
    <h1>お客さまの声</h1>
    <p class="lead">ランサーズでいただいた評価${list.length}件を、新しい順に原文のまま掲載しています。</p>
  </div>
</section>
${stats(site)}
<section class="section">
  <div class="wrap">
    <div class="grid grid-quotes">
      ${list
        .map(
          (t) => `<figure class="card quote" id="${esc(t.id)}">
        <figcaption><span class="eyebrow">${jaDate(t.date)}${t.repeat ? `・${esc(t.repeat)}` : ""}</span>${esc(t.job)}</figcaption>
        ${t.comment ? `<blockquote><p>${esc(t.comment)}</p></blockquote>` : `<p class="muted">（コメントは公開されていません）</p>`}
      </figure>`,
        )
        .join("\n      ")}
    </div>
    <p class="muted small">評価はランサーズでも確認できます。<a href="${esc(l.reviews_url ?? l.profile_url)}">ランサーズの評価ページ</a></p>
  </div>
</section>
${cta(site)}`;
  return layout(site, { route: "reviews/", title: "お客さまの声", description, body, ld: [personLd(site)] });
}

export function render404(site) {
  const body = `<section class="hero hero-sub">
  <div class="wrap">
    <h1>ページが見つかりません</h1>
    <p class="lead">URLが変わったか、ページが削除された可能性があります。</p>
    <p class="actions"><a class="btn btn-accent" href="${esc(site.profile.site_url)}">トップへ戻る</a></p>
  </div>
</section>`;
  return layout(site, { route: "404.html", title: "ページが見つかりません", description: "ページが見つかりません。", body, absolute: true });
}

export function renderLlmsTxt(site) {
  const { profile, services } = site;
  return join([
    `# ${profile.brand}`,
    "",
    `> ${profile.title}の${profile.name}。開発歴${site.years}年。AI（ChatGPT・RAG・AIエージェント）とWeb・業務システムの開発を、要件の整理から保守まで担当。ご相談・ご契約はランサーズ経由: ${profile.contact_url}`,
    "",
    "## サービス",
    ...services.map((s) => `- [${s.name}](${s.url}): ${s.summary}${s.priceFrom ? `（${yen(s.priceFrom)}〜）` : ""}`),
    "",
    "## ほか",
    `- [料金一覧（${site.packages.length}パッケージ）](${new URL("prices/", profile.site_url).href})`,
    `- [実績](${new URL("works/", profile.site_url).href})`,
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
  return join([
    `# ${profile.name}｜${profile.brand.replace(/^.*?｜/, "")}`,
    "",
    `${profile.title}。開発歴${site.years}年。ChatGPT・RAGを使った業務アプリやAIチャットボット、WordPress・Shopify、業務システムを、要件の整理から保守まで担当しています。`,
    "",
    `- 🌐 サービス一覧: ${profile.site_url}`,
    `- ⭐ お客さまの声（${(profile.testimonials ?? []).length}件）: ${new URL("reviews/", profile.site_url).href}`,
    `- 💬 お仕事のご相談: [ランサーズ](${l.profile_url ?? profile.contact_url})（${[l.rank, l.reviews && `評価${l.reviews.replace(/（.*$/, "")}すべて満足`].filter(Boolean).join("・")}）`,
    isSet(p.zenn) && `- ✍️ Zenn: https://zenn.dev/${p.zenn}`,
    isSet(p.qiita) && `- ✍️ Qiita: https://qiita.com/${p.qiita}`,
    isSet(p.note) && `- ✍️ note: https://note.com/${p.note}`,
    "",
    "## できること",
    "",
    "| サービス | 料金の目安 |",
    "|---|---|",
    ...services.map((s) => `| [${s.name}](${s.url}) | ${s.priceFrom ? `${yen(s.priceFrom)}〜` : "お見積もり"} |`),
    "",
    "## 実績（抜粋）",
    "",
    ...(profile.cases ?? []).slice(0, 5).map((c) => `- **${c.title}**（${c.period}）: ${c.result}`),
    "",
    `[すべての実績](${new URL("works/", profile.site_url).href})`,
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
  const routes = ["", ...site.services.map((s) => `services/${s.id}/`), "prices/", "works/", "reviews/", "about/"];
  files["sitemap.xml"] = renderSitemap(site, routes);
  files["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", site.profile.site_url).href}\n`;
  return files;
}
