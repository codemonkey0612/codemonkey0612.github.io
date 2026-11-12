// Entry for the Cloudflare Worker: the Claude client and the model settings; the rest is in
// handler.mjs (requests, limits, streaming) and core.mjs (retrieval, prompt, citations).
// Secret: ANTHROPIC_API_KEY (`wrangler secret put ANTHROPIC_API_KEY`), never committed.
import Anthropic from "@anthropic-ai/sdk";
import { handle } from "./handler.mjs";

let client = null;

export default {
  fetch(request, env, ctx) {
    if (!client && env.ANTHROPIC_API_KEY) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
    return handle(request, env, {
      client,
      waitUntil: (p) => ctx.waitUntil(p),
      params: {
        model: env.MODEL || "claude-opus-5-5",
        // Short answers; the cap also bounds what one question can cost.
        max_tokens: 2048,
        // Thinking stays adaptive (always on for this model); low effort keeps replies quick.
        output_config: { effort: env.EFFORT || "low" },
        // If the model declines on a safety classifier, the API retries on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
    });
  },
};
