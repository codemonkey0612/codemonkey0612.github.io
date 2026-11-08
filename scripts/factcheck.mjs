#!/usr/bin/env node
// Usage:
//   npm run factcheck [-- files...]            (no files = articles changed vs. main)
//   npm run factcheck -- --report out.md --json out.json files...
//   npm run factcheck -- --replay out.json     (re-render a saved run, no API call)
// Env: ANTHROPIC_API_KEY, FACTCHECK_MODEL, FACTCHECK_EFFORT, FACTCHECK_MAX_SEARCHES
import fs from "node:fs";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadProfile, readArticle, rel, resolveFiles } from "./lib/common.mjs";
import { factcheck, FactcheckError, renderReport } from "./lib/factcheck-core.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { report: { type: "string" }, json: { type: "string" }, replay: { type: "string" } },
});

let runs;
if (values.replay) {
  runs = JSON.parse(fs.readFileSync(values.replay, "utf8"));
} else {
  const files = resolveFiles(positionals);
  if (!files.length) {
    console.log("factcheck: no article files to check");
    process.exit(0);
  }
  const profile = loadProfile();
  const client = new Anthropic();
  runs = [];
  for (const file of files) {
    const article = readArticle(file);
    console.error(`fact-checking ${rel(file)} …`);
    try {
      const result = await factcheck({ client, article, profile, log: (m) => console.error(m) });
      runs.push({ file: rel(file), title: article.data.title, result });
    } catch (err) {
      let message;
      if (err instanceof FactcheckError) message = err.message;
      else if (err instanceof Anthropic.AuthenticationError)
        message = "the Claude API rejected the credentials: check ANTHROPIC_API_KEY";
      else if (err instanceof Anthropic.RateLimitError) message = "rate limited by the Claude API; try again later";
      else if (err instanceof Anthropic.APIError) message = `Claude API error ${err.status}: ${err.message}`;
      else if (err instanceof Anthropic.AnthropicError)
        message = `${err.message} (set ANTHROPIC_API_KEY locally, or as a repository secret in CI)`;
      else throw err;
      runs.push({ file: rel(file), title: article.data.title, error: message });
    }
  }
}

let errors = 0;
let warnings = 0;
const sections = runs.map((run) => {
  const r = renderReport(run);
  errors += r.errors;
  warnings += r.warnings;
  return r.markdown;
});
const verdict = errors
  ? `🔴 ${errors} claim(s) to fix before publishing`
  : warnings
    ? `🟡 no blocking problems; ${warnings} claim(s) worth a second look`
    : "🟢 every checked claim is supported and sourced";
const markdown = [`## Fact-check`, "", verdict, "", ...sections].join("\n");

console.log(markdown);
if (values.report) fs.writeFileSync(values.report, markdown);
if (values.json && !values.replay) fs.writeFileSync(values.json, JSON.stringify(runs, null, 2));
process.exit(errors ? 1 : 0);
