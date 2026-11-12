// The chat endpoint: POST { messages } from the site → Server-Sent Events:
//   delta { t }                       text as it is written
//   done  { blocks, sources, limited } the final answer with its citations
//   error { message }                 something went wrong (said in Japanese)
// The Claude client comes in through `deps.client`, so tests run without the SDK.
import { buildMessages, failureText, makeIndex, search, shapeAnswer, sse, SYSTEM, validate } from "./core.mjs";

export const RATE = { perVisitor: 15, windowSec: 600, perDay: 300 };
const KB_TTL_MS = 10 * 60 * 1000;
let kbCache = null; // { at, index } per Worker instance

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const allowedOrigins = (env) =>
  String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

/** The site's knowledge base (assets/kb.json), indexed and kept for ten minutes. */
export async function knowledge(env, doFetch = fetch) {
  if (kbCache && Date.now() - kbCache.at < KB_TTL_MS) return kbCache.index;
  const res = await doFetch(env.KB_URL, { cf: { cacheTtl: 600 } });
  if (!res.ok) throw new Error(`knowledge base: HTTP ${res.status}`);
  kbCache = { at: Date.now(), index: makeIndex(await res.json()) };
  return kbCache.index;
}
export const resetKnowledge = () => {
  kbCache = null;
};

export async function handle(request, env = {}, deps = {}) {
  const origin = (request.headers.get("Origin") ?? "").replace(/\/$/, "");
  const okOrigin = origin !== "" && allowedOrigins(env).includes(origin);
  const cors = okOrigin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors } });

  if (request.method === "OPTIONS") {
    if (!okOrigin) return new Response(null, { status: 403, headers: cors });
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method !== "POST") return json(405, { error: "POST only" });
  if (!okOrigin) return json(403, { error: "このサイトからのみ使えます。" });
  if (!deps.client) return json(503, { error: "ただいま準備中です。" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "送信内容を読み取れませんでした。" });
  }
  const req = validate(body);
  if (req.error) return json(400, { error: req.error });

  // Limits: per visitor (hashed IP, ten minutes) and for the whole site per day.
  const kv = env.CHAT_KV;
  if (kv) {
    const ip = (await sha256(`${env.IP_SALT ?? "takumi-chat"}:${request.headers.get("CF-Connecting-IP") ?? ""}`)).slice(0, 32);
    const day = new Date().toISOString().slice(0, 10);
    const [mine, today] = await Promise.all([kv.get(`rl:${ip}`), kv.get(`day:${day}`)]);
    if (Number(today ?? 0) >= Number(env.DAILY_CAP ?? RATE.perDay)) return json(429, { error: "本日の受付数の上限に達しました。ご相談はランサーズからお送りください。" });
    if (Number(mine ?? 0) >= RATE.perVisitor) return json(429, { error: "短い時間に多くの質問をいただきました。10分ほどおいて、お試しください。" });
    await Promise.all([kv.put(`rl:${ip}`, String(Number(mine ?? 0) + 1), { expirationTtl: RATE.windowSec }), kv.put(`day:${day}`, String(Number(today ?? 0) + 1), { expirationTtl: 2 * 24 * 60 * 60 })]);
  }

  let docs;
  try {
    const index = await knowledge(env, deps.fetch ?? fetch);
    const previous = [...req.history].reverse().find((m) => m.role === "user")?.content ?? "";
    docs = search(index, req.question, { previous });
  } catch {
    return json(503, { error: "サイトの情報を読み込めませんでした。少し時間をおいて、お試しください。" });
  }

  const params = {
    ...(deps.params ?? {}),
    system: [{ type: "text", text: SYSTEM }],
    messages: buildMessages(req, docs, env.SITE_URL ?? "https://shanaiai.com/"),
  };
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event, data) => writer.write(enc.encode(sse(event, data)));
  const run = (async () => {
    try {
      const stream = deps.client.beta.messages.stream(params);
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") await send("delta", { t: ev.delta.text });
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        await send("done", { blocks: [{ text: "この質問にはお答えできません。サイトの内容についての質問をどうぞ。", cites: [] }], sources: [] });
      } else {
        const answer = shapeAnswer(final.content);
        if (final.stop_reason === "max_tokens") answer.blocks.push({ text: "…（長くなるため、ここまでにします）", cites: [] });
        await send("done", answer);
      }
    } catch (err) {
      await send("error", { message: failureText(Number(err?.status) || 0) });
    } finally {
      await writer.close();
    }
  })();
  deps.waitUntil?.(run);
  return new Response(readable, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", ...cors } });
}
