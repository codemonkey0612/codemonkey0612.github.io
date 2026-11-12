import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessages, LIMITS, makeIndex, search, shapeAnswer, terms, validate } from "../chat/src/core.mjs";
import { handle, resetKnowledge } from "../chat/src/handler.mjs";
import { loadProfile, ROOT } from "../scripts/lib/common.mjs";
import { buildKnowledge } from "../scripts/lib/kb.mjs";
import { loadSite } from "../scripts/lib/site-core.mjs";
import { COMMON_FAQ } from "../scripts/lib/site-pages.mjs";

const today = new Date("2026-11-12T00:00:00+09:00");
const kb = buildKnowledge(loadSite({ root: ROOT, profile: loadProfile(), today }), { faq: COMMON_FAQ, root: ROOT });

test("the knowledge base holds what the site shows, and nothing it hides", () => {
  const ids = new Set(kb.map((d) => d.id));
  for (const id of ["about", "record", "prices", "contact", "nda", "case-ai-saas", "svc-ai-chatbot"]) assert.ok(ids.has(id), id);
  for (const id of ["1319001", "1319015", "1319679", "1319682"]) assert.ok(!ids.has(`pkg-${id}`), `Lancers-only package ${id} stays out`);
  assert.ok(!JSON.stringify(kb).match(/@(gmail|yahoo|outlook|icloud)\./), "no mailbox address");
  for (const d of kb) for (const b of d.blocks) assert.ok(b.length <= 400, `${d.id}: a short citable block`);
});

test("retrieval finds the passage a question is about", () => {
  const index = makeIndex(kb);
  const top = (q) => search(index, q).map((d) => d.id);
  assert.ok(terms("RAGチャットボット").includes("rag"));
  assert.ok(top("NDAは結べますか？").some((id) => id === "nda" || id === "faq" || id === "facts"), "NDA");
  assert.ok(top("RAGチャットボットの料金はいくら？").some((id) => id.startsWith("pkg-") || id.startsWith("svc-ai-chatbot")), "chatbot price");
  assert.ok(top("どんな資格を持っていますか").includes("certifications"), "certifications");
  assert.ok(top("物流の配送管理システムの実績").includes("case-delivery-management"), "a confidential project");
  assert.equal(search(index, "zzqx").length, 0, "nothing for nonsense");
  assert.ok(search(index, "料金").length <= LIMITS.passages);
});

test("requests are checked: the last turn is the visitor's question, within limits", () => {
  assert.ok(validate({}).error);
  assert.ok(validate({ messages: [{ role: "assistant", content: "x" }] }).error);
  assert.ok(validate({ messages: [{ role: "user", content: "あ".repeat(LIMITS.question + 1) }] }).error);
  const ok = validate({ messages: [{ role: "assistant", content: "hi" }, { role: "user", content: "料金は？" }, { role: "assistant", content: "…" }, { role: "user", content: " NDAは？ " }] });
  assert.equal(ok.question, "NDAは？");
  assert.deepEqual(ok.history.map((m) => m.role), ["user", "assistant"], "history starts with the visitor and alternates");
});

test("the question goes last, after the passages as citable search results", () => {
  const index = makeIndex(kb);
  const docs = search(index, "NDAは結べますか");
  const msgs = buildMessages({ question: "NDAは結べますか", history: [] }, docs, "https://shanaiai.com/");
  const content = msgs.at(-1).content;
  assert.equal(content.at(-1).text, "NDAは結べますか");
  for (const b of content.slice(0, -1)) {
    assert.equal(b.type, "search_result");
    assert.match(b.source, /^https:\/\/shanaiai\.com\//);
    assert.deepEqual(b.citations, { enabled: true });
  }
});

test("citations become numbered sources", () => {
  const cite = (source, title) => ({ type: "search_result_location", source, title, cited_text: "x", search_result_index: 0, start_block_index: 0, end_block_index: 1 });
  const out = shapeAnswer([
    { type: "thinking", thinking: "" },
    { type: "text", text: "結べます。", citations: [cite("https://shanaiai.com/works/#nda", "機密保持について")] },
    { type: "text", text: "\n" },
    { type: "text", text: "フォームから。", citations: [cite("https://shanaiai.com/contact/", "相談"), cite("https://shanaiai.com/works/#nda", "機密保持について")] },
  ]);
  assert.deepEqual(out.sources.map((s) => s.n), [1, 2]);
  assert.deepEqual(out.blocks.map((b) => b.cites), [[1], [], [2, 1]]);
});

function fakeClient(events, final, seen = []) {
  return {
    beta: {
      messages: {
        stream(params) {
          seen.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e;
            },
            finalMessage: async () => final,
          };
        },
      },
    },
  };
}
const env = { ALLOWED_ORIGINS: "https://shanaiai.com", KB_URL: "https://shanaiai.com/assets/kb.json", SITE_URL: "https://shanaiai.com/" };
const kbFetch = async () => new Response(JSON.stringify(kb), { status: 200 });
const post = (body, origin = "https://shanaiai.com") => new Request("https://chat.shanaiai.com/", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("the endpoint streams the answer, then its sources", async () => {
  resetKnowledge();
  const seen = [];
  const client = fakeClient(
    [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "結べます。" } }],
    { stop_reason: "end_turn", content: [{ type: "text", text: "結べます。", citations: [{ type: "search_result_location", source: "https://shanaiai.com/works/#nda", title: "機密保持について" }] }] },
    seen,
  );
  const res = await handle(post({ messages: [{ role: "user", content: "NDAは結べますか？" }] }), env, { client, fetch: kbFetch, params: { model: "m", max_tokens: 100 } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://shanaiai.com");
  const text = await res.text();
  assert.match(text, /event: delta\ndata: \{"t":"結べます。"\}/);
  assert.match(text, /event: done\ndata: .*"sources":\[\{"n":1,"title":"機密保持について"/);
  assert.equal(seen[0].model, "m");
  assert.match(seen[0].system[0].text, /推測で答えず/);
});

test("other sites, empty questions and failures get a plain refusal", async () => {
  resetKnowledge();
  const client = fakeClient([], { stop_reason: "end_turn", content: [] });
  assert.equal((await handle(post({ messages: [{ role: "user", content: "x" }] }, "https://evil.example"), env, { client, fetch: kbFetch })).status, 403);
  assert.equal((await handle(post({ messages: [] }), env, { client, fetch: kbFetch })).status, 400);
  assert.equal((await handle(post({ messages: [{ role: "user", content: "x" }] }), env, { fetch: kbFetch })).status, 503, "no key yet: not ready");
  const broken = { beta: { messages: { stream() { const e = new Error("rate"); e.status = 429; throw e; } } } };
  const text = await (await handle(post({ messages: [{ role: "user", content: "料金は？" }] }), env, { client: broken, fetch: kbFetch })).text();
  assert.match(text, /event: error\ndata: \{"message":"ただいま混み合っています/);
});

test("visitors are limited per ten minutes, and the site per day", async () => {
  resetKnowledge();
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
  const client = fakeClient([], { stop_reason: "end_turn", content: [{ type: "text", text: "はい。" }] });
  const e = { ...env, CHAT_KV: kv, DAILY_CAP: "3" };
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await handle(post({ messages: [{ role: "user", content: "料金は？" }] }), e, { client, fetch: kbFetch })).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
});
