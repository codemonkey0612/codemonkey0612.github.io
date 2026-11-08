#!/usr/bin/env node
// Build the hub site from profile.yml, site/ and the published articles.
//   npm run site                 → dist/site/ and dist/github-profile/README.md
//   npm run site -- --serve      → build, then preview at http://localhost:4321
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
