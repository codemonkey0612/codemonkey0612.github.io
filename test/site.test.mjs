import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadProfile, ROOT } from "../scripts/lib/common.mjs";
import { careerYears, esc, listArticles, loadSite, renderGithubReadme, renderSite } from "../scripts/lib/site-core.mjs";

const today = new Date("2026-11-08T00:00:00+09:00");

test("career years count whole years from the start month", () => {
  assert.equal(careerYears("2015-04", today), 11);
  assert.equal(careerYears("2015-12", today), 10);
  assert.equal(careerYears("TODO", today), null);
});

test("esc escapes HTML", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("the real site builds: every page, link and structured-data block is valid", () => {
  const profile = loadProfile();
  const site = loadSite({ root: ROOT, profile, today });
  const files = renderSite(site);
  const pages = Object.keys(files).filter((f) => f.endsWith(".html"));
  assert.equal(pages.length, profile.services.length + 6);
  for (const s of profile.services) assert.ok(files[`services/${s.id}/index.html`], s.id);

  for (const page of pages) {
    const html = files[page];
    assert.doesNotMatch(html, /undefined|\[object Object\]|\bTODO\b|NaN/, page);
    assert.match(html, new RegExp(profile.contact_url.replace(/[.?]/g, "\\$&")), `${page} links to the contact page`);
    for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) JSON.parse(m[1]);
    if (page === "404.html") continue; // uses absolute links
    // Media is served from this site, never hotlinked from Lancers (its video URLs expire).
    assert.doesNotMatch(html, /(?:src|poster)="https?:\/\/[^"]*lancers\.jp/, `${page} hotlinks Lancers media`);
    // Every relative link, image and video points at a file the build produces.
    for (const [, href] of html.matchAll(/(?:href|src|poster)="([^"#:]+)(?:#[^"]*)?"/g)) {
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(page), href));
      if (target === "." || target === "./") target = "";
      const file = target === "" || target.endsWith("/") ? `${target}index.html` : target;
      const exists = files[file] ?? fs.existsSync(path.join(ROOT, "site", file));
      assert.ok(exists, `${page}: broken link ${href}`);
    }
  }
  assert.match(files["index.html"], /開発歴11年/);
  assert.match(files["sitemap.xml"], /<loc>https:\/\/[^<]+\/services\/ai-chatbot\/<\/loc>/);
  assert.match(renderGithubReadme(site), /\n\n## できること\n\n/, "README keeps blank lines between blocks");
  assert.match(renderGithubReadme(site), /\| \[生成AI・ChatGPT業務アプリ開発\]\(https:\/\/.+\/services\/ai-apps\/\) \| 48,000円〜 \|/);
});

test("prices on service pages come from site/packages.yml", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const chatbot = site.services.find((s) => s.id === "ai-chatbot");
  assert.equal(chatbot.priceFrom, 98000);
  assert.equal(chatbot.packages[0].url, "https://www.lancers.jp/menu/detail/1351686");
});

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-test-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}

test("only published articles with a public URL are listed, newest first", () => {
  const dir = tmpRepo({
    "articles/live-article-01.md": "---\ntitle: 公開済み\npublished: true\npublished_at: 2026-11-01 09:00\n---\n",
    "articles/draft-article-1.md": "---\ntitle: 下書き\npublished: false\n---\n",
    "public/q.md": "---\ntitle: Qiita\nignorePublish: false\nprivate: false\nid: abc123\npublished_at: 2026-11-05\n---\n",
    "public/q2.md": "---\ntitle: まだIDなし\nignorePublish: false\nprivate: false\nid: null\n---\n",
    "notes/n.md": "---\ntitle: note\nstatus: ready\nurl: https://note.com/me/n/n1\npublished_at: 2026-10-01\n---\n",
    "notes/n2.md": "---\ntitle: 未投稿\nstatus: ready\nurl: null\n---\n",
  });
  const list = listArticles(dir, { platforms: { zenn: "me", qiita: "me", note: "me" } });
  assert.deepEqual(
    list.map((a) => [a.platform, a.url]),
    [
      ["qiita", "https://qiita.com/me/items/abc123"],
      ["zenn", "https://zenn.dev/me/articles/live-article-01"],
      ["note", "https://note.com/me/n/n1"],
    ],
  );
  const noZenn = listArticles(dir, { platforms: { zenn: "TODO", qiita: "me" } });
  assert.ok(!noZenn.some((a) => a.platform === "zenn"), "no Zenn links without a Zenn username");
});

test("a service page that references a missing case or package fails the build", () => {
  const base = { "site/packages.yml": '"1":\n  title: P\n  plans: []\n' };
  const profile = { site_url: "https://x.example/", services: [{ id: "a", name: "A" }], cases: [] };
  const bad = tmpRepo({ ...base, "site/services/a.md": "---\ncases: [nope]\n---\n" });
  assert.throws(() => loadSite({ root: bad, profile, today }), /unknown case "nope"/);
  const badPkg = tmpRepo({ ...base, "site/services/a.md": "---\npackages: [2]\n---\n" });
  assert.throws(() => loadSite({ root: badPkg, profile, today }), /package 2/);
  const missing = tmpRepo(base);
  assert.throws(() => loadSite({ root: missing, profile, today }), /site\/services\/a\.md is missing/);
  const noVideo = tmpRepo({
    "site/packages.yml": '"1":\n  title: P\n  video: media/packages/1.mp4\n  plans: []\n',
    "site/services/a.md": "---\npackages: [1]\n---\n",
  });
  assert.throws(() => loadSite({ root: noVideo, profile, today }), /site\/assets\/media\/packages\/1\.mp4 does not exist/);
});

test("service pages show each package's cover and promo video", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  for (const s of site.services) {
    const html = files[`services/${s.id}/index.html`];
    for (const p of s.packages.filter((x) => x.video)) {
      assert.ok(html.includes(`<source src="../../${p.video}" type="video/mp4">`), `${s.id}: video of ${p.id}`);
      assert.ok(html.includes(`poster="../../${p.cover}"`), `${s.id}: poster of ${p.id}`);
    }
    if (s.packages.some((x) => x.video)) assert.match(html, /案内役は、AIで生成したキャラクターです/, `${s.id} says the presenter is AI`);
    if (s.cover) {
      assert.ok(files["index.html"].includes(`src="./${s.cover}"`), `home card of ${s.id} has its cover`);
      assert.ok(html.includes(`<meta property="og:image" content="${new URL(s.cover, site.profile.site_url).href}">`), `${s.id} share image`);
    }
  }
});

test("the site lists every Lancers review and package profile.yml counts", () => {
  const profile = loadProfile();
  const site = loadSite({ root: ROOT, profile, today });
  const count = (s) => Number(/^(\d+)/.exec(s)?.[1]);
  assert.equal(profile.testimonials.length, count(profile.lancers.reviews), "testimonials vs lancers.reviews");
  assert.equal(site.packages.length, count(profile.lancers.packages), "site/packages.yml vs lancers.packages");
  const files = renderSite(site);
  for (const t of profile.testimonials) assert.match(files["reviews/index.html"], new RegExp(`id="${t.id}"`));
  for (const p of site.packages) assert.match(files["prices/index.html"], new RegExp(`menu/detail/${p.id}"`));
  const ids = new Set(profile.testimonials.map((t) => t.id));
  assert.equal(ids.size, profile.testimonials.length, "testimonial ids are unique");
});
