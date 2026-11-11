#!/usr/bin/env node
// Generated artwork ("plates") → site images. Put PNG/JPG/WebP files named after a scene
// (home.png, svc-ai-chatbot.png, work-insurance-lp.png …; see ~/dev/note/mockup/PLATES.md)
// in ~/dev/note/mockup/plates/, then:
//   npm run site:plates                 → convert every image there
//   npm run site:plates -- home works   → only these
//   npm run site:plates -- --from <dir>
// Writes site/assets/plates/<name>.webp (desktop, the image as it is), <name>-m.webp (a
// 1000×860 crop around the subject for phones) and plates.json (size + light/dark, measured
// on the left side where the headline sits). A plate replaces that scene's 3D still, and
// the live 3D scene is not loaded over it. Delete a plate's files to go back to the still.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ROOT } from "./lib/common.mjs";
import { imageSize } from "./lib/site-core.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { from: { type: "string", default: ["named", ""].map((d) => path.resolve(ROOT, "..", "mockup", "plates", d)).find((d) => fs.existsSync(d)) }, focus: { type: "string" } },
});
const SRC = path.resolve(values.from);
const OUT = path.join(ROOT, "site", "assets", "plates");
const SCENES = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "assets", "art", "scenes.json"), "utf8"));
// Section images (second list in PLATES.md): backgrounds and ornaments inside pages.
export const SECTIONS = [
  "sec-silk",
  "sec-home-selected",
  "sec-home-showreel",
  "sec-manifesto",
  "sec-about-steps",
  "sec-about-constellation",
  "sec-about-cta",
  "sec-tier-1",
  "sec-tier-2",
  "sec-tier-3",
  "sec-pricing-band",
  "sec-bubble",
  "sec-contact-side",
  "sec-services-discovery",
  "sec-services-inquiry",
  "sec-service-cta",
  // home pilot (~/dev/note/mockup/home-pilot): the mockup's sections without their text
  "sec-home-hero",
  "sec-home-hero-m",
  "sec-home-sel",
  "sec-home-exp",
  "sec-home-reel",
  "sec-home-quote",
  "sec-home-cta",
  // cut-outs laid across section edges (glints: light on black, blended with screen)
  "deco-sakura-a",
  "deco-sakura-b",
  "deco-ribbon",
  "deco-pearl",
  "deco-glints",
];
const MW = 1000;
const MH = 860;

if (!fs.existsSync(SRC)) {
  console.error(`plates: ${SRC} doesn't exist yet. Put the generated images there (see PLATES.md).`);
  process.exit(1);
}
const files = fs.readdirSync(SRC).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
const wanted = positionals.length ? files.filter((f) => positionals.includes(path.parse(f).name)) : files;
if (!wanted.length) {
  console.error(`plates: no images to convert in ${SRC}`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, "plates.json");
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Optional per-plate focus for the phone crop: --focus home=0.72,works=0.65 (0 = left, 1 = right).
const focus = Object.fromEntries((values.focus ?? "").split(",").filter(Boolean).map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));

let n = 0;
for (const file of wanted) {
  const name = path.parse(file).name;
  const isSection = SECTIONS.includes(name);
  if (!SCENES[name] && !isSection) {
    console.warn(`plates: skipped ${file} — no scene or section image called "${name}"`);
    continue;
  }
  const src = path.join(SRC, file);
  // Read the size from a decoded PNG copy (works for any input format).
  const tmp = path.join(OUT, `.${name}.png`);
  ff(["-i", src, "-frames:v", "1", tmp]);
  const [w, h] = imageSize(tmp);
  if (isSection) {
    // As generated, transparency kept (the ornaments and the speech bubble).
    ff(["-i", tmp, "-c:v", "libwebp", "-quality", "84", "-compression_level", "6", path.join(OUT, `${name}.webp`)]);
    fs.rmSync(tmp);
    manifest[name] = { kind: "section", w, h, source: file };
    console.log(`plates: ${name} ${w}×${h} → plates/${name}.webp (section image)`);
    n++;
    continue;
  }
  // Desktop: the image as generated (no upscaling).
  ff(["-i", tmp, "-c:v", "libwebp", "-quality", "84", "-compression_level", "6", path.join(OUT, `${name}.webp`)]);
  // Phone: a 1000×860 crop around the subject (the right side unless told otherwise).
  const cw = Math.min(w, Math.round((h * MW) / MH));
  const ch = Math.round((cw * MH) / MW);
  const fx = focus[name] ?? manifest[name]?.focus ?? (name === "expertise" ? 0.5 : 0.7);
  const x = Math.max(0, Math.min(w - cw, Math.round(fx * w - cw / 2)));
  const y = Math.max(0, Math.round((h - ch) / 2));
  ff(["-i", tmp, "-vf", `crop=${cw}:${ch}:${x}:${y},scale=${MW}:${MH}:flags=lanczos`, "-c:v", "libwebp", "-quality", "84", path.join(OUT, `${name}-m.webp`)]);
  // Light or dark: mean brightness of the left 40% (where the headline sits).
  const out = execFileSync("ffmpeg", ["-loglevel", "error", "-i", tmp, "-vf", `crop=${Math.round(w * 0.4)}:${h}:0:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, "-f", "null", "-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  fs.rmSync(tmp);
  const y2 = Number(/YAVG=([\d.]+)/.exec(out)?.[1]);
  const tone = y2 > 128 ? "light" : "dark";
  manifest[name] = { tone, w, h, mw: MW, mh: MH, focus: fx, source: file };
  console.log(`plates: ${name} ${w}×${h} → plates/${name}.webp + ${name}-m.webp (${tone}, left-side brightness ${Math.round(y2)})`);
  n++;
}
fs.writeFileSync(manifestFile, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`);
console.log(`plates: ${n} converted. Run \`npm run site\` (or site:preview) to see them.`);
