import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import matter from "gray-matter";
import { pauseQiita, prepareQiita, PAUSED } from "../scripts/qiita-daily.mjs";
import { MAX_OVERLAP, overlap, QiitaArticle, qiitaCompanions, qiitaPrompt, readQiitaHistory, authorContext } from "../scripts/lib/writer-core.mjs";
import { validateArticle } from "../scripts/lib/validate-core.mjs";

const jst = (s) => new Date(`${s}+09:00`);
const profile = {
  name: "匠（たくみ）",
  title: "フリーランスのAI・Webエンジニア",
  persona: "私",
  site_url: "https://codemonkey0612.github.io/",
  contact_url: "https://www.lancers.jp/profile/navi_work/contact_light",
  facts: { career_start: "2015-04" },
  platforms: { zenn: "takumiengineer", note: "shanaiai" },
  services: [{ id: "system", name: "Web・業務システム／アプリ開発", summary: "s" }],
  cases: [],
  todos: [],
};
const config = { enabled: true, mode: "auto", days_ahead: 2, max_per_run: 2, pillars: [], avoid: ["実在しない事例を作ること"], qiita: "daily" };
function repo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qiita-daily-test-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}
const ZENN_BODY = `${"毎月届く複数のExcelから必要な数字を集計用のファイルへ手で写す作業は、時間がかかり間違いも起きます。".repeat(12)}\n\n---\n\n私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。\n→ [詳しく](https://codemonkey0612.github.io/services/system/)\n`;
const zenn = (at, title = "Excelの転記作業を減らす最初の一歩") => `---\ntitle: ${title}\nemoji: "📊"\ntype: idea\ntopics: [excel, python]\npublished: true\npublished_at: "${at}"\n---\n\n${ZENN_BODY}`;
const QIITA_BODY = `pandasで複数のExcelファイルを一度に読み込み、列名をそろえてから重複を確かめる手順をまとめます。\n\n## 手順\n\n\`\`\`python:aggregate.py\nimport pandas as pd\nframes = [pd.read_excel(p) for p in paths]\n\`\`\`\n\n${"読み込んだあとは列名の対応表で名前を統一し、キー列で重複を抽出して確認用のファイルに書き出します。".repeat(8)}\n`;
const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 1 };
const clean = { report: { summary: "ok", findings: [] }, usage };

function fakeSteps({ first = QIITA_BODY, revised = QIITA_BODY, checks = [clean] } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    steps: {
      writeQiita: async (ctx) => (calls.push(["write", ctx.zenn.title]), { value: { title: "pandasで複数のExcelを読み込み重複を検出する", tags: ["Python", "pandas", "Excel"], body: first }, usage }),
      reviseArticle: async (ctx) => (calls.push(["revise", ctx.platform, ctx.problems]), { value: { body: revised, summary: "s" }, usage }),
      factcheck: async (article) => (calls.push(["factcheck", article.platform]), checks[Math.min(n++, checks.length - 1)]),
    },
  };
}

