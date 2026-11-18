import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import matter from "gray-matter";
import {
  Article,
  authorContext,
  autowrite,
  closingOf,
  noteCompanions,
  notePrompt,
  openSlots,
  pickPillar,
  readHistory,
  readNoteHistory,
  spentToday,
  Topic,
  topicPrompt,
  topicTool,
  uniqueSlug,
  writePrompt,
} from "../scripts/lib/writer-core.mjs";

const jst = (s) => new Date(`${s}+09:00`);
const config = {
  enabled: true,
  mode: "auto",
  days_ahead: 2,
  max_per_run: 2,
  pillars: [
    { id: "sme", weight: 3, label: "中小企業の課題", audience: "buyer", brief: "b" },
    { id: "ai-software", weight: 3, label: "AI・ソフトウェア", audience: "engineer", brief: "b" },
    { id: "news", weight: 2, label: "ニュース", audience: "buyer", brief: "b" },
  ],
  avoid: ["実在しない事例・顧客・数字・引用を作ること"],
};
const profile = {
  name: "匠（たくみ）",
  title: "フリーランスのAI・Webエンジニア",
  persona: "私",
  site_url: "https://codemonkey0612.github.io/",
  contact_url: "https://www.lancers.jp/profile/navi_work/contact_light",
  facts: { career_start: "2015-04" },
  services: [{ id: "ai-chatbot", name: "AIチャットボット・社内文書検索（RAG）", summary: "s" }],
  cases: [{ id: "rag-docs", title: "RAG文書解析", period: "2023", team: "6名", role: "AI", challenge: "c", actions: "a", result: "検索時間を約60%削減", stack: ["Python"] }],
  todos: [],
};
function repo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writer-test-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}
const zenn = (at) => `---\ntitle: 既存\nemoji: "🤖"\ntype: tech\ntopics: [ai]\npublished: true\npublished_at: "${at}"\n---\n本文\n`;

test("the writer fills open mornings at least an hour ahead, and counts ones waiting for review", () => {
  const dir = repo({ "articles/existing-article.md": zenn("2026-11-11 09:00") });
  assert.deepEqual(openSlots(dir, jst("2026-11-10T06:00"), 2, { history: [] }), ["2026-11-10 09:00"], "today still counts at 06:00; the 11th is taken");
  assert.deepEqual(openSlots(dir, jst("2026-11-10T08:30"), 2, { history: [] }), ["2026-11-12 09:00"], "too late for today");
  assert.deepEqual(openSlots(dir, jst("2026-11-10T06:00"), 2, { history: [{ status: "in review", date: "2026-11-10 09:00" }] }), []);
});

test("every_days 2: a morning is open only when no article is on the day before or after it", () => {
  const dir = repo({ "articles/existing-article.md": zenn("2026-11-11 09:00") });
  const slots = (at, days) => openSlots(dir, jst(at), days, { history: [], every: 2 });
  assert.deepEqual(slots("2026-11-10T06:00", 2), [], "the 10th and 12th are next to the 11th");
  assert.deepEqual(slots("2026-11-12T06:00", 2), ["2026-11-13 09:00"]);
  assert.deepEqual(slots("2026-11-12T06:00", 5), ["2026-11-13 09:00", "2026-11-15 09:00"], "and not next to each other");
});

// ---------- requeue_missing: an article Zenn never took is sent again ----------

const qiitaFailed = `---\ntitle: Q\ntags: [Python]\nprivate: false\nignorePublish: true\nzenn: articles/missed-on-zenn.md\nstatus: failed\n---\n本文\n`;
const requeueConfig = { ...config, max_per_run: 1, zenn: { every_days: 2, requeue_missing: true } };

