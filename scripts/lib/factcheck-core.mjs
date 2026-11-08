// Claude-powered fact-check: finds checkable claims, verifies them with web
// search, and returns a structured report. The request loop lives here so it can
// be tested with a fake client.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const MODEL = process.env.FACTCHECK_MODEL || "claude-opus-5-5";
export const EFFORT = process.env.FACTCHECK_EFFORT || "high";
export const MAX_SEARCHES = Number(process.env.FACTCHECK_MAX_SEARCHES || 15);
const MAX_REQUESTS = 8;

const CLAIM_TYPES = ["statistic", "study_or_survey", "date_or_event", "attribution", "technical", "self_claim", "title_overclaim"];
const VERDICTS = ["supported", "contradicted", "unsupported", "unverifiable"];

const Finding = z.object({
  quote: z.string().min(1),
  claim_type: z.enum(CLAIM_TYPES),
  verdict: z.enum(VERDICTS),
  source_in_article: z.boolean(),
  evidence_url: z.string(),
  explanation: z.string(),
  suggested_fix: z.string(),
});
export const ReportSchema = z.object({ summary: z.string(), findings: z.array(Finding) });

const REPORT_TOOL = {
  name: "submit_report",
  description: "Submit the finished fact-check report. Call exactly once, after all searches.",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "findings"],
    properties: {
      summary: { type: "string", description: "2–3 sentences on the article's overall reliability, in the article's language." },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["quote", "claim_type", "verdict", "source_in_article", "evidence_url", "explanation", "suggested_fix"],
          properties: {
            quote: { type: "string", description: "The claim, copied exactly from the article." },
            claim_type: { type: "string", enum: CLAIM_TYPES },
            verdict: { type: "string", enum: VERDICTS },
            source_in_article: { type: "boolean", description: "Does the article itself link a source for this claim?" },
            evidence_url: { type: "string", description: "Best source you found, or empty string." },
            explanation: { type: "string", description: "What the evidence shows, in the article's language." },
            suggested_fix: { type: "string", description: "Corrected wording or what to add; empty if supported and sourced." },
          },
        },
      },
    },
  },
};

const SYSTEM = `You fact-check blog articles before they are published. The author is a freelance engineer whose articles also market their services, so a wrong number, a misread survey or misleading technical advice costs them credibility with the clients they want to reach.

Find every claim a reader could check or act on, and classify it:
- statistic: numbers, percentages, prices, durations, counts.
- study_or_survey: a named study, survey, report or paper. Check that it says what the article says: what was measured, who was surveyed, how many, when, and who sponsored it.
- date_or_event: dates, releases, incidents, court cases.
- attribution: quotes, sayings or proverbs credited to a person, group or work.
- technical: technical statements and advice, especially security advice a reader might rely on.
- self_claim: what the author says about themselves (years of experience, location, history, past work). Judge these against the author profile, not the web.
- title_overclaim: the title or a heading claims more than the body or its source supports (e.g. "stops" when the study says "slows").

Use web search to verify every type except self_claim, preferring primary sources: the original survey or paper, official documentation, the court ruling. For each claim, record whether the article itself links a source for it.

Verdicts: supported (a reliable source confirms it as written), contradicted (a reliable source says otherwise, or the article misstates its own source), unsupported (you found no support; it may still be true), unverifiable (private experience that can't be checked). Leave out pure opinion and facts that are common knowledge for the article's audience. Ignore style.

Copy each quote exactly from the article. Write summary, explanation and suggested_fix in the article's language. When you have checked everything, call submit_report once with all findings.`;

export function buildUserMessage({ article, profile, today }) {
  const facts = {
    name: profile.name,
    persona: profile.persona,
    ...(profile.facts ?? {}),
    ...(profile.lancers && { lancers: profile.lancers }),
    ...(profile.certifications && { certifications: profile.certifications }),
    ...(profile.cases && {
      cases: profile.cases.map(({ title, period, role, result, stack }) => ({ title, period, role, result, stack })),
    }),
  };
  return [
    `Today is ${today}.`,
    `Platform: ${article.platform}. Title: ${article.data.title ?? "(none)"}`,
    `Author profile (ground truth for self_claim):\n${JSON.stringify(facts, null, 2)}`,
    `<article>\n${article.content.replace(/<!--[\s\S]*?-->/g, "").trim()}\n</article>`,
  ].join("\n\n");
}

/**
 * After a mid-output fallback, only text blocks and paired server-tool blocks
 * from before the last `fallback` block may be echoed back (see Claude API docs).
 */
export function echoableContent(content) {
  const lastFallback = content.findLastIndex((b) => b.type === "fallback");
  if (lastFallback < 0) return content;
  const before = content.slice(0, lastFallback);
  const resultIds = new Set(before.filter((b) => b.tool_use_id && b.type.endsWith("_tool_result")).map((b) => b.tool_use_id));
  const kept = before.filter(
    (b) =>
      b.type === "text" ||
      (b.type === "server_tool_use" && resultIds.has(b.id)) ||
      (b.type.endsWith("_tool_result") && b.type !== "tool_result" && resultIds.has(b.tool_use_id)),
  );
  return [...kept, ...content.slice(lastFallback)];
}

export class FactcheckError extends Error {}

function readReport(block) {
  let input;
  try {
    input = block.input; // lazily parsed from streamed JSON; may throw
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return { ok: false, why: `unparseable JSON (${err.message})` };
  }
  const parsed = ReportSchema.safeParse(input);
  return parsed.success ? { ok: true, report: parsed.data } : { ok: false, why: parsed.error.message };
}

