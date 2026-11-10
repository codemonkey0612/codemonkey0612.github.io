// One Claude task that ends with a "submit" tool call carrying a structured result: the
// fact-check report, the day's topic, the article itself. Claude may search the web first.
//
// Claude Opus 5.5 with adaptive thinking, streamed (long outputs), with automatic prompt
// caching: each resumed request re-sends the whole conversation (search results included),
// and the cached part is billed at a tenth of the input price. Opted into server-side
// refusal fallbacks ("default" routing), so a request declined by a safety classifier is
// retried on a suitable model inside the same call. Paused server-side searches are resumed;
// a broken or invalid submission is re-asked for without echoing it back.

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// USD per million tokens for Claude Opus 5.5 (input, output, cache read, cache write = 1.25× input).
export const PRICE = { input: 4, output: 20, cache_read: 0.2, cache_write: 5 };

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

export const emptyUsage = () => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 });
export function addUsage(total, u) {
  for (const k of Object.keys(emptyUsage())) total[k] += u?.[k] ?? 0;
  return total;
}
/** Token cost in USD (web search fees are billed separately per search). */
export const costUsd = (u) =>
  (u.input_tokens * PRICE.input +
    u.output_tokens * PRICE.output +
    u.cache_read_input_tokens * PRICE.cache_read +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cache_write) /
  1e6;

/**
 * Runs the task until Claude calls `submitTool`, then validates its input with `schema` (zod).
 * Returns { value, usage, model, fallback }. Throws `ErrorClass` with a readable message when
 * Claude declines, runs out of room, or never submits a valid result.
 *   task:  what Claude was asked to do, for messages ("check this article")
 *   what:  what it submits, for messages ("report")
 */
export async function runSubmitTask({
  client,
  system,
  user,
  submitTool,
  schema,
  effort = "high",
  maxSearches = 0,
  maxRequests = 8,
  task,
  what,
  ErrorClass = Error,
  log = () => {},
}) {
  const messages = [{ role: "user", content: user }];
  const usage = emptyUsage();
  const tools = [...(maxSearches > 0 ? [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }] : []), submitTool];
  let bad = 0;
  let nudged = false;
  let servedBy = MODEL;
  let fallback = false;

  for (let request = 1; request <= maxRequests; request++) {
    let msg;
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort },
        system,
        tools,
        tool_choice: { type: "auto" },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages,
      });
      msg = await stream.finalMessage();
    } catch (err) {
      // The SDK parses streamed tool input with JSON.parse, so unparseable input
      // is a SyntaxError. Anything else (auth, rate limit, network) propagates.
      if (!(err instanceof SyntaxError)) throw err;
      if (++bad > 2) throw new ErrorClass(`${what} could not be parsed: ${err.message}`);
      log(`  ${what} JSON broke mid-stream (${err.message}); retrying`);
      continue;
    }

    addUsage(usage, { ...msg.usage, web_search_requests: msg.usage?.server_tool_use?.web_search_requests ?? 0 });
    servedBy = msg.model ?? servedBy;
    if ((msg.usage?.iterations ?? []).some((it) => it.type === "fallback_message")) fallback = true;

    if (msg.stop_reason === "refusal") {
      const category = msg.stop_details?.category ?? "unspecified";
      throw new ErrorClass(`Claude declined to ${task} (category: ${category})`);
    }
    if (msg.stop_reason === "max_tokens") throw new ErrorClass(`response hit max_tokens before the ${what} was complete`);

    const call = msg.content.find((b) => b.type === "tool_use" && b.name === submitTool.name);
    if (call) {
      let input;
      try {
        input = call.input; // lazily parsed from streamed JSON; may throw
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        input = undefined;
      }
      const parsed = input === undefined ? { success: false, error: { message: "unparseable JSON" } } : schema.safeParse(input);
      if (parsed.success) return { value: parsed.data, usage, model: servedBy, fallback };
      const issues = input === undefined ? "the tool input was not valid JSON" : parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
      if (++bad > 2) throw new ErrorClass(`invalid ${what}: ${issues}`);
      log(`  invalid ${what} (${issues}); retrying`);
      // A call whose JSON didn't parse can't be sent back unedited, so ask again from scratch.
      if (input === undefined) continue;
      // Otherwise send the call back with what was wrong, so the next attempt fixes it instead of repeating it.
      messages.push({ role: "assistant", content: echoableContent(msg.content) });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Not accepted: ${issues}. Fix that and call ${submitTool.name} again with the complete ${what}.` }],
      });
      continue;
    }

    if (msg.stop_reason === "pause_turn") {
      // Server-side search loop paused; resend so it resumes where it stopped.
      messages.push({ role: "assistant", content: echoableContent(msg.content) });
      continue;
    }

    if (nudged) throw new ErrorClass(`Claude finished without submitting a ${what}`);
    nudged = true;
    messages.push({ role: "assistant", content: echoableContent(msg.content) });
    messages.push({ role: "user", content: `Call ${submitTool.name} now with everything you found.` });
  }
  throw new ErrorClass(`no ${what} after ${maxRequests} requests`);
}
