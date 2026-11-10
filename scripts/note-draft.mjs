#!/usr/bin/env node
// Puts your note posts into your note account: as drafts for you to publish, or published
// outright with --publish (autopilot.yml `note: auto` turns that on in CI). CI runs this on
// every push to main and every morning once the NOTE_SESSION secret is set (see README).
//   npm run note:draft                     every notes/*.md with status: ready and no url yet
//   npm run note:draft -- notes/<slug>.md  only these
//   npm run note:draft -- --publish        publish them too (checks the public page afterwards)
//   npm run note:draft -- --dry-run        convert and report what would be sent; no network
//
// Each post gets note_id, note_key and note_hash in its front matter, so the next push updates
// the same draft (only when the text or images changed) instead of making a new one. After you
// publish a post on note, the next run fills in its url: and the hub site lists it. Edit a post
// that's already public (its text or `cover:`) and, with --publish, the public post is updated
// too, without notifying your followers again.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadProfile, PLATFORM_DIRS, readArticle, rel, ROOT } from "./lib/common.mjs";
import { IMAGE_TYPES, NOTE_ORIGIN, NoteClient } from "./lib/note-client.mjs";
import { localImages, markdownToNote } from "./lib/note-html.mjs";
import { validateArticle } from "./lib/validate-core.mjs";

const isSet = (v) => typeof v === "string" && v.trim() !== "" && !/^\s*TODO\b/.test(v);

/**
 * Posts to bring up to date on note: status ready and not published yet, or published by this
 * tool (note_id recorded), so a change to the post (its text or header image) reaches note.
 */
export function readyNotes(root = ROOT) {
  const dir = path.join(root, PLATFORM_DIRS.note);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.join(dir, f))
    .filter((f) => {
      const { data } = readArticle(f);
      return data.status === "ready" && (!data.url || Boolean(data.note_id && data.note_key));
    });
}

/** What note.com shows publicly for a post: is it live, and which header image does it have. */
async function publicNote(fetchPage, key) {
  const res = await fetchPage(`${NOTE_ORIGIN}/api/v3/notes/${encodeURIComponent(key)}`, { method: "GET", redirect: "manual" });
  if (res.status !== 200) return { live: false, eyecatch: null };
  const data = (await res.json().catch(() => ({})))?.data ?? {};
  return { live: data.status == null || data.status === "published", eyecatch: data.eyecatch ?? null };
}

/** Sets keys in a Markdown file's front matter, keeping its comments and order. */
export function setFrontMatter(file, values) {
  const raw = fs.readFileSync(file, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) throw new Error(`${file} has no front matter`);
  const doc = YAML.parseDocument(m[1]);
  for (const [k, v] of Object.entries(values)) doc.set(k, v);
  fs.writeFileSync(file, raw.replace(m[0], `---\n${String(doc).trimEnd()}\n---`));
}

function readImage(mdFile, href) {
  const file = path.resolve(path.dirname(mdFile), decodeURI(href));
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`${href}: note accepts PNG, JPEG or GIF images`);
  if (!fs.existsSync(file)) throw new Error(`${href}: image not found`);
  return { name: path.basename(file), type, data: fs.readFileSync(file) };
}

/**
 * Brings each post's note draft up to date. Returns one result per file:
 * { file, action: "created" | "updated" | "unchanged" | "published" | "skipped" | "failed", ... }.
 */