test("requeue: an article Zenn never took gets the next open morning instead of a new article", async () => {
  const dir = repo({
    "articles/missed-on-zenn.md": zenn("2026-11-14 09:00"),
    "articles/live-on-zenn.md": zenn("2026-11-13 09:00"),
    "articles/held-by-zenn.md": zenn("2026-11-15 09:00"),
    "qiita/missed-on-zenn.md": qiitaFailed,
  });
  const asked = [];
  const status = { "missed-on-zenn": 404, "live-on-zenn": 200, "held-by-zenn": 403 };
  const zennStatus = async (slug) => (asked.push(slug), status[slug]);
  const { steps, calls } = fakeSteps({ checks: [report()] });
  const results = await autowrite({ root: dir, profile, config: requeueConfig, now: jst("2026-11-17T06:00"), steps, textlint: () => [], zennStatus });
  assert.deepEqual(results.map((r) => [r.status, r.slug, r.date, r.from]), [["requeued", "missed-on-zenn", "2026-11-17 09:00", "2026-11-14 09:00"]]);
  assert.deepEqual(calls, [], "no Claude calls: nothing new is written");
  assert.deepEqual(matter(fs.readFileSync(path.join(dir, "articles/missed-on-zenn.md"), "utf8")).data.published_at, "2026-11-17 09:00");
  assert.match(fs.readFileSync(path.join(dir, "articles/missed-on-zenn.md"), "utf8"), /^title: 既存\nemoji: "🤖"/m, "the rest of the front matter is kept as it was");
  assert.equal(fs.existsSync(path.join(dir, "qiita/missed-on-zenn.md")), false, "its failed Qiita article is written again");
  assert.equal(matter(fs.readFileSync(path.join(dir, "articles/held-by-zenn.md"), "utf8")).data.published_at, "2026-11-15 09:00", "a 403 is left alone");
  assert.deepEqual(asked, ["live-on-zenn", "missed-on-zenn"], "oldest first, stopping at the first one sent again");
});

test("requeue: sent once; if Zenn still doesn't take it, it's reported once and then left alone", async () => {
  const dir = repo({ "articles/missed-on-zenn.md": zenn("2026-11-17 09:00") });
  fs.mkdirSync(path.join(dir, "autopilot"));
  fs.writeFileSync(path.join(dir, "autopilot/history.json"), JSON.stringify([{ slug: "missed-on-zenn", status: "requeued", date: "2026-11-17 09:00", from: "2026-11-14 09:00" }]));
  const zennStatus = async () => 404;
  const { steps } = fakeSteps({ checks: [report()] });
  const run = (at) => autowrite({ root: dir, profile, config: requeueConfig, now: jst(at), steps, textlint: () => [], zennStatus });
  const first = await run("2026-11-18T06:00");
  assert.equal(first[0].status, "missing");
  assert.match(first[0].problems[0], /zenn\.dev\/dashboard\/deploys/);
  assert.equal(first[1].status, "scheduled", "and a new article is written for the open morning");
  assert.equal(first[1].date, "2026-11-19 09:00");
  assert.equal(matter(fs.readFileSync(path.join(dir, "articles/missed-on-zenn.md"), "utf8")).data.published_at, "2026-11-17 09:00", "not moved again");
  const again = await run("2026-11-20T06:00");
  assert.ok(!again.some((r) => r.status === "missing"), "reported only once");
});

test("requeue is off by default, and a Zenn that can't be reached sends nothing again", async () => {
  const dir = repo({ "articles/missed-on-zenn.md": zenn("2026-11-14 09:00") });
  const { steps } = fakeSteps({ checks: [report()] });
  let asked = 0;
  const off = await autowrite({ root: dir, profile, config: { ...config, max_per_run: 1 }, now: jst("2026-11-17T06:00"), steps, textlint: () => [], zennStatus: async () => (asked++, 404) });
  assert.equal(asked, 0);
  assert.equal(off[0].status, "scheduled");
  const dir2 = repo({ "articles/missed-on-zenn.md": zenn("2026-11-14 09:00") });
  const down = await autowrite({ root: dir2, profile, config: requeueConfig, now: jst("2026-11-17T06:00"), steps, textlint: () => [], zennStatus: async () => null });
  assert.deepEqual(down.map((r) => r.status), ["scheduled"]);
});

test("pillars rotate by weight", () => {
  const history = [];
  for (let i = 0; i < 16; i++) history.push({ pillar: pickPillar(config, history).id, status: "scheduled" });
  const count = (id) => history.filter((h) => h.pillar === id).length;
  assert.deepEqual([count("sme"), count("ai-software"), count("news")], [6, 6, 4]);
  assert.notEqual(history[0].pillar, history[1].pillar, "no two of the same in a row at the start");
});

