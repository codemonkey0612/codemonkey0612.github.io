// A Bluesky client for the official AT Protocol API (https://docs.bsky.app/), signed in with
// your handle and an App Password (Settings → Privacy and security → App passwords), never
// your account password. It can read your own recent posts, upload an image and create a
// post; nothing else (no deleting, following, liking or replying).

export const SERVICE = "https://bsky.social";
const TIMEOUT_MS = 30_000;
export const MAX_GRAPHEMES = 300; // Bluesky's limit for a post's text
export const MAX_THUMB_BYTES = 1_000_000; // app.bsky.embed.external thumb limit

export class BlueskyAuthError extends Error {
  constructor(status, body = "") {
    super(
      `Bluesky did not accept the sign-in (HTTP ${status}${body ? `: ${String(body).slice(0, 200)}` : ""}). Check profile.yml platforms.bluesky ` +
        "(your handle) and the BLUESKY_APP_PASSWORD secret (an App Password from Settings → Privacy and security → App passwords).",
    );
    this.name = "BlueskyAuthError";
  }
}

export class BlueskyApiError extends Error {
  constructor(message, status, body = "") {
    const snippet = String(body).replace(/\s+/g, " ").slice(0, 300);
    super(`${message} (HTTP ${status})${snippet ? `: ${snippet}` : ""}`);
    this.name = "BlueskyApiError";
  }
}

const graphemes = (s) => [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
export const graphemeLength = (s) => graphemes(s).length;

/**
 * Post text with clickable links and hashtags. `parts` is a list of strings and
 * { text, link } / { text, tag } pieces; facets use UTF-8 byte offsets, as the API requires.
 */
export function richText(parts) {
  let text = "";
  const facets = [];
  for (const part of parts) {
    const piece = typeof part === "string" ? { text: part } : part;
    const byteStart = Buffer.byteLength(text);
    text += piece.text;
    const byteEnd = Buffer.byteLength(text);
    if (piece.link) facets.push({ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: piece.link }] });
    if (piece.tag) facets.push({ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: piece.tag }] });
  }
  return { text, facets };
}

/** The post's page on bsky.app, from its at:// URI. */
export const postUrl = (handle, uri) => `https://bsky.app/profile/${handle}/post/${String(uri).split("/").pop()}`;

export class BlueskyClient {
  constructor({ handle, appPassword }, { fetch: fetchImpl = globalThis.fetch, service = SERVICE } = {}) {
    this.handle = String(handle ?? "").trim().replace(/^@/, "");
    this.password = String(appPassword ?? "").trim();
    if (!this.handle || !this.password) throw new Error("Bluesky needs your handle and an App Password");
    this.fetch = fetchImpl;
    this.service = service;
    this.session = null;
  }

  async call(method, nsid, { body, query, raw, type } = {}) {
    const base = this.session?.pds ?? this.service;
    const url = `${base}/xrpc/${nsid}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const headers = { accept: "application/json" };
    if (this.session) headers.authorization = `Bearer ${this.session.accessJwt}`;
    if (body !== undefined) headers["content-type"] = raw ? type : "application/json";
    const res = await this.fetch(url, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    if (nsid === "com.atproto.server.createSession" && (res.status === 400 || res.status === 401)) throw new BlueskyAuthError(res.status, text);
    if (res.status === 401) throw new BlueskyAuthError(res.status, text);
    if (!res.ok) throw new BlueskyApiError(`Bluesky refused ${nsid}`, res.status, text);
    return text ? JSON.parse(text) : {};
  }

  /** Signs in; later calls go to the server that hosts the account (from its DID document). */
  async login() {
    const s = await this.call("POST", "com.atproto.server.createSession", { body: { identifier: this.handle, password: this.password } });
    const pds = s.didDoc?.service?.find((x) => x.id === "#atproto_pds" || x.type === "AtprotoPersonalDataServer")?.serviceEndpoint;
    this.session = { did: s.did, handle: s.handle ?? this.handle, accessJwt: s.accessJwt, pds: pds ? String(pds).replace(/\/$/, "") : this.service };
    return this.session;
  }

  /** Your most recent posts (newest first), as { uri, value }. */
  async recentPosts(limit = 50) {
    const r = await this.call("GET", "com.atproto.repo.listRecords", { query: { repo: this.session.did, collection: "app.bsky.feed.post", limit: String(limit) } });
    return r.records ?? [];
  }

  async uploadImage(data, type) {
    if (data.length > MAX_THUMB_BYTES) throw new Error(`image is ${data.length} bytes; Bluesky takes at most ${MAX_THUMB_BYTES}`);
    return (await this.call("POST", "com.atproto.repo.uploadBlob", { body: data, raw: true, type })).blob;
  }

  /** Creates a post; returns { uri, cid, url }. */
  async post(record) {
    const r = await this.call("POST", "com.atproto.repo.createRecord", {
      body: { repo: this.session.did, collection: "app.bsky.feed.post", record: { $type: "app.bsky.feed.post", createdAt: new Date().toISOString(), ...record } },
    });
    return { uri: r.uri, cid: r.cid, url: postUrl(this.session.handle, r.uri) };
  }
}
