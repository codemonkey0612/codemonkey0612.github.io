// Inquiry form endpoint (Cloudflare Worker). POST JSON (from site/assets/contact.js) or a
// form-encoded POST (the no-JavaScript fallback). Sends one email per inquiry: over SMTP through
// your own mailbox when SMTP_* is set (Hostinger: smtp.hostinger.com:465), otherwise through Resend.
//
// Bindings (see wrangler.toml and README.md):
//   vars     ALLOWED_ORIGINS  comma-separated site origins allowed to post
//            SMTP_HOST, SMTP_PORT  your mail server (465 = TLS, otherwise STARTTLS)
//   secrets  CONTACT_TO (your inbox), CONTACT_FROM (the sender: with SMTP, the mailbox you log in as),
//            SMTP_USER + SMTP_PASS (mailbox login) or RESEND_API_KEY, optional IP_SALT
//   KV       CONTACT_KV       rate-limit counters (hashed IP, 10 min) and idempotency (24 h)
// The addresses and the password exist only in these secrets: never in the site or this file.
import { LIMITS, buildEmail, makeRef, parseBody, validate } from "./core.mjs";
import { SmtpError, sendSmtp } from "./smtp.mjs";

export const RATE = { max: 5, windowSec: 600 };
const IDEM_TTL = 24 * 60 * 60;
const PENDING_TTL = 120;
const PROVIDER_TIMEOUT_MS = 10_000;

export default {
  fetch: (request, env) => handle(request, env),
};

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const allowedOrigins = (env) =>
  String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Small Japanese result page for the no-JavaScript form post. */
function page(status, title, lines, back, cors) {
  const body = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.8 "Noto Sans JP",system-ui,sans-serif;background:#f6f7fb;color:#0f1d2e}main{max-width:560px;margin:12vh auto;padding:32px 24px;background:#fff;border:1px solid rgba(15,29,46,.12);border-radius:14px}h1{font:600 24px/1.4 "Shippori Mincho",serif;margin:0 0 12px}a{color:#8a6418}</style></head>
<body><main><h1>${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}${back ? `<p><a href="${esc(back)}">お問い合わせページへ戻る</a></p>` : ""}</main></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...cors } });
}

