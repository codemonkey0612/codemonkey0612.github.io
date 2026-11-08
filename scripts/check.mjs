#!/usr/bin/env node
// Everything CI runs, locally: textlint → validate → fact-check.
// Usage: npm run check [-- files...]  (no files = articles changed vs. main)
//        npm run check -- --no-factcheck [files...]
import { spawnSync } from "node:child_process";
import { rel, resolveFiles, ROOT } from "./lib/common.mjs";

const args = process.argv.slice(2);
const skipFactcheck = args.includes("--no-factcheck");
const files = resolveFiles(args.filter((a) => a !== "--no-factcheck")).map(rel);
if (!files.length) {
  console.log("check: no article files to check");
  process.exit(0);
}

const steps = [
  ["textlint", ["npx", "textlint", ...files]],
  ["validate", ["node", "scripts/validate.mjs", ...files]],
];
if (!skipFactcheck) steps.push(["fact-check", ["node", "scripts/factcheck.mjs", ...files]]);

let failed = [];
for (const [name, [cmd, ...rest]] of steps) {
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd, rest, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length ? `\n✗ failed: ${failed.join(", ")}` : "\n✓ all checks passed");
process.exit(failed.length ? 1 : 0);
