#!/usr/bin/env node
// Renders the note header images (notes/covers/<id>.jpg, 1280×670) from your Lancers package
// images, as listed in notes/covers/covers.yml. Run it after you change a package image:
//   npm run note:covers                     every image, from ../portfolio
//   npm run note:covers -- --from <folder>  the originals are somewhere else
//   npm run note:covers -- 1351569 1319677  only these
// Needs ffmpeg. The rendered images are committed, so CI never needs the originals.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import { PLATFORM_DIRS, rel, ROOT } from "./lib/common.mjs";
import { COVER_SIZE, COVERS_DIR, loadCovers } from "./lib/note-covers.mjs";

const [W, H] = COVER_SIZE;

/**
 * The ffmpeg filter for one entry of size `width`×`height`: crop to fill the frame, or show the
 * whole image with its left and right edges stretched out (softened) to fill the sides.
 */
export function coverFilter({ fit = "crop", y = 0.5 }, [width, height]) {
  if (fit === "contain") {
    const fg = Math.min(W, 2 * Math.round((H * width) / height / 2));
    const left = Math.floor((W - fg) / 2);
    const right = W - fg - left;
    if (!left || !right) return `[0:v]scale=${W}:${H},format=yuvj420p`;
    const side = (x, w) => `crop=48:ih:${x}:0,scale=1:10:flags=area,scale=${w}:${H}:flags=bicubic,gblur=sigma=16`;
    return `[0:v]split=3[a][b][c];[a]${side(0, left)}[l];[c]${side("iw-48", right)}[r];[b]scale=${fg}:${H}[fg];[l][fg][r]hstack=inputs=3,format=yuvj420p`;
  }
  const anchor = Math.min(1, Math.max(0, Number(y)));
  return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})*${anchor},format=yuvj420p`;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--from");
  const from = path.resolve(at >= 0 ? args[at + 1] : path.join(ROOT, "..", "portfolio"));
  const only = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1));
  const outDir = path.join(ROOT, PLATFORM_DIRS.note, COVERS_DIR);
  let failed = 0;
  for (const entry of loadCovers()) {
    if (only.length && !only.includes(entry.id)) continue;
    const src = path.join(from, entry.original ?? "");
    const out = path.join(outDir, `${entry.id}.jpg`);
    if (!entry.original || !fs.existsSync(src)) {
      console.error(`note-covers: ${entry.id}: original not found (${src})`);
      failed++;
      continue;
    }
    const { width, height } = imageSize(fs.readFileSync(src));
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-filter_complex", coverFilter(entry, [width, height]), "-frames:v", "1", "-q:v", "2", out]);
    console.log(`note-covers: ${rel(out)} ← ${entry.original} (${entry.fit ?? "crop"}) ${entry.service ?? ""}`);
  }
  if (failed) process.exit(1);
}
