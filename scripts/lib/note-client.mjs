// A note.com client: saves drafts and, when asked, publishes one.
//
// note has no posting API for individual accounts (its "note API" from October 2026 is for
// corporate note pro customers only), so this calls the internal endpoints note's own editor
// uses, signed in with your login cookie. They are undocumented and can change without notice.
// The draft endpoints and headers match two independent open-source clients (goodnasubi/note-mcp
// in TypeScript, tuuu428/Note-CLI in Go). Publishing is PUT /api/v1/text_notes/{id} with
// status "published", as in Note-CLI (with its full payload) and shimayuz/note-com-mcp; it's
// less well documented, so callers check the public page afterwards. The same PUT (with the
// header image set first) updates a post this tool published. Only the calls in ALLOWED can be
// made: nothing here can delete, price or unpublish a post.

export const NOTE_ORIGIN = "https://note.com";
export const EDITOR_ORIGIN = "https://editor.note.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 30_000;
const ALLOWED = [
  ["GET", /^\/api\/v2\/current_user$/],
  ["GET", /^\/api\/v2\/note_list\/contents$/],
  ["POST", /^\/api\/v1\/text_notes$/],
  ["POST", /^\/api\/v1\/text_notes\/draft_save$/],
  ["POST", /^\/api\/v3\/images\/upload\/presigned_post$/],
  ["POST", /^\/api\/v1\/image_upload\/note_eyecatch$/],
  ["PUT", /^\/api\/v1\/text_notes\/\d+$/], // publish (see publish())
];
export const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };

export class NoteAuthError extends Error {
  constructor(status) {
    super(
      `note did not accept the login cookie (HTTP ${status}). It has probably expired: sign in to note in your browser, ` +
        "copy the _note_session_v5 cookie again and update the NOTE_SESSION secret (see README).",
    );
    this.name = "NoteAuthError";
  }
}

export class NoteApiError extends Error {
  constructor(message, status, body = "") {
    const snippet = String(body).replace(/\s+/g, " ").slice(0, 300);
    super(`${message} (HTTP ${status})${snippet ? `: ${snippet}` : ""}. note may have changed its editor; see README.`);
    this.name = "NoteApiError";
  }
}

const record = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

export class NoteClient {
  /** `session` is the value of the _note_session_v5 cookie. */
  constructor(session, { fetch: fetchImpl = globalThis.fetch } = {}) {
    this.session = String(session ?? "").trim().replace(/^_note_session_v5=/, "");
    if (!this.session) throw new Error("NOTE_SESSION is empty");
    this.fetch = fetchImpl;
    this.xsrf = "";
  }

  static editUrl(key) {
    return `${EDITOR_ORIGIN}/notes/${encodeURIComponent(key)}/edit/`;
  }

  /** Checks the cookie and returns the signed-in account. */
  async currentUser() {
    const data = record(record(await this.request("GET", "/api/v2/current_user")).data);
    if (data.id == null) throw new NoteAuthError(200); // signed out: 200 with no user
    return { id: String(data.id), urlname: String(data.urlname ?? "") };
  }

  /** Creates an empty post (not yet a draft on note) and returns its id and key. */
  async createNote(title) {
    const json = await this.request("POST", "/api/v1/text_notes", {
      json: { body: "<p></p>", body_length: 0, name: title, index: false, is_lead_form: false },
    });
    const data = record(record(json).data);
    if (data.id == null || !data.key) throw new NoteApiError("note created the post but returned no id/key", 200, JSON.stringify(json));
    return { id: String(data.id), key: String(data.key) };
  }

  /** Saves the title and body as a draft. Never publishes. */
  async saveDraft(id, { title, html, textLength }) {
    if (!/^\d+$/.test(String(id))) throw new Error(`note post id must be a number: ${id}`);
    await this.request("POST", "/api/v1/text_notes/draft_save", {
      query: { id: String(id), is_temp_saved: "true" },
      json: { name: title, body: html, body_length: textLength, index: false, is_lead_form: false },
    });
  }

  /** Is `id` one of your drafts? (Guards against overwriting a published post.) */
  async isDraft(id, maxPages = 10) {
    for (let page = 1; page <= maxPages; page++) {
      const json = await this.request("GET", "/api/v2/note_list/contents", {
        query: { page: String(page), per_page: "50", draft: "true", draft_reedit: "false", status: "draft" },
      });
      const data = record(record(json).data);
      const notes = Array.isArray(data.notes) ? data.notes : [];
      if (notes.some((n) => String(record(n).id) === String(id) && record(n).status === "draft")) return true;
      if ((data.isLastPage ?? data.is_last_page) === true || notes.length < 50) return false;
    }
    return false;
  }

