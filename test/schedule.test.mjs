import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import matter from "gray-matter";
import { crosspost, msUntil, withoutCta } from "../scripts/crosspost.mjs";
import { listArticles } from "../scripts/lib/site-core.mjs";
import { isLive, nextFreeSlot, publishedAt, zennToNote, zennToQiita } from "../scripts/lib/schedule.mjs";
import { validateArticle } from "../scripts/lib/validate-core.mjs";

const jst = (s) => new Date(`${s}+09:00`);

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-test-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}
const zenn = (title, { published = true, at = null, topics = "[ai, rag]" } = {}) =>
  `---\ntitle: ${title}\nemoji: "🤖"\ntype: tech\ntopics: ${topics}\npublished: ${published}\n${at ? `published_at: "${at}"\n` : ""}---\n\n本文。[相談する](https://x.example/)\n`;
const profile = { site_url: "https://codemonkey0612.github.io/", platforms: { zenn: "takumiengineer", qiita: "takumi_engineer", github: "codemonkey0612" }, todos: [] };

test("published_at is Japan time, like Zenn reads it", () => {
  assert.equal(publishedAt("2026-11-10 09:00").toISOString(), "2026-11-10T00:00:00.000Z");
  assert.equal(publishedAt(new Date("2026-11-10")).toISOString(), "2026-11-09T15:00:00.000Z", "a bare date means 00:00 JST");
  assert.equal(publishedAt("10 Nov"), null);
  assert.equal(isLive({ published: true, published_at: "2026-11-10 09:00" }, jst("2026-11-10T08:59")), false);
  assert.equal(isLive({ published: true, published_at: "2026-11-10 09:00" }, jst("2026-11-10T09:00")), true);
  assert.equal(isLive({ published: false }, jst("2030-01-01T00:00")), false);
});

test("a new article gets the next morning with no post", () => {
  const dir = repo({
    "articles/day-one-article.md": zenn("1", { at: "2026-11-10 09:00" }),
    "articles/day-three-article.md": zenn("3", { at: "2026-11-12 09:00", published: false }),
  });
  assert.equal(nextFreeSlot(dir, jst("2026-11-09T22:00")), "2026-11-11 09:00");
  assert.equal(nextFreeSlot(dir, jst("2026-11-12T10:00")), "2026-11-13 09:00");
});

test("Zenn-only Markdown becomes Qiita and note Markdown", () => {
  const md = [
    ":::message",
    "ポイント",
    ":::",
    ":::message alert",
    "注意",
    ":::",
    "::::details 詳しく",
    ":::message",
    "入れ子",
    ":::",
    "::::",
    "@[youtube](dQw4w9WgXcQ)",
    "@[card](https://zenn.dev/takumiengineer)",
    "![図](/images/rag-flow.png)",
  ].join("\n");
  const base = "https://raw.githubusercontent.com/codemonkey0612/codemonkey0612.github.io/main/images/";
  assert.equal(
    zennToQiita(md, { base }),
    [
      ":::note info",
      "ポイント",
      ":::",
      ":::note alert",
      "注意",
      ":::",
      "<details><summary>詳しく</summary>\n",
      ":::note info",
      "入れ子",
      ":::",
      "\n</details>",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://zenn.dev/takumiengineer",
      `![図](${base}rag-flow.png)`,
    ].join("\n"),
  );
  assert.equal(zennToNote(":::message\nポイント\n:::\n本文", { base }), "> ポイント\n本文");
  assert.equal(zennToNote("::: details 詳しく\n中身\n:::", { base }), "**詳しく**\n\n中身");
});

