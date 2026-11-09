#!/usr/bin/env node
// Renders a post as a page you open in a browser, copy with one click, and paste into note's
// editor (formatting is kept). Works for note posts and for your daily Zenn article.
// Usage: npm run note -- articles/<slug>.md   (or notes/<slug>.md)   → dist/note/<slug>.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { loadProfile, readArticle, rel, ROOT } from "./lib/common.mjs";
import { imageBase, zennToNote } from "./lib/schedule.mjs";

export function toNoteHtml(markdown) {
  const warnings = [];
  const src = markdown.replace(/<!--[\s\S]*?-->/g, "").trim();
  let html = marked.parse(src, { gfm: true });
  // note's editor has two heading levels (大見出し = h2, 小見出し = h3).
  html = html.replace(/<h1>(.*?)<\/h1>/g, "<h2>$1</h2>");
  if (/<h[4-6]>/.test(html)) warnings.push("h4–h6 headings were turned into bold lines (note has only h2/h3)");
  html = html.replace(/<h([4-6])>(.*?)<\/h\1>/g, "<p><strong>$2</strong></p>");
  if (/<table>/.test(html)) warnings.push("note can't show tables: turn them into lists or an image before pasting");
  if (/<img /.test(html)) warnings.push("images don't paste into note: upload them in the editor at the marked spots");
  html = html.replace(/<img [^>]*alt="([^"]*)"[^>]*>/g, "<p>［画像: $1］</p>");
  return { html, warnings };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page({ title, hashtags, html, warnings, source }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>note: ${escapeHtml(title)}</title>
<style>
  :root { --fg:#1f2328; --muted:#59636e; --bg:#fff; --panel:#f6f8fa; --line:#d1d9e0; --accent:#0a7d5a; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --muted:#9198a1; --bg:#0d1117; --panel:#151b23; --line:#3d444d; --accent:#3fb98a; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.8 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
  main { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
  .bar { position:sticky; top:0; background:var(--panel); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  button { font:inherit; padding:6px 14px; border-radius:6px; border:1px solid var(--line); background:var(--bg); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .status { color:var(--muted); font-size:14px; }
  .warn { background:var(--panel); border-left:4px solid #d4a72c; padding:8px 12px; margin:16px 0; font-size:14px; }
  .tags { color:var(--muted); font-size:14px; }
  #body img { max-width:100%; } #body pre { background:var(--panel); padding:12px; overflow-x:auto; border-radius:6px; }
  #body blockquote { border-left:4px solid var(--line); margin:0; padding-left:12px; color:var(--muted); }
</style></head>
<body>
<div class="bar">
  <button data-copy="title">Copy title</button>
  <button class="primary" data-copy="body">Copy body</button>
  <button data-copy="tags">Copy hashtags</button>
  <span class="status" id="status">Paste into note's editor with Ctrl/⌘+V</span>
</div>
<main>
  <p class="tags">${escapeHtml(source)}</p>
  ${warnings.map((w) => `<div class="warn">${escapeHtml(w)}</div>`).join("\n  ")}
  <h1 id="title">${escapeHtml(title)}</h1>
  <p class="tags" id="tags">${hashtags.map((t) => `#${escapeHtml(t)}`).join(" ")}</p>
  <hr>
  <article id="body">
${html}
  </article>
</main>
<script>
  const status = document.getElementById("status");
  async function copy(kind) {
    const el = document.getElementById(kind);
    const text = el.innerText.trim();
    try {
      if (kind === "body" && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([el.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // file:// pages in some browsers block the Clipboard API; select and copy instead.
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand("copy");
      sel.removeAllRanges();
    }
    status.textContent = "Copied " + kind + ". Paste into note with Ctrl/⌘+V";
  }
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy)));
</script>
</body></html>`;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: npm run note -- articles/<slug>.md (or notes/<slug>.md)");
    process.exit(1);
  }
  for (const file of files) {
    const article = readArticle(path.resolve(file));
    if (!["note", "zenn"].includes(article.platform)) {
      console.error(`skip ${file}: note copies come from articles/ (Zenn) or notes/`);
      continue;
    }
    const markdown = article.platform === "zenn" ? zennToNote(article.content, { base: imageBase(loadProfile()) }) : article.content;
    const { html, warnings } = toNoteHtml(markdown);
    const out = path.join(ROOT, "dist", "note", `${path.basename(file, ".md")}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      page({ title: article.data.title ?? "", hashtags: article.data.hashtags ?? article.data.topics ?? [], html, warnings, source: rel(article.file) }),
    );
    console.log(`wrote ${rel(out)} — open it in a browser, click "Copy body", paste into note`);
    for (const w of warnings) console.log(`  warn: ${w}`);
  }
}
