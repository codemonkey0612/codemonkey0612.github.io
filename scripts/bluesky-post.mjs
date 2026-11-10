#!/usr/bin/env node
// Announces each new Zenn article on Bluesky: one post with its title, its opening sentences,
// a link to the service page the article ends with, up to three hashtags, and a link card to
// the article (with the same Lancers package image as the note copy). The Publish workflow runs
// this after the 09:00 wait once the BLUESKY_APP_PASSWORD secret is set and profile.yml has
// platforms.bluesky (your handle); autopilot.yml `bluesky: off` stops it. See README.
//   node scripts/bluesky-post.mjs            post what's new (live on Zenn in the last 2 days)
//   node scripts/bluesky-post.mjs --dry-run  print the posts; nothing is sent
//
// Posts are recorded in social/bluesky.yml, and before posting it also looks through your
// recent Bluesky posts for one that links the article, so an article is never posted twice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";
import { loadProfile, rel, ROOT } from "./lib/common.mjs";
import { BlueskyClient, graphemeLength, MAX_GRAPHEMES, postUrl, richText } from "./lib/bluesky-client.mjs";
import { chooseCover, coverPath, coverUsage, loadCovers } from "./lib/note-covers.mjs";
import { isLive, zennArticles } from "./lib/schedule.mjs";

export const RECENT_MS = 2 * 24 * 60 * 60 * 1000; // older articles (before you connected Bluesky) aren't posted
export const RECORD = path.join("social", "bluesky.yml");
const isSet = (v) => typeof v === "string" && v.trim() !== "" && !/^\s*TODO\b/.test(v);

export function loadRecord(root = ROOT) {
  const file = path.join(root, RECORD);
  return fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, "utf8")) ?? {}) : {};
}

function saveRecord(root, record) {
  const file = path.join(root, RECORD);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Bluesky posts made by scripts/bluesky-post.mjs, one per Zenn article, so none is posted twice.\n${YAML.stringify(record)}`);
}

/** The article's first plain paragraph, without Markdown. */
export function lead(markdown) {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
  for (const block of text.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || /^(#|>|[-*+] |\d+\. |!\[|\||:::|@\[|---|<)/.test(t)) continue;
    return t
      .replace(/\n/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*|__/g, "")
      .trim();
  }
  return "";
}

/** At most n graphemes, ending at a sentence (。) when that keeps at least a third of it. */
export function clip(text, n) {
  const g = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
  if (g.length <= n) return text;
  if (n <= 1) return "";
  const head = g.slice(0, n).join("");
  const end = head.lastIndexOf("。");
  return end >= 0 && graphemeLength(head.slice(0, end + 1)) >= n / 3 ? head.slice(0, end + 1) : `${g.slice(0, n - 1).join("")}…`;
}

/** The last link to your own site in the article (its call to action), else the site itself. */
export function serviceLink(markdown, profile) {
  const site = new URL(profile.site_url).origin;
  return [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((u) => u.startsWith(site)).at(-1) ?? profile.site_url;
}

/** The post for an article: text with links and hashtags, and a link card to the article. */
export function composePost(article, { profile, articleUrl }) {
  const title = String(article.data.title);
  const service = serviceLink(article.content, profile);
  const head = `📝 新しい記事：${title}`;
  const offer = ["\n\n💼 AI・Web開発のご相談 → ", { text: service.replace(/^https?:\/\//, "").replace(/\/$/, ""), link: service }];
  const topics = (Array.isArray(article.data.topics) ? article.data.topics : []).filter((t) => typeof t === "string" && /^[\p{L}\p{N}_]+$/u.test(t)).slice(0, 3);
  const tags = topics.flatMap((t, i) => [i ? " " : "\n", { text: `#${t}`, tag: t }]);
  const size = (parts) => parts.reduce((n, p) => n + graphemeLength(typeof p === "string" ? p : p.text), 0);
  let rest = [...offer, ...tags];
  if (size([head, ...rest]) > MAX_GRAPHEMES) rest = offer; // a very long title: drop the hashtags
  const room = MAX_GRAPHEMES - size([head, ...rest]) - 2;
  const opening = room > 20 ? clip(lead(article.content), room) : "";
  const { text, facets } = richText([head, ...(opening ? [`\n\n${opening}`] : []), ...rest]);
  return {
    text,
    facets,
    langs: ["ja"],
    embed: { $type: "app.bsky.embed.external", external: { uri: articleUrl, title, description: `${profile.brand ?? ""}の技術記事（Zenn）`.replace(/^の/, "") } },
  };
}

/** The note copy's header image, or the package image that fits the article best. */
function coverFor(root, article) {
  const notePath = path.join(root, "notes", `${article.slug}.md`);
  let cover = fs.existsSync(notePath) ? matter(fs.readFileSync(notePath, "utf8")).data.cover : null;
  if (!cover) {
    const pick = chooseCover(loadCovers(root), { title: article.data.title, topics: article.data.topics ?? [], used: coverUsage(root) });
    cover = pick ? coverPath(pick) : null;
  }
  const file = cover ? path.join(root, "notes", String(cover)) : null;
  if (!file || !fs.existsSync(file)) return null;
  const type = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" }[path.extname(file).toLowerCase()];
  return type ? { data: fs.readFileSync(file), type } : null;
}