test("topics are checked: Zenn slug, one emoji, ASCII topics, a known service", () => {
  const good = { title: "社内の問い合わせ対応をRAGで減らす前に決めること", slug: "rag-before-you-start", emoji: "🤖", topics: ["rag", "ai"], service_id: "ai-chatbot", angle: "a", outline: ["一", "二", "三", "四"], sources: [], cases: ["rag-docs"] };
  assert.ok(Topic.safeParse(good).success);
  for (const bad of [{ slug: "RAG_Start" }, { emoji: "🤖🤖" }, { topics: ["生成AI"] }, { topics: [] }]) assert.ok(!Topic.safeParse({ ...good, ...bad }).success, JSON.stringify(bad));
  const tool = topicTool(authorContext(profile));
  assert.deepEqual(tool.input_schema.properties.service_id.enum, ["ai-chatbot"]);
  assert.equal(tool.strict, true);
  const { system } = writePrompt({ author: authorContext(profile), config, pillar: config.pillars[0], topic: { ...good }, service: authorContext(profile).services[0], contactUrl: profile.contact_url, today: "2026-11-10" });
  assert.match(system, /Never invent projects, clients, results, numbers, quotes or conversations/);
  assert.match(system, /\[ランサーズで相談する\]\(https:\/\/www\.lancers\.jp\/profile\/navi_work\/contact_light\)/);
});

const BODY = (extra = "") =>
  `${"中小企業の問い合わせ対応について、現場で使える進め方を説明します。".repeat(30)}${extra}\n\n---\n\n私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。\n→ [AIチャットボット・社内文書検索（RAG）について](https://codemonkey0612.github.io/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)\n`;
const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 2 };
const report = (findings = []) => ({ report: { summary: "ok", findings }, usage });
const wrong = { quote: "検索時間を約90%削減", claim_type: "statistic", verdict: "contradicted", source_in_article: false, evidence_url: "", explanation: "プロフィールでは約60%", suggested_fix: "約60%に直す" };

function fakeSteps({ checks }) {
  const calls = [];
  let n = 0;
  return {
    calls,
    steps: {
      chooseTopic: async (ctx) => {
        calls.push(["topic", ctx.pillar.id]);
        return { value: { title: "社内の問い合わせ対応をRAGで減らす前に決めること", slug: "rag-before-you-start", emoji: "🤖", topics: ["rag", "ai"], service_id: "ai-chatbot", angle: "a", outline: ["一", "二", "三", "四"], sources: [], cases: ["rag-docs"] }, usage };
      },
      writeArticle: async () => (calls.push(["write"]), { value: { body: BODY("約90%"), summary: "s" }, usage }),
      reviseArticle: async (ctx) => (calls.push(["revise", ctx.problems]), { value: { body: BODY("約60%"), summary: "s" }, usage }),
      factcheck: async () => (calls.push(["factcheck"]), checks[Math.min(n++, checks.length - 1)]),
    },
  };
}

test("a # heading is refused, but # comments inside code blocks are fine", () => {
  const filler = "本文".repeat(800);
  const ok = (body) => Article.safeParse({ body: `${filler}\n${body}`, summary: "s" }).success;
  assert.ok(ok("## 確認手順\n\n```bash\n# PHPのバージョンを確認\nphp -v\n```\n\n~~~python\n# comment\n~~~\n"));
  assert.ok(!ok("# 見出し\n本文"));
  assert.ok(!ok("```bash\nphp -v\n```\n# 見出し\n"), "a heading after a closed block is still caught");
});

test("the writer plans, writes, fixes what the fact-check finds and schedules the article", async () => {
  const dir = repo();
  const { steps, calls } = fakeSteps({ checks: [report([wrong]), report()] });
  const results = await autowrite({ root: dir, profile, config: { ...config, max_per_run: 1 }, now: jst("2026-11-10T06:00"), steps, textlint: () => [] });
  assert.equal(results[0].status, "scheduled");
  assert.deepEqual(calls.map((c) => c[0]), ["topic", "write", "factcheck", "revise", "factcheck"]);
  assert.match(calls[3][1].join("\n"), /約60%に直す/, "the fix the fact-check suggested is passed on");
  const file = path.join(dir, "articles/rag-before-you-start.md");
  const { data, content } = matter(fs.readFileSync(file, "utf8"));
  assert.deepEqual([data.published, data.published_at, data.type, data.topics], [true, "2026-11-10 09:00", "idea", ["rag", "ai"]]);
  assert.match(content, /約60%/);
  const [h] = readHistory(dir);
  assert.equal(h.pillar, "sme");
  assert.equal(h.usage.input_tokens, 5000, "usage from every step is added up");
  // Claude Sonnet 5.5 by default ($2 / $10 per million tokens) plus $0.01 per web search.
  assert.equal(h.model, "claude-sonnet-5-5");
  assert.equal(h.cost_usd, Number(((5000 * 2 + 2500 * 10) / 1e6 + 10 * 0.01).toFixed(2)));
  assert.deepEqual(openSlots(dir, jst("2026-11-10T06:00"), 1), [], "the morning is now taken");
});

