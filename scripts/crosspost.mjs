#!/usr/bin/env node
// Copies Zenn articles that are due (published: true and published_at reached) to Qiita and
// note, so the same Publish run posts them: qiita-cli publishes public/<slug>.md, and
// scripts/note-draft.mjs puts notes/<slug>.md on note. The Publish workflow runs this every
// morning: Zenn publishes the day's article at 09:00 by itself, and this makes the copies then.
// Editing a Zenn article updates its copies too (a note post that's already public is left alone).
//   node scripts/crosspost.mjs              copy everything that's due now
//   node scripts/crosspost.mjs --at 09:00   if it's 03:30–09:00 JST, wait until 09:00 first
//
// Each copy carries a hidden marker line; a Qiita or note post you wrote yourself (no marker) is
// never overwritten. autopilot.yml `qiita: off` or `manual` / `note: off` skip those copies. note copies get
// the Lancers package image that fits the article best as their header image (see
// notes/covers/covers.yml). Qiita copies leave out the closing paragraph with your service and
// Lancers links: Qiita doesn't want posts that promote.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";
import { loadProfile, rel, ROOT, siteUrls } from "./lib/common.mjs";
import { chooseCover, coverPath, coverUsage, loadCovers } from "./lib/note-covers.mjs";
import { imageBase, isLive, jstDay, publishedAt, zennArticles, zennToNote, zennToQiita } from "./lib/schedule.mjs";

