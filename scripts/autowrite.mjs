#!/usr/bin/env node
// Writes the next articles on its own: one for every morning (09:00 Japan time). Each morning's
// article gets its own Qiita and note versions, posted that morning; every few days, when Zenn's
// posting limit allows (autopilot.yml `zenn.every_days`), the article itself goes to Zenn too
// (articles/); the others stay in off-zenn/. The Write workflow runs this every morning;
// settings are in autopilot.yml. The steps are writeMornings in lib/writer-core.mjs.
//   npm run autowrite            fill the open mornings (needs ANTHROPIC_API_KEY)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadProfile, ROOT } from "./lib/common.mjs";
import { trendDigest } from "./lib/trends.mjs";
import { claudeSettings, claudeSteps, loadConfig, openSlots, writeMornings } from "./lib/writer-core.mjs";

const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

const config = loadConfig(ROOT);
out("mode", config.mode);
if (!config.enabled) {
  console.log("autowrite: off (autopilot.yml enabled: false)");
  process.exit(0);
}
// `qiita: daily` and `note_version: true` (unless `note: off`): each morning's article also gets
// its own Qiita and note articles, which may still be missing even when every morning has one.
const companionsOn = config.qiita === "daily" || (config.note_version && config.note !== "off");
if (!openSlots(ROOT, new Date(), config.days_ahead).length && !companionsOn) {
  console.log("autowrite: the next mornings already have articles");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("autowrite: ANTHROPIC_API_KEY is not set (add it as a repository secret)");
  process.exit(1);
}

const profile = loadProfile();
const log = (m) => console.log(m);
const ideasFile = path.join(ROOT, "ideas.md");
const { slots, moved, results, qiita, note } = await writeMornings({
  root: ROOT,
  profile,
  config,
  steps: claudeSteps(new Anthropic(), (m) => console.error(m), claudeSettings(config)),
  ideas: fs.existsSync(ideasFile) ? fs.readFileSync(ideasFile, "utf8") : "",
  log,
  // What's being liked on Zenn, Qiita and note right now, for planning the topic and title.
  trends: () => trendDigest({ log }),
});
if (!slots.length && !qiita.length && !note.length && !moved.length) console.log("autowrite: the next mornings already have articles (and their Qiita and note articles)");

// "requeued": an article Zenn never took, sent again for this morning; "missing": Zenn still
// didn't take it after that (the run fails); "zenn refused": moved to off-zenn/.
const failed = (r) => r.status === "failed" || r.status === "missing";
const ok = results.filter((r) => !failed(r) && r.status !== "requeued");
const lines = ["### Autopilot", ""];
for (const r of moved) lines.push(`- **Zenn refused** · ${r.date} · ${r.title} · goes to note and Qiita only · \`${r.file}\``);
for (const r of results) {
  const where = r.zenn === true ? " · Zenn, Qiita and note" : r.zenn === false && r.status !== "failed" ? " · Qiita and note (Zenn's next upload isn't due yet)" : "";
  const what = r.pillar ? `${r.pillar}${where}` : r.from ? `first set for ${r.from}` : "Zenn";
  lines.push(`- **${r.status}** · ${r.date} · ${r.title ?? "(no topic)"} · ${what} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
}
for (const r of qiita) {
  lines.push(`- **Qiita ${r.status}** · ${r.date} · ${r.title ?? "(none)"} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
}
// A note article that fails its checks doesn't fail the run: note gets the article's copy instead.
for (const r of note) {
  lines.push(`- **note ${r.status}** · ${r.date} · ${r.title ?? "(none)"} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}${r.status === "failed" ? " · note gets the article's copy" : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
}
summary(lines.join("\n"));
console.log(lines.join("\n"));
out("changed", String([...moved, ...results, ...qiita, ...note].some((r) => r.file)));
out("written", String(ok.length));
out("titles", JSON.stringify(ok.map((r) => `${r.date} ${r.title}`)));
// Fail the run (GitHub emails you) when a morning, or its Qiita article, couldn't be filled, or
// when Zenn refused an article that was sent again.
if ([...results, ...qiita].some(failed)) process.exit(1);
