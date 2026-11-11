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

/** Narrower than this and cropping to 1280×670 would cut off too much (16:9 is 1.78). */
const MIN_RATIO = 1.7;

/**
 * The ffmpeg filter for one entry of size `width`×`height`: scale and crop to fill the frame,
 * keeping the part of the height that `y` names. Throws for an image that isn't 16:9.
 */
export function coverFilter({ y = 0.5 }, [width, height]) {
  if (width / height < MIN_RATIO) throw new Error(`${width}×${height} isn't 16:9 (note's header image is ${W}×${H}); use the 16:9 version of this package image`);
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
    let filter;
    try {
      filter = coverFilter(entry, [width, height]);
    } catch (err) {
      console.error(`note-covers: ${entry.id}: ${entry.original}: ${err.message}`);
      failed++;
      continue;
    }
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-filter_complex", filter, "-frames:v", "1", "-q:v", "2", out]);
    console.log(`note-covers: ${rel(out)} ← ${entry.original} (y ${entry.y ?? 0.5}) ${entry.service ?? ""}`);
  }
  if (failed) process.exit(1);
}
