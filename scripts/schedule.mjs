#!/usr/bin/env node
// Your publishing calendar: every Zenn article by date, and where it stands.
//   npm run schedule
// "scheduled" articles go live on Zenn at their time and on Qiita in the same minute (the daily
// job); "draft" ones have published: false and won't go anywhere until you flip it.
import fs from "node:fs";
import path from "node:path";
import { rel, ROOT } from "./lib/common.mjs";
import { isLive, jstDay, nextFreeSlot, zennArticles } from "./lib/schedule.mjs";

const now = new Date();
const articles = zennArticles(ROOT);
const jstTime = (d) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
const perDay = new Map();
for (const a of articles) if (a.at) perDay.set(jstDay(a.at), (perDay.get(jstDay(a.at)) ?? 0) + 1);

if (!articles.length) console.log("No articles yet: npm run new -- zenn <slug> --title \"…\"");
for (const a of articles) {
  const when = a.at ? `${jstDay(a.at)} ${jstTime(a.at)}` : "(no date)       ";
  const state = a.data.published !== true ? "draft    " : isLive(a.data, now) ? "live     " : "scheduled";
  const qiita = fs.existsSync(path.join(ROOT, "public", `${a.slug}.md`)) ? " + Qiita" : "";
  const clash = a.at && perDay.get(jstDay(a.at)) > 1 ? "  ← two posts this day" : "";
  console.log(`${when}  ${state}  ${a.data.title ?? a.slug}${qiita}  (${rel(a.file)})${clash}`);
}
console.log(`\nNext free morning: ${nextFreeSlot(ROOT, now)}`);