test("overlap measures copied prose, ignoring code; the Qiita prompt forbids promotion and copying", () => {
  assert.ok(overlap(ZENN_BODY, ZENN_BODY) > 0.95);
  assert.ok(overlap(QIITA_BODY, ZENN_BODY) < MAX_OVERLAP);
  assert.equal(overlap("```js\nconst same = 1;\n```\n", "```js\nconst same = 1;\n```\n"), 0, "shared code isn't counted");
  const { system, user } = qiitaPrompt({ author: authorContext(profile), config, zenn: { title: "T", body: "B" }, today: "2026-11-11" });
  assert.match(system, /No promotion at all: no links to the author's website, Lancers, Zenn or note/);
  assert.match(system, /Don't reuse the Zenn article's title, sentences or structure/);
  assert.match(system, /:::note info/);
  assert.doesNotMatch(system, /ランサーズで相談する/);
  assert.match(user, /<zenn>\nB\n<\/zenn>/);
  const ok = { title: "pandasで複数のExcelを読み込み重複を検出する", tags: ["Python"], body: `${"本文".repeat(800)}\n\`\`\`python\nx = 1\n\`\`\`\n` };
  assert.ok(QiitaArticle.safeParse(ok).success);
  assert.ok(!QiitaArticle.safeParse({ ...ok, body: "本文".repeat(900) }).success, "a code block is required");
  assert.ok(!QiitaArticle.safeParse({ ...ok, tags: ["Visual Studio"] }).success);
});

test("a Qiita article may not link to your site, Lancers, Zenn or note", () => {
  const article = (content) => ({ file: "public/x.md", platform: "qiita", data: { title: "t", tags: ["Python"], private: false, ignorePublish: false }, content, raw: "" });
  assert.deepEqual(validateArticle(article("[公式](https://pandas.pydata.org/docs/)\n"), profile).errors, []);
  for (const link of ["https://codemonkey0612.github.io/services/system/", "https://www.lancers.jp/profile/navi_work", "https://zenn.dev/takumiengineer/articles/x", "https://note.com/shanaiai/n/abc"])
    assert.match(validateArticle(article(`詳しくは[こちら](${link})\n`), profile).errors.join(), /must not link to your site, Lancers, Zenn or note/, link);
  assert.deepEqual(validateArticle(article("[Zennの公式](https://zenn.dev/zenn/articles/x)\n"), profile).errors, [], "other people's Zenn pages are fine");
});

test("the writer adds a separate Qiita article for each scheduled Zenn article that has none", async () => {
  const dir = repo({
    "articles/excel-first-step-001.md": zenn("2026-11-11 09:00"),
    "articles/yesterday-article-1.md": zenn("2026-11-10 09:00", "昨日"),
    "articles/already-on-qiita-1.md": zenn("2026-11-12 09:00", "Qiitaにもう出した"),
    "public/already-on-qiita-1.md": "---\ntitle: x\n---\n",
  });
  const { steps, calls } = fakeSteps();
  const results = await qiitaCompanions({ root: dir, profile, config, now: jst("2026-11-11T06:00"), steps, textlint: () => [] });
  assert.deepEqual(results.map((r) => [r.zenn, r.status]), [["articles/excel-first-step-001.md", "scheduled"]]);
  assert.deepEqual(calls.map((c) => c[0]), ["write", "factcheck"]);
  assert.equal(calls[1][1], "qiita");
  const { data, content } = matter(fs.readFileSync(path.join(dir, "qiita/excel-first-step-001.md"), "utf8"));
  assert.deepEqual([data.title, data.tags, data.published_at, data.ignorePublish], ["pandasで複数のExcelを読み込み重複を検出する", ["Python", "pandas", "Excel"], "2026-11-11 09:00", true]);
  assert.match(content, /```python:aggregate\.py/);
  assert.equal(readQiitaHistory(dir).length, 1);
  assert.deepEqual(await qiitaCompanions({ root: dir, profile, config, now: jst("2026-11-11T06:00"), steps, textlint: () => [] }), [], "never written twice");
});

test("a Qiita article that copies the Zenn article is rewritten; one that keeps failing is never scheduled", async () => {
  const dir = repo({ "articles/excel-first-step-001.md": zenn("2026-11-11 09:00") });
  const { steps, calls } = fakeSteps({ first: `${ZENN_BODY}\n\`\`\`python\nx = 1\n\`\`\`\n` });
  const [r] = await qiitaCompanions({ root: dir, profile, config, now: jst("2026-11-11T06:00"), steps, textlint: () => [] });
  assert.equal(r.status, "scheduled");
  const revise = calls.find((c) => c[0] === "revise");
  assert.equal(revise[1], "qiita");
  assert.match(revise[2].join("\n"), /copied from the Zenn article/);
  assert.match(revise[2].join("\n"), /must not link to your site/, "the copied service link is flagged too");

  const dir2 = repo({ "articles/excel-first-step-001.md": zenn("2026-11-11 09:00") });
  const stuck = fakeSteps({ first: ZENN_BODY, revised: ZENN_BODY });
  const [bad] = await qiitaCompanions({ root: dir2, profile, config, now: jst("2026-11-11T06:00"), steps: stuck.steps, textlint: () => [] });
  assert.equal(bad.status, "failed");
  assert.equal(stuck.calls.filter((c) => c[0] === "revise").length, 2);
  const kept = matter(fs.readFileSync(path.join(dir2, "qiita/excel-first-step-001.md"), "utf8"));
  assert.equal(kept.data.status, "failed");
  assert.equal(kept.data.published_at, undefined);
  assert.match(kept.content, /^\s*<!-- autopilot: not posted to Qiita/);
});

// A fake Qiita API: the items this repository posted, and your recent items.
const api = ({ items = {}, mine = [] } = {}) => {
  const calls = [];
  return {
    calls,
    item: async (id) => (calls.push(`item ${id}`), items[id] ?? null),
    myItems: async () => (calls.push("mine"), mine),
  };
};
const draft = (at, { title = "pandasで重複を検出する", status = null, body = QIITA_BODY } = {}) =>
  `---\ntitle: ${title}\ntags:\n  - Python\nprivate: false\nignorePublish: true\nzenn: articles/x.md\n${status ? `status: ${status}\n` : ""}${at ? `published_at: ${at}\n` : ""}---\n\n${body}`;
const live = "---\ntitle: 公開済み\ntags:\n  - Python\nprivate: false\nupdated_at: '2026-11-10T21:13:38+09:00'\nid: e82696ebcc5f745696a3\nignorePublish: false\n---\n本文\n";