/** The request handler. `deps.fetch` is replaceable for tests. */
export async function handle(request, env = {}, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const origin = (request.headers.get("Origin") ?? "").replace(/\/$/, "");
  const okOrigin = origin !== "" && allowedOrigins(env).includes(origin);
  const cors = okOrigin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  const isForm = (request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
  const back = okOrigin ? `${origin}/contact/` : null;

  const json = (status, obj, extra = {}) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors, ...extra } });
  // One reply shape per outcome, as JSON (script) or a small page (no-JS form post).
  const reply = (status, obj, { title, lines }, extra = {}) => (isForm ? page(status, title, lines, back, { ...cors, ...extra }) : json(status, obj, extra));
  const failed = (status, error, lines, extra) => reply(status, { ok: false, error }, { title: "送信できませんでした", lines }, extra);

  if (request.method === "OPTIONS") {
    if (!okOrigin) return new Response(null, { status: 403, headers: cors });
    return new Response(null, {
      status: 204,
      headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
    });
  }
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });
  if (!okOrigin) return json(403, { ok: false, error: "forbidden_origin" });

  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > LIMITS.body) return failed(413, "too_large", ["送信内容が長すぎます。ご相談内容を短くして、もう一度お試しください。"]);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > LIMITS.body) return failed(413, "too_large", ["送信内容が長すぎます。ご相談内容を短くして、もう一度お試しください。"]);

  let raw;
  try {
    raw = parseBody(new TextDecoder().decode(buf), request.headers.get("Content-Type") ?? "");
  } catch {
    return failed(400, "bad_request", ["送信内容を読み取れませんでした。もう一度お試しください。"]);
  }
  const v = validate(raw);
  if (!v.ok) {
    return reply(400, { ok: false, error: "invalid", fields: v.errors }, {
      title: "入力内容を確認してください",
      lines: ["未入力の項目や、形式が正しくない項目があります。戻って入力内容をご確認ください。"],
    });
  }
  const done = (ref) => reply(200, { ok: true, ref }, { title: "送信しました", lines: ["お問い合わせを受け付けました。内容を確認のうえ、ご入力いただいたメールアドレスにご連絡します。", `受付番号：${ref}`] });
  if (v.spam) return done(makeRef()); // honeypot filled: look normal, send nothing

  const kv = env.CONTACT_KV;
  const useSmtp = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  if (!kv || !(useSmtp || env.RESEND_API_KEY) || !env.CONTACT_TO || !env.CONTACT_FROM) {
    return failed(503, "unavailable", ["現在、フォームから送信できません。時間をおいてお試しいただくか、Lancersからご相談ください。"]);
  }

  const ipHash = (await sha256(`${env.IP_SALT ?? "takumi-contact"}:${request.headers.get("CF-Connecting-IP") ?? ""}`)).slice(0, 32);
  const d = v.data;
  // Without a key from the script (no-JS post), the same content from the same visitor counts as a retry.
  const idemKey = `idem:${d.idempotency || `auto-${(await sha256(`${ipHash}|${d.email}|${d.message}`)).slice(0, 40)}`}`;

  const prior = await kv.get(idemKey);
  if (prior) {
    const p = JSON.parse(prior);
    if (p.status === "sent") return done(p.ref);
    return failed(409, "in_progress", ["前回の送信を処理しています。少し待ってから、もう一度お試しください。"]);
  }

  const rlKey = `rl:${ipHash}`;
  const count = Number((await kv.get(rlKey)) ?? 0);
  if (count >= RATE.max) {
    return failed(429, "rate_limited", ["短い時間に送信が続いたため、受け付けを一時的に止めています。10分ほど待ってから、もう一度お試しください。"], {
      "Retry-After": String(RATE.windowSec),
    });
  }
  await kv.put(rlKey, String(count + 1), { expirationTtl: RATE.windowSec });
  await kv.put(idemKey, JSON.stringify({ status: "pending" }), { expirationTtl: PENDING_TTL });

  const ref = makeRef();
  const mail = buildEmail(d, { from: env.CONTACT_FROM, to: env.CONTACT_TO, ref });
  const timeoutMs = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  // "sent" or a refusal status; throws when the provider can't be reached in time.
  const send = async () => {
    if (useSmtp) {
      const connect = deps.connect ?? (await import("cloudflare:sockets")).connect;
      try {
        await sendSmtp(mail, { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS }, { connect, timeoutMs, messageId: ref });
      } catch (err) {
        if (err instanceof SmtpError) return `smtp ${err.step} ${err.code}`;
        throw err;
      }
      return "sent";
    }
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idemKey.slice(5) },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? "sent" : `resend ${res.status}`;
  };
  let outcome;
  try {
    outcome = await send();
  } catch (err) {
    await kv.delete(idemKey);
    // Network errors only (refusals are handled above): their message never contains the password.
    console.error("contact: mail provider unreachable", err?.name ?? "error", String(err?.message ?? "").slice(0, 200));
    return failed(504, "timeout", ["送信を確認できませんでした。時間をおいてもう一度お試しいただくか、Lancersからご相談ください。"]);
  }
  if (outcome !== "sent") {
    await kv.delete(idemKey);
    console.error("contact: mail provider refused", outcome); // never pass its message to the visitor
    return failed(502, "send_failed", ["送信できませんでした。時間をおいてもう一度お試しいただくか、Lancersからご相談ください。"]);
  }
  await kv.put(idemKey, JSON.stringify({ status: "sent", ref }), { expirationTtl: IDEM_TTL });
  return done(ref);
}
