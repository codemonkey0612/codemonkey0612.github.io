import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadProfile, ROOT } from "../scripts/lib/common.mjs";
import { careerYears, esc, imageSize, listArticles, loadSite, renderGithubReadme, renderSite } from "../scripts/lib/site-core.mjs";

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
  assert.equal(pages.length, profile.services.length + site.works.all.length + 6);
  for (const s of profile.services) assert.ok(files[`services/${s.id}/index.html`], s.id);
  for (const w of site.works.all) assert.ok(files[`works/${w.id}/index.html`], w.id);

  for (const page of pages) {
    const html = files[page];
    assert.doesNotMatch(html, /undefined|\[object Object\]|\bTODO\b|NaN/, page);
    assert.match(html, new RegExp(profile.contact_url.replace(/[.?]/g, "\\$&")), `${page} links to the contact page`);
    for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) JSON.parse(m[1]);
    if (page === "404.html") continue; // uses absolute links
    // Media is served from this site, never hotlinked from Lancers (its video URLs expire).
    assert.doesNotMatch(html, /(?:src|poster)="https?:\/\/[^"]*lancers\.jp/, `${page} hotlinks Lancers media`);
    // Every relative link, image and video points at a file the build produces.
    for (const [, href] of html.matchAll(/(?:href|src|poster)="([^"#:?]+)(?:\?[^"#]*)?(?:#[^"]*)?"/g)) {
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
    assert.ok(files["index.html"].includes(`href="./services/${s.id}/"`), `home links to ${s.id}`);
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

test("every work page is backed by something a visitor can check", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  assert.ok(site.works.sites.length >= 1 && site.works.lancers.length >= 1);
  for (const w of site.works.sites) {
    const html = files[`works/${w.id}/index.html`];
    assert.ok(html.includes(`href="${w.url}" target="_blank" rel="noopener"`), `${w.id} links to the live site`);
    assert.match(html, /開発に参加/, `${w.id} states the role`);
  }
  for (const w of site.works.lancers) {
    assert.ok(w.reviews.length > 0, `${w.id} has at least one review`);
    const html = files[`works/${w.id}/index.html`];
    for (const t of w.reviews) {
      assert.ok(html.includes(`reviews/#${t.id}`), `${w.id} links to review ${t.id}`);
      if (t.comment) assert.ok(html.includes(esc(t.comment)), `${w.id} quotes review ${t.id} in full`);
      assert.match(files["reviews/index.html"], new RegExp(`works/${w.id}/`), `review page links back to ${w.id}`);
    }
    if (w.job) assert.ok(html.includes(`https://www.lancers.jp/work/detail/${w.job}`), `${w.id} links to its public job post`);
    assert.doesNotMatch(html, /【クライアント様のご評価より】|【掲載画像】/, `${w.id}: Lancers-only blocks are dropped`);
  }
  const featured = site.works.lancers.filter((w) => w.featured);
  for (const w of featured) assert.ok(files["index.html"].includes(`works/${w.id}/`), `home shows featured ${w.id}`);
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html"))) {
    assert.match(files[page], /<meta property="og:image" content="https:\/\/[^"]+\.(png|jpg|webp)">/, `${page} has a share image`);
  }
});

test("works.yml typos fail the build", () => {
  const base = {
    "site/packages.yml": "{}\n",
    "site/assets/media/w.webp": "x",
  };
  const profile = { site_url: "https://x.example/", services: [], cases: [], testimonials: [{ id: "t1", comment: "c" }] };
  const badReview = tmpRepo({ ...base, "site/works.yml": "lancers:\n  - id: a\n    cover: media/w.webp\n    reviews: [t2]\n" });
  assert.throws(() => loadSite({ root: badReview, profile, today }), /unknown testimonial "t2"/);
  const badImage = tmpRepo({ ...base, "site/works.yml": "lancers:\n  - id: a\n    cover: media/missing.webp\n    reviews: [t1]\n" });
  assert.throws(() => loadSite({ root: badImage, profile, today }), /site\/assets\/media\/missing\.webp does not exist/);
  const dup = tmpRepo({ ...base, "site/works.yml": "lancers:\n  - { id: a, cover: media/w.webp, reviews: [t1] }\n  - { id: a, cover: media/w.webp, reviews: [t1] }\n" });
  assert.throws(() => loadSite({ root: dup, profile, today }), /duplicate id "a"/);
});

