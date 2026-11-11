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
  assert.equal(pages.length, profile.services.length + site.works.all.length + 8);
  for (const f of ["services/index.html", "contact/index.html", "prices/index.html", "reviews/index.html", "about/index.html", "works/index.html"]) assert.ok(files[f], f);
  for (const s of profile.services) assert.ok(files[`services/${s.id}/index.html`], s.id);
  for (const w of site.works.all) assert.ok(files[`works/${w.id}/index.html`], w.id);

  for (const page of pages) {
    const html = files[page];
    assert.doesNotMatch(html, /undefined|\[object Object\]|\bTODO\b|NaN/, page);
    assert.match(html, new RegExp(profile.contact_url.replace(/[.?]/g, "\\$&")), `${page} keeps Lancers as the second route`);
    if (page !== "404.html") assert.match(html, /href="(?:\.\.\/)*(?:\.\/)?contact\/(?:\?[^"]*)?"/, `${page} links to the on-site contact form`);
    // The owner's email address never appears on the site, and there is no mailto link.
    assert.doesNotMatch(html, /mailto:/i, `${page} has a mailto link`);
    assert.doesNotMatch(html, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/, `${page} shows an email address`);
    for (const [en] of [["Works"], ["Expertise"], ["About"], ["Contact"]]) assert.match(html, new RegExp(`<span lang="en">${en}</span>`), `${page}: header has ${en}`);
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
      assert.ok(html.includes(`data-video="../../${p.video}"`), `${s.id}: video of ${p.id}`);
      assert.ok(html.includes(`src="../../${p.cover}"`), `${s.id}: image of ${p.id}`);
    }
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
  // The home page follows the mockup (one live site and one case study in device frames);
  // every featured work is on the works index.
  assert.ok(files["index.html"].includes(`works/${featured[0].id}/`), "home shows the first featured work");
  assert.ok(files["index.html"].includes('href="./works/"'), "home links to the works index");
  for (const w of featured) assert.ok(files["works/index.html"].includes(`works/${w.id}/`), `works index shows featured ${w.id}`);
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

test("the works index says the covers are illustrations; no page carries an AI-character line (your choice, 2026-11-10)", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html"))) {
    assert.doesNotMatch(files[page], /AIで生成した(イメージ)?キャラクター/, page);
  }
  assert.match(files["works/index.html"], /カバー画像はイメージです/, "works index says the covers are illustrations");
});

test("your emblem, package images, showreel and promo videos are on the site", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  const home = files["index.html"];
  const { art } = site;
  assert.ok(art.emblem && art.emblemSmall && art.showreel);
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html") && f !== "404.html")) {
    assert.match(files[page], /class="mark" src="[./]*assets\/brand\/emblem-160\.webp"/, `${page} shows the emblem in the header`);
  }
  assert.ok(home.includes(`<source src="./${art.showreel.video}" type="video/mp4">`), "showreel video");
  // The showreel's poster: its own artwork when it exists, else the home artwork, else its own frame.
  const poster = site.art.section("reel-poster")?.src ?? (site.art.stage("home").plate ? site.art.stage("home").wide : art.showreel.poster);
  assert.ok(home.includes(`poster="./${poster}"`), "showreel poster");
  for (const s of site.services) {
    assert.ok(s.cover, `${s.id} has a package image`);
    // The services index shows the service's artwork when it exists, else its package image;
    // the package image itself is always on the service page (checked below).
    const plate = site.art.stage(`svc-${s.id}`);
    assert.ok(files["services/index.html"].includes(`src="../${plate.plate ? plate.wide : s.cover}"`), `services index shows the picture of ${s.id}`);
    const html = files[`services/${s.id}/index.html`];
    assert.ok(html.includes(`src="../../${s.cover}"`), `${s.id} page shows its package image`);
    assert.ok(html.includes(`<meta property="og:image" content="${new URL(s.cover, site.profile.site_url).href}">`), `${s.id} share image`);
    if (s.video) assert.ok(html.includes(`data-video="../../${s.video.video}"`), `${s.id} page opens its video`);
  }
  const first = site.works.lancers.find((x) => x.featured);
  assert.ok(home.includes(`src="./${first.cover}"`), `home shows the cover of ${first.id}`);
  for (const w of site.works.lancers) assert.ok(files["works/index.html"].includes(`src="../${w.cover}"`), `works index shows the cover of ${w.id}`);
  for (const w of site.works.sites) assert.ok(home.includes(`works/${w.id}/`), `home links to the live site ${w.id}`);
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

test("the contact page has the inquiry form and no address; no shipped script contains one", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  const html = files["contact/index.html"];
  assert.match(html, /<form[^>]+id="inquiry"/);
  assert.match(html, /assets\/contact\.js/);
  for (const f of ["app.js", "contact.js", "celestial.js"]) {
    const file = path.join(ROOT, "site", "assets", f);
    if (!fs.existsSync(file)) continue;
    const js = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(js, /mailto:/i, `${f} has a mailto link`);
    assert.doesNotMatch(js, /[A-Za-z0-9._%+-]+@(?:gmail|yahoo|outlook|icloud|hotmail)\.[a-z.]+/i, `${f} contains a mailbox address`);
  }
});

