// One post a day: you write it once in articles/ (Zenn) with published_at "YYYY-MM-DD 09:00".
// Zenn publishes it at that time by itself; at the same time the daily job copies it to Qiita
// (zennToQiita), and `npm run note -- articles/<slug>.md` gives you a note copy (zennToNote).
// All times are Japan time (JST, UTC+9), which is also how Zenn reads published_at.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

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

/** Zenn articles with their front matter, sorted by publish date. */
export function zennArticles(root) {
  const dir = path.join(root, "articles");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const file = path.join(dir, f);
      const { data, content } = matter(fs.readFileSync(file, "utf8"));
      return { file, slug: path.basename(f, ".md"), data, content, at: publishedAt(data.published_at) };
    })
    .sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity) || a.slug.localeCompare(b.slug));
}

/** The first day after today (Japan time) with no article scheduled, as "YYYY-MM-DD 09:00". */
export function nextFreeSlot(root, now = new Date()) {
  const taken = new Set(zennArticles(root).filter((a) => a.at).map((a) => jstDay(a.at)));
  for (let d = 1; d < 3660; d++) {
    const day = jstDay(new Date(now.getTime() + d * 86_400_000));
    if (!taken.has(day)) return `${day} ${PUBLISH_TIME}`;
  }
  throw new Error("no free day found");
}

/** Where Zenn's /images/… files are on the web (your public GitHub repo), for Qiita and note copies. */
export function imageBase(profile) {
  const gh = profile.platforms?.github;
  if (!gh || /^\s*TODO/.test(gh)) return null;
  return `https://raw.githubusercontent.com/${gh}/${new URL(profile.site_url).host}/main/images/`;
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
