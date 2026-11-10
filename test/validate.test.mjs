import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ROOT } from "../scripts/lib/common.mjs";
import { validateArticle } from "../scripts/lib/validate-core.mjs";

const profile = {
  site_url: "https://me.example",
  contact_url: "https://me.example/contact",
  persona: "私",
  todos: [],
};
const cta = "\n\n→ [相談する](https://me.example/contact)";
const zenn = (data, content = `本文${cta}`, slug = "valid-slug-123") => ({
  file: path.join(ROOT, "articles", `${slug}.md`),
  platform: "zenn",
  data: { title: "タイトル", emoji: "🤖", type: "tech", topics: ["rag"], published: true, ...data },
  content,
});
const qiita = (data, content = `本文${cta}`) => ({
  file: path.join(ROOT, "public", "x.md"),
  platform: "qiita",
  data: { title: "t", tags: ["Python"], private: false, ignorePublish: false, ...data },
  content,
});
const note = (data, content = `本文${cta}`) => ({
  file: path.join(ROOT, "notes", "x.md"),
  platform: "note",
  data: { title: "t", status: "ready", hashtags: [], ...data },
  content,
});

test("a correct, publish-ready Zenn article passes", () => {
  const r = validateArticle(zenn({}), profile);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ready, true);
});

test("Zenn rules from zenn-cli are enforced", () => {
  const errs = (a) => validateArticle(a, profile).errors.join("\n");
  assert.match(errs(zenn({}, undefined, "short")), /slug/);
  assert.match(errs(zenn({ title: "あ".repeat(71) })), /70/);
  assert.match(errs(zenn({ emoji: "🤖🤖" })), /exactly one emoji/);
  assert.match(errs(zenn({ type: "blog" })), /tech/);
  assert.match(errs(zenn({ topics: ["a", "b", "c", "d", "e", "f"] })), /at most 5/);
  assert.match(errs(zenn({ topics: ["c++"] })), /symbols/);
  assert.match(errs(zenn({ tags: ["x"] })), /topics, not tags/);
  assert.equal(errs(zenn({ topics: ["生成AI", "nextjs"] })), "");
});

test("Qiita needs 1–5 tags", () => {
  assert.match(validateArticle(qiita({ tags: [] }), profile).errors.join(), /1–5 tags/);
  assert.match(validateArticle(qiita({ tags: ["a b"] }), profile).errors.join(), /non-empty word/);
});

test("publish-ready posts must link back to your site", () => {
  const r = validateArticle(note({}, "本文だけ"), profile);
  assert.match(r.errors.join(), /no link to your site/);
  const draft = validateArticle(note({ status: "draft" }, "本文だけ"), profile);
  assert.deepEqual(draft.errors, [], "drafts may skip the call to action");
  const onQiita = validateArticle(qiita({}, "本文だけ"), profile);
  assert.doesNotMatch(onQiita.errors.join(), /no link to your site/, "Qiita articles leave the promotional links out");
});

test("statistics need an outside source", () => {
  const body = `社員の41%が確認せずにAIを使っている。${cta}`;
  assert.match(validateArticle(note({}, body), profile).errors.join(), /no source links/);
  const sourced = `${body}\n\n- [調査](https://survey.example/report)`;
  assert.deepEqual(validateArticle(note({}, sourced), profile).errors, []);
  assert.match(validateArticle(note({ status: "draft" }, body), profile).warnings.join(), /no source links/);
});

test("profile TODOs block publishing", () => {
  const r = validateArticle(note({}), { ...profile, todos: ["site_url"] });
  assert.match(r.errors.join(), /TODO/);
});

test("leftover placeholders block publishing, warn in drafts", () => {
  assert.match(validateArticle(note({}, `TODO: 書く${cta}`), profile).errors.join(), /placeholder/);
  assert.match(validateArticle(note({ status: "draft" }, "TODO"), profile).warnings.join(), /placeholder/);
});

test("mixed first-person words are flagged", () => {
  const r = validateArticle(note({}, `私は書いた。僕は思う。私たちは平気。${cta}`), profile);
  assert.match(r.warnings.join(), /僕×1/);
  const clean = validateArticle(note({}, `私は書いた。私たちは平気。${cta}`), profile);
  assert.equal(clean.warnings.length, 0);
});

test("your own published results don't need an outside source", () => {
  const own = { ...profile, cases: [{ result: "作業時間を約75%削減した。" }], lancers: { completion_rate: "100%" } };
  const r = validateArticle(zenn({}, `作業時間を75％減らし、完了率は100%です。${cta}`), own);
  assert.deepEqual(r.errors, []);
  const other = validateArticle(zenn({}, `導入企業の42%が効果を実感。${cta}`), own);
  assert.match(other.errors.join(), /42%/, "numbers that aren't yours still need a source");
});

test("only the username of the post's own platform blocks publishing", () => {
  const p = { ...profile, todos: ["platforms.qiita", "platforms.note"] };
  assert.deepEqual(validateArticle(zenn({}), p).errors, []);
  assert.match(validateArticle(qiita({}), p).errors.join(), /platforms\.qiita/);
  assert.doesNotMatch(validateArticle(qiita({}), p).errors.join(), /platforms\.note/);
});

test("a note url must be the published note link", () => {
  assert.deepEqual(validateArticle(note({ url: "https://note.com/me/n/n0123abcd" }), profile).errors, []);
  assert.match(validateArticle(note({ url: "https://example.com/x" }), profile).errors.join(), /url must be/);
});
