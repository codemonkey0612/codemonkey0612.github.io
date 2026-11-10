import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NoteAuthError, NoteClient } from "../scripts/lib/note-client.mjs";
import { localImages, markdownToNote } from "../scripts/lib/note-html.mjs";
import { readyNotes, syncNotes } from "../scripts/note-draft.mjs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

test("Markdown becomes note editor HTML: block ids, two heading levels, figures, no tables", () => {
  const md = [
    "<!-- 読者: 経営者 -->",
    "# 大見出し",
    "### 小見出し",
    "#### 小さい見出し",
    "本文と**強調**と[リンク](https://example.com)。",
    "",
    "![構成図](img/diagram.png)",
    "",
    "- 項目1",
    "- 項目2",
    "",
    "| 項目 | 値 |",
    "|---|---|",
    "| 速度 | 2倍 |",
    "",
    "```js",
    "const a = 1 < 2;",
    "```",
    "",
    "<div>生のHTML</div>",
  ].join("\n");
  assert.deepEqual(localImages(md), ["img/diagram.png"]);
  const { html, textLength, warnings } = markdownToNote(md, { imageUrls: new Map([["img/diagram.png", "https://assets.st-note.com/x.png"]]), newId: ids() });
  assert.ok(html.startsWith('<h2 name="id1" id="id1">大見出し</h2><h3 name="id2" id="id2">小見出し</h3>'));
  assert.match(html, /<p name="id3" id="id3"><strong>小さい見出し<\/strong><\/p>/);
  assert.match(html, /<p name="id\d+" id="id\d+">本文と<strong>強調<\/strong>と<a href="https:\/\/example\.com">リンク<\/a>。<\/p>/);
  assert.match(html, /<figure name="id\d+" id="id\d+"><img src="https:\/\/assets\.st-note\.com\/x\.png" alt="" width="620" height="auto"><figcaption>構成図<\/figcaption><\/figure>/);
  assert.match(html, /<ul name="id\d+" id="id\d+"><li name="id\d+" id="id\d+">項目1<\/li><li name="id\d+" id="id\d+">項目2<\/li><\/ul>/);
  assert.match(html, /<li name="id\d+" id="id\d+">項目: 速度 \/ 値: 2倍<\/li>/, "a table row becomes a bullet");
  assert.match(html, /<pre name="id\d+" id="id\d+"><code>const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.doesNotMatch(html, /読者|<div|<table/);
  assert.equal(new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])).size, [...html.matchAll(/ id="/g)].length, "ids are unique");
  assert.ok(warnings.some((w) => /tables/.test(w)) && warnings.some((w) => /raw HTML/.test(w)) && warnings.some((w) => /h4/.test(w)));
  assert.equal(textLength, [...html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<")].length);
});

// A fake note: records calls, answers like the real endpoints.
function fakeNote({ urlname = "shanaiai", status = 200, drafts = [], published = [], publishWorks = true, eyecatchWorks = true, keys = {} } = {}) {
  const calls = [];
  const keyOf = new Map(Object.entries(keys));
  let nextId = 1000;
  let eyecatch = "https://assets.st-note.com/eye-0.png";
  let uploads = 0;
  const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...init.headers } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body });
    if (status !== 200) return new Response("", { status });
    if (u.hostname === "s3.example") return new Response(null, { status: 204 });
    if (u.pathname === "/api/v2/current_user") return json({ data: { id: 7, urlname } }, { headers: { "set-cookie": "XSRF-TOKEN=tok%3D; path=/" } });
    if (u.pathname === "/api/v1/text_notes") {
      keyOf.set(String(++nextId), `nkey${nextId}`);
      return json({ data: { id: nextId, key: `nkey${nextId}` } });
    }
    const put = init.method === "PUT" && /^\/api\/v1\/text_notes\/(\d+)$/.exec(u.pathname);
    if (put) {
      if (publishWorks) published.push(keyOf.get(put[1]));
      return json({ data: {} });
    }
    if (u.pathname === "/api/v1/text_notes/draft_save") return json({ data: {} });
    if (u.pathname === "/api/v2/note_list/contents") return json({ data: { notes: drafts.map((id) => ({ id, status: "draft" })), isLastPage: true } });
    if (u.pathname === "/api/v3/images/upload/presigned_post") return json({ data: { url: "https://assets.st-note.com/up.png", action: "https://s3.example/", post: { key: "k", policy: "p" } } });
    if (u.pathname === "/api/v1/image_upload/note_eyecatch") {
      if (eyecatchWorks) eyecatch = `https://assets.st-note.com/eye-${++uploads}.png`;
      return json({ data: { url: eyecatch } });
    }
    if (u.pathname.startsWith(`/${urlname}/n/`)) return new Response("", { status: published.includes(u.pathname.split("/").pop()) ? 200 : 404 });
    const pub = /^\/api\/v3\/notes\/(\w+)$/.exec(u.pathname);
    if (pub) return published.includes(pub[1]) ? json({ data: { status: "published", eyecatch } }) : new Response("", { status: 404 });
    return new Response("not found", { status: 404 });
  };
  return { calls, fetch };
}

