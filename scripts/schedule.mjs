#!/usr/bin/env node
// Your publishing calendar: every morning's article by date, where it goes and where it stands.
//   npm run schedule
// Each morning's article goes to Qiita and note; one in articles/ goes to Zenn too (every few
// days, Zenn's posting limit), one in off-zenn/ doesn't. "scheduled" ones go live at their time;
// "draft" ones have published: false and won't go anywhere until you flip it.
import fs from "node:fs";
import path from "node:path";
import { rel, ROOT } from "./lib/common.mjs";
import { anchors, isLive, jstDay, nextFreeSlot } from "./lib/schedule.mjs";

const now = new Date();
const articles = anchors(ROOT);
const jstTime = (d) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
const perDay = new Map();
for (const a of articles) if (a.at) perDay.set(jstDay(a.at), (perDay.get(jstDay(a.at)) ?? 0) + 1);
const has = (dir, slug) => fs.existsSync(path.join(ROOT, dir, `${slug}.md`));

if (!articles.length) console.log("No articles yet: npm run new -- zenn <slug> --title \"…\"");
for (const a of articles) {
  const when = a.at ? `${jstDay(a.at)} ${jstTime(a.at)}` : "(no date)       ";
  const state = a.data.published !== true ? "draft    " : isLive(a.data, now) ? "live     " : "scheduled";
  const where = [a.zenn ? "Zenn" : null, has("public", a.slug) || has("qiita", a.slug) ? "Qiita" : null, has("notes", a.slug) || has("note-src", a.slug) ? "note" : null].filter(Boolean).join("+");
  const clash = a.at && perDay.get(jstDay(a.at)) > 1 ? "  ← two posts this day" : "";
  console.log(`${when}  ${state}  ${(where || "-").padEnd(15)}  ${a.data.title ?? a.slug}  (${rel(a.file)})${clash}`);
}
console.log(`\nNext free morning for a Zenn article you write yourself: ${nextFreeSlot(ROOT, now)}`);