test("an article that still fails after two fixes is kept as an unpublished draft and the morning stays open", async () => {
  const dir = repo();
  const { steps, calls } = fakeSteps({ checks: [report([wrong])] });
  const [r] = await autowrite({ root: dir, profile, config: { ...config, max_per_run: 1 }, now: jst("2026-11-10T06:00"), steps, textlint: () => ["textlint (line 3): 一文が長すぎます"] });
  assert.equal(r.status, "failed");
  assert.equal(calls.filter((c) => c[0] === "revise").length, 2);
  const { data, content } = matter(fs.readFileSync(path.join(dir, "articles/rag-before-you-start.md"), "utf8"));
  assert.equal(data.published, false);
  assert.equal(data.published_at, undefined);
  assert.match(content, /^\s*<!-- autopilot: not published/);
  assert.deepEqual(openSlots(dir, jst("2026-11-10T06:00"), 1), ["2026-11-10 09:00"]);
});

test("the topic step sees what readers are liking, once per run, and plans without it when it's unavailable", async () => {
  const author = authorContext(profile);
  const ctx = { author, config, pillar: config.pillars[0], recentTitles: [], ideas: "", today: "2026-11-18" };
  const withTrends = topicPrompt({ ...ctx, trends: "Zenn: …\n- 475 likes · ある記事" });
  assert.match(withTrends.user, /<trends>\nZenn: …\n- 475 likes · ある記事\n<\/trends>/);
  assert.match(withTrends.user, /never copy a title/);
  assert.doesNotMatch(topicPrompt(ctx).user, /<trends>/);
  assert.match(withTrends.system, /three versions/);
  assert.match(withTrends.system, /Never invent experience/);

  const dir = repo();
  const { steps } = fakeSteps({ checks: [report()] });
  const seen = [];
  const watching = { ...steps, chooseTopic: async (c) => (seen.push(c.trends), steps.chooseTopic(c)) };
  let fetched = 0;
  await autowrite({ root: dir, profile, config, now: jst("2026-11-10T06:00"), steps: watching, textlint: () => [], trends: async () => (fetched++, "DIGEST") });
  assert.deepEqual([fetched, seen], [1, ["DIGEST", "DIGEST"]], "two articles, one fetch");
  const down = await autowrite({ root: repo(), profile, config: { ...config, max_per_run: 1 }, now: jst("2026-11-10T06:00"), steps, textlint: () => [], trends: async () => Promise.reject(new Error("offline")) });
  assert.equal(down[0].status, "scheduled");
});

// ---------- note_version: a separate note article for general readers ----------

const zennWithClosing = (at) =>
  `---\ntitle: 既存\nemoji: "🤖"\ntype: tech\ntopics: [ai]\npublished: true\npublished_at: "${at}"\n---\n${BODY()}`;
const NOTE_BODY = `${Array.from({ length: 40 }, (_, i) => `${i + 1}つ目の場面では、${["請求書", "見積書", "日報", "議事録", "問い合わせ", "在庫表", "勤怠"][i % 7]}の作業を見直して、手順を一つずつ確かめました。`).join("")}\n\n---\n\n私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。\n→ [AIチャットボット・社内文書検索（RAG）について](https://codemonkey0612.github.io/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)\n`;
const noteSteps = (checks) => {
  const { steps, calls } = fakeSteps({ checks });
  return {
    calls,
    steps: {
      ...steps,
      writeNote: async (ctx) => (calls.push(["note", ctx.closing]), { value: { title: "仕事でAIを使い始めた方へ", hashtags: ["生成AI", "業務効率化"], body: NOTE_BODY }, usage }),
    },
  };
};

