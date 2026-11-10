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

// ---------- data ----------

const isSet = (v) => typeof v === "string" && v.trim() !== "" && !/^\s*TODO\b/.test(v);
// Works filter on /works/: a work's category follows its service's pillar.
const PILLAR_KEY = { AI: "ai", "Web・EC": "web", システム開発: "system", "品質・セキュリティ": "system" };

/** "## heading" sections of a service page: their bullet items and plain paragraphs. */
function mdSections(md) {
  const out = {};
  let cur = null;
  for (const line of String(md).split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = out[h[1]] = { items: [], paras: [] };
      continue;
    }
    if (!cur || !line.trim()) continue;
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li) cur.items.push(li[1].trim());
    else cur.paras.push(line.trim());
  }
  return out;
}

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
    const sections = mdSections(content);
    return {
      ...s,
      no: String(i + 1).padStart(2, "0"),
      en: data.en ?? s.name,
      short: data.short ?? s.name,
      card: String(data.card ?? s.summary).split("|"),
      headline: data.headline ?? s.name,
      lead: data.lead ?? s.summary,
      accent: data.accent ?? "#c9a24a",
      process: data.process ?? [],
      deliverables: data.deliverables ?? [],
      problems: sections["こんな課題に"]?.items ?? [],
      scope: sections["できること"]?.items ?? [],
      scopeNote: sections["できること"]?.paras ?? [],
      approach: sections["進め方"]?.paras ?? [],
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
  works.forEach((w, i) => {
    w.no = String(i + 1).padStart(2, "0");
    w.cat = PILLAR_KEY[w.service?.pillar] ?? "system";
    w.title_ = w.short ?? (w.kindOf === "site" ? w.name : w.headline);
  });
  // Each service's promo video: the first of its packages that has one.
  for (const s of services) s.video = s.packages.find((p) => p.video) ?? null;

  // Brand art (site/media.yml): the emblem and the showreel.
  const mediaFile = path.join(root, "site", "media.yml");
  const m = fs.existsSync(mediaFile) ? readYaml(mediaFile) : {};
  // Hero stills rendered by `npm run site:scenes -- --stills` (site/assets/art/<scene>.webp,
  // <scene>-m.webp for phones, scenes.json = each scene's mood). A missing still falls back
  // to a CSS gradient, so the site still builds while you render them.
  const artDir = path.join(root, "site", "assets", "art");
  const manifestFile = path.join(artDir, "scenes.json");
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
  // Plates (site/assets/plates/, made by `npm run site:plates` from your generated images)
  // take the place of a scene's 3D still; plates.json holds their size and tone.
  const plateDir = path.join(root, "site", "assets", "plates");
  const plateFile = path.join(plateDir, "plates.json");
  const plates = fs.existsSync(plateFile) ? JSON.parse(fs.readFileSync(plateFile, "utf8")) : {};
  const stage = (name) => {
    const p = plates[name];
    if (p && fs.existsSync(path.join(plateDir, `${name}.webp`)) && fs.existsSync(path.join(plateDir, `${name}-m.webp`))) {
      return { plate: true, tone: p.tone, wide: `assets/plates/${name}.webp`, narrow: `assets/plates/${name}-m.webp`, w: p.w, h: p.h, mw: p.mw, mh: p.mh };
    }
    const dims = { w: 1920, h: 1080, mw: 1000, mh: 860 };
    const wide = path.join(artDir, `${name}.webp`);
    const narrow = path.join(artDir, `${name}-m.webp`);
    const tone = manifest[name]?.mood === "pearl" ? "light" : "dark";
    if (!fs.existsSync(wide)) return { tone, wide: null, narrow: null, ...dims };
    return { tone, ...dims, wide: `assets/art/${name}.webp`, narrow: fs.existsSync(narrow) ? `assets/art/${name}-m.webp` : `assets/art/${name}.webp` };
  };
  /** A section image (sec-*) from plates.json, or null until you add it. */
  const section = (name) => {
    const p = plates[name];
    return p?.kind === "section" && fs.existsSync(path.join(plateDir, `${name}.webp`)) ? { src: `assets/plates/${name}.webp`, w: p.w, h: p.h } : null;
  };
  const art = {
    stage,
    section,
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
    .update(["style.css", "app.js", "celestial.js", "contact.js", "contact.css"].map((f) => {
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

// ---------- pages ----------
// Rendering lives in site-pages.mjs; these re-exports keep the old import paths working.
export {
  esc,
  render404,
  renderAbout,
  renderContact,
  renderGithubReadme,
  renderIndex,
  renderLlmsTxt,
  renderPrices,
  renderReviews,
  renderService,
  renderServices,
  renderSite,
  renderSitemap,
  renderWork,
  renderWorks,
} from "./site-pages.mjs";
