// note header images from your Lancers package images (notes/covers/covers.yml): loading the
// list and picking the best one for an article. scripts/note-covers.mjs renders the images;
// scripts/crosspost.mjs uses them.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { PLATFORM_DIRS, ROOT } from "./common.mjs";

export const COVER_SIZE = [1280, 670]; // note's recommended 見出し画像 size
export const COVERS_DIR = "covers"; // inside notes/

/** notes/covers/<id>.jpg, as the note copy's `cover:` (relative to notes/). */
export const coverPath = (entry) => `${COVERS_DIR}/${entry.id}.jpg`;

/** The list in notes/covers/covers.yml; [] if there's none. */
export function loadCovers(root = ROOT) {
  const file = path.join(root, PLATFORM_DIRS.note, COVERS_DIR, "covers.yml");
  if (!fs.existsSync(file)) return [];
  const list = YAML.parse(fs.readFileSync(file, "utf8")) ?? [];
  return list.map((c) => {
    if (!c?.id || !Array.isArray(c.keywords)) throw new Error(`${file}: every entry needs an id and keywords`);
    const seen = new Set();
    const keywords = c.keywords.map(String).filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
    return { ...c, id: String(c.id), keywords };
  });
}

const ASCII = /^[\x20-\x7e]+$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An ASCII keyword must be a whole word in the title ("line" doesn't match "pipeline"). */
function inTitle(title, keyword) {
  if (!ASCII.test(keyword)) return title.includes(keyword);
  return new RegExp(`(^|[^a-z0-9])${escapeRe(keyword.toLowerCase())}($|[^a-z0-9])`).test(title.toLowerCase());
}

/** 3 for each keyword that is one of the topics, 2 for each one in the title. */
export function scoreCover(entry, { title = "", topics = [] }) {
  const tags = new Set(topics.map((t) => String(t).toLowerCase()));
  let score = 0;
  for (const k of entry.keywords) {
    if (tags.has(k.toLowerCase())) score += 3;
    if (inTitle(title, k)) score += 2;
  }
  return score;
}

/**
 * The best package image for an article. `used` counts how often each cover path is already in
 * use, so equally good images take turns. No match at all: the `default: true` image.
 */
export function chooseCover(covers, { title, topics, used = {} }) {
  if (!covers.length) return null;
  const scored = covers.map((c, i) => ({ c, i, s: scoreCover(c, { title, topics }) }));
  const best = Math.max(...scored.map((x) => x.s));
  if (best <= 0) return covers.find((c) => c.default) ?? covers[0];
  const uses = (c) => used[coverPath(c)] ?? 0;
  return scored.filter((x) => x.s === best).sort((a, b) => uses(a.c) - uses(b.c) || a.i - b.i)[0].c;
}

/** How many note posts already use each cover path. */
export function coverUsage(root = ROOT) {
  const dir = path.join(root, PLATFORM_DIRS.note);
  const used = {};
  if (!fs.existsSync(dir)) return used;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const cover = matter(fs.readFileSync(path.join(dir, f), "utf8")).data.cover;
    if (typeof cover === "string") used[cover] = (used[cover] ?? 0) + 1;
  }
  return used;
}