export async function syncNotes({
  files,
  client,
  profile,
  dryRun = false,
  publish = false,
  fetchPage = globalThis.fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  const results = [];
  let user = null;
  if (!dryRun) {
    user = await client.currentUser();
    const expected = profile.platforms?.note;
    if (isSet(expected) && user.urlname !== expected) {
      throw new Error(`NOTE_SESSION is signed in as note.com/${user.urlname}, but profile.yml says your note is ${expected}. Copy the cookie from that account.`);
    }
    log(`note: signed in as ${user.urlname}`);
  }

  for (const file of files) {
    const name = rel(file);
    const done = (action, extra = {}) => results.push({ file: name, action, ...extra });
    if (path.basename(path.dirname(file)) !== PLATFORM_DIRS.note) {
      done("skipped", { reason: "not in notes/" });
      continue;
    }
    const article = { ...readArticle(file), platform: "note" };
    const { data } = article;
    const isPublic = Boolean(data.url);
    if (data.status !== "ready" || (isPublic && !(data.note_id && data.note_key))) {
      done("skipped", { reason: isPublic ? "already published (not by this tool)" : "status is not ready" });
      continue;
    }
    const check = validateArticle(article, profile);
    if (check.errors.length) {
      done("failed", { reason: `fix these first (npm run validate): ${check.errors.join("; ")}` });
      continue;
    }

    try {
      // Published on note since the last run? Then record its link for the hub site.
      if (!isPublic && user && data.note_key) {
        const page = `${NOTE_ORIGIN}/${user.urlname}/n/${encodeURIComponent(data.note_key)}`;
        const res = await fetchPage(page, { method: "GET", redirect: "manual" });
        if (res.status === 200) {
          setFrontMatter(file, { url: page });
          done("published", { url: page });
          continue;
        }
      }

      const hrefs = localImages(article.content);
      const images = new Map(hrefs.map((h) => [h, readImage(file, h)]));
      const cover = data.cover ? readImage(file, String(data.cover)) : null;
      const hash = crypto
        .createHash("sha1")
        .update(JSON.stringify([data.title, article.content, data.cover ?? null]))
        .update(Buffer.concat([...images.values(), ...(cover ? [cover] : [])].map((i) => i.data)))
        .digest("hex")
        .slice(0, 12);

      // A public post whose text or header image changed here: update it on note.
      if (isPublic) {
        if (data.note_hash === hash) {
          done("unchanged", { public: true });
          continue;
        }
        if (dryRun) {
          done("dry-run", { reason: `changed since it went public: would update ${data.url}` });
          continue;
        }
        if (!publish) {
          done("skipped", { reason: `changed since it went public; note: auto (or --publish) updates ${data.url}` });
          continue;
        }
        const before = await publicNote(fetchPage, data.note_key);
        const imageUrls = new Map();
        for (const [href, img] of images) imageUrls.set(href, await client.uploadImage(img));
        const body = markdownToNote(article.content, { imageUrls });
        if (cover) await client.setEyecatch(data.note_id, cover);
        await client.publish(data.note_id, { title: data.title, html: body.html, textLength: body.textLength, hashtags: data.hashtags ?? [], notify: false });
        // Recorded now, so a slow check below doesn't make every later run send it again.
        setFrontMatter(file, { note_hash: hash });
        let now = before;
        for (let i = 0; i < 6; i++) {
          if (i) await wait(5000);
          now = await publicNote(fetchPage, data.note_key);
          if (now.live && (!cover || (now.eyecatch && now.eyecatch !== before.eyecatch))) break;
        }
        if (now.live && (!cover || (now.eyecatch && now.eyecatch !== before.eyecatch))) done("republished", { url: data.url, warnings: body.warnings });
        else
          done("failed", {
            reason: now.live
              ? `note took the update, but ${data.url} still shows the old header image: set it in ${NoteClient.editUrl(data.note_key)}`
              : `after the update ${data.url} isn't public: open ${NoteClient.editUrl(data.note_key)} and publish it there`,
          });
        continue;
      }

      if (data.note_id && data.note_hash === hash && !publish) {
        done("unchanged", { edit: NoteClient.editUrl(data.note_key) });
        continue;
      }
      if (dryRun) {
        const { textLength, warnings } = markdownToNote(article.content);
        done("dry-run", { reason: `${textLength} characters, ${images.size} image(s)${cover ? " + header image" : ""}`, warnings });
        continue;
      }
      if (data.note_id && !(await client.isDraft(data.note_id))) {
        done("failed", {
          reason: `note post ${data.note_id} is no longer one of your drafts (published under another link, or deleted). Remove note_id, note_key and note_hash from the front matter to make a new draft.`,
        });
        continue;
      }

      const ref = data.note_id ? { id: String(data.note_id), key: String(data.note_key) } : await client.createNote(data.title);
      if (!data.note_id) setFrontMatter(file, { note_id: ref.id, note_key: ref.key }); // recorded at once, so a failure below never leaves a stray draft
      const imageUrls = new Map();
      for (const [href, img] of images) imageUrls.set(href, await client.uploadImage(img));
      const body = markdownToNote(article.content, { imageUrls });
      await client.saveDraft(ref.id, { title: data.title, html: body.html, textLength: body.textLength });
      if (cover) await client.setEyecatch(ref.id, cover);
      setFrontMatter(file, { note_id: ref.id, note_key: ref.key, note_hash: hash });
      if (publish) {
        await client.publish(ref.id, { title: data.title, html: body.html, textLength: body.textLength, hashtags: data.hashtags ?? [] });
        // The publish call is the least documented one, so trust the public page, not the reply.
        const page = `${NOTE_ORIGIN}/${user.urlname}/n/${encodeURIComponent(ref.key)}`;
        let live = false;
        for (let i = 0; i < 6 && !live; i++) {
          if (i) await wait(5000);
          live = (await fetchPage(page, { method: "GET", redirect: "manual" })).status === 200;
        }
        if (live) {
          setFrontMatter(file, { url: page });
          done("published", { url: page, warnings: body.warnings });
        } else {
          done("failed", { reason: `note took the publish request, but ${page} isn't public: open ${NoteClient.editUrl(ref.key)} and publish it there` });
        }
        continue;
      }
      done(data.note_id ? "updated" : "created", { edit: NoteClient.editUrl(ref.key), hashtags: data.hashtags ?? [], warnings: body.warnings });
    } catch (err) {
      if (err.name === "NoteAuthError") throw err; // every later post would fail the same way
      done("failed", { reason: err.message });
    }
  }
  return results;
}

function report(results) {
  const lines = [];
  for (const r of results) {
    const head = `${r.action.padEnd(9)} ${r.file}`;
    lines.push(r.edit ? `${head}\n          edit and publish: ${r.edit}` : r.url ? `${head}\n          ${r.url}` : `${head}${r.reason ? ` — ${r.reason}` : ""}`);
    if (r.hashtags?.length) lines.push(`          add when publishing: ${r.hashtags.map((t) => `#${t}`).join(" ")}`);
    for (const w of r.warnings ?? []) lines.push(`          warn: ${w}`);
  }
  return lines.join("\n");
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  // autopilot.yml `note: auto` publishes; `draft` (the default) leaves drafts for you.
  const autopilot = path.join(ROOT, "autopilot.yml");
  const noteMode = fs.existsSync(autopilot) ? (YAML.parse(fs.readFileSync(autopilot, "utf8"))?.note ?? "draft") : "draft";
  const publish = args.includes("--publish") || noteMode === "auto";
  const given = args.filter((a) => !a.startsWith("--"));
  const files = given.length ? given.map((f) => path.resolve(f)) : readyNotes();
  if (!dryRun && !process.env.NOTE_SESSION) {
    console.error("note: set NOTE_SESSION to your _note_session_v5 cookie (see README), or use --dry-run");
    process.exit(1);
  }
  try {
    const client = dryRun ? null : new NoteClient(process.env.NOTE_SESSION);
    const results = await syncNotes({ files, client, profile: loadProfile(), dryRun, publish });
    const shown = results.filter((r) => !(r.public && r.action === "unchanged")); // public posts with no change
    const text = shown.length ? report(shown) : "note: nothing new for note";
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY && shown.length) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### note\n\n\`\`\`\n${text}\n\`\`\`\n`);
    }
    if (results.some((r) => r.action === "failed")) process.exit(1);
  } catch (err) {
    console.error(`note: ${err.message}`);
    process.exit(1);
  }
}
