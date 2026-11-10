#!/usr/bin/env node
// Writes the next articles on its own: picks a topic, researches it, writes it, checks it,
// fixes what the checks find and schedules it for the next free 09:00 (Japan time).
// The Write workflow runs this every morning; settings are in autopilot.yml.
//   npm run autowrite            fill the open mornings (needs ANTHROPIC_API_KEY)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadProfile, ROOT } from "./lib/common.mjs";
import { autowrite, claudeSteps, loadConfig, openSlots, qiitaCompanions } from "./lib/writer-core.mjs";

const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

const config = loadConfig(ROOT);
out("mode", config.mode);
if (!config.enabled) {
  console.log("autowrite: off (autopilot.yml enabled: false)");
  process.exit(0);
}
const slots = openSlots(ROOT, new Date(), config.days_ahead);
// `qiita: daily`: each scheduled Zenn article also gets its own Qiita article.
const qiitaDaily = config.qiita === "daily";
if (!slots.length && !qiitaDaily) {
  console.log("autowrite: the next mornings already have articles");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("autowrite: ANTHROPIC_API_KEY is not set (add it as a repository secret)");
  process.exit(1);
}

const profile = loadProfile();
const steps = claudeSteps(new Anthropic(), (m) => console.error(m));
const ideasFile = path.join(ROOT, "ideas.md");
const results = slots.length
  ? await autowrite({ root: ROOT, profile, config, steps, ideas: fs.existsSync(ideasFile) ? fs.readFileSync(ideasFile, "utf8") : "", log: (m) => console.log(m) })
  : [];
const qiita = qiitaDaily ? await qiitaCompanions({ root: ROOT, profile, config, steps, log: (m) => console.log(m) }) : [];
if (!slots.length && !qiita.length) console.log("autowrite: the next mornings already have articles (and their Qiita articles)");

const ok = results.filter((r) => r.status !== "failed");
const lines = ["### Autopilot", ""];
for (const r of results) {
  lines.push(`- **${r.status}** · ${r.date} · ${r.title ?? "(no topic)"} · ${r.pillar} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
  if (r.status !== "failed" && r.file) lines.push(`  - note: \`npm run note -- ${r.file}\``);
}
for (const r of qiita) {
  lines.push(`- **Qiita ${r.status}** · ${r.date} · ${r.title ?? "(none)"} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
}
summary(lines.join("\n"));
console.log(lines.join("\n"));
out("changed", String([...results, ...qiita].some((r) => r.file)));
out("written", String(ok.length));
out("titles", JSON.stringify(ok.map((r) => `${r.date} ${r.title}`)));
// Fail the run (GitHub emails you) when a morning, or its Qiita article, couldn't be filled.
if ([...results, ...qiita].some((r) => r.status === "failed")) process.exit(1);
