#!/usr/bin/env node
// autopilot.yml `qiita: daily`. Run by the Publish workflow just before qiita-cli: it puts the
// morning's Qiita article (qiita/<slug>.md, written and checked by the autopilot) into public/,
// where qiita-cli posts it. At most one new Qiita article per day (Japan time), the oldest due
// one first, and never a title that's already on your Qiita (its id is reused instead).
//
// First it looks at the Qiita articles this repository posted. If Qiita has hidden one (its spam
// monitoring makes it private) or it's gone, it writes qiita/PAUSED and posts nothing more until
// you've checked it on Qiita and deleted that file. scripts/qiita-hold.mjs writes the same file
// when Qiita refuses a post.
//   node scripts/qiita-daily.mjs   (needs QIITA_TOKEN)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";
import { loadProfile, rel, ROOT } from "./lib/common.mjs";
import { jstDay, publishedAt } from "./lib/schedule.mjs";
import { validateArticle } from "./lib/validate-core.mjs";
import { setFrontMatter } from "./note-draft.mjs";

export const PAUSED = path.join("qiita", "PAUSED");

/** Stops daily Qiita posts until qiita/PAUSED is deleted. */
export function pauseQiita(root, reason) {
  const file = path.join(root, PAUSED);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${reason}\n\nDaily Qiita posts are paused. Check the article on Qiita, then delete this file (qiita/PAUSED) to resume.\n`);
}

/** The few Qiita API calls this needs, signed in with your token. */
export function qiitaApi(token, fetchImpl = globalThis.fetch) {
  const get = async (p) => {
    const res = await fetchImpl(`https://qiita.com/api/v2${p}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Qiita API ${p}: HTTP ${res.status}`);
    return res.json();
  };
  return {
    item: (id) => get(`/items/${encodeURIComponent(id)}`),
    myItems: async () => (await get("/authenticated_user/items?page=1&per_page=20")) ?? [],
  };
}

const read = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => ({ file: path.join(dir, f), slug: path.basename(f, ".md"), ...matter(fs.readFileSync(path.join(dir, f), "utf8")) }))
    : [];

const frontMatter = (title, tags, remote) => ({
  title,
  tags,
  private: false,
  updated_at: remote?.updated_at ?? "",
  id: remote?.id ?? null,
  organization_url_name: null,
  slide: false,
  ignorePublish: false,
  posting_campaign_uuid: null,
  agreed_posting_campaign_term: false,
});

/**
 * Returns { action: "paused" | "posted-today" | "nothing" | "failed" | "prepared" | "adopted", ... }.
 * `pausedNow` is true when this call found the problem (so the run can fail and email you).
 */
export async function prepareQiita({ root = ROOT, profile, api, now = new Date() }) {
  const pausedFile = path.join(root, PAUSED);
  if (fs.existsSync(pausedFile)) return { action: "paused", reason: fs.readFileSync(pausedFile, "utf8").split("\n")[0], pausedNow: false };
  const today = jstDay(now);

  // 1. Has Qiita hidden (or removed) anything this repository posted?
  const posted = read(path.join(root, "public"))
    .filter((a) => a.data.ignorePublish === false && a.data.id)
    .sort((a, b) => String(b.data.updated_at).localeCompare(String(a.data.updated_at)))
    .slice(0, 20);
  for (const a of posted) {
    const item = await api.item(String(a.data.id));
    if (!item || item.private === true) {
      const reason = `${today}: Qiita ${item ? "made private (hidden)" : "no longer shows"} 「${a.data.title}」 (${rel(a.file)}, item ${a.data.id}).`;
      pauseQiita(root, reason);
      return { action: "paused", reason, pausedNow: true };
    }
  }

  // 2. At most one new Qiita article a day.
  const mine = await api.myItems();
  if (mine.some((i) => i.created_at && jstDay(new Date(i.created_at)) === today)) return { action: "posted-today" };

  // 3. The oldest due article that isn't on Qiita yet.
  const due = read(path.join(root, "qiita"))
    .filter((d) => d.data.status !== "failed" && publishedAt(d.data.published_at) && publishedAt(d.data.published_at) <= now)
    .filter((d) => !fs.existsSync(path.join(root, "public", `${d.slug}.md`)))
    .sort((a, b) => publishedAt(a.data.published_at) - publishedAt(b.data.published_at));
  if (!due.length) return { action: "nothing" };
  const d = due[0];
  const target = path.join(root, "public", `${d.slug}.md`);
  const remote = mine.find((i) => i.title === d.data.title) ?? null;
  const fm = frontMatter(String(d.data.title), d.data.tags, remote);
  const check = validateArticle({ file: target, platform: "qiita", data: fm, content: d.content, raw: "" }, profile);
  if (check.errors.length) {
    setFrontMatter(d.file, { status: "failed" }); // not retried every run; the article is kept to look at
    return { action: "failed", file: rel(d.file), reason: check.errors.join("; ") };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `---\n${YAML.stringify(fm)}---\n${d.content.replace(/^\n+/, "")}`);
  return { action: remote ? "adopted" : "prepared", file: rel(target), title: fm.title };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  const autopilot = path.join(ROOT, "autopilot.yml");
  const mode = (fs.existsSync(autopilot) ? YAML.parse(fs.readFileSync(autopilot, "utf8"))?.qiita : null) ?? "auto";
  if (mode !== "daily") {
    console.log(`qiita-daily: autopilot.yml has qiita: ${mode}, so nothing to prepare`);
    process.exit(0);
  }
  if (!process.env.QIITA_TOKEN) {
    console.log("qiita-daily: QIITA_TOKEN is not set");
    process.exit(0);
  }
  try {
    const r = await prepareQiita({ profile: loadProfile(), api: qiitaApi(process.env.QIITA_TOKEN) });
    const lines = {
      paused: `::warning::Daily Qiita posts are paused: ${r.reason} Delete qiita/PAUSED to resume.`,
      "posted-today": "qiita-daily: a Qiita article already went up today",
      nothing: "qiita-daily: no Qiita article is due",
      failed: `::error::qiita-daily: ${r.file} isn't fit to post (${r.reason}); it was marked status: failed`,
      prepared: `qiita-daily: ${r.file} (「${r.title}」) goes to Qiita now`,
      adopted: `qiita-daily: 「${r.title}」 is already on Qiita; ${r.file} now points to it`,
    };
    console.log(lines[r.action]);
    out("paused_now", String(Boolean(r.pausedNow)));
    out("failed", String(r.action === "failed"));
  } catch (err) {
    console.log(`::error::qiita-daily: ${err.message}`);
    out("failed", "true");
  }
}