test("every service and work page has its own hero scene, and each page's chapters are in reading order", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  for (const s of site.services) assert.match(files[`services/${s.id}/index.html`], new RegExp(`data-scene="svc-${s.id}"`));
  for (const w of site.works.all) assert.match(files[`works/${w.id}/index.html`], new RegExp(`data-scene="work-${w.id}"`));
  const svc = files["services/ai-chatbot/index.html"];
  const order = ["intro-title", "film-title", "scope-title", "process-title", "faq-title", "price-title"].map((id) => svc.indexOf(`id="${id}"`));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `service chapters in order: ${order}`);
  const scenes = new Set();
  for (const page of Object.keys(files).filter((f) => f.endsWith(".html"))) for (const [, n] of files[page].matchAll(/data-scene="([^"]+)"/g)) scenes.add(n);
  assert.equal(scenes.size, 7 + site.services.length + site.works.all.length, "one scene per page (404 has none)");
});

test("the pages carry the mockups' elements", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  const works = files["works/index.html"];
  assert.equal((works.match(/class="gdev"/g) ?? []).length, site.works.all.length, "every works card shows its picture in a device frame");
  const svc = files["services/index.html"];
  if (site.art.stage("services").plate) assert.equal((svc.match(/class="svc-label"/g) ?? []).length, 8, "the eight symbols are labelled");
  for (const s of site.services) assert.ok(svc.includes(s.card[0]), `${s.id} card has its two-line description`);
  assert.equal((svc.match(/お問い合わせ<svg/g) ?? []).length, 8, "each service card has an inquiry button");
  const about = files["about/index.html"];
  for (const t of ["深く考える", "丁寧につくる", "そして、磨き続ける"]) assert.ok(about.includes(t), `manifesto: ${t}`);
  for (const v of loadProfile().values) assert.ok(about.includes(esc(v)), `manifesto keeps the value: ${v}`);
  assert.match(about, /class="hero-caption"/);
  assert.equal((files["prices/index.html"].match(/class="step-glass"/g) ?? []).length, 4, "pricing steps stand on glass blocks");
  const rv = files["reviews/index.html"];
  assert.ok((rv.match(/class="qc-head"/g) ?? []).length >= 20, "review cards have a title row");
  assert.match(rv, /class="bubble-title"/);
});

test("the home page uses the pilot plates when they exist, and its links survive", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const home = renderSite(site)["index.html"];
  if (site.art.section("sec-home-hero")) {
    assert.match(home, /class="stage stage-dark stage-home stage-pilot"/);
    assert.match(home, /<source media="\(max-width: 760px\)" srcset="\.\/assets\/plates\/sec-home-hero-m\.webp"/, "phones get the portrait hero");
  }
  if (site.art.section("sec-home-sel")) {
    assert.match(home, /<source media="\(min-width: 1024px\)" srcset="\.\/assets\/plates\/sec-home-sel\.webp[ "]/, "desktop gets the plate with the screenshots on its laptops");
    // The laptops in the picture are links to the two works, with real alt text for the screenshots.
    assert.match(home, /class="dev-laptop" href="\.\/works\/[^"]+\/"><span class="dev-screen"><img[^>]+alt="[^"]+"/);
    assert.match(home, /class="dev-tablet" href="\.\/works\/[^"]+\/">/);
  }
  // Upscaled copies go to large and high-density screens only, through srcset (phones keep the 1× files).
  for (const name of ["sec-home-hero", "sec-home-sel", "sec-home-exp", "sec-home-reel", "sec-home-cta"]) {
    const a = site.art.section(name);
    if (a?.src2x) assert.ok(home.includes(`${a.src} ${a.w}w, ./${a.src2x} ${a.w2}w`), `${name} offers its 2× copy`);
  }
  assert.doesNotMatch(home, /sec-home-hero-m[^"]*-2x/, "the phone hero has no 2× copy");
  // Cut-outs are decoration only.
  for (const m of home.matchAll(/<div class="seam [^"]+"([^>]*)>/g)) assert.match(m[1], /aria-hidden="true"/);
  for (const m of home.matchAll(/<img class="deco [^"]+"[^>]*>/g)) assert.match(m[0], /alt=""/);
});


test("the other pages use their pilot plates where they exist, keeping their text", () => {
  const site = loadSite({ root: ROOT, profile: loadProfile(), today });
  const files = renderSite(site);
  const prices = files["prices/index.html"];
  if (site.art.section("sec-prices-steps")) {
    assert.match(prices, /class="ch ch-mist plan[^"]* plan-pilot"/);
    assert.match(prices, /class="plan-art"/);
    // the four steps stay real text over the picture
    for (const t of ["課題の整理", "スコープ設計", "実行・検証", "展開・拡張"]) assert.ok(prices.includes(`<h3 class="step-title">${t}</h3>`), t);
  }
  if (site.art.section("sec-works-next")) assert.match(files["works/index.html"], /sec-works-next\.webp/);
  if (site.art.section("sec-reviews-cta")) assert.match(files["reviews/index.html"], /sec-reviews-cta\.webp/);
  if (site.art.section("sec-about-bio")) assert.match(files["about/index.html"], /class="ch ch-pearl bio has-sec"/);
  // the service labels still link to all eight services
  const svc = files["services/index.html"];
  for (const s of site.services) assert.ok(svc.includes(`class="svc-label" href="../services/${s.id}/"`), s.id);
});

test("classes the body carries (hero-*, route-*, page-*) are never reused to style an element", () => {
  // 2026-11-11: a spotlight element named .hero-light made every light page invisible.
  const css = fs.readFileSync(path.join(ROOT, "site", "assets", "style.css"), "utf8");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of m[1].split(",").map((x) => x.trim())) {
      if (/^\.(hero-(light|dark)|page-[a-z]+)$/.test(sel)) assert.fail(`"${sel}" styles the <body> itself: ${m[2].trim().slice(0, 60)}`);
    }
  }
});
