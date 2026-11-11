#!/usr/bin/env node
// Build the hub site from profile.yml, site/ and the published articles.
//   npm run site                 → dist/site/ and dist/github-profile/README.md
//   npm run site -- --serve      → build, then preview at http://localhost:4321
import { minifyCss, usedWords } from "./lib/css-min.mjs";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadProfile, rel, ROOT } from "./lib/common.mjs";
import { loadSite, renderGithubReadme, renderSite } from "./lib/site-core.mjs";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "dist/site" },
    serve: { type: "boolean", default: false },
    port: { type: "string", default: "4321" },
  },
});
const fail = (m) => {
  console.error(`site: ${m}`);
  process.exit(1);
};

const profile = loadProfile();
if (!/^https?:\/\/\S+$/.test(profile.site_url ?? "")) fail("profile.yml site_url must be the site's URL, e.g. https://you.github.io/");
if (!profile.site_url.endsWith("/")) profile.site_url += "/";
for (const [k, v] of Object.entries(profile.site_verification ?? {}))
  if (v && !/^[A-Za-z0-9_-]{8,128}$/.test(String(v))) fail(`profile.yml site_verification.${k} must be only the code inside the meta tag's content="…"`);
if (profile.analytics?.cloudflare && !/^[0-9a-f]{32}$/i.test(String(profile.analytics.cloudflare)))
  fail('profile.yml analytics.cloudflare must be the 32-character token from the Web Analytics snippet ({"token": "…"})');

let site;
try {
  site = loadSite({ root: ROOT, profile });
} catch (err) {
  fail(err.message);
}

const out = path.resolve(ROOT, values.out);
fs.rmSync(out, { recursive: true, force: true });
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const files = renderSite(site);
for (const [name, content] of Object.entries(files)) write(path.join(out, name), content);
fs.cpSync(path.join(ROOT, "site", "assets"), path.join(out, "assets"), { recursive: true });

// Smaller stylesheets: rules for classes the site no longer uses are dropped, comments and
// spacing removed (SITE_NO_MINIFY=1 keeps them as written, for comparing).
if (!process.env.SITE_NO_MINIFY) {
  const texts = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(html|js|mjs)$/.test(e.name)) texts.push(fs.readFileSync(f, "utf8"));
    }
  };
  walk(out);
  const known = usedWords(texts);
  for (const name of ["style.css", "contact.css"]) {
    const file = path.join(out, "assets", name);
    if (!fs.existsSync(file)) continue;
    const before = fs.statSync(file).size;
    const { css, dropped } = minifyCss(fs.readFileSync(file, "utf8"), known);
    fs.writeFileSync(file, css);
    console.log(`site: ${name} ${Math.round(before / 1024)} KB → ${Math.round(css.length / 1024)} KB (${dropped} unused rules dropped)`);
  }
}

const readme = path.join(ROOT, "dist", "github-profile", "README.md");
write(readme, renderGithubReadme(site));

console.log(`site: ${Object.keys(files).length} files → ${rel(out)}/ (${site.services.length} services, ${site.articles.length} articles)`);
console.log(`site: GitHub profile README → ${rel(readme)}`);
if (profile.todos.length) console.log(`site: profile.yml TODOs (not shown on the site): ${profile.todos.join(", ")}`);

if (values.serve) {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8" };
  http
    .createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      let file = path.join(out, path.normalize(urlPath));
      if (!file.startsWith(out)) file = path.join(out, "404.html");
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      const found = fs.existsSync(file);
      if (!found) file = path.join(out, "404.html");
      res.writeHead(found ? 200 : 404, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(Number(values.port), () => console.log(`site: preview at http://localhost:${values.port}/ (Ctrl+C to stop)`));
}
