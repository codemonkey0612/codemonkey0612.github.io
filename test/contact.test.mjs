import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEmail, LIMITS, makeRef, oneLine, parseBody, validate } from "../contact/src/core.mjs";
import { handle, RATE } from "../contact/src/worker.mjs";
import { buildMessage, dotStuff, encodeHeader, sendSmtp, SmtpError } from "../contact/src/smtp.mjs";
import { PRIVACY_HTML, renderInquiryForm } from "../scripts/lib/contact-form.mjs";

const good = () => ({
  name: "山田 太郎",
  company: "株式会社サンプル",
  email: "taro@example.test",
  category: "ai",
  budget: "10〜30万円",
  schedule: "1〜3か月",
  message: "社内文書を検索できるチャットボットを検討しています。",
  consent: true,
  context: "サービス：AIチャットボット",
  website: "",
  idempotency: "abcd1234-0000-4000-8000-000000000001",
});

// ---------- core ----------

test("a complete submission validates", () => {
  const v = validate(good());
  assert.equal(v.ok, true);
  assert.equal(v.spam, false);
  assert.equal(v.data.email, "taro@example.test");
  assert.equal(v.data.idempotency, "abcd1234-0000-4000-8000-000000000001");
});

test("missing, short, long and malformed fields are reported", () => {
  const v = validate({ ...good(), name: " ", email: "", category: "", message: "", consent: false });
  assert.deepEqual(v, { ok: false, errors: { name: "required", email: "required", category: "required", message: "required", consent: "required" } });
  const w = validate({
    ...good(),
    name: "あ".repeat(LIMITS.name + 1),
    company: "x".repeat(LIMITS.company + 1),
    email: "not-an-address",
    category: "hack",
    budget: "1億円",
    schedule: "明日",
    message: "短い",
  });
  assert.deepEqual(w.errors, { name: "too_long", company: "too_long", email: "invalid", category: "invalid", budget: "invalid", schedule: "invalid", message: "too_short" });
  assert.equal(validate({ ...good(), message: "あ".repeat(LIMITS.message + 1) }).errors.message, "too_long");
  assert.equal(validate({ ...good(), message: "あ".repeat(LIMITS.message) }).ok, true, "4000 characters (not bytes) is allowed");
  assert.equal(validate({ ...good(), consent: "on" }).ok, true, "form-encoded consent");
});

test("nothing a visitor types can add a mail header", () => {
  assert.equal(validate({ ...good(), email: "taro@example.test\r\nBcc: other@example.test" }).errors.email, "invalid");
  const v = validate({ ...good(), name: "Taro\r\nBcc: other@example.test", context: "a\nb" });
  assert.equal(v.ok, true);
  assert.doesNotMatch(v.data.name, /[\r\n]/);
  const mail = buildEmail(v.data, { from: "Form <form@example.test>\r\nX: y", to: "owner@example.test", ref: "TK-ABCDEF" });
  for (const h of [mail.subject, mail.from, mail.reply_to, ...mail.to]) assert.doesNotMatch(h, /[\r\n]/, h);
  assert.equal(oneLine("a\u2028b\u0000c"), "a b c");
});

test("a filled honeypot is treated as spam", () => {
  const v = validate({ ...good(), website: "http://spam.example" });
  assert.equal(v.ok, true);
  assert.equal(v.spam, true);
});

test("bodies: JSON or form-encoded only", () => {
  assert.equal(parseBody('{"name":"a"}', "application/json; charset=utf-8").name, "a");
  assert.equal(parseBody("name=%E5%B1%B1%E7%94%B0&consent=on", "application/x-www-form-urlencoded").name, "山田");
  assert.throws(() => parseBody("[1]", "application/json"));
  assert.throws(() => parseBody("{", "application/json"));
  assert.throws(() => parseBody("x", "text/plain"));
});