/**
 * Run the fact-check loop for one article.
 * Returns { report, usage, model, fallback }.
 */
export async function factcheck({ client, article, profile, today = new Date().toISOString().slice(0, 10), log = () => {} }) {
  const messages = [{ role: "user", content: buildUserMessage({ article, profile, today }) }];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, web_search_requests: 0 };
  let badReports = 0;
  let nudged = false;
  let servedBy = MODEL;
  let fallback = false;

  for (let request = 1; request <= MAX_REQUESTS; request++) {
    let msg;
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }, REPORT_TOOL],
        tool_choice: { type: "auto" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages,
      });
      msg = await stream.finalMessage();
    } catch (err) {
      // The SDK parses streamed tool input with JSON.parse, so unparseable input
      // is a SyntaxError. Anything else (auth, rate limit, network) propagates.
      if (!(err instanceof SyntaxError)) throw err;
      if (++badReports > 2) throw new FactcheckError(`report could not be parsed: ${err.message}`);
      log(`  report JSON broke mid-stream (${err.message}); retrying`);
      continue;
    }

    usage.input_tokens += msg.usage?.input_tokens ?? 0;
    usage.output_tokens += msg.usage?.output_tokens ?? 0;
    usage.cache_read_input_tokens += msg.usage?.cache_read_input_tokens ?? 0;
    usage.web_search_requests += msg.usage?.server_tool_use?.web_search_requests ?? 0;
    servedBy = msg.model ?? servedBy;
    if ((msg.usage?.iterations ?? []).some((it) => it.type === "fallback_message")) fallback = true;

    if (msg.stop_reason === "refusal") {
      const category = msg.stop_details?.category ?? "unspecified";
      throw new FactcheckError(`Claude declined to check this article (category: ${category})`);
    }
    if (msg.stop_reason === "max_tokens") throw new FactcheckError("response hit max_tokens before the report was complete");

    const call = msg.content.find((b) => b.type === "tool_use" && b.name === "submit_report");
    if (call) {
      const result = readReport(call);
      if (result.ok) return { report: result.report, usage, model: servedBy, fallback };
      // Don't echo a broken tool call back (that would edit the model's turn); ask again.
      if (++badReports > 2) throw new FactcheckError(`invalid report: ${result.why}`);
      log(`  invalid report (${result.why}); retrying`);
      continue;
    }

    if (msg.stop_reason === "pause_turn") {
      // Server-side search loop paused; resend so it resumes where it stopped.
      messages.push({ role: "assistant", content: echoableContent(msg.content) });
      continue;
    }

    if (nudged) throw new FactcheckError("Claude finished without submitting a report");
    nudged = true;
    messages.push({ role: "assistant", content: echoableContent(msg.content) });
    messages.push({ role: "user", content: "Call submit_report now with everything you found." });
  }
  throw new FactcheckError(`no report after ${MAX_REQUESTS} requests`);
}

// ---- Severity and rendering -------------------------------------------------

export function severity(f) {
  if (f.verdict === "contradicted") return "error";
  if (f.claim_type === "title_overclaim" && f.verdict !== "supported") return "error";
  if (["statistic", "study_or_survey"].includes(f.claim_type) && !f.source_in_article) return "error";
  if (f.verdict === "supported") return "ok";
  return "warning";
}

const ICON = { error: "🔴", warning: "🟡", ok: "🟢" };
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ");

export function renderReport({ file, title, result, error }) {
  const lines = [`### ${title ? esc(title) : file}`, "", `\`${file}\``, ""];
  if (error) {
    lines.push(`⚠️ Fact-check failed: ${error}`, "");
    return { markdown: lines.join("\n"), errors: 1, warnings: 0 };
  }
  const { report, usage, model, fallback } = result;
  const rows = report.findings.map((f) => ({ ...f, level: severity(f) }));
  const count = (l) => rows.filter((r) => r.level === l).length;
  const errors = count("error");
  const warnings = count("warning");
  lines.push(
    `**${ICON.error} ${errors} to fix · ${ICON.warning} ${warnings} to check · ${ICON.ok} ${count("ok")} verified**`,
    "",
    report.summary,
    "",
  );
  const order = { error: 0, warning: 1, ok: 2 };
  const shown = rows.filter((r) => r.level !== "ok").sort((a, b) => order[a.level] - order[b.level]);
  for (const r of shown) {
    const src = r.source_in_article ? "source linked in article" : "**no source in article**";
    lines.push(
      `- ${ICON[r.level]} **${r.claim_type} · ${r.verdict}** · ${src}`,
      `  - Claim: 「${esc(r.quote)}」`,
      `  - Why: ${esc(r.explanation)}`,
    );
    if (r.suggested_fix) lines.push(`  - **Fix:** ${esc(r.suggested_fix)}`);
    if (r.evidence_url) lines.push(`  - Evidence: ${r.evidence_url}`);
  }
  if (shown.length) lines.push("");
  const ok = rows.filter((r) => r.level === "ok");
  if (ok.length) {
    lines.push(`<details><summary>${ok.length} verified claim(s)</summary>`, "");
    for (const r of ok) lines.push(`- ${esc(r.quote)}${r.evidence_url ? ` — ${r.evidence_url}` : ""}`);
    lines.push("", "</details>", "");
  }
  if (usage)
    lines.push(
      `<sub>${model}${fallback ? " (fallback model served part of this run)" : ""} · ${usage.web_search_requests} searches · ${usage.input_tokens.toLocaleString()} in / ${usage.output_tokens.toLocaleString()} out tokens</sub>`,
      "",
    );
  return { markdown: lines.join("\n"), errors, warnings };
}