test("every page discloses the AI character, and the hero demo is real, highlighted code", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  // The character in the Lancers images and videos is AI-generated; every page says so (footer).
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html"))) {
    assert.match(files[page], /AIで生成したイメージキャラクター/, `${page} discloses the AI character`);
  }
  assert.match(files["works/index.html"], /カバー画像はイメージです/, "works index says the covers are illustrations");
  const home = files["index.html"];
  for (const file of ["rag.ts", "Sales.tsx", "ci.yml"]) assert.ok(home.includes(`>${file}</button>`), `demo tab ${file}`);
  assert.match(home, /<span class="tk-kw">export<\/span> <span class="tk-kw">async<\/span> <span class="tk-kw">function<\/span> <span class="tk-fn">answer<\/span>/);
  assert.match(home, /<span class="tk-tg">&lt;Kpi<\/span> <span class="tk-pr">label<\/span>=<span class="tk-st">&quot;売上&quot;<\/span>/);
  assert.match(home, /<span class="tk-pr">runs-on<\/span><span class="tk-p">:<\/span> <span class="tk-st">ubuntu-latest<\/span>/);
  assert.doesNotMatch(home, /data-len="NaN"/);
});

test("your emblem, service illustrations, showreel and promo videos are on the site", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  const home = files["index.html"];
  const { art } = site;
  assert.ok(art.emblem && art.emblemSmall && art.showreel);
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html") && f !== "404.html")) {
    assert.match(files[page], /class="mark" src="[./]*assets\/brand\/emblem-160\.webp"/, `${page} shows the emblem in the header`);
  }
  assert.ok(home.includes(`<source src="./${art.showreel.video}" type="video/mp4">`), "showreel video");
  assert.ok(home.includes(`poster="./${art.showreel.poster}"`), "showreel poster");
  for (const s of site.services) {
    assert.ok(s.art, `${s.id} has an illustration in site/assets/art/services/`);
    assert.ok(home.includes(`src="./${s.art}"`), `home card of ${s.id} shows its illustration`);
    const html = files[`services/${s.id}/index.html`];
    assert.ok(html.includes(`src="../../${s.art}"`), `${s.id} page shows its illustration`);
    assert.ok(html.includes(`<meta property="og:image" content="${new URL(s.art, site.profile.site_url).href}">`), `${s.id} share image`);
    if (s.video) {
      assert.ok(home.includes(`data-hover-video="./${s.video.video}"`), `${s.id} card plays its video on hover`);
      assert.ok(home.includes(`data-src="./${s.video.video}"`), `${s.id} is in the movie section`);
      assert.ok(html.includes(`data-video="../../${s.video.video}"`), `${s.id} page opens its video`);
    }
  }
  for (const w of site.works.lancers.filter((x) => x.featured)) assert.ok(home.includes(`src="./${w.cover}"`), `home shows the cover of ${w.id}`);
});

test("media.yml typos fail the build", () => {
  const profile = { site_url: "https://x.example/", services: [], cases: [], testimonials: [] };
  const bad = tmpRepo({ "site/packages.yml": "{}\n", "site/media.yml": "emblem: brand/missing.webp\n" });
  assert.throws(() => loadSite({ root: bad, profile, today }), /site\/assets\/brand\/missing\.webp does not exist/);
});

test("images carry their real size, so nothing jumps while they load", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  assert.deepEqual(imageSize(path.join(ROOT, "site", "assets", "media", "works", "go-to-market-page.webp")), [1200, 4333]);
  assert.deepEqual(imageSize(path.join(ROOT, "site", "assets", "brand", "apple-touch-icon.png")), [180, 180]);
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html"))) {
    for (const [tag] of files[page].matchAll(/<img\b[^>]*>/g)) assert.match(tag, /width="\d+" height="\d+"/, `${page}: ${tag}`);
  }
});

test("Lancers works use your own portfolio images, and assets carry a version", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  for (const w of site.works.lancers) assert.match(w.cover, /^assets\/media\/portfolio\//, `${w.id} uses an image from your portfolio`);
  assert.match(site.assetVersion, /^[0-9a-f]{8}$/);
  assert.ok(files["index.html"].includes(`assets/style.css?v=${site.assetVersion}`));
  assert.ok(files["works/index.html"].includes(`assets/app.js?v=${site.assetVersion}`));
});
