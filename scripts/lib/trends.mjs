// What readers are liking right now: the most-liked recent articles on Zenn, Qiita and note,
// as a short digest the topic step reads (topicPrompt in writer-core.mjs), so each morning's
// topic and title are planned against what is actually being liked, not a guess.
// Public data only: Zenn's article API, Qiita's API v2, and note's public hashtag page (note's
// robots.txt disallows /api/ for crawlers, so its API isn't used). Nothing about the author is
// sent. Each source is fetched once per run; one that fails is left out and the writer carries on.

const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; writing-trends/1.0)", accept: "application/json, text/html" };
const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

async function get(fetchImpl, url, as) {
  const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

// Other people's titles go into a prompt: one line each, no markup that could pass for instructions.
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/[<>`]/g, "").trim().slice(0, 100);

/** Zenn: the most-liked tech articles of the past week. */
export async function zennTrending(fetchImpl = globalThis.fetch, n = 12) {
  const j = await get(fetchImpl, "https://zenn.dev/api/articles?order=weekly&article_type=tech&count=100", "json");
  return (j.articles ?? [])
    .filter((a) => typeof a.liked_count === "number" && a.title)
    .sort((a, b) => b.liked_count - a.liked_count)
    .slice(0, n)
    .map((a) => ({ likes: a.liked_count, title: clean(a.title) }));
}

/** Qiita: the most-liked articles created in the past 14 days (with their tags, e.g. #ポエム). */
export async function qiitaTrending(fetchImpl = globalThis.fetch, now = new Date(), n = 12) {
  // 14 days back, as a Japan-time date (Qiita's dates are Japan time).
  const since = new Date(now.getTime() + 9 * 3_600_000 - 14 * DAY_MS).toISOString().slice(0, 10);
  const query = encodeURIComponent(`created:>=${since} stocks:>=20`);
  const j = await get(fetchImpl, `https://qiita.com/api/v2/items?query=${query}&per_page=100`, "json");
  if (!Array.isArray(j)) throw new Error("unexpected response");
  return j
    .filter((a) => typeof a.likes_count === "number" && a.title)
    .sort((a, b) => b.likes_count - a.likes_count)
    .slice(0, n)
    .map((a) => ({ likes: a.likes_count, title: clean(a.title), tags: (a.tags ?? []).map((t) => clean(t.name)).filter(Boolean) }));
}

/**
 * The notes embedded in a note.com page (Next.js flight data): each is the innermost JSON object
 * with its own "likeCount", parsed whole so a count is never paired with a neighbour's title.
 */
export function notesInPage(html) {
  let text = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      text += JSON.parse(m[1]);
    } catch {}
  }
  const notes = new Map();
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (stack.length && text.startsWith('"likeCount":', i)) stack.at(-1).hasLike = true;
      i = j;
    } else if (c === "{") stack.push({ start: i, hasLike: false });
    else if (c === "}" && stack.length) {
      const o = stack.pop();
      if (!o.hasLike) continue;
      try {
        const n = JSON.parse(text.slice(o.start, i + 1));
        if (/^n[0-9a-f]{12}$/.test(n.key ?? "") && typeof n.likeCount === "number" && n.name) {
          const prev = notes.get(n.key);
          if (!prev || prev.likes < n.likeCount) notes.set(n.key, { likes: n.likeCount, title: n.name, publishAt: n.publishAt ?? "", price: n.price ?? 0 });
        }
      } catch {}
    }
  }
  return [...notes.values()];
}

/** note: the most-liked free posts of the past 30 days on a hashtag's public page. */
export async function noteTrending(fetchImpl = globalThis.fetch, now = new Date(), n = 10, hashtag = "生成AI") {
  const html = await get(fetchImpl, `https://note.com/hashtag/${encodeURIComponent(hashtag)}`, "text");
  return notesInPage(html)
    .filter((x) => !x.price && x.publishAt && now.getTime() - Date.parse(x.publishAt) <= 30 * DAY_MS)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, n)
    .map((x) => ({ likes: x.likes, title: clean(x.title) }));
}

const line = (x) => `- ${x.likes} likes · ${x.title}${x.tags?.length ? ` (${x.tags.map((t) => `#${t}`).join(" ")})` : ""}`;

/** The digest for the topic step: one titled list per source that answered; "" if none did. */
export async function trendDigest({ fetchImpl = globalThis.fetch, now = new Date(), log = () => {} } = {}) {
  const sources = [
    ["Zenn: the most-liked tech articles of the past week (readers: engineers)", () => zennTrending(fetchImpl)],
    ["Qiita: the most-liked articles of the past 14 days (readers: engineers)", () => qiitaTrending(fetchImpl, now)],
    ["note: the most-liked free #生成AI posts of the past 30 days (readers: mostly non-engineers)", () => noteTrending(fetchImpl, now)],
  ];
  const parts = [];
  for (const [label, fetchList] of sources) {
    try {
      const items = await fetchList();
      if (items.length) parts.push(`${label}\n${items.map(line).join("\n")}`);
      else log(`trends: ${label.split(":")[0]} returned nothing`);
    } catch (err) {
      log(`trends: ${label.split(":")[0]} skipped (${err.message})`);
    }
  }
  return parts.join("\n\n");
}
