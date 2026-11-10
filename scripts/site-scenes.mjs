#!/usr/bin/env node
// Hero sculptures: bundle site/scene/ into site/assets/celestial.js, and render the
// still images every visitor sees first (site/assets/art/<scene>.webp and <scene>-m.webp).
//   npm run site:scenes                    → bundle only
//   npm run site:scenes -- --stills        → bundle, then render every still
//   npm run site:scenes -- --stills home works   → only these scenes
// Needs Google Chrome (headless, software WebGL) and ffmpeg. Commit the outputs:
// the Pages build does not run this.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ROOT } from "./lib/common.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { stills: { type: "boolean", default: false }, layout: { type: "string" } },
});

const SITE = path.join(ROOT, "site");
const OUT = path.join(SITE, "assets", "celestial.js");
const ART = path.join(SITE, "assets", "art");
export const LAYOUTS = { wide: [1920, 1080], narrow: [1000, 860] };

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [path.join(SITE, "scene", "entry.js")],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "eof",
  outfile: OUT,
  logLevel: "warning",
});
console.log(`scenes: bundle → ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
if (!values.stills) process.exit(0);

// ---- stills ----
const types = { ".html": "text/html", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const file = path.join(SITE, path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const prof = fs.mkdtempSync(path.join(process.env.SCENES_TMP ?? os.tmpdir(), "scenes-chrome-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
  process.env.CHROME ?? "google-chrome",
  ["--headless=new", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const pg = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl);
  } catch {}
  if (!ws) await sleep(250);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Page.enable");
await send("Page.navigate", { url: `${base}/scene/harness.html?s=__list&w=10&h=10` });
await sleep(1500);
const all = await evaluate(`import("/assets/celestial.js").then((m) => m.names())`);
const wanted = positionals.length ? positionals : all;
const unknown = wanted.filter((n) => !all.includes(n));
if (unknown.length) throw new Error(`unknown scenes: ${unknown.join(", ")} (have: ${all.join(", ")})`);
fs.mkdirSync(ART, { recursive: true });
// scenes.json: each scene's mood, so the site sets light or dark text over its still.
const moods = await evaluate(`import("/assets/celestial.js").then((m) => Object.fromEntries(Object.entries(m.SCENES).map(([k, d]) => [k, { mood: d.mood ?? "midnight" }])))`);
fs.writeFileSync(path.join(ART, "scenes.json"), `${JSON.stringify(moods, null, 2)}\n`);
const layouts = values.layout ? [values.layout] : Object.keys(LAYOUTS);
let failed = 0;
for (const name of wanted) {
  for (const layout of layouts) {
    const [w, h] = LAYOUTS[layout];
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${base}/scene/harness.html?s=${name}&layout=${layout}&w=${w}&h=${h}` });
    let state;
    for (let i = 0; i < 240 && !state; i++) {
      await sleep(250);
      state = await evaluate(`window.__sceneError ? "error: " + window.__sceneError : window.__sceneReady ? "ok" : ""`);
    }
    if (state !== "ok") {
      failed++;
      console.error(`scenes: ${name} (${layout}) failed: ${state || "timed out"}`);
      continue;
    }
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    const png = path.join(prof, `${name}-${layout}.png`);
    fs.writeFileSync(png, Buffer.from(shot.result.data, "base64"));
    const out = path.join(ART, `${name}${layout === "narrow" ? "-m" : ""}.webp`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-c:v", "libwebp", "-quality", "80", "-compression_level", "6", out]);
    console.log(`scenes: ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  }
}
ws.close();
chrome.kill();
server.close();
await sleep(800); // let Chrome let go of its profile before removing it
try {
  fs.rmSync(prof, { recursive: true, force: true });
} catch {}
if (failed) process.exit(1);
