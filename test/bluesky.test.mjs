import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { clip, composePost, lead, loadRecord, syncBluesky } from "../scripts/bluesky-post.mjs";
import { BlueskyClient, graphemeLength, richText } from "../scripts/lib/bluesky-client.mjs";

const profile = {
  site_url: "https://codemonkey0612.github.io/",
  brand: "匠｜AI・Webシステム開発",
  platforms: { zenn: "takumiengineer", bluesky: "takumi.bsky.social" },
};
const PDS = "https://pds.example";

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluesky-test-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}
const zenn = (title, at, { topics = "[python, rag, ai, llm]", body = "最初の段落です。`tenant_id` を **必ず** 付けます。二文目です。" } = {}) =>
  `---\ntitle: ${title}\nemoji: "🤖"\ntype: tech\ntopics: ${topics}\npublished: true\npublished_at: "${at}"\n---\n\n<!-- 読者: エンジニア -->\n## はじめに\n\n${body}\n\n## 本題\n\n本文。\n\n---\n\n私は「AI」をお仕事としてお受けしています。\n→ [AIチャットボットについて](https://codemonkey0612.github.io/services/ai-chatbot/) ／ [相談](https://www.lancers.jp/x)\n`;

// A fake Bluesky server: sign-in, own posts, image upload, new posts; and Zenn's public pages.
function fakeBluesky({ password = "app-pass", existing = [], zennUp = true } = {}) {
  const calls = [];
  const posts = [...existing];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: `${u.origin}${u.pathname}`, auth: init.headers?.authorization, body: init.body });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.hostname === "zenn.dev") return new Response("", { status: zennUp ? 200 : 404 });
    if (u.pathname === "/xrpc/com.atproto.server.createSession") {
      const { identifier, password: p } = JSON.parse(init.body);
      if (p !== password) return json({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401);
      return json({ did: "did:plc:abc", handle: identifier, accessJwt: "jwt", didDoc: { service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] } });
    }
    if (init.headers?.authorization !== "Bearer jwt") return json({ error: "AuthRequired" }, 401);
    if (u.pathname === "/xrpc/com.atproto.repo.listRecords") return json({ records: posts.slice().reverse() });
    if (u.pathname === "/xrpc/com.atproto.repo.uploadBlob") return json({ blob: { $type: "blob", ref: { $link: "bafyimg" }, mimeType: init.headers["content-type"], size: init.body.length } });
    if (u.pathname === "/xrpc/com.atproto.repo.createRecord") {
      const { record } = JSON.parse(init.body);
      const uri = `at://did:plc:abc/app.bsky.feed.post/rkey${posts.length + 1}`;
      posts.push({ uri, value: record });
      return json({ uri, cid: "cid" });
    }
    return json({ error: "NotFound" }, 404);
  };
  return { fetch, calls, posts, client: new BlueskyClient({ handle: "takumi.bsky.social", appPassword: "app-pass" }, { fetch, service: "https://bsky.social" }) };
}

test("text helpers: the opening paragraph without Markdown, clipped at a sentence; links and tags as byte-offset facets", () => {
  assert.equal(lead("<!-- x -->\n## 見出し\n\n```js\nconst a = 1;\n```\n\n[リンク](https://a.example)と`tenant_id`と**強調**。\n続き。\n\n次の段落。"), "リンクと tenant_id と強調。続き。".replace(/ /g, ""));
  assert.equal(clip("一文目です。二文目はとても長い文章です。", 12), "一文目です。");
  assert.equal(clip("区切りのないとても長い文章", 6), "区切りのな…");
  assert.equal(clip("短い", 10), "短い");
  const rt = richText(["日本語 ", { text: "site.example", link: "https://site.example/" }, " ", { text: "#rag", tag: "rag" }]);
  assert.equal(rt.text, "日本語 site.example #rag");
  assert.deepEqual(rt.facets[0].index, { byteStart: 10, byteEnd: 22 }, "UTF-8 bytes, not characters");
  assert.equal(Buffer.from(rt.text).subarray(rt.facets[1].index.byteStart, rt.facets[1].index.byteEnd).toString(), "#rag");
});

test("a post: title, opening, the service page the article ends with, three hashtags, a card to the article; never over 300", () => {
  const article = { slug: "s", data: { title: "記事のタイトル", topics: ["python", "rag", "ai", "llm"] }, content: zenn("x", "2026-11-11 09:00").split("---\n").slice(2).join("---\n") };
  const post = composePost(article, { profile, articleUrl: "https://zenn.dev/takumiengineer/articles/s" });
  assert.equal(post.text, "📝 新しい記事：記事のタイトル\n\n最初の段落です。tenant_id を 必ず 付けます。二文目です。\n\n💼 AI・Web開発のご相談 → codemonkey0612.github.io/services/ai-chatbot\n#python #rag #ai");
  assert.deepEqual(post.facets.map((f) => f.features[0].uri ?? `#${f.features[0].tag}`), ["https://codemonkey0612.github.io/services/ai-chatbot/", "#python", "#rag", "#ai"]);
  assert.deepEqual(post.embed.external, { uri: "https://zenn.dev/takumiengineer/articles/s", title: "記事のタイトル", description: "匠｜AI・Webシステム開発の技術記事（Zenn）" });
  assert.deepEqual(post.langs, ["ja"]);

  const long = composePost({ ...article, data: { ...article.data, title: "長".repeat(70) }, content: `${"とても長い文章です。".repeat(60)}\n` }, { profile, articleUrl: "https://zenn.dev/x" });
  assert.ok(graphemeLength(long.text) <= 300, `${graphemeLength(long.text)} graphemes`);
  assert.match(long.text, /。\n\n💼/);
});

