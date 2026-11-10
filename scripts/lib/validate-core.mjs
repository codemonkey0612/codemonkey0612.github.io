// Deterministic checks: platform front matter, call-to-action, sources, persona.
// Errors block publishing; warnings are advice.
import path from "node:path";
import { publishedAt } from "./schedule.mjs";
import { isPublishReady, todosFor } from "./common.mjs";

const PERSONAS = ["私", "僕", "俺", "オレ", "ボク", "わたし", "筆者", "自分"];
const STAT_RE = /\d+(?:\.\d+)?\s?(?:%|％|割|倍|万人|億円|万円|人に1人)/g;
const LINK_RE = /\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(?<![("<])(https?:\/\/[^\s)<>]+)/g;

const graphemes = (s) => [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s)];

function links(text) {
  return [...text.matchAll(LINK_RE)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function checkZenn({ file, data }, out) {
  const slug = path.basename(file, ".md");
  if (!/^[a-z0-9_-]{12,50}$/.test(slug))
    out.error("slug (file name) must be 12–50 chars of a-z, 0-9, - or _ (Zenn rule)");
  if (typeof data.title !== "string" || !data.title.trim()) out.error("title is required");
  else if ([...data.title].length > 70) out.error(`title is ${[...data.title].length} chars; Zenn allows 70`);
  const emoji = typeof data.emoji === "string" ? graphemes(data.emoji.trim()) : [];
  if (emoji.length !== 1 || !/\p{Extended_Pictographic}/u.test(data.emoji))
    out.error("emoji must be exactly one emoji");
  if (!["tech", "idea"].includes(data.type)) out.error('type must be "tech" or "idea"');
  if ("tags" in data) out.error("Zenn uses topics, not tags");
  if (!Array.isArray(data.topics)) out.error("topics must be a list");
  else {
    if (data.topics.length === 0) out.warn("no topics: readers find Zenn articles through topics");
    if (data.topics.length > 5) out.error("Zenn allows at most 5 topics");
    for (const t of data.topics) {
      if (typeof t !== "string" || !t) out.error(`topic ${JSON.stringify(t)} must be a non-empty string`);
      else if ([...t].length > 18) out.error(`topic "${t}" is longer than 18 chars`);
      else if (!/^[\p{L}\p{N}]+$/u.test(t)) out.error(`topic "${t}" has symbols or spaces (C++ → cpp, C# → csharp)`);
    }
  }
  if (typeof data.published !== "boolean") out.error("published must be true or false");
  if (data.published_at != null && !publishedAt(data.published_at))
    out.error('published_at must look like "2026-11-10 09:00" (Japan time)');
}

function checkQiita({ data }, out) {
  if (typeof data.title !== "string" || !data.title.trim()) out.error("title is required");
  if (!Array.isArray(data.tags) || data.tags.length < 1 || data.tags.length > 5)
    out.error("Qiita needs 1–5 tags");
  else
    for (const t of data.tags)
      if (typeof t !== "string" || !t.trim() || /\s/.test(t)) out.error(`tag ${JSON.stringify(t)} must be a non-empty word`);
  if (typeof data.private !== "boolean") out.error("private must be true or false");
  if (typeof data.ignorePublish !== "boolean") out.error("ignorePublish must be true or false");
}

function checkNote({ data }, out) {
  if (typeof data.title !== "string" || !data.title.trim()) out.error("title is required");
  if (!["draft", "ready"].includes(data.status)) out.error('status must be "draft" or "ready"');
  if (data.hashtags !== undefined && !Array.isArray(data.hashtags)) out.error("hashtags must be a list");
  if (data.url != null && !/^https:\/\/note\.com\/[^/]+\/n\/\w+/.test(String(data.url)))
    out.error("url must be the published note link (https://note.com/<you>/n/<key>) or empty");
}

/** Numbers you publish about your own work (profile cases, Lancers stats): no outside source needed. */
function ownStatistics(profile) {
  const text = JSON.stringify([profile.facts, profile.lancers, profile.cases]);
  return new Set((text.match(STAT_RE) ?? []).map(normalizeStat));
}

const normalizeStat = (s) => s.replace(/％/g, "%").replace(/\s/g, "");

export function validateArticle(article, profile) {
  const errors = [];
  const warnings = [];
  const out = { error: (m) => errors.push(m), warn: (m) => warnings.push(m) };
  const ready = isPublishReady(article);
  const body = article.content.replace(/<!--[\s\S]*?-->/g, "");

  if (article.platform === "zenn") checkZenn(article, out);
  else if (article.platform === "qiita") checkQiita(article, out);
  else if (article.platform === "note") checkNote(article, out);
  else out.error("not in articles/ (Zenn), public/ (Qiita) or notes/ (note)");

  // Leftover placeholders.
  const placeholder = body.match(/\bTODO\b|（[^）]*ここに[^）]*）|{{[A-Z_]+}}/);
  if (placeholder) (ready ? out.error : out.warn)(`placeholder left in body: "${placeholder[0]}"`);

  const allLinks = links(body);
  const ownOrigins = new Set([origin(profile.site_url), origin(profile.contact_url)].filter(Boolean));
  const platformHosts = /(^|\.)(zenn\.dev|qiita\.com|note\.com|github\.com)$/;
  const external = allLinks.filter((u) => {
    const o = origin(u);
    return o && !ownOrigins.has(o) && !platformHosts.test(new URL(u).hostname);
  });

  // Every published post should lead readers to a service page or contact form, except on
  // Qiita: it doesn't want promotional posts (its spam monitoring hid one that ended with
  // these links), so Qiita articles leave them out and the link lives in your Qiita profile.
  if (ready) {
    const todos = todosFor(profile, article.platform);
    if (todos.length) out.error(`profile.yml still has TODO values: ${todos.join(", ")}`);
    else if (article.platform !== "qiita" && !allLinks.some((u) => ownOrigins.has(origin(u))))
      out.error(`no link to your site (${profile.site_url}): add a call to action that points to a service page or ${profile.contact_url}`);
  }

  // Qiita articles carry no promotion at all: no links to your site, Lancers, Zenn or note.
  if (article.platform === "qiita") {
    const p = profile.platforms ?? {};
    const own = allLinks.filter((u) => {
      let host;
      let pathname;
      try {
        ({ host, pathname } = new URL(u));
      } catch {
        return false;
      }
      return (
        ownOrigins.has(origin(u)) ||
        /(^|\.)lancers\.jp$/.test(host) ||
        (host === "zenn.dev" && typeof p.zenn === "string" && pathname.startsWith(`/${p.zenn}`)) ||
        (host === "note.com" && typeof p.note === "string" && pathname.startsWith(`/${p.note}`))
      );
    });
    if (own.length) (ready ? out.error : out.warn)(`Qiita articles must not link to your site, Lancers, Zenn or note (Qiita forbids promotion): ${own.slice(0, 3).join(", ")}`);
  }

  // Numbers that read like statistics need at least one outside source, unless
  // they are your own published results (profile.yml cases / Lancers stats).
  const own = ownStatistics(profile);
  const stats = [...new Set(body.match(STAT_RE) ?? [])].filter((s) => !own.has(normalizeStat(s)));
  if (stats.length && external.length === 0)
    (ready ? out.error : out.warn)(`statistics (${stats.slice(0, 4).join(", ")}) but no source links: link the survey or study`);

  // One narrator voice across every post.
  if (profile.persona && PERSONAS.includes(profile.persona)) {
    const others = PERSONAS.filter((p) => p !== profile.persona && p !== "自分")
      .map((p) => [p, (body.match(new RegExp(`${p}(?!たち|達|ども|立|物|服|鉄|生活|有)`, "g")) ?? []).length])
      .filter(([, n]) => n > 0);
    if (others.length)
      out.warn(`profile.yml persona is "${profile.persona}" but the body also uses ${others.map(([p, n]) => `${p}×${n}`).join(", ")}`);
  }

  return { file: article.file, platform: article.platform, ready, errors, warnings };
}