test("note_version: each scheduled article gets a note article for general readers, dated for its morning", async () => {
  const dir = repo({
    "articles/scheduled-article.md": zennWithClosing("2026-11-20 09:00"),
    "articles/already-on-note.md": zennWithClosing("2026-11-19 09:00"),
    "notes/already-on-note.md": "---\ntitle: x\nstatus: ready\n---\nx\n",
    "articles/yesterdays-article.md": zennWithClosing("2026-11-17 09:00"),
  });
  const { steps, calls } = noteSteps([report()]);
  const results = await noteCompanions({ root: dir, profile, config, now: jst("2026-11-18T06:00"), steps, textlint: () => [] });
  assert.deepEqual(results.map((r) => [r.status, r.zenn]), [["scheduled", "articles/scheduled-article.md"]], "not for one already on note, or a past morning");
  assert.match(calls[0][1], /^私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。\n→ \[/, "it's given the Zenn article's closing paragraph");
  const { data, content } = matter(fs.readFileSync(path.join(dir, "note-src/scheduled-article.md"), "utf8"));
  assert.deepEqual([data.title, data.hashtags, data.published_at, data.status], ["仕事でAIを使い始めた方へ", ["生成AI", "業務効率化"], "2026-11-20 09:00", undefined]);
  assert.match(content, /ランサーズで相談する/);
  assert.equal(readNoteHistory(dir).length, 1);
  assert.ok(spentToday(dir, jst("2026-11-18T07:00")) > 0, "its cost counts toward the day's budget");
});

test("note_version: one that still fails is marked failed, so note gets the Zenn copy", async () => {
  const dir = repo({ "articles/scheduled-article.md": zennWithClosing("2026-11-20 09:00") });
  const { steps } = noteSteps([report([wrong])]);
  const [r] = await noteCompanions({ root: dir, profile, config, now: jst("2026-11-18T06:00"), steps, textlint: () => [] });
  assert.equal(r.status, "failed");
  const { data, content } = matter(fs.readFileSync(path.join(dir, "note-src/scheduled-article.md"), "utf8"));
  assert.deepEqual([data.status, data.published_at], ["failed", undefined]);
  assert.match(content, /^\s*<!-- autopilot: not used on note/);
});

test("the note prompt asks for note's readers and keeps the facts and the closing", () => {
  const closing = closingOf(BODY());
  assert.match(closing, /^私は「/);
  assert.equal(closingOf("no rule here"), "");
  const { system, user } = notePrompt({ author: authorContext(profile), config, zenn: { title: "Zennの題", body: BODY() }, closing, today: "2026-11-18" });
  assert.match(system, /mostly not engineers/);
  assert.match(system, /Never invent projects, clients, results, numbers, quotes or conversations/);
  assert.ok(system.includes(closing));
  assert.match(user, /Title: Zennの題/);
});

test("a new article never reuses a slug that's taken on any platform", () => {
  const dir = repo({ "notes/old-slug-here.md": "x", "zenn-missed/missed-slug-x.md": "x", "public/qiita-slug-x.md": "x" });
  assert.equal(uniqueSlug(dir, "old-slug-here"), "old-slug-here-2");
  assert.equal(uniqueSlug(dir, "missed-slug-x"), "missed-slug-x-2");
  assert.equal(uniqueSlug(dir, "qiita-slug-x"), "qiita-slug-x-2");
  assert.equal(uniqueSlug(dir, "brand-new-slug"), "brand-new-slug");
});

test("an error in one morning doesn't stop the next", async () => {
  const dir = repo();
  const { steps } = fakeSteps({ checks: [report()] });
  let first = true;
  const flaky = { ...steps, chooseTopic: async (ctx) => (first ? ((first = false), Promise.reject(new Error("rate limited"))) : steps.chooseTopic(ctx)) };
  const results = await autowrite({ root: dir, profile, config, now: jst("2026-11-10T06:00"), steps: flaky, textlint: () => [] });
  assert.deepEqual(results.map((r) => r.status), ["failed", "scheduled"]);
  assert.deepEqual(results[0].problems, ["rate limited"]);
});
