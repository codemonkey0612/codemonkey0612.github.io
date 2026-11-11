// Sends one plain-text email over SMTP from a Cloudflare Worker (TCP sockets, `cloudflare:sockets`).
// Implicit TLS on port 465 (Hostinger: smtp.hostinger.com:465), STARTTLS on any other port.
// Just what the inquiry form needs: AUTH PLAIN or LOGIN, one sender, a few recipients, UTF-8 text.
// `connect` is passed in, so tests can use a fake server (test/contact.test.mjs).

/** The server refused something (a reply code we did not expect). Never carries the password. */
export class SmtpError extends Error {
  constructor(step, code) {
    super(`SMTP ${step} refused (${code})`);
    this.name = "SmtpError";
    this.step = step;
    this.code = code;
  }
}

const enc = new TextEncoder();

/** Base64 of the UTF-8 bytes of a string. */
export function b64(text) {
  const bytes = enc.encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const ASCII_SAFE = /^[\x20-\x7e]*$/;

/** A header value as RFC 2047 encoded words where needed, folded so no line passes 76 characters. */
export function encodeHeader(value) {
  const v = String(value).replace(/[\r\n]+/g, " ");
  if (ASCII_SAFE.test(v)) return v;
  const words = [];
  let chunk = "";
  for (const ch of v) {
    // ≤39 UTF-8 bytes → ≤52 base64 characters; with "=?UTF-8?B?" and "?=" a word is ≤64, so even
    // the first one fits after "Reply-To: " within 78 characters.
    if (enc.encode(chunk + ch).length > 39) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join("\r\n ");
}

/** "Name <a@b>" or "a@b" → { name, address }. Throws on anything that could break the envelope. */
export function parseAddress(s) {
  const text = String(s ?? "").trim();
  const m = text.match(/^(.*?)\s*<([^<>]+)>$/);
  const name = m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
  const address = (m ? m[2] : text).trim();
  if (!/^[^\s<>@"]+@[^\s<>@"]+$/.test(address)) throw new SmtpError("address", 0);
  return { name, address };
}

/** `field` is the header name: a long display name moves the address to a folded line. */
function formatAddress({ name, address }, field = "") {
  if (!name) return address;
  const shown = ASCII_SAFE.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : encodeHeader(name);
  const lastLine = `${field}: ${shown}`.split("\r\n").at(-1);
  return `${shown}${lastLine.length + address.length + 3 > 78 ? "\r\n " : " "}<${address}>`;
}

const wrap = (s, n) => s.match(new RegExp(`.{1,${n}}`, "g"))?.join("\r\n") ?? "";

/** The whole message (headers + base64 body), CRLF line ends. */
export function buildMessage(mail, { date = new Date(), messageId } = {}) {
  const from = parseAddress(mail.from);
  const to = [mail.to].flat().map(parseAddress);
  const domain = from.address.split("@")[1];
  const id = messageId ?? `${Date.now().toString(36)}.${crypto.randomUUID()}`;
  const headers = [
    `From: ${formatAddress(from, "From")}`,
    `To: ${to.map((a) => formatAddress(a, "To")).join(",\r\n ")}`,
    ...(mail.reply_to ? [`Reply-To: ${formatAddress(parseAddress(mail.reply_to), "Reply-To")}`] : []),
    `Subject: ${encodeHeader(mail.subject ?? "")}`,
    `Date: ${date.toUTCString().replace(/GMT$/, "+0000")}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap(b64(String(mail.text ?? "").replace(/\r?\n/g, "\r\n")), 76);
  return { from, to, data: `${headers.join("\r\n")}\r\n\r\n${body}` };
}

/** Lines starting with "." get a second one (RFC 5321 4.5.2). */
export const dotStuff = (data) => data.replace(/(^|\r\n)\./g, "$1..");

function session(socket) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const dec = new TextDecoder();
  let buf = "";
  async function reply() {
    const lines = [];
    for (;;) {
      let i;
      while ((i = buf.indexOf("\n")) < 0) {
        const { value, done } = await reader.read();
        if (done) throw new SmtpError("connection", "closed");
        buf += dec.decode(value, { stream: true });
      }
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      lines.push(line);
      if (!/^\d{3}-/.test(line)) break;
    }
    return { code: Number(lines.at(-1).slice(0, 3)), lines: lines.map((l) => l.slice(4)) };
  }
  return {
    reply,
    write: (text) => writer.write(enc.encode(text)),
    release() {
      reader.releaseLock();
      writer.releaseLock();
    },
  };
}

/**
 * Send `mail` ({ from, to, reply_to, subject, text } — the same object buildEmail makes for Resend).
 * cfg: { host, port = 465, user, pass }. deps: { connect, timeoutMs = 10000, messageId }.
 * Resolves when the server accepted the message (250 after DATA). Rejects with SmtpError when the
 * server refuses, or with a TimeoutError / network error when it can't be reached in time.
 */
export async function sendSmtp(mail, cfg, { connect, timeoutMs = 10_000, messageId } = {}) {
  const { from, to, data } = buildMessage(mail, { messageId });
  const port = Number(cfg.port || 465);
  const implicitTls = port === 465;
  const helo = from.address.split("@")[1];
  let socket = connect({ hostname: cfg.host, port }, { secureTransport: implicitTls ? "on" : "starttls", allowHalfOpen: false });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("SMTP timed out"), { name: "TimeoutError" })), timeoutMs);
  });
  const run = async () => {
    let s = session(socket);
    const expect = async (step, ...codes) => {
      const r = await s.reply();
      if (!codes.includes(r.code)) throw new SmtpError(step, r.code);
      return r;
    };
    const cmd = async (step, line, ...codes) => {
      await s.write(`${line}\r\n`);
      return expect(step, ...codes);
    };
    await expect("greeting", 220);
    let ehlo = await cmd("EHLO", `EHLO ${helo}`, 250);
    if (!implicitTls) {
      await cmd("STARTTLS", "STARTTLS", 220);
      s.release();
      socket = socket.startTls();
      s = session(socket);
      ehlo = await cmd("EHLO", `EHLO ${helo}`, 250);
    }
    const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l))?.toUpperCase().split(/[ =]+/) ?? [];
    if (auth.includes("PLAIN")) await cmd("AUTH", `AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`, 235);
    else if (auth.includes("LOGIN")) {
      await cmd("AUTH", "AUTH LOGIN", 334);
      await cmd("AUTH", b64(cfg.user), 334);
      await cmd("AUTH", b64(cfg.pass), 235);
    } else throw new SmtpError("AUTH", "unsupported");
    await cmd("MAIL", `MAIL FROM:<${from.address}>`, 250);
    for (const r of to) await cmd("RCPT", `RCPT TO:<${r.address}>`, 250, 251);
    await cmd("DATA", "DATA", 354);
    await cmd("DATA", `${dotStuff(data)}\r\n.`, 250);
    await cmd("QUIT", "QUIT", 221).catch(() => {});
  };
  const conversation = run();
  conversation.catch(() => {}); // if the timeout wins, closing the socket ends it quietly
  try {
    await Promise.race([conversation, timeout]);
  } finally {
    clearTimeout(timer);
    try {
      await socket.close();
    } catch {
      // already closed
    }
  }
}