test("posts each new article once, with the package image as the card thumbnail, and records it", async () => {
  const dir = repo({
    "articles/old-article-0001.md": zenn("先週の記事", "2026-11-01 09:00"),
    "articles/new-article-0001.md": zenn("今日の記事", "2026-11-11 09:00"),
    "articles/next-article-001.md": zenn("明日の記事", "2026-11-12 09:00"),
    "notes/new-article-0001.md": "---\ntitle: 今日の記事\ncover: covers/1.jpg\n---\n本文\n",
    "notes/covers/1.jpg": "JPEGDATA",
  });
  const now = new Date("2026-11-11T00:05:00Z");
  const fake = fakeBluesky();
  const results = await syncBluesky({ root: dir, client: fake.client, profile, now, fetchPage: fake.fetch });
  assert.deepEqual(results, [{ slug: "new-article-0001", action: "posted", url: "https://bsky.app/profile/takumi.bsky.social/post/rkey1" }]);
  assert.equal(fake.posts.length, 1, "nothing older than two days, nothing not yet live");
  const record = fake.posts[0].value;
  assert.equal(record.$type, "app.bsky.feed.post");
  assert.equal(record.embed.external.uri, "https://zenn.dev/takumiengineer/articles/new-article-0001");
  assert.equal(record.embed.external.thumb.ref.$link, "bafyimg");
  assert.ok(fake.calls.filter((c) => c.path.includes("/xrpc/") && !c.path.endsWith("createSession")).every((c) => c.path.startsWith(PDS)), "calls go to the account's own server");
  assert.deepEqual(Object.keys(loadRecord(dir)), ["new-article-0001"]);
  assert.match(fs.readFileSync(path.join(dir, "social/bluesky.yml"), "utf8"), /^# Bluesky posts/);

  fake.calls.length = 0;
  assert.deepEqual(await syncBluesky({ root: dir, client: fake.client, profile, now, fetchPage: fake.fetch }), []);
  assert.equal(fake.calls.length, 0, "a recorded article costs no calls");
});

test("an article already posted (its record lost) is found, not posted again; one not up on Zenn waits", async () => {
  const dir = repo({ "articles/new-article-0001.md": zenn("今日の記事", "2026-11-11 09:00") });
  const now = new Date("2026-11-11T00:05:00Z");
  const fake = fakeBluesky({ existing: [{ uri: "at://did:plc:abc/app.bsky.feed.post/old1", value: { createdAt: "2026-11-11T00:01:00Z", embed: { external: { uri: "https://zenn.dev/takumiengineer/articles/new-article-0001" } } } }] });
  const [found] = await syncBluesky({ root: dir, client: fake.client, profile, now, fetchPage: fake.fetch });
  assert.equal(found.action, "found");
  assert.equal(fake.posts.length, 1);
  assert.equal(loadRecord(dir)["new-article-0001"].url, "https://bsky.app/profile/takumi.bsky.social/post/old1");

  const dir2 = repo({ "articles/new-article-0001.md": zenn("今日の記事", "2026-11-11 09:00") });
  const down = fakeBluesky({ zennUp: false });
  const [waiting] = await syncBluesky({ root: dir2, client: down.client, profile, now, fetchPage: down.fetch });
  assert.equal(waiting.action, "waiting");
  assert.equal(down.posts.length, 0);
  assert.deepEqual(loadRecord(dir2), {});
});

test("a wrong App Password stops the run with what to check; the client can't delete or follow", async () => {
  const dir = repo({ "articles/new-article-0001.md": zenn("今日の記事", "2026-11-11 09:00") });
  const fake = fakeBluesky({ password: "other" });
  await assert.rejects(syncBluesky({ root: dir, client: fake.client, profile, now: new Date("2026-11-11T00:05:00Z"), fetchPage: fake.fetch }), (err) => err.name === "BlueskyAuthError" && /App Password/.test(err.message));
  assert.equal(typeof fake.client.delete, "undefined");
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(fake.client)).sort(), ["call", "constructor", "login", "post", "recentPosts", "uploadImage"]);
  assert.equal(YAML.stringify(loadRecord(dir)), "{}\n");
});