  /** Uploads an image for the body and returns the URL to put in it. */
  async uploadImage({ name, type, data }) {
    const form = new FormData();
    form.append("filename", name);
    const json = record(record(await this.request("POST", "/api/v3/images/upload/presigned_post", { form })).data);
    const post = record(json.post);
    if (typeof json.action !== "string" || !/^https:\/\//.test(json.action) || typeof json.url !== "string" || !Object.keys(post).length) {
      throw new NoteApiError("note gave no upload address for the image", 200, JSON.stringify(json));
    }
    // S3 POST policy: every field first, the file last. The cookie is never sent to S3.
    const s3 = new FormData();
    for (const [k, v] of Object.entries(post)) if (v != null && v !== "") s3.append(k, String(v));
    s3.append("file", new Blob([data], { type }), name);
    const res = await this.fetch(json.action, { method: "POST", body: s3, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new NoteApiError(`uploading ${name} failed`, res.status, await res.text().catch(() => ""));
    return json.url;
  }

  /** Sets the post's header image (見出し画像). */
  async setEyecatch(id, { name, type, data }) {
    const form = new FormData();
    form.append("note_id", String(id));
    form.append("file", new Blob([data], { type }), name);
    await this.request("POST", "/api/v1/image_upload/note_eyecatch", { form });
  }

  /**
   * Publishes a draft as a free post: comments on, followers notified, no magazine. note takes
   * the whole post with this call (it has no partial update), so title and body are sent again.
   * The same call updates a post that's already public; pass notify: false for that.
   */
  async publish(id, { title, html, textLength, hashtags = [], notify = true }) {
    if (!/^\d+$/.test(String(id))) throw new Error(`note post id must be a number: ${id}`);
    await this.request("PUT", `/api/v1/text_notes/${id}`, {
      json: {
        status: "published",
        name: title,
        body: html,
        body_length: textLength,
        free_body: html,
        pay_body: "",
        separator: null,
        price: 0,
        is_refund: false,
        hashtags: hashtags.map((t) => (String(t).startsWith("#") ? String(t) : `#${t}`)),
        magazine_ids: [],
        magazine_keys: [],
        circle_permissions: [],
        limited: false,
        disable_comment: false,
        send_notifications_flag: notify,
        author_ids: [],
        image_keys: [],
        index: false,
        is_lead_form: false,
      },
    });
  }

  async request(method, path, { query, json, form } = {}) {
    if (!ALLOWED.some(([m, p]) => m === method && p.test(path))) throw new Error(`not an allowed note endpoint, refusing: ${method} ${path}`);
    const url = new URL(path, NOTE_ORIGIN);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const headers = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Cookie: `_note_session_v5=${this.session}${this.xsrf ? `; XSRF-TOKEN=${encodeURIComponent(this.xsrf)}` : ""}`,
    };
    let body;
    if (method !== "GET") {
      Object.assign(headers, { Origin: EDITOR_ORIGIN, Referer: `${EDITOR_ORIGIN}/`, "X-Requested-With": "XMLHttpRequest" });
      if (this.xsrf) headers["X-XSRF-TOKEN"] = this.xsrf;
      if (json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(json);
      } else body = form; // fetch sets the multipart boundary
    }
    const res = await this.fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    this.#rememberXsrf(res);
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) throw new NoteAuthError(res.status);
    if (!res.ok) throw new NoteApiError(`${method} ${path} failed`, res.status, text);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      if (/^\s*</.test(text)) throw new NoteAuthError(res.status); // a login page instead of JSON
      throw new NoteApiError(`${method} ${path} did not return JSON`, res.status, text);
    }
  }

  #rememberXsrf(res) {
    const fromHeader = res.headers?.get?.("x-xsrf-token");
    const fromCookie = (res.headers?.getSetCookie?.() ?? []).map((c) => /^XSRF-TOKEN=([^;]*)/.exec(c)?.[1]).find(Boolean);
    const token = fromHeader || fromCookie;
    if (token) this.xsrf = decodeURIComponent(token);
  }
}