/**
 * Posts every article that went live on Zenn in the last RECENT_MS and isn't on Bluesky yet.
 * Returns one result per article: { slug, action: "posted" | "found" | "waiting" | "dry-run" | "failed", ... }.
 */
export async function syncBluesky({ root = ROOT, client, profile, now = new Date(), dryRun = false, fetchPage = globalThis.fetch, log = () => {} }) {
  const zenn = profile.platforms?.zenn;
  if (!isSet(zenn)) throw new Error("profile.yml platforms.zenn is not set, so there's no article link to post");
  const record = loadRecord(root);
  const due = zennArticles(root).filter((a) => a.at && isLive(a.data, now) && now - a.at <= RECENT_MS && !record[a.slug]);
  const results = [];
  if (!due.length) return results;
  let recent = [];
  if (!dryRun) {
    await client.login();
    recent = await client.recentPosts(50);
  }
  for (const a of due) {
    const articleUrl = `https://zenn.dev/${zenn}/articles/${a.slug}`;
    const post = composePost(a, { profile, articleUrl });
    if (dryRun) {
      results.push({ slug: a.slug, action: "dry-run", text: post.text, link: articleUrl });
      continue;
    }
    try {
      const links = (r) => [r.value?.embed?.external?.uri, ...(r.value?.facets ?? []).flatMap((f) => (f.features ?? []).map((x) => x.uri))];
      const earlier = recent.find((r) => links(r).includes(articleUrl));
      if (earlier) {
        record[a.slug] = { url: postUrl(client.session.handle, earlier.uri), uri: earlier.uri, at: earlier.value?.createdAt ?? null };
        saveRecord(root, record);
        results.push({ slug: a.slug, action: "found", url: record[a.slug].url });
        continue;
      }
      // Zenn publishes on its own; don't link a page that isn't up yet (a later run posts it).
      const page = await fetchPage(articleUrl, { method: "GET" });
      if (!page.ok) {
        results.push({ slug: a.slug, action: "waiting", reason: `${articleUrl} isn't public on Zenn yet (HTTP ${page.status})` });
        continue;
      }
      const image = coverFor(root, a);
      if (image) {
        try {
          post.embed.external.thumb = await client.uploadImage(image.data, image.type);
        } catch (err) {
          log(`bluesky: posting ${a.slug} without its image (${err.message})`);
        }
      }
      const made = await client.post(post);
      record[a.slug] = { url: made.url, uri: made.uri, at: now.toISOString() };
      saveRecord(root, record); // at once, so a failure later never leads to a second post
      results.push({ slug: a.slug, action: "posted", url: made.url });
    } catch (err) {
      if (err.name === "BlueskyAuthError") throw err;
      results.push({ slug: a.slug, action: "failed", reason: err.message });
    }
  }
  return results;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const dryRun = process.argv.includes("--dry-run");
  const autopilot = path.join(ROOT, "autopilot.yml");
  const mode = (fs.existsSync(autopilot) ? YAML.parse(fs.readFileSync(autopilot, "utf8"))?.bluesky : null) ?? "off";
  if (mode === "off") {
    console.log("bluesky: autopilot.yml has bluesky: off, so nothing was posted");
    process.exit(0);
  }
  const profile = loadProfile();
  const handle = profile.platforms?.bluesky;
  if (!dryRun && !(isSet(handle) && process.env.BLUESKY_APP_PASSWORD)) {
    console.error("bluesky: set platforms.bluesky (your handle) in profile.yml and the BLUESKY_APP_PASSWORD secret (see README), or use --dry-run");
    process.exit(1);
  }
  try {
    const client = dryRun ? null : new BlueskyClient({ handle, appPassword: process.env.BLUESKY_APP_PASSWORD });
    const results = await syncBluesky({ client, profile, dryRun, log: console.log });
    const lines = results.map((r) =>
      r.action === "dry-run" ? `would post (${graphemeLength(r.text)}/${MAX_GRAPHEMES}) + card ${r.link}:\n${r.text}\n` : `${r.action.padEnd(8)} ${r.slug}${r.url ? `\n         ${r.url}` : ""}${r.reason ? ` — ${r.reason}` : ""}`,
    );
    const text = lines.length ? lines.join("\n") : "bluesky: nothing new to post";
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY && lines.length) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bluesky\n\n\`\`\`\n${text}\n\`\`\`\n`);
    if (results.some((r) => r.action === "failed")) process.exit(1);
    if (results.some((r) => r.action === "posted" || r.action === "found")) console.log(`bluesky: recorded in ${rel(path.join(ROOT, RECORD))}`);
  } catch (err) {
    console.error(`bluesky: ${err.message}`);
    process.exit(1);
  }
}
