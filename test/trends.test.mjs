import assert from "node:assert/strict";
import { test } from "node:test";
import { noteTrending, notesInPage, qiitaTrending, trendDigest, zennTrending } from "../scripts/lib/trends.mjs";

const now = new Date("2026-11-18T06:00:00+09:00");
const response = (body, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
  text: async () => body,
});

// A note.com page carries its notes in Next.js flight data: JSON inside JS string literals.
const notePage = (notes) =>
  `<html><script>self.__next_f.push([1,${JSON.stringify(`5:{"items":${JSON.stringify(notes)}}`)}])</script></html>`;
const note = (key, name, likeCount, publishAt, price = 0) => ({ id: 1, key, name, likeCount, publishAt, price, user: { id: 2, urlname: "someone", likeCount: 99999 } });

test("Zenn: the week's tech articles, most-liked first", async () => {
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), response({ articles: [{ title: "A", liked_count: 5 }, { title: "B\nwith a newline", liked_count: 50 }, { title: "C" }] }));
  assert.deepEqual(await zennTrending(fetchImpl), [
    { likes: 50, title: "B with a newline" },
    { likes: 5, title: "A" },
  ]);
  assert.match(urls[0], /order=weekly&article_type=tech/);
});

test("Qiita: articles of the past 14 days with their tags, most-liked first", async () => {
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), response([{ title: "X", likes_count: 3, tags: [{ name: "Python" }] }, { title: "Y", likes_count: 30, tags: [{ name: "ポエム" }] }]));
  assert.deepEqual(await qiitaTrending(fetchImpl, now), [
    { likes: 30, title: "Y", tags: ["ポエム"] },
    { likes: 3, title: "X", tags: ["Python"] },
  ]);
  assert.match(decodeURIComponent(urls[0]), /created:>=2026-11-04 stocks:>=20/);
});

test("note: each note's own like count, never a neighbour's or its author's", () => {
  const html = notePage([note("n0123456789ab", "一つ目", 120, "2026-11-10T09:00:00+09:00"), note("n0123456789cd", "二つ目", 7, "2026-11-11T09:00:00+09:00")]);
  assert.deepEqual(
    notesInPage(html).map((n) => [n.title, n.likes]),
    [
      ["一つ目", 120],
      ["二つ目", 7],
    ],
  );
});

test("note: free posts of the past 30 days only", async () => {
  const html = notePage([
    note("n0123456789ab", "新しい無料", 300, "2026-11-10T09:00:00+09:00"),
    note("n0123456789cd", "有料", 900, "2026-11-10T09:00:00+09:00", 500),
    note("n0123456789ef", "古い", 2000, "2026-09-01T09:00:00+09:00"),
  ]);
  assert.deepEqual(await noteTrending(async () => response(html), now), [{ likes: 300, title: "新しい無料" }]);
});

test("the digest lists each source that answered and skips one that failed", async () => {
  const logs = [];
  const fetchImpl = async (url) => {
    if (url.includes("zenn.dev")) return response({ articles: [{ title: "Zの記事", liked_count: 10 }] });
    if (url.includes("qiita.com")) return response({ message: "Rate limit exceeded" }, 403);
    return response(notePage([note("n0123456789ab", "noteの記事", 200, "2026-11-12T09:00:00+09:00")]));
  };
  const digest = await trendDigest({ fetchImpl, now, log: (m) => logs.push(m) });
  assert.match(digest, /^Zenn: .*\n- 10 likes · Zの記事/);
  assert.match(digest, /note: .*\n- 200 likes · noteの記事/);
  assert.doesNotMatch(digest, /Qiita/);
  assert.match(logs.join("\n"), /Qiita skipped \(HTTP 403\)/);
  assert.equal(await trendDigest({ fetchImpl: async () => Promise.reject(new Error("offline")), now }), "", "nothing at all: empty, and the writer goes on");
});