test("the note client saves drafts and publishes only through publish(), with the editor's headers and XSRF token", async () => {
  const note = fakeNote();
  const client = new NoteClient("_note_session_v5=abc", { fetch: note.fetch });
  assert.deepEqual(await client.currentUser(), { id: "7", urlname: "shanaiai" });
  const ref = await client.createNote("タイトル");
  await client.saveDraft(ref.id, { title: "タイトル", html: "<p>本文</p>", textLength: 2 });
  const save = note.calls.find((c) => c.path === "/api/v1/text_notes/draft_save");
  assert.deepEqual(save.query, { id: ref.id, is_temp_saved: "true" });
  assert.deepEqual(JSON.parse(save.body), { name: "タイトル", body: "<p>本文</p>", body_length: 2, index: false, is_lead_form: false });
  assert.equal(save.headers.Cookie, "_note_session_v5=abc; XSRF-TOKEN=tok%3D");
  assert.equal(save.headers["X-XSRF-TOKEN"], "tok=");
  assert.equal(save.headers.Origin, "https://editor.note.com");
  await client.publish(ref.id, { title: "タイトル", html: "<p>本文</p>", textLength: 2, hashtags: ["ai", "#RAG"] });
  const put = note.calls.find((c) => c.method === "PUT");
  assert.equal(put.path, `/api/v1/text_notes/${ref.id}`);
  const payload = JSON.parse(put.body);
  assert.deepEqual([payload.status, payload.name, payload.free_body, payload.pay_body, payload.price], ["published", "タイトル", "<p>本文</p>", "", 0]);
  assert.deepEqual(payload.hashtags, ["#ai", "#RAG"]);
  await assert.rejects(client.request("DELETE", `/api/v1/text_notes/${ref.id}`), /not an allowed note endpoint/);
  await assert.rejects(client.request("PUT", "/api/v1/text_notes/nkey1"), /not an allowed note endpoint/);
  await assert.rejects(client.publish("nkey1", { title: "t", html: "", textLength: 0 }), /must be a number/);
  for (const status of [401, 302]) {
    const expired = new NoteClient("abc", { fetch: fakeNote({ status }).fetch });
    await assert.rejects(expired.currentUser(), NoteAuthError);
  }
});

function tmpNotes(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-test-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}
const profile = { site_url: "https://x.example/", platforms: { note: "shanaiai" }, todos: [] };
const post = (extra = "") => `---\ntitle: 社内のAI活用\nstatus: ready # 準備ができたら ready\nhashtags: [AI, 業務効率化]\n${extra}---\n\n本文です。[相談する](https://x.example/)\n\n![図](fig.png)\n`;
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

