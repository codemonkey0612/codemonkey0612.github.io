#!/usr/bin/env node
// Writes the next articles on its own: picks a topic, researches it, writes it, checks it,
// fixes what the checks find and schedules it for the next free 09:00 (Japan time).
// The Write workflow runs this every morning; settings are in autopilot.yml.
//   npm run autowrite            fill the open mornings (needs ANTHROPIC_API_KEY)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadProfile, ROOT } from "./lib/common.mjs";
import { trendDigest } from "./lib/trends.mjs";
import { autowrite, claudeSettings, claudeSteps, loadConfig, noteCompanions, openSlots, qiitaCompanions, zennSettings } from "./lib/writer-core.mjs";

const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

const config = loadConfig(ROOT);
out("mode", config.mode);
if (!config.enabled) {
  console.log("autowrite: off (autopilot.yml enabled: false)");
  process.exit(0);
}
const slots = openSlots(ROOT, new Date(), config.days_ahead, { every: zennSettings(config).every });
// `qiita: daily`: each scheduled Zenn article also gets its own Qiita article.
const qiitaDaily = config.qiita === "daily";
// `note_version: true`: and its own note article for general readers (unless `note: off`).
const noteVersions = config.note_version && config.note !== "off";
if (!slots.length && !qiitaDaily && !noteVersions) {
  console.log("autowrite: the next mornings already have articles");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("autowrite: ANTHROPIC_API_KEY is not set (add it as a repository secret)");
  process.exit(1);
}

const profile = loadProfile();
const steps = claudeSteps(new Anthropic(), (m) => console.error(m), claudeSettings(config));
const ideasFile = path.join(ROOT, "ideas.md");
const results = slots.length
  ? await autowrite({
      root: ROOT,
      profile,
      config,
      steps,
      ideas: fs.existsSync(ideasFile) ? fs.readFileSync(ideasFile, "utf8") : "",
      log: (m) => console.log(m),
      // What's being liked on Zenn, Qiita and note right now, for planning the topic and title.
      trends: () => trendDigest({ log: (m) => console.log(m) }),
    })
  : [];
const qiita = qiitaDaily ? await qiitaCompanions({ root: ROOT, profile, config, steps, log: (m) => console.log(m) }) : [];
const note = noteVersions ? await noteCompanions({ root: ROOT, profile, config, steps, log: (m) => console.log(m) }) : [];
if (!slots.length && !qiita.length && !note.length) console.log("autowrite: the next mornings already have articles (and their Qiita and note articles)");

// "requeued": an article Zenn never took, sent again for this morning; "missing": Zenn still
// didn't take it after that (the run fails).
const failed = (r) => r.status === "failed" || r.status === "missing";
const ok = results.filter((r) => !failed(r) && r.status !== "requeued");
const lines = ["### Autopilot", ""];
for (const r of results) {
  const what = r.pillar ?? (r.from ? `first set for ${r.from}` : "Zenn");
  lines.push(`- **${r.status}** · ${r.date} · ${r.title ?? "(no topic)"} · ${what} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
  if (r.pillar && r.status !== "failed" && r.file) lines.push(`  - note: \`npm run note -- ${r.file}\``);
}
for (const r of qiita) {
  lines.push(`- **Qiita ${r.status}** · ${r.date} · ${r.title ?? "(none)"} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
}
// A note article that fails its checks doesn't fail the run: note gets the Zenn copy instead.
for (const r of note) {
  lines.push(`- **note ${r.status}** · ${r.date} · ${r.title ?? "(none)"} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}${r.status === "failed" ? " · note gets the Zenn copy" : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
}
summary(lines.join("\n"));
console.log(lines.join("\n"));
out("changed", String([...results, ...qiita, ...note].some((r) => r.file)));
out("written", String(ok.length));
out("titles", JSON.stringify(ok.map((r) => `${r.date} ${r.title}`)));
// Fail the run (GitHub emails you) when a morning, or its Qiita article, couldn't be filled, or
// when Zenn refused an article that was sent again.
if ([...results, ...qiita].some(failed)) process.exit(1);