test("the daily job copies only the articles that are due to Qiita, keeps Qiita's id, and never overwrites your own Qiita posts", () => {
  const dir = repo({
    "articles/live-article-01.md": zenn("今日の記事", { at: "2026-11-10 09:00" }),
    "articles/later-article-1.md": zenn("明日の記事", { at: "2026-11-11 09:00" }),
    "articles/draft-article-1.md": zenn("下書き", { published: false, at: "2026-11-09 09:00" }),
    "articles/no-topic-article.md": zenn("タグなし", { at: "2026-11-01 09:00", topics: "[]" }),
    "articles/my-own-qiita-1.md": zenn("自分のQiita", { at: "2026-11-02 09:00" }),
    "public/my-own-qiita-1.md": "---\ntitle: 手書き\ntags: [x]\nprivate: false\nignorePublish: false\n---\n手書きのQiita記事\n",
  });
  const now = jst("2026-11-10T09:00");
  const results = crosspost({ root: dir, profile, now });
  const by = Object.fromEntries(results.map((r) => [r.slug, r.action]));
  assert.deepEqual(by, { "no-topic-article": "failed", "my-own-qiita-1": "skipped", "live-article-01": "created" });
  const copy = path.join(dir, "public/live-article-01.md");
  const { data, content } = matter(fs.readFileSync(copy, "utf8"));
  assert.deepEqual([data.title, data.tags, data.ignorePublish, data.private, data.id], ["今日の記事", ["ai", "rag"], false, false, null]);
  assert.match(content, /^<!-- crossposted from articles\/live-article-01\.md/);
  assert.match(fs.readFileSync(path.join(dir, "public/my-own-qiita-1.md"), "utf8"), /手書きのQiita記事/);
  assert.ok(!fs.existsSync(path.join(dir, "public/later-article-1.md")), "tomorrow's article waits");

  // qiita-cli publishes and writes the id back; a later edit on Zenn updates the same Qiita post.
  fs.writeFileSync(copy, fs.readFileSync(copy, "utf8").replace("id: null", "id: abc123").replace("updated_at: \"\"", "updated_at: '2026-11-10T09:01:00+09:00'"));
  assert.equal(crosspost({ root: dir, profile, now }).find((r) => r.slug === "live-article-01").action, "unchanged");
  const src = path.join(dir, "articles/live-article-01.md");
  fs.writeFileSync(src, fs.readFileSync(src, "utf8").replace("本文。", "本文を直しました。"));
  assert.equal(crosspost({ root: dir, profile, now }).find((r) => r.slug === "live-article-01").action, "updated");
  const updated = matter(fs.readFileSync(copy, "utf8"));
  assert.equal(updated.data.id, "abc123");
  assert.match(updated.content, /本文を直しました/);
});

test("the morning run waits for 09:00 Japan time, but never for long", () => {
  assert.equal(msUntil("09:00", jst("2026-11-10T08:45")), 15 * 60 * 1000);
  assert.equal(msUntil("09:00", jst("2026-11-10T09:05")), 0, "late cron: publish right away");
  assert.equal(msUntil("09:00", jst("2026-11-10T05:00")), 0, "more than 3 h early: don't wait");
});

test("the site lists a post once it's live, once even when it's on Zenn and Qiita", () => {
  const dir = repo({
    "articles/live-article-01.md": zenn("今日の記事", { at: "2020-01-01 09:00" }),
    "articles/later-article-1.md": zenn("未来の記事", { at: "2999-01-01 09:00" }),
    "public/live-article-01.md": "---\ntitle: 今日の記事\ntags: [ai]\nprivate: false\nignorePublish: false\nid: abc123\n---\n本文\n",
  });
  const list = listArticles(dir, profile);
  assert.deepEqual(list.map((a) => [a.platform, a.title]), [["zenn", "今日の記事"]]);
});

test("a Zenn article's published_at must be a date and time", () => {
  const article = (at) => ({ file: "/x/articles/scheduled-article.md", platform: "zenn", data: matter(zenn("t", { at })).data, content: "本文", raw: "" });
  const p = { ...profile, todos: [] };
  assert.ok(validateArticle(article("2026-11-10 09:00"), p).errors.every((e) => !/published_at/.test(e)));
  assert.ok(validateArticle(article("明日の朝"), p).errors.some((e) => /published_at/.test(e)));
});

