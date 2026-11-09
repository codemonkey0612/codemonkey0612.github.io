import assert from "node:assert/strict";
import { test } from "node:test";
import {
  echoableContent,
  factcheck,
  FactcheckError,
  renderReport,
  severity,
} from "../scripts/lib/factcheck-core.mjs";

const profile = { name: "テスト", persona: "私", facts: { career_start: 2018 } };
const article = {
  platform: "note",
  data: { title: "社員の4割がAIを使っている" },
  content: "<!-- メモ -->\n社員の4割がAIを使っている。",
};
const finding = {
  quote: "社員の4割がAIを使っている",
  claim_type: "statistic",
  verdict: "contradicted",
  source_in_article: false,
  evidence_url: "https://example.com/survey",
  explanation: "調査では92.4%が利用、41%が会社に確認せず利用。",
  suggested_fix: "「会社に確認せずにAIを使った社員は4割」",
};
const report = { summary: "数字の読み違いが1件。", findings: [finding] };
const usage = (searches = 0) => ({ input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: searches } });

const reportMsg = (input = report) => ({
  model: "claude-opus-5-5",
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "toolu_1", name: "submit_report", input }],
  usage: usage(),
});

/** A client whose stream() replays scripted responses and records each request. */
function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = responses.shift();
          return { finalMessage: async () => (next instanceof Error ? Promise.reject(next) : next) };
        },
      },
    },
  };
}

test("sends Opus 5.5 with web search, a strict report tool and refusal fallbacks", async () => {
  const client = fakeClient([reportMsg()]);
  await factcheck({ client, article, profile, today: "2026-11-08" });
  const [req] = client.requests;
  assert.equal(req.model, "claude-opus-5-5");
  assert.deepEqual(req.thinking, { type: "adaptive" });
  assert.equal(req.output_config.effort, "high");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.tools[0].type, "web_search_20260209");
  assert.equal(req.tools[1].strict, true);
  assert.equal(req.tools[1].eager_input_streaming, true);
  assert.equal(req.tool_choice.type, "auto");
  assert.deepEqual(req.cache_control, { type: "ephemeral" }, "resent conversations are cached");
  const text = req.messages[0].content;
  assert.match(text, /Today is 2026-11-08/);
  assert.match(text, /career_start/);
  assert.doesNotMatch(text, /メモ/, "HTML comments are stripped before sending");
});

test("resumes a paused server-side search and sums usage", async () => {
  const paused = {
    model: "claude-opus-5-5",
    stop_reason: "pause_turn",
    content: [{ type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "q" } }],
    usage: usage(3),
  };
  const client = fakeClient([paused, { ...reportMsg(), usage: usage(2) }]);
  const result = await factcheck({ client, article, profile });
  assert.equal(client.requests.length, 2);
  const second = client.requests[1].messages;
  assert.equal(second.length, 2, "paused turn echoed back, no extra user message");
  assert.equal(second[1].role, "assistant");
  assert.equal(result.usage.web_search_requests, 5);
  assert.equal(result.report.findings.length, 1);
});

test("re-asks without echoing an invalid report", async () => {
  const client = fakeClient([reportMsg({ summary: "x", findings: [{ quote: "q" }] }), reportMsg()]);
  const result = await factcheck({ client, article, profile });
  assert.equal(client.requests.length, 2);
  assert.equal(client.requests[1].messages.length, 1, "broken tool call is not sent back");
  assert.equal(result.report.summary, report.summary);
});

test("re-asks when the streamed report JSON can't be parsed", async () => {
  const broken = reportMsg();
  Object.defineProperty(broken.content[0], "input", {
    get() {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  });
  const client = fakeClient([broken, reportMsg()]);
  const result = await factcheck({ client, article, profile });
  assert.equal(client.requests.length, 2);
  assert.equal(result.report.findings[0].verdict, "contradicted");
});

test("retries a stream that broke on unparseable JSON, but not other errors", async () => {
  const retried = fakeClient([new SyntaxError("Unexpected token"), reportMsg()]);
  await factcheck({ client: retried, article, profile });
  assert.equal(retried.requests.length, 2);

  const auth = fakeClient([new Error("Could not resolve authentication method")]);
  await assert.rejects(factcheck({ client: auth, article, profile }), /authentication/);
  assert.equal(auth.requests.length, 1, "no retry for credential or API errors");
});

test("nudges once when Claude ends without a report", async () => {
  const chatty = { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "done" }], usage: usage() };
  const client = fakeClient([chatty, reportMsg()]);
  await factcheck({ client, article, profile });
  const msgs = client.requests[1].messages;
  assert.equal(msgs.at(-1).role, "user");
  assert.match(msgs.at(-1).content, /submit_report/);

  const twice = fakeClient([chatty, chatty]);
  await assert.rejects(factcheck({ client: twice, article, profile }), FactcheckError);
});

test("stops on a refusal and names the category", async () => {
  const refusal = { model: "x", stop_reason: "refusal", stop_details: { category: "cyber" }, content: [], usage: usage() };
  await assert.rejects(factcheck({ client: fakeClient([refusal]), article, profile }), /declined.*cyber/);
});

test("stops on max_tokens instead of trusting a truncated report", async () => {
  const cut = { ...reportMsg(), stop_reason: "max_tokens" };
  await assert.rejects(factcheck({ client: fakeClient([cut]), article, profile }), /max_tokens/);
});

test("echoableContent keeps only text and paired search blocks before a fallback", () => {
  const content = [
    { type: "thinking", thinking: "" },
    { type: "server_tool_use", id: "a" },
    { type: "web_search_tool_result", tool_use_id: "a" },
    { type: "server_tool_use", id: "b" },
    { type: "text", text: "partial" },
    { type: "fallback", from: { model: "m1" }, to: { model: "m2" } },
    { type: "thinking", thinking: "" },
  ];
  assert.deepEqual(
    echoableContent(content).map((b) => b.type),
    ["server_tool_use", "web_search_tool_result", "text", "fallback", "thinking"],
  );
  const plain = [{ type: "text", text: "x" }];
  assert.equal(echoableContent(plain), plain);
});

test("severity: wrong or unsourced numbers block, verified ones pass", () => {
  assert.equal(severity(finding), "error");
  assert.equal(severity({ ...finding, verdict: "supported", source_in_article: false }), "error");
  assert.equal(severity({ ...finding, verdict: "supported", source_in_article: true }), "ok");
  assert.equal(severity({ ...finding, verdict: "unsupported", source_in_article: true }), "warning");
  assert.equal(severity({ ...finding, claim_type: "technical", verdict: "unsupported", source_in_article: false }), "warning");
  assert.equal(severity({ ...finding, claim_type: "title_overclaim", verdict: "unsupported" }), "error");
});

test("renderReport lists problems first and counts them", () => {
  const ok = { ...finding, quote: "OK claim", verdict: "supported", source_in_article: true };
  const r = renderReport({
    file: "notes/x.md",
    title: "T",
    result: { report: { summary: "s", findings: [ok, finding] }, usage: { web_search_requests: 4, input_tokens: 1, output_tokens: 1 }, model: "m" },
  });
  assert.equal(r.errors, 1);
  assert.equal(r.warnings, 0);
  assert.ok(r.markdown.indexOf("社員の4割") < r.markdown.indexOf("OK claim"));
  assert.match(r.markdown, /\*\*Fix:\*\*/);
  const failed = renderReport({ file: "notes/x.md", error: "no credentials" });
  assert.equal(failed.errors, 1);
});
