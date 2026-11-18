// One post a day: you write it once in articles/ (Zenn) with published_at "YYYY-MM-DD 09:00".
// Zenn publishes it at that time by itself; at the same time the daily job copies it to Qiita
// (zennToQiita), and `npm run note -- articles/<slug>.md` gives you a note copy (zennToNote).
// All times are Japan time (JST, UTC+9), which is also how Zenn reads published_at.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";

export const PUBLISH_TIME = "09:00";
const JST_MS = 9 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of a moment, in Japan time. */
export const jstDay = (date) => new Date(date.getTime() + JST_MS).toISOString().slice(0, 10);

/** A Zenn published_at ("YYYY-MM-DD", "YYYY-MM-DD hh:mm" or a YAML date) as a moment; null if unset or invalid. */
export function publishedAt(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : publishedAt(value.toISOString().slice(0, 10));
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi) - JST_MS;
  return Number.isNaN(t) ? null : new Date(t);
}

/** Is this Zenn article live on Zenn at `now`? (published, and its scheduled time has come.) */
export function isLive(data, now = new Date()) {
  if (data.published !== true) return false;
  const at = publishedAt(data.published_at);
  return !at || at <= now;
}

const byDate = (a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity) || a.slug.localeCompare(b.slug);

function readArticles(root, dirName) {
  const dir = path.join(root, dirName);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const file = path.join(dir, f);
      const { data, content } = matter(fs.readFileSync(file, "utf8"));
      return { file, dir: dirName, slug: path.basename(f, ".md"), data, content, at: publishedAt(data.published_at) };
    });
}

/** Zenn articles with their front matter, sorted by publish date. */
export function zennArticles(root) {
  return readArticles(root, "articles").sort(byDate);
}

/**
 * Articles written like Zenn articles that go to note and Qiita only: the mornings between Zenn's
 * (Zenn limits how often an account may post), and ones Zenn refused. Zenn never reads this folder.
 */
export const OFF_ZENN_DIR = "off-zenn";

/** Every morning's article, on Zenn (articles/, `zenn: true`) or not (off-zenn/, `zenn: false`), by date. */
export function anchors(root) {
  return [...readArticles(root, "articles").map((a) => ({ ...a, zenn: true })), ...readArticles(root, OFF_ZENN_DIR).map((a) => ({ ...a, zenn: false }))].sort(byDate);
}

/**
 * The note version the writer prepared for an article (note-src/<slug>.md, autopilot.yml
 * `note_version`), if it passed its checks; null otherwise. It goes to note in place of the copy.
 */
export function noteVersionOf(root, slug) {
  const file = path.join(root, "note-src", `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const v = matter(fs.readFileSync(file, "utf8"));
  return v.data.status === "failed" || !v.data.title || !v.content.trim() ? null : v;
}

/** autopilot.yml `zenn.every_days`: one Zenn article every this many mornings (default 1, daily). */
export function zennEvery(root) {
  const file = path.join(root, "autopilot.yml");
  const n = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, "utf8"))?.zenn?.every_days : null;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Is `day` ("YYYY-MM-DD") free, with no article in `taken` within `every` − 1 days of it? */
export function dayIsFree(day, taken, every = 1) {
  const t = Date.parse(`${day}T00:00:00Z`);
  for (let k = 1 - every; k < every; k++) if (taken.has(new Date(t + k * 86_400_000).toISOString().slice(0, 10))) return false;
  return true;
}

/** The first free day after today (Japan time), as "YYYY-MM-DD 09:00" (see dayIsFree). */
export function nextFreeSlot(root, now = new Date(), every = zennEvery(root)) {
  const taken = new Set(zennArticles(root).filter((a) => a.at).map((a) => jstDay(a.at)));
  for (let d = 1; d < 3660; d++) {
    const day = jstDay(new Date(now.getTime() + d * 86_400_000));
    if (dayIsFree(day, taken, every)) return `${day} ${PUBLISH_TIME}`;
  }
  throw new Error("no free day found");
}

/** Where Zenn's /images/… files are on the web (your public GitHub repo), for Qiita and note copies. */
export function imageBase(profile) {
  const gh = profile.platforms?.github;
  if (!gh || /^\s*TODO/.test(gh)) return null;
  // The repo is named in site_repo; before the custom domain its name was the site's host.
  const repo = profile.site_repo ?? new URL(profile.site_url).host;
  return `https://raw.githubusercontent.com/${gh}/${repo}/main/images/`;
}

const embed = (kind, arg) =>
  kind === "youtube" && !/^https?:/.test(arg) ? `https://www.youtube.com/watch?v=${arg}` : arg;

// Zenn-only Markdown, shared by both converters: embeds become bare URLs, /images/ become web URLs.
function common(md, base) {
  return md
    .replace(/^@\[(\w+)\]\(([^)\s]+)\)\s*$/gm, (_, kind, arg) => embed(kind, arg))
    .replace(/\]\(\/images\//g, base ? `](${base}` : "](/images/");
}

/** Zenn Markdown → Qiita Markdown (:::message → :::note, :::details → <details>, embeds, images). */
export function zennToQiita(markdown, { base = null } = {}) {
  const stack = [];
  const lines = common(markdown, base).split("\n").map((line) => {
    let m;
    if ((m = /^(:{3,})\s*message(?:\s+(alert))?\s*$/.exec(line))) {
      stack.push({ fence: m[1], close: m[1] });
      return `${m[1]}note ${m[2] ? "alert" : "info"}`;
    }
    if ((m = /^(:{3,})\s*details\s+(.*)$/.exec(line))) {
      stack.push({ fence: m[1], close: "</details>" });
      return `<details><summary>${m[2].trim()}</summary>\n`;
    }
    if (stack.length && line.trim() === stack.at(-1).fence) {
      const { close } = stack.pop();
      return close === "</details>" ? "\n</details>" : close;
    }
    return line;
  });
  return lines.join("\n");
}

/** Zenn Markdown → plain Markdown for note (messages become quotes, details are opened up). */
export function zennToNote(markdown, { base = null } = {}) {
  const stack = [];
  const out = [];
  for (const line of common(markdown, base).split("\n")) {
    let m;
    if ((m = /^(:{3,})\s*message(?:\s+alert)?\s*$/.exec(line))) {
      stack.push({ fence: m[1], quote: true });
      continue;
    }
    if ((m = /^(:{3,})\s*details\s+(.*)$/.exec(line))) {
      stack.push({ fence: m[1], quote: false });
      out.push(`**${m[2].trim()}**`, "");
      continue;
    }
    if (stack.length && line.trim() === stack.at(-1).fence) {
      stack.pop();
      continue;
    }
    out.push(stack.some((s) => s.quote) ? `> ${line}`.trimEnd() : line);
  }
  return out.join("\n");
}