test("ready note posts become drafts once, are updated only when changed, and get their link after you publish", async () => {
  const dir = tmpNotes({ "notes/ai.md": post(), "notes/fig.png": PNG, "notes/wip.md": "---\ntitle: 書きかけ\nstatus: draft\n---\n本文\n" });
  const file = path.join(dir, "notes/ai.md");
  assert.deepEqual(readyNotes(dir), [file], "only status: ready posts without a url");
  const log = () => {};

  const first = fakeNote();
  let results = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: first.fetch }), profile, fetchPage: first.fetch, log });
  assert.equal(results[0].action, "created", results[0].reason);
  assert.equal(results[0].edit, "https://editor.note.com/notes/nkey1001/edit/");
  assert.deepEqual(results[0].hashtags, ["AI", "業務効率化"]);
  const saved = JSON.parse(first.calls.find((c) => c.path === "/api/v1/text_notes/draft_save").body);
  assert.match(saved.body, /<img src="https:\/\/assets\.st-note\.com\/up\.png"/, "the image was uploaded and used");
  let fm = fs.readFileSync(file, "utf8");
  assert.match(fm, /status: ready # 準備ができたら ready/, "front matter comments are kept");
  assert.match(fm, /note_id: "1001"\nnote_key: nkey1001\nnote_hash: [0-9a-f]{12}\n---/);

  const again = fakeNote({ drafts: ["1001"] });
  results = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: again.fetch }), profile, fetchPage: again.fetch, log });
  assert.equal(results[0].action, "unchanged");
  assert.ok(!again.calls.some((c) => c.method === "POST"), "nothing is sent when nothing changed");

  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("本文です。", "本文を直しました。"));
  const edit = fakeNote({ drafts: ["1001"] });
  results = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: edit.fetch }), profile, fetchPage: edit.fetch, log });
  assert.equal(results[0].action, "updated");
  assert.ok(!edit.calls.some((c) => c.path === "/api/v1/text_notes"), "the same draft is updated, not a new one");
  assert.deepEqual(edit.calls.find((c) => c.path === "/api/v1/text_notes/draft_save").query.id, "1001");

  const live = fakeNote({ published: ["nkey1001"] });
  results = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: live.fetch }), profile, fetchPage: live.fetch, log });
  assert.equal(results[0].action, "published");
  assert.match(fs.readFileSync(file, "utf8"), /url: https:\/\/note\.com\/shanaiai\/n\/nkey1001/);
  assert.deepEqual(readyNotes(dir), [file], "a published post is still watched for changes");
  const quiet = fakeNote({ published: ["nkey1001"] });
  results = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: quiet.fetch }), profile, fetchPage: quiet.fetch, publish: true, log });
  assert.deepEqual([results[0].action, results[0].public], ["unchanged", true]);
  assert.ok(!quiet.calls.some((c) => c.method === "POST" || c.method === "PUT"), "an unchanged public post is left alone");
});

test("a public post whose header image or text changed is updated on note, without notifying followers", async () => {
  const quiet = { wait: async () => {}, log: () => {} };
  const dir = tmpNotes({ "notes/ai.md": post(), "notes/fig.png": PNG, "notes/covers/1351569.jpg": PNG, "notes/old.png": PNG });
  const file = path.join(dir, "notes/ai.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("---\n\n本文", "cover: old.png\n---\n\n本文"));
  const first = fakeNote();
  await syncNotes({ files: [file], client: new NoteClient("s", { fetch: first.fetch }), profile, fetchPage: first.fetch, publish: true, ...quiet });
  const hashBefore = /note_hash: (\w+)/.exec(fs.readFileSync(file, "utf8"))[1];

  // Swap in a package image, as for the 2026-11-10 post.
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("cover: old.png", "cover: covers/1351569.jpg"));
  const live = fakeNote({ published: ["nkey1001"], keys: { 1001: "nkey1001" } });
  const [r] = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: live.fetch }), profile, fetchPage: live.fetch, publish: true, ...quiet });
  assert.equal(r.action, "republished", r.reason);
  assert.equal(r.url, "https://note.com/shanaiai/n/nkey1001");
  const eyecatch = live.calls.findIndex((c) => c.path === "/api/v1/image_upload/note_eyecatch");
  const put = live.calls.findIndex((c) => c.method === "PUT");
  assert.ok(eyecatch >= 0 && put > eyecatch, "header image first, then the post");
  const payload = JSON.parse(live.calls[put].body);
  assert.equal(payload.send_notifications_flag, false);
  assert.match(payload.body, /本文です。/);
  assert.ok(!live.calls.some((c) => c.path === "/api/v1/text_notes"), "no new post");
  assert.notEqual(/note_hash: (\w+)/.exec(fs.readFileSync(file, "utf8"))[1], hashBefore);

  // If note keeps showing the old header image, say so (and don't resend it on every run).
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("本文です。", "本文です！"));
  const stuck = fakeNote({ published: ["nkey1001"], keys: { 1001: "nkey1001" }, eyecatchWorks: false });
  const [bad] = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: stuck.fetch }), profile, fetchPage: stuck.fetch, publish: true, ...quiet });
  assert.equal(bad.action, "failed");
  assert.match(bad.reason, /still shows the old header image: set it in https:\/\/editor\.note\.com\/notes\/nkey1001\/edit\//);
  const again = fakeNote({ published: ["nkey1001"] });
  const [after] = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: again.fetch }), profile, fetchPage: again.fetch, publish: true, ...quiet });
  assert.equal(after.action, "unchanged");

  // Without --publish (note: draft), a changed public post is only reported.
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("本文です！", "本文です。"));
  const draftMode = fakeNote({ published: ["nkey1001"] });
  const [skip] = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: draftMode.fetch }), profile, fetchPage: draftMode.fetch, ...quiet });
  assert.equal(skip.action, "skipped");
  assert.ok(!draftMode.calls.some((c) => c.method === "PUT"));
});

