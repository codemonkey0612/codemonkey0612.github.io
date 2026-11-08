#!/usr/bin/env node
// Usage: npm run validate [-- files...]   (no files = articles changed vs. main)
import { loadProfile, readArticle, rel, resolveFiles } from "./lib/common.mjs";
import { validateArticle } from "./lib/validate-core.mjs";

const files = resolveFiles(process.argv.slice(2));
if (!files.length) {
  console.log("validate: no article files to check");
  process.exit(0);
}

const profile = loadProfile();
let failed = 0;
for (const file of files) {
  const r = validateArticle(readArticle(file), profile);
  const status = r.errors.length ? "✗" : "✓";
  console.log(`${status} ${rel(file)} [${r.platform}${r.ready ? ", publish-ready" : ", draft"}]`);
  for (const e of r.errors) console.log(`    error: ${e}`);
  for (const w of r.warnings) console.log(`    warn:  ${w}`);
  if (r.errors.length) failed++;
}
if (failed) {
  console.log(`\n${failed} file(s) with errors`);
  process.exit(1);
}