const MARK = (slug) => `<!-- crossposted from articles/${slug}.md: edit the Zenn article, not this copy -->`;
const write = (file, fm, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\n${body.endsWith("\n") ? body : `${body}\n`}`);
};
/** Reads an existing copy; null if there's none, or "theirs" if it's a post you wrote yourself. */
function existing(file, slug) {
  if (!fs.existsSync(file)) return null;
  const old = matter(fs.readFileSync(file, "utf8"));
  return old.content.includes(MARK(slug)) ? old : "theirs";
}

/** The article without its closing call to action (the part after the last --- that links to you). */
export function withoutCta(markdown, profile) {
  const i = markdown.lastIndexOf("\n---\n");
  if (i < 0) return markdown;
  const tail = markdown.slice(i);
  const own = [...siteUrls(profile), profile.contact_url].filter(Boolean);
  return own.some((u) => tail.includes(new URL(u).host)) ? `${markdown.slice(0, i).trimEnd()}\n` : markdown;
}

function qiitaCopy(a, { root, base, topics, profile }) {
  const out = path.join(root, "public", `${a.slug}.md`);
  const old = existing(out, a.slug);
  if (old === "theirs") return ["skipped", "a Qiita article you wrote with the same name already exists"];
  // Held back on purpose (e.g. Qiita hid it as possible spam): never send it again from here.
  if (old?.data.ignorePublish === true) return ["unchanged"];
  // Keep what qiita-cli wrote back (id, updated_at, …); take title and tags from Zenn.
  const fm = {
    title: a.data.title,
    tags: topics.slice(0, 5),
    private: false,
    updated_at: old?.data.updated_at ?? "",
    id: old?.data.id ?? null,
    organization_url_name: old?.data.organization_url_name ?? null,
    slide: false,
    ignorePublish: false,
    posting_campaign_uuid: old?.data.posting_campaign_uuid ?? null,
    agreed_posting_campaign_term: old?.data.agreed_posting_campaign_term ?? false,
  };
  const body = `${MARK(a.slug)}\n${zennToQiita(withoutCta(a.content.replace(/^\n+/, ""), profile), { base })}`;
  // Compare what matters, not the bytes: qiita-cli rewrites the front matter in its own style.
  if (old && old.data.title === fm.title && JSON.stringify(old.data.tags) === JSON.stringify(fm.tags) && old.data.ignorePublish === false && old.content.trim() === body.trim()) {
    return ["unchanged"];
  }
  write(out, fm, body);
  return [old ? "updated" : "created"];
}

function noteCopy(a, { root, base, topics, cover }) {
  const out = path.join(root, "notes", `${a.slug}.md`);
  const old = existing(out, a.slug);
  if (old === "theirs") return ["skipped", "a note post you wrote with the same name already exists"];
  if (old?.data.url) return ["unchanged"]; // already public on note: edit notes/<slug>.md itself
  // Keep what note-draft.mjs wrote back (note_id, note_key, note_hash).
  const fm = { title: a.data.title, status: "ready", hashtags: topics.slice(0, 5) };
  for (const k of ["cover", "note_id", "note_key", "note_hash"]) if (old?.data[k] != null) fm[k] = old.data[k];
  fm.url = null;
  // Your own header image (notes/<slug>.png or .jpg, 1280×670) wins; otherwise the package
  // image that fits the article best (notes/covers/covers.yml).
  const own = ["png", "jpg", "jpeg"].map((ext) => path.join(root, "notes", `${a.slug}.${ext}`)).find((f) => fs.existsSync(f));
  if (own) fm.cover = path.basename(own);
  else if (!fm.cover && cover) {
    const chosen = cover({ title: a.data.title, topics });
    if (chosen) fm.cover = chosen;
  }
  const body = `${MARK(a.slug)}\n${zennToNote(a.content.replace(/^\n+/, ""), { base })}`;
  if (old && old.data.title === fm.title && old.data.cover === fm.cover && old.content.trim() === body.trim()) return ["unchanged"];
  write(out, fm, body);
  return [old ? "updated" : "created"];
}

/**
 * Writes or refreshes the Qiita copy (and, with `note`, the note copy) of every due Zenn
 * article. `cover({ title, topics })` returns the note header image for a new note copy, as a
 * path relative to notes/ (or null for none).
 */
export function crosspost({ root = ROOT, profile, now = new Date(), qiita = true, note = false, cover = null }) {
  const base = imageBase(profile);
  const results = [];
  for (const a of zennArticles(root)) {
    if (!isLive(a.data, now)) continue;
    const topics = Array.isArray(a.data.topics) ? a.data.topics.filter(Boolean) : [];
    const record = (platform, dir, [action, reason = ""]) => results.push({ slug: a.slug, platform, file: rel(path.join(root, dir, `${a.slug}.md`)), action, reason });
    if (qiita && !topics.length) {
      record("qiita", "public", ["failed", "add at least one topic: Qiita needs 1–5 tags"]);
      continue;
    }
    if (qiita) record("qiita", "public", qiitaCopy(a, { root, base, topics, profile }));
    if (note) record("note", "notes", noteCopy(a, { root, base, topics, cover }));
  }
  return results;
}

/** Longest wait for --at: the Publish workflow's earliest daily run is 5 h 13 min before 09:00. */
export const MAX_WAIT_MS = 5.5 * 60 * 60 * 1000;

/** Milliseconds to wait until hh:mm Japan time today (0 if that's passed or more than 5½ h away). */
export function msUntil(hhmm, now = new Date()) {
  const target = publishedAt(`${jstDay(now)} ${hhmm}`);
  const ms = target - now;
  return ms > 0 && ms <= MAX_WAIT_MS ? ms : 0;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const i = process.argv.indexOf("--at");
  if (i > 0) {
    const wait = msUntil(process.argv[i + 1] ?? "09:00");
    if (wait) {
      console.log(`crosspost: waiting ${Math.round(wait / 1000)} s until ${process.argv[i + 1]} JST`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const profile = loadProfile();
  const autopilot = path.join(ROOT, "autopilot.yml");
  const settings = fs.existsSync(autopilot) ? (YAML.parse(fs.readFileSync(autopilot, "utf8")) ?? {}) : {};
  const noteMode = settings.note ?? "draft";
  const covers = loadCovers();
  const used = coverUsage();
  const results = crosspost({
    profile,
    qiita: (settings.qiita ?? "auto") === "auto", // `manual` publishes only what you prepared in public/
    note: noteMode !== "off",
    cover: ({ title, topics }) => {
      const pick = chooseCover(covers, { title, topics, used });
      if (!pick) return null;
      used[coverPath(pick)] = (used[coverPath(pick)] ?? 0) + 1;
      return coverPath(pick);
    },
  });
  for (const r of results) if (r.action !== "unchanged") console.log(`crosspost: ${r.action} ${r.file}${r.reason ? ` — ${r.reason}` : ""}`);
  if (!results.some((r) => r.action !== "unchanged")) console.log("crosspost: nothing new is due");
  if (results.some((r) => r.action === "failed")) process.exit(1);
}