test("note drafts refuse the wrong account and never overwrite a published post", async () => {
  const dir = tmpNotes({ "notes/ai.md": post('note_id: "55"\nnote_key: nold\nnote_hash: stale\n'), "notes/fig.png": PNG });
  const file = path.join(dir, "notes/ai.md");
  const other = fakeNote({ urlname: "someone" });
  await assert.rejects(syncNotes({ files: [file], client: new NoteClient("s", { fetch: other.fetch }), profile, fetchPage: other.fetch, log: () => {} }), /signed in as note\.com\/someone/);

  const gone = fakeNote({ drafts: [] }); // 55 is not a draft any more
  const [r] = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: gone.fetch }), profile, fetchPage: gone.fetch, log: () => {} });
  assert.equal(r.action, "failed");
  assert.match(r.reason, /no longer one of your drafts/);
  assert.ok(!gone.calls.some((c) => c.path === "/api/v1/text_notes/draft_save"));
});

test("with publish, a ready post goes out on note and its public link is recorded; if note doesn't make it public, it says so", async () => {
  const quiet = { wait: async () => {}, log: () => {} };
  const dir = tmpNotes({ "notes/ai.md": post(), "notes/fig.png": PNG });
  const file = path.join(dir, "notes/ai.md");
  const live = fakeNote();
  const [ok] = await syncNotes({ files: [file], client: new NoteClient("s", { fetch: live.fetch }), profile, fetchPage: live.fetch, publish: true, ...quiet });
  assert.equal(ok.action, "published");
  assert.equal(ok.url, "https://note.com/shanaiai/n/nkey1001");
  assert.deepEqual(JSON.parse(live.calls.find((c) => c.method === "PUT").body).hashtags, ["#AI", "#業務効率化"]);
  assert.match(fs.readFileSync(file, "utf8"), /url: https:\/\/note\.com\/shanaiai\/n\/nkey1001/);

  const dir2 = tmpNotes({ "notes/ai.md": post(), "notes/fig.png": PNG });
  const stuck = fakeNote({ publishWorks: false });
  const [bad] = await syncNotes({ files: [path.join(dir2, "notes/ai.md")], client: new NoteClient("s", { fetch: stuck.fetch }), profile, fetchPage: stuck.fetch, publish: true, ...quiet });
  assert.equal(bad.action, "failed");
  assert.match(bad.reason, /isn't public: open https:\/\/editor\.note\.com\/notes\/nkey1001\/edit\//);
  assert.doesNotMatch(fs.readFileSync(path.join(dir2, "notes/ai.md"), "utf8"), /^url: https/m);
});
