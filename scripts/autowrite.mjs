#!/usr/bin/env node
// Writes the next articles on its own: picks a topic, researches it, writes it, checks it,
// fixes what the checks find and schedules it for the next free 09:00 (Japan time).
// The Write workflow runs this every morning; settings are in autopilot.yml.
//   npm run autowrite            fill the open mornings (needs ANTHROPIC_API_KEY)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadProfile, ROOT } from "./lib/common.mjs";
import { autowrite, claudeSteps, loadConfig, openSlots } from "./lib/writer-core.mjs";

const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

const config = loadConfig(ROOT);
out("mode", config.mode);
if (!config.enabled) {
  console.log("autowrite: off (autopilot.yml enabled: false)");
  process.exit(0);
}
const slots = openSlots(ROOT, new Date(), config.days_ahead);
if (!slots.length) {
  console.log("autowrite: the next mornings already have articles");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("autowrite: ANTHROPIC_API_KEY is not set (add it as a repository secret)");
  process.exit(1);
}

const ideasFile = path.join(ROOT, "ideas.md");
const results = await autowrite({
  root: ROOT,
  profile: loadProfile(),
  config,
  steps: claudeSteps(new Anthropic(), (m) => console.error(m)),
  ideas: fs.existsSync(ideasFile) ? fs.readFileSync(ideasFile, "utf8") : "",
  log: (m) => console.log(m),
});

const ok = results.filter((r) => r.status !== "failed");
const lines = ["### Autopilot", ""];
for (const r of results) {
  lines.push(`- **${r.status}** · ${r.date} · ${r.title ?? "(no topic)"} · ${r.pillar} · $${r.cost_usd}${r.file ? ` · \`${r.file}\`` : ""}`);
  for (const p of r.problems ?? []) lines.push(`  - ${p}`);
  if (r.status !== "failed" && r.file) lines.push(`  - note: \`npm run note -- ${r.file}\``);
}
summary(lines.join("\n"));
console.log(lines.join("\n"));
out("changed", String(results.some((r) => r.file)));
out("written", String(ok.length));
out("titles", JSON.stringify(ok.map((r) => `${r.date} ${r.title}`)));
// Fail the run (GitHub emails you) when a morning couldn't be filled.
if (results.some((r) => r.status === "failed")) process.exit(1);