test("at 09:00 the oldest due Qiita article goes into public/, one a day", async () => {
  const dir = repo({
    "public/live.md": live,
    "qiita/day-one-article.md": draft("2026-11-11 09:00"),
    "qiita/day-two-article.md": draft("2026-11-12 09:00", { title: "二日目" }),
    "qiita/broken-article.md": draft("2026-11-10 09:00", { status: "failed" }),
  });
  const qiita = api({ items: { e82696ebcc5f745696a3: { id: "e82696ebcc5f745696a3", private: false } }, mine: [{ id: "e82696ebcc5f745696a3", title: "公開済み", created_at: "2026-11-10T21:13:38+09:00" }] });
  assert.equal((await prepareQiita({ root: dir, profile, api: qiita, now: jst("2026-11-11T08:59") })).action, "nothing");
  const r = await prepareQiita({ root: dir, profile, api: qiita, now: jst("2026-11-11T09:00") });
  assert.deepEqual([r.action, path.basename(r.file)], ["prepared", "day-one-article.md"]);
  const { data, content } = matter(fs.readFileSync(path.join(dir, "public/day-one-article.md"), "utf8"));
  assert.deepEqual(data, { title: "pandasで重複を検出する", tags: ["Python"], private: false, updated_at: "", id: null, organization_url_name: null, slide: false, ignorePublish: false, posting_campaign_uuid: null, agreed_posting_campaign_term: false });
  assert.equal(content.trim(), QIITA_BODY.trim());
  assert.ok(!fs.existsSync(path.join(dir, "public/broken-article.md")), "a failed article is never posted");

  // Later that day, with the next article due too: nothing more until tomorrow.
  fs.writeFileSync(path.join(dir, "qiita/day-two-article.md"), draft("2026-11-11 12:00", { title: "二日目" }));
  const postedToday = api({ items: { e82696ebcc5f745696a3: { id: "e82696ebcc5f745696a3", private: false } }, mine: [{ id: "new1", title: "pandasで重複を検出する", created_at: "2026-11-11T09:01:00+09:00" }] });
  assert.equal((await prepareQiita({ root: dir, profile, api: postedToday, now: jst("2026-11-11T15:00") })).action, "posted-today");
  assert.ok(!fs.existsSync(path.join(dir, "public/day-two-article.md")));
});

test("a title already on Qiita is adopted, not posted again; a promotional link stops the article", async () => {
  const dir = repo({ "qiita/day-one-article.md": draft("2026-11-11 09:00") });
  const remote = { id: "abc123", title: "pandasで重複を検出する", created_at: "2026-11-10T09:00:00+09:00", updated_at: "2026-11-10T09:00:00+09:00" };
  const r = await prepareQiita({ root: dir, profile, api: api({ mine: [remote] }), now: jst("2026-11-11T09:00") });
  assert.equal(r.action, "adopted");
  assert.equal(matter(fs.readFileSync(path.join(dir, "public/day-one-article.md"), "utf8")).data.id, "abc123");

  const dir2 = repo({ "qiita/day-one-article.md": draft("2026-11-11 09:00", { body: `${QIITA_BODY}\n[相談](https://www.lancers.jp/profile/navi_work)\n` }) });
  const bad = await prepareQiita({ root: dir2, profile, api: api(), now: jst("2026-11-11T09:00") });
  assert.equal(bad.action, "failed");
  assert.match(bad.reason, /must not link/);
  assert.equal(matter(fs.readFileSync(path.join(dir2, "qiita/day-one-article.md"), "utf8")).data.status, "failed");
  assert.ok(!fs.existsSync(path.join(dir2, "public/day-one-article.md")));
});

test("when Qiita hides a post, daily posting pauses until qiita/PAUSED is deleted", async () => {
  const dir = repo({ "public/live.md": live, "qiita/day-one-article.md": draft("2026-11-11 09:00") });
  const hidden = api({ items: { e82696ebcc5f745696a3: { id: "e82696ebcc5f745696a3", private: true } } });
  const r = await prepareQiita({ root: dir, profile, api: hidden, now: jst("2026-11-11T09:00") });
  assert.deepEqual([r.action, r.pausedNow], ["paused", true]);
  assert.match(fs.readFileSync(path.join(dir, PAUSED), "utf8"), /made private \(hidden\) 「公開済み」/);
  assert.ok(!fs.existsSync(path.join(dir, "public/day-one-article.md")));

  const again = api();
  const r2 = await prepareQiita({ root: dir, profile, api: again, now: jst("2026-11-12T09:00") });
  assert.deepEqual([r2.action, r2.pausedNow], ["paused", false]);
  assert.deepEqual(again.calls, [], "no Qiita calls while paused");

  const gone = repo({ "public/live.md": live });
  assert.equal((await prepareQiita({ root: gone, profile, api: api(), now: jst("2026-11-11T09:00") })).action, "paused", "a post that's gone pauses too");

  const refused = repo({});
  pauseQiita(refused, "2026-11-11: Qiita refused public/x.md");
  assert.match(fs.readFileSync(path.join(refused, PAUSED), "utf8"), /^2026-11-11: Qiita refused public\/x\.md\n\nDaily Qiita posts are paused/);
});