test("the email replies to the visitor and carries the reference", () => {
  const v = validate(good());
  const mail = buildEmail(v.data, { from: "Form <form@example.test>", to: "owner@example.test", ref: "TK-ABCDEF", receivedAt: new Date("2026-11-10T03:00:00Z") });
  assert.equal(mail.reply_to, "taro@example.test");
  assert.deepEqual(mail.to, ["owner@example.test"]);
  assert.match(mail.subject, /^【お問い合わせ】AI 山田 太郎様（TK-ABCDEF）$/);
  assert.match(mail.text, /受付日時：2026\/11\/10 12:00（日本時間）/);
  assert.match(mail.text, /ご相談の対象：サービス：AIチャットボット/);
  assert.match(makeRef(), /^TK-[A-HJ-NP-Z2-9]{6}$/);
});

// ---------- worker ----------

const ORIGIN = "https://site.example";
function kv() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}
const env = (over = {}) => ({ ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:4321`, RESEND_API_KEY: "re_test", CONTACT_TO: "owner@example.test", CONTACT_FROM: "Form <form@example.test>", CONTACT_KV: kv(), ...over });
function mailer(respond = () => new Response('{"id":"x"}', { status: 200 })) {
  const calls = [];
  return { calls, fetch: async (url, init) => (calls.push({ url, init, body: JSON.parse(init.body) }), respond(url, init)) };
}
const post = (body, { origin = ORIGIN, ip = "203.0.113.5", type = "application/json" } = {}) =>
  new Request("https://worker.example/", {
    method: "POST",
    headers: { "Content-Type": type, ...(origin && { Origin: origin }), "CF-Connecting-IP": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("only the site's origin may post", async () => {
  const m = mailer();
  for (const origin of ["https://evil.example", null]) {
    const res = await handle(post(good(), { origin }), env(), m);
    assert.equal(res.status, 403);
  }
  assert.equal(m.calls.length, 0);
  const pre = await handle(new Request("https://worker.example/", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await handle(new Request("https://worker.example/", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env())).status, 403);
  assert.equal((await handle(new Request("https://worker.example/", { method: "GET", headers: { Origin: ORIGIN } }), env())).status, 405);
});

test("a valid inquiry is sent once, through Resend, and returns a reference", async () => {
  const m = mailer();
  const res = await handle(post(good()), env(), m);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.ref, /^TK-[A-Z0-9]{6}$/);
  assert.equal(m.calls.length, 1);
  const call = m.calls[0];
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.init.headers.Authorization, "Bearer re_test");
  assert.equal(call.body.reply_to, "taro@example.test");
  assert.deepEqual(call.body.to, ["owner@example.test"]);
  assert.match(call.body.subject, new RegExp(body.ref));
});

test("a retry with the same key returns the same reference without a second email", async () => {
  const m = mailer();
  const e = env();
  const a = await (await handle(post(good()), e, m)).json();
  const b = await (await handle(post(good()), e, m)).json();
  assert.equal(a.ref, b.ref);
  assert.equal(m.calls.length, 1);
  // A no-JS post (no key) twice with the same content is also sent once.
  const form = new URLSearchParams({ ...good(), idempotency: "", consent: "on" }).toString();
  const r1 = await handle(post(form, { type: "application/x-www-form-urlencoded" }), e, m);
  const r2 = await handle(post(form, { type: "application/x-www-form-urlencoded" }), e, m);
  assert.equal(r1.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await r1.text(), /送信しました/);
  assert.equal(r2.status, 200);
  assert.equal(m.calls.length, 2);
});

test("too many posts from one visitor get 429", async () => {
  const m = mailer();
  const e = env();
  for (let i = 0; i < RATE.max; i++) {
    const res = await handle(post({ ...good(), idempotency: `key-number-${i}` }), e, m);
    assert.equal(res.status, 200, `post ${i + 1}`);
  }
  const res = await handle(post({ ...good(), idempotency: "key-number-x" }), e, m);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), String(RATE.windowSec));
  assert.equal((await res.json()).error, "rate_limited");
  assert.equal(m.calls.length, RATE.max);
  const other = await handle(post({ ...good(), idempotency: "key-number-y" }, { ip: "198.51.100.7" }), e, m);
  assert.equal(other.status, 200, "another visitor is not affected");
  for (const k of e.CONTACT_KV.m.keys()) assert.doesNotMatch(k, /203\.0\.113\.5/, "IPs are stored hashed");
});

test("a provider failure is reported neutrally and can be retried", async () => {
  const e = env();
  const bad = mailer(() => new Response('{"message":"secret internal detail from provider"}', { status: 500 }));
  const res = await handle(post(good()), e, bad);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.doesNotMatch(text, /secret|provider|resend/i);
  assert.equal(JSON.parse(text).ok, false);
  const ok = mailer();
  const retry = await handle(post(good()), e, ok);
  assert.equal(retry.status, 200, "the same key can be retried after a failure");
  assert.equal(ok.calls.length, 1);
  const slow = mailer(() => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
  const t = await handle(post({ ...good(), idempotency: "timeout-key-1" }), env(), slow);
  assert.equal(t.status, 504);
});

test("spam, bad input, oversize bodies and missing configuration never send", async () => {
  const m = mailer();
  const spam = await handle(post({ ...good(), website: "http://spam.example" }), env(), m);
  assert.equal(spam.status, 200);
  assert.equal((await spam.json()).ok, true);
  const invalid = await handle(post({ ...good(), email: "nope" }), env(), m);
  assert.equal(invalid.status, 400);
  assert.deepEqual((await invalid.json()).fields, { email: "invalid" });
  assert.equal((await handle(post("{", {}), env(), m)).status, 400);
  assert.equal((await handle(post({ ...good(), message: "あ".repeat(6000) }), env(), m)).status, 413);
  const unset = await handle(post(good()), env({ CONTACT_TO: "" }), m);
  assert.equal(unset.status, 503);
  assert.equal(m.calls.length, 0);
});

// ---------- SMTP (your own mailbox) ----------

/** A pretend mail server speaking SMTP over the same socket shape as cloudflare:sockets. */
function smtpServer({ auth = "AUTH PLAIN LOGIN", refuse = {}, silent = false } = {}) {
  const dec = new TextDecoder();
  const srv = { log: [], data: null, opened: null, closed: false, tls: false };
  let ctrl;
  let buf = "";
  let mode = "cmd";
  const say = (line) => ctrl.enqueue(new TextEncoder().encode(`${line}\r\n`));
  const answer = (line) => {
    srv.log.push(line);
    if (mode === "user") return (mode = "pass"), say("334 UGFzc3dvcmQ6");
    if (mode === "pass") return (mode = "cmd"), say(refuse.AUTH ?? "235 ok");
    const verb = line.split(/[ :]/)[0].toUpperCase();
    if (refuse[verb] && !(verb === "AUTH" && line === "AUTH LOGIN")) return say(refuse[verb]);
    if (verb === "EHLO") return say("250-smtp.test"), say(`250-${auth}`), say("250 SIZE 1000000");
    if (verb === "AUTH") return line === "AUTH LOGIN" ? ((mode = "user"), say("334 VXNlcm5hbWU6")) : say("235 ok");
    if (verb === "STARTTLS") return (srv.tls = true), say("220 go ahead");
    if (verb === "DATA") return (mode = "data"), say("354 end with .");
    if (verb === "QUIT") return say("221 bye");
    return say("250 ok");
  };
  const socket = {
    readable: new ReadableStream({ start: (c) => void (ctrl = c) }),
    writable: new WritableStream({
      write(chunk) {
        buf += dec.decode(chunk);
        for (;;) {
          if (mode === "data") {
            const end = buf.indexOf("\r\n.\r\n");
            if (end < 0) return;
            srv.data = buf.slice(0, end);
            buf = buf.slice(end + 5);
            mode = "cmd";
            say(refuse.DOT ?? "250 queued");
            continue;
          }
          const i = buf.indexOf("\r\n");
          if (i < 0) return;
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          answer(line);
        }
      },
    }),
    close: async () => void (srv.closed = true),
    startTls: () => socket,
  };
  srv.connect = (addr, opts) => {
    srv.opened = { ...addr, ...opts };
    if (!silent) say("220 smtp.test ESMTP");
    return socket;
  };
  return srv;
}

const unB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
// Unfold (CRLF goes, the space stays), drop the space between two encoded words (RFC 2047), decode.
const unHeader = (v) =>
  v
    .replace(/\r\n(?= )/g, "")
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => unB64(b));
const SMTP = { host: "smtp.test", port: 465, user: "me@site.test", pass: "pa55-wörd" };
const MAIL = { from: "匠 お問い合わせフォーム <me@site.test>", to: ["me@site.test"], reply_to: "taro@example.test", subject: "【お問い合わせ】AI 山田 太郎様（TK-ABCDEF）", text: "一行目\n.先頭がドット\n" + "長い本文。".repeat(200) };

test("SMTP: logs in over TLS, sends one message, and says goodbye", async () => {
  const srv = smtpServer();
  await sendSmtp(MAIL, SMTP, { connect: srv.connect, messageId: "TK-ABCDEF" });
  assert.deepEqual(srv.opened, { hostname: "smtp.test", port: 465, secureTransport: "on", allowHalfOpen: false });
  assert.deepEqual(srv.log.map((l) => l.split(" ")[0]), ["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
  assert.equal(unB64(srv.log[1].split(" ")[2]), "\0me@site.test\0pa55-wörd");
  assert.equal(srv.log[2], "MAIL FROM:<me@site.test>");
  assert.equal(srv.log[3], "RCPT TO:<me@site.test>");
  assert.ok(srv.closed);
  const [head, body] = srv.data.split("\r\n\r\n");
  const h = Object.fromEntries(head.split(/\r\n(?! )/).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
  assert.equal(unHeader(h.Subject), MAIL.subject);
  assert.equal(unHeader(h.From), "匠 お問い合わせフォーム <me@site.test>");
  assert.equal(h["Reply-To"], "taro@example.test");
  assert.equal(h["Message-ID"], "<TK-ABCDEF@site.test>");
  assert.equal(h["Content-Transfer-Encoding"], "base64");
  for (const line of head.split("\r\n")) assert.ok(line.length <= 78, `header line too long: ${line}`);
  assert.equal(unB64(body.replace(/\r\n/g, "")), MAIL.text.replace(/\n/g, "\r\n"));
});

test("SMTP: AUTH LOGIN when PLAIN isn't offered, STARTTLS on port 587", async () => {
  const srv = smtpServer({ auth: "AUTH LOGIN" });
  await sendSmtp(MAIL, { ...SMTP, port: 587 }, { connect: srv.connect });
  assert.equal(srv.opened.secureTransport, "starttls");
  assert.ok(srv.tls);
  assert.deepEqual(srv.log.slice(0, 6).map((l) => l.split(" ")[0]), ["EHLO", "STARTTLS", "EHLO", "AUTH", srv.log[4], srv.log[5]]);
  assert.equal(unB64(srv.log[4]), "me@site.test");
  assert.equal(unB64(srv.log[5]), "pa55-wörd");
});

test("SMTP: a wrong password is a refusal that never repeats the password", async () => {
  const srv = smtpServer({ refuse: { AUTH: "535 5.7.8 authentication failed" } });
  await assert.rejects(sendSmtp(MAIL, SMTP, { connect: srv.connect }), (err) => {
    assert.ok(err instanceof SmtpError);
    assert.equal(err.step, "AUTH");
    assert.equal(err.code, 535);
    assert.doesNotMatch(err.message, /pa55/);
    return true;
  });
  assert.equal(srv.data, null);
  assert.ok(srv.closed);
});

test("SMTP: header values can't add headers, and dots are stuffed", () => {
  assert.doesNotMatch(encodeHeader("a\r\nBcc: x@y.test"), /\r\nBcc/);
  assert.throws(() => buildMessage({ ...MAIL, from: "x <me@site.test>\r\nBcc: x@y.test" }));
  assert.throws(() => buildMessage({ ...MAIL, reply_to: "a@b.test>\r\nBcc: <x@y.test" }));
  assert.equal(dotStuff(".a\r\nb\r\n.c"), "..a\r\nb\r\n..c");
});

const smtpEnv = (over = {}) => env({ RESEND_API_KEY: "", SMTP_HOST: "smtp.test", SMTP_PORT: "465", SMTP_USER: "me@site.test", SMTP_PASS: "pa55-wörd", CONTACT_TO: "me@site.test", CONTACT_FROM: "匠 お問い合わせフォーム <me@site.test>", ...over });

test("worker: with SMTP settings, an inquiry goes through the mailbox and returns a reference", async () => {
  const srv = smtpServer();
  const m = mailer();
  const res = await handle(post(good()), smtpEnv(), { ...m, connect: srv.connect });
  assert.equal(res.status, 200);
  const { ok, ref } = await res.json();
  assert.equal(ok, true);
  assert.equal(m.calls.length, 0, "Resend is not used");
  assert.match(unHeader(srv.data.match(/^Subject: (.*(?:\r\n .*)*)/m)[1]), new RegExp(`山田 太郎様（${ref}）`));
  assert.match(srv.data, /^Reply-To: taro@example\.test$/m);
});

test("worker: a refused or unreachable mailbox is reported neutrally and can be retried", async () => {
  const e = smtpEnv();
  const refused = await handle(post(good()), e, { connect: smtpServer({ refuse: { AUTH: "535 nope" } }).connect });
  assert.equal(refused.status, 502);
  assert.doesNotMatch(await refused.text(), /535|smtp|pa55/i);
  const silent = await handle(post(good()), e, { connect: smtpServer({ silent: true }).connect, timeoutMs: 30 });
  assert.equal(silent.status, 504);
  const ok = await handle(post(good()), e, { connect: smtpServer().connect });
  assert.equal(ok.status, 200, "the same key works after failures");
});

// ---------- the form ----------

test("the form never shows an email address or a mailto link", () => {
  const services = [{ id: "ai-chatbot", name: "AIチャットボット", pillar: "AI" }];
  const works = [{ id: "a-worker", name: "A-worker", service: { pillar: "システム開発" } }, { id: "stress-ai", headline: "AI機能の追加", service: { pillar: "AI" } }];
  for (const endpoint of ["", "https://takumi-contact.example.workers.dev"]) {
    const html = renderInquiryForm({ endpoint, lancersUrl: "https://www.lancers.jp/profile/navi_work/contact_light", services, works, base: "../" });
    assert.doesNotMatch(html, /mailto:/i);
    assert.doesNotMatch(html, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "no email address");
    assert.match(html, /id="inquiry"/);
    assert.match(html, new RegExp(`data-endpoint="${endpoint.replace(/[.]/g, "\\.")}"`));
    if (endpoint) assert.match(html, new RegExp(`action="${endpoint.replace(/[.]/g, "\\.")}" method="post"`));
    else assert.doesNotMatch(html, /<form[^>]*\saction=/);
    for (const name of ["name", "company", "email", "category", "budget", "schedule", "message", "consent", "website", "context"]) assert.match(html, new RegExp(`name="${name}"`), name);
    assert.match(html, /"ai-chatbot":\{"name":"AIチャットボット","cat":"ai"\}/);
    assert.match(html, /"a-worker":\{"name":"A-worker","cat":"system"\}/);
    assert.match(html, /<dialog class="privacy" id="privacy"/);
  }
  assert.doesNotMatch(PRIVACY_HTML, /@/);
});
