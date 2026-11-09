import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import matter from "gray-matter";
import { authorContext, autowrite, openSlots, pickPillar, readHistory, Topic, topicTool, writePrompt } from "../scripts/lib/writer-core.mjs";

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
  assert.deepEqual(openSlots(dir, jst("2026-11-10T06:00"), 2, []), ["2026-11-10 09:00"], "today still counts at 06:00; the 11th is taken");
  assert.deepEqual(openSlots(dir, jst("2026-11-10T08:30"), 2, []), ["2026-11-12 09:00"], "too late for today");
  assert.deepEqual(openSlots(dir, jst("2026-11-10T06:00"), 2, [{ status: "in review", date: "2026-11-10 09:00" }]), []);
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
const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, web_search_requests: 2 };
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
  assert.equal(h.cost_usd, Number(((5000 * 4 + 2500 * 20) / 1e6).toFixed(2)));
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

test("an error in one morning doesn't stop the next", async () => {
  const dir = repo();
  const { steps } = fakeSteps({ checks: [report()] });
  let first = true;
  const flaky = { ...steps, chooseTopic: async (ctx) => (first ? ((first = false), Promise.reject(new Error("rate limited"))) : steps.chooseTopic(ctx)) };
  const results = await autowrite({ root: dir, profile, config, now: jst("2026-11-10T06:00"), steps: flaky, textlint: () => [] });
  assert.deepEqual(results.map((r) => r.status), ["failed", "scheduled"]);
  assert.deepEqual(results[0].problems, ["rate limited"]);
});
