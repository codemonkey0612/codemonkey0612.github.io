// Inquiry form: the pure part (no network, no storage). Parses and validates a submission,
// strips anything that could break out of a mail header, and builds the email.
// Used by worker.mjs (Cloudflare Worker) and tested in test/contact.test.mjs.

export const LIMITS = { name: 80, company: 120, email: 254, message: 4000, messageMin: 10, context: 200, body: 16 * 1024 };

export const CATEGORIES = { ai: "AI", web: "Web・EC", system: "システム", other: "その他" };
export const BUDGETS = ["未定", "〜10万円", "10〜30万円", "30〜100万円", "100万円〜"];
export const SCHEDULES = ["未定", "1か月以内", "1〜3か月", "3か月以上", "相談したい"];

const EMAIL = /^[^\s@<>()[\]\\,;:"']{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,64}$/;

/** Parse a JSON or form-encoded body into a plain object of strings. Throws on anything else. */
export function parseBody(text, contentType = "") {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "application/json") {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("body must be a JSON object");
    return v;
  }
  if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(text));
  throw new Error(`unsupported content type: ${type || "(none)"}`);
}

/** Text a person typed: NFC, no control characters except newlines and tabs, trimmed. */
export function cleanText(v) {
  return String(v ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, "")
    .trim();
}

/** One line, safe inside a mail header: CR/LF and all other control characters removed. */
export function oneLine(v) {
  return String(v ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const len = (s) => [...s].length;

/**
 * Validate a submission. Returns { ok: true, data, spam } or { ok: false, errors: { field: code } }
 * with codes "required" | "too_long" | "too_short" | "invalid".
 * A filled honeypot ("website") returns { ok: true, spam: true }: the caller pretends to succeed.
 */
export function validate(raw = {}) {
  if (cleanText(raw.website) !== "") return { ok: true, spam: true, data: null };
  const errors = {};
  const name = oneLine(raw.name);
  const company = oneLine(raw.company);
  const emailRaw = String(raw.email ?? "").trim();
  const category = String(raw.category ?? "").trim();
  const budget = oneLine(raw.budget);
  const schedule = oneLine(raw.schedule);
  const message = cleanText(raw.message);
  const context = oneLine(raw.context);
  const consent = [true, "true", "on", "1", "yes"].includes(raw.consent);

  if (!name) errors.name = "required";
  else if (len(name) > LIMITS.name) errors.name = "too_long";
  if (len(company) > LIMITS.company) errors.company = "too_long";
  if (!emailRaw) errors.email = "required";
  else if (emailRaw.length > LIMITS.email) errors.email = "too_long";
  else if (/[\r\n]/.test(emailRaw) || !EMAIL.test(emailRaw)) errors.email = "invalid";
  // The kind of inquiry is optional (a one-tap hint on the form); a value must be a known one.
  if (category && !Object.hasOwn(CATEGORIES, category)) errors.category = "invalid";
  if (budget && !BUDGETS.includes(budget)) errors.budget = "invalid";
  if (schedule && !SCHEDULES.includes(schedule)) errors.schedule = "invalid";
  if (!message) errors.message = "required";
  else if (len(message) < LIMITS.messageMin) errors.message = "too_short";
  else if (len(message) > LIMITS.message) errors.message = "too_long";
  if (!consent) errors.consent = "required";

  if (Object.keys(errors).length) return { ok: false, errors };
  const idem = String(raw.idempotency ?? "").trim();
  return {
    ok: true,
    spam: false,
    data: {
      name,
      company,
      email: emailRaw,
      category,
      budget,
      schedule,
      message,
      context: [...context].slice(0, LIMITS.context).join(""),
      idempotency: IDEMPOTENCY.test(idem) ? idem : "",
    },
  };
}

const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A short reference number for the visitor, e.g. TK-7KQ2MD. */
export function makeRef(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `TK-${[...random(6)].map((b) => REF_CHARS[b % REF_CHARS.length]).join("")}`;
}

const jst = (d) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

/** The email to the site owner (Resend API payload). Reply-To is the visitor. */
export function buildEmail(data, { from, to, ref, receivedAt = new Date() }) {
  const kind = CATEGORIES[data.category] ?? "";
  const subject = oneLine(`【お問い合わせ】${kind ? `${kind} ` : ""}${data.name}様（${ref}）`).slice(0, 200);
  const rows = [
    ["受付番号", ref],
    ["受付日時", `${jst(receivedAt)}（日本時間）`],
    ["お名前", data.name],
    ["会社名", data.company || "（未入力）"],
    ["返信先", data.email],
    ["相談したいこと", kind || "（未選択）"],
    ["ご予算", data.budget || "（未選択）"],
    ["希望時期", data.schedule || "（未選択）"],
    ...(data.context ? [["ご相談の対象", data.context]] : []),
  ];
  const text = [
    "サイトのお問い合わせフォームから、次の内容が届きました。",
    "このメールに返信すると、お問い合わせいただいた方に届きます。",
    "",
    ...rows.map(([k, v]) => `${k}：${v}`),
    "",
    "―― ご相談内容 ――",
    data.message,
    "",
  ].join("\n");
  return { from: oneLine(from), to: [oneLine(to)], reply_to: oneLine(data.email), subject, text };
}
