#!/usr/bin/env node
// Copies Zenn articles that are due (published: true and published_at reached) to Qiita, so
// qiita-cli publishes them in the same run. The Publish workflow runs this every morning:
// Zenn publishes the day's article at 09:00 by itself, and this makes the Qiita copy at 09:00.
// Editing a published Zenn article updates its Qiita copy too.
//   node scripts/crosspost.mjs              copy everything that's due now
//   node scripts/crosspost.mjs --at 09:00   if it's earlier than 09:00 JST, wait until then first
//
// A copy is public/<slug>.md with a hidden marker line; a Qiita article you wrote yourself
// (no marker) is never overwritten. qiita-cli writes the copy's id back after publishing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";
import { loadProfile, rel, ROOT } from "./lib/common.mjs";
import { imageBase, isLive, jstDay, publishedAt, zennArticles, zennToQiita } from "./lib/schedule.mjs";

const MARK = (slug) => `<!-- crossposted from articles/${slug}.md: edit the Zenn article, not this copy -->`;

/** Writes or refreshes the Qiita copy of every due Zenn article. Returns what it did per article. */
export function crosspost({ root = ROOT, profile, now = new Date() }) {
  const base = imageBase(profile);
  const results = [];
  for (const a of zennArticles(root)) {
    if (!isLive(a.data, now)) continue;
    const out = path.join(root, "public", `${a.slug}.md`);
    const done = (action, reason = "") => results.push({ slug: a.slug, file: rel(out), action, reason });
    const topics = Array.isArray(a.data.topics) ? a.data.topics.filter(Boolean) : [];
    if (!topics.length) {
      done("failed", "add at least one topic: Qiita needs 1–5 tags");
      continue;
    }
    let old = null;
    if (fs.existsSync(out)) {
      old = matter(fs.readFileSync(out, "utf8"));
      if (!old.content.includes(MARK(a.slug))) {
        done("skipped", "a Qiita article you wrote with the same name already exists");
        continue;
      }
    }
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
    const body = `${MARK(a.slug)}\n${zennToQiita(a.content.replace(/^\n+/, ""), { base })}`;
    // Compare what matters, not the bytes: qiita-cli rewrites the front matter in its own style.
    if (old && old.data.title === fm.title && JSON.stringify(old.data.tags) === JSON.stringify(fm.tags) && old.data.ignorePublish === false && old.content.trim() === body.trim()) {
      done("unchanged");
      continue;
    }
    const text = `---\n${YAML.stringify(fm)}---\n${body.endsWith("\n") ? body : `${body}\n`}`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    done(old ? "updated" : "created");
  }
  return results;
}

/** Milliseconds to wait until hh:mm Japan time today (0 if that's passed or more than 3 h away). */
export function msUntil(hhmm, now = new Date()) {
  const target = publishedAt(`${jstDay(now)} ${hhmm}`);
  const ms = target - now;
  return ms > 0 && ms <= 3 * 60 * 60 * 1000 ? ms : 0;
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
  const results = crosspost({ profile: loadProfile() });
  for (const r of results) if (r.action !== "unchanged") console.log(`crosspost: ${r.action} ${r.file}${r.reason ? ` — ${r.reason}` : ""}`);
  if (!results.some((r) => r.action !== "unchanged")) console.log("crosspost: nothing due for Qiita");
  if (results.some((r) => r.action === "failed")) process.exit(1);
}
