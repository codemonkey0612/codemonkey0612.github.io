#!/usr/bin/env node
// Run by the Publish workflow when qiita-cli failed: every Qiita article in public/ that was due
// to be posted for the first time (ignorePublish: false, no id yet) is set to ignorePublish: true,
// so the next runs don't send it again. On 2026-11-09 Qiita answered 403 to a second new post
// from this new account; trying again on every run looks even more like spam. Check the run log
// and Qiita, then set ignorePublish: false again yourself to retry.
//   node scripts/qiita-hold.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { rel, ROOT } from "./lib/common.mjs";

/** Marks the unsent Qiita articles under root/public ignorePublish: true; returns their paths. */
export function holdUnsent(root = ROOT) {
  const dir = path.join(root, "public");
  if (!fs.existsSync(dir)) return [];
  const held = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, "utf8");
    const { data } = matter(text);
    if (data.ignorePublish !== false || data.id) continue;
    // Change only that line: qiita-cli writes the front matter in its own style.
    const end = text.indexOf("\n---", 3);
    const head = text.slice(0, end).replace(/^ignorePublish:\s*false\s*$/m, "ignorePublish: true");
    fs.writeFileSync(file, head + text.slice(end));
    held.push(file);
  }
  return held;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const held = holdUnsent();
  for (const f of held) console.log(`qiita: held back ${rel(f)} (set ignorePublish: false to send it again)`);
  if (!held.length) console.log("qiita: no unsent article to hold back");
}