test("with note on, due articles also get a note copy with a header image; your own note posts and published ones are left alone", () => {
  const dir = repo({
    "articles/live-article-01.md": zenn("今日の記事", { at: "2026-11-10 09:00" }),
    "articles/own-note-post-1.md": zenn("自分のnote", { at: "2026-11-02 09:00" }),
    "notes/own-note-post-1.md": "---\ntitle: 手書き\nstatus: ready\n---\n手書きのnote\n",
  });
  const covers = [];
  const cover = ({ title, out }) => (covers.push(title), fs.writeFileSync(out, "png"), true);
  const now = jst("2026-11-10T09:00");
  const results = crosspost({ root: dir, profile, now, note: true, cover });
  const note = Object.fromEntries(results.filter((r) => r.platform === "note").map((r) => [r.slug, r.action]));
  assert.deepEqual(note, { "own-note-post-1": "skipped", "live-article-01": "created" });
  const copy = path.join(dir, "notes/live-article-01.md");
  const { data, content } = matter(fs.readFileSync(copy, "utf8"));
  assert.deepEqual([data.title, data.status, data.hashtags, data.cover, data.url], ["今日の記事", "ready", ["ai", "rag"], "live-article-01.png", null]);
  assert.match(content, /^<!-- crossposted from articles\/live-article-01\.md/);
  assert.deepEqual(covers, ["今日の記事"], "one cover, for the new copy");

  // Drafted on note (ids written back), then the Zenn article is edited: the copy follows, ids kept.
  fs.writeFileSync(copy, fs.readFileSync(copy, "utf8").replace("url: null", 'note_id: "55"\nnote_key: nabc\nurl: null'));
  const src = path.join(dir, "articles/live-article-01.md");
  fs.writeFileSync(src, fs.readFileSync(src, "utf8").replace("本文。", "本文を直しました。"));
  assert.equal(crosspost({ root: dir, profile, now, note: true, cover }).find((r) => r.platform === "note" && r.slug === "live-article-01").action, "updated");
  const updated = matter(fs.readFileSync(copy, "utf8"));
  assert.equal(updated.data.note_id, "55");
  assert.match(updated.content, /本文を直しました/);
  assert.equal(covers.length, 1, "the cover isn't made again");

  // Once it's public on note, the copy is left alone.
  fs.writeFileSync(copy, fs.readFileSync(copy, "utf8").replace("url: null", "url: https://note.com/shanaiai/n/nabc"));
  fs.writeFileSync(src, fs.readFileSync(src, "utf8").replace("本文を直しました。", "もう一度直しました。"));
  assert.equal(crosspost({ root: dir, profile, now, note: true, cover }).find((r) => r.platform === "note" && r.slug === "live-article-01").action, "unchanged");
  assert.doesNotMatch(fs.readFileSync(copy, "utf8"), /もう一度/);
});

test("a header image you put at notes/<slug>.jpg (or .png) is used instead of making one", () => {
  const dir = repo({ "articles/live-article-01.md": zenn("今日の記事", { at: "2026-11-10 09:00" }), "notes/live-article-01.jpg": "jpeg" });
  let made = 0;
  crosspost({ root: dir, profile, now: jst("2026-11-10T09:00"), note: true, cover: () => (made++, true) });
  assert.equal(matter(fs.readFileSync(path.join(dir, "notes/live-article-01.md"), "utf8")).data.cover, "live-article-01.jpg");
  assert.equal(made, 0);
});

test("qiita: off makes no Qiita copies; Qiita copies never carry the promotional closing paragraph", () => {
  const dir = repo({ "articles/live-article-01.md": zenn("今日の記事", { at: "2026-11-10 09:00" }) });
  const now = jst("2026-11-10T09:00");
  assert.deepEqual(crosspost({ root: dir, profile, now, qiita: false, note: true, cover: () => false }).map((r) => r.platform), ["note"]);
  assert.ok(!fs.existsSync(path.join(dir, "public/live-article-01.md")));

  const md = "本文です。\n\n## まとめ\n\n- 要点\n\n---\n\n私は「AI」をお仕事としてお受けしています。\n→ [AIについて](https://codemonkey0612.github.io/services/ai/) ／ [相談](https://www.lancers.jp/x)\n";
  assert.equal(withoutCta(md, { site_url: "https://codemonkey0612.github.io/", contact_url: "https://www.lancers.jp/x" }), "本文です。\n\n## まとめ\n\n- 要点\n");
  const plain = "前半\n\n---\n\n後半はただの区切り\n";
  assert.equal(withoutCta(plain, { site_url: "https://codemonkey0612.github.io/" }), plain, "a horizontal rule without your links stays");
});
