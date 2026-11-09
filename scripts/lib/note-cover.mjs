// The note header image (見出し画像, 1280×670, note's recommended size) for a post: your emblem,
// the title and the brand line in the site's navy and gold. Rendered with headless Chrome so the
// Japanese web fonts come out right; GitHub's Ubuntu runners have Chrome. Without Chrome no cover
// is made and the post goes out without one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COVER_SIZE = [1280, 670];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function chromePath() {
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

export function coverHtml({ title, emblem, brand = "匠｜AI・Webシステム開発", site = "" }) {
  const n = [...title].length;
  const size = n <= 20 ? 66 : n <= 32 ? 56 : n <= 44 ? 48 : 42;
  const [w, h] = COVER_SIZE;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700&family=Geist:wght@500;600&display=block">
<style>
*{box-sizing:border-box}html,body{margin:0}
body{width:${w}px;height:${h}px;overflow:hidden;background:#fff;color:#0f1729;font-family:Geist,"Noto Sans JP",sans-serif;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(#e5e8ee 1px,transparent 1px),linear-gradient(90deg,#e5e8ee 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 80% at 85% 10%,#000 10%,transparent 70%);opacity:.8}
.band{position:absolute;left:0;top:0;bottom:0;width:14px;background:linear-gradient(#e9c76e,#d4a640 55%,#b8862a)}
.in{position:absolute;inset:64px 72px 56px 88px;display:flex;flex-direction:column}
.title{margin:auto 0;max-width:${emblem ? 820 : 1080}px;font-weight:700;font-size:${size}px;line-height:1.42;letter-spacing:.01em;font-feature-settings:"palt";word-break:auto-phrase;text-wrap:balance}
.foot{display:flex;align-items:center;gap:16px;padding-top:22px;border-top:2px solid #0f1729;font-size:22px;font-weight:500}
.foot .site{margin-left:auto;font-size:18px;color:#646c7b}
.mark{position:absolute;right:72px;top:50%;margin-top:-170px;width:300px;height:300px;border-radius:50%;box-shadow:0 30px 60px -24px rgba(11,20,40,.55)}
</style></head><body><div class="grid"></div><div class="band"></div>
${emblem ? `<img class="mark" src="${esc(emblem)}" alt="">` : ""}
<div class="in"><div class="title">${esc(title)}</div><div class="foot"><span>${esc(brand)}</span><span class="site">${esc(site)}</span></div></div>
</body></html>`;
}

/** Renders the cover to `out` (PNG). Returns true when a non-empty image was written. */
export function makeCover({ title, out, emblem = null, site = "", chrome = chromePath() }) {
  if (!chrome) return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-cover-"));
  const html = path.join(dir, "cover.html");
  fs.writeFileSync(html, coverHtml({ title, emblem: emblem && fs.existsSync(emblem) ? pathToFileURL(emblem).href : null, site }));
  const [w, h] = COVER_SIZE;
  spawnSync(
    chrome,
    ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", `--window-size=${w},${h}`, "--virtual-time-budget=10000", `--screenshot=${out}`, pathToFileURL(html).href],
    { stdio: "ignore", timeout: 60_000 },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  return fs.existsSync(out) && fs.statSync(out).size > 0;
}
