#!/usr/bin/env node
// Usage:
//   npm run new -- zenn  <slug> --title "…" [--topics nextjs,typescript] [--service <id>]
//   npm run new -- qiita <slug> --title "…" [--tags Python,RAG]          [--service <id>]
//   npm run new -- note  <slug> --title "…" [--hashtags 中小企業,AI導入] [--service <id>]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { loadProfile, PLATFORM_DIRS, rel, ROOT, todosFor } from "./lib/common.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string", default: "" },
    topics: { type: "string", default: "" },
    tags: { type: "string", default: "" },
    hashtags: { type: "string", default: "" },
    service: { type: "string" },
    emoji: { type: "string", default: "📝" },
    type: { type: "string", default: "tech" },
  },
});
const [platform, slug] = positionals;
const fail = (m) => {
  console.error(`new: ${m}`);
  process.exit(1);
};
if (!PLATFORM_DIRS[platform] || !slug) fail("usage: npm run new -- <zenn|qiita|note> <slug> --title \"…\"");
if (platform === "zenn" && !/^[a-z0-9_-]{12,50}$/.test(slug))
  fail("Zenn slugs must be 12–50 chars of a-z, 0-9, - or _ (it becomes the URL)");
if (!/^[a-z0-9_-]+$/i.test(slug)) fail("slug: use letters, digits, - and _ only");

const file = path.join(ROOT, PLATFORM_DIRS[platform], `${slug}.md`);
if (fs.existsSync(file)) fail(`${rel(file)} already exists`);

const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const profile = loadProfile();
const services = profile.services ?? [];
const service = values.service ? services.find((s) => s.id === values.service) : services[0];
if (values.service && !service) fail(`no service "${values.service}" in profile.yml (have: ${services.map((s) => s.id).join(", ")})`);

const frontMatter = {
  zenn: { title: values.title, emoji: values.emoji, type: values.type, topics: list(values.topics), published: false },
  qiita: {
    title: values.title,
    tags: list(values.tags),
    private: false,
    updated_at: "",
    id: null,
    organization_url_name: null,
    slide: false,
    ignorePublish: true,
    posting_campaign_uuid: null,
    agreed_posting_campaign_term: false,
  },
  // url: paste the note link here after posting, so the hub site lists the post.
  note: { title: values.title, status: "draft", hashtags: list(values.hashtags), service: service?.id ?? null, url: null },
}[platform];

const template = platform === "note" ? "note.md" : "engineer.md";
const body = fs
  .readFileSync(path.join(ROOT, "templates", template), "utf8")
  .replaceAll("{{PATH}}", rel(file))
  .replaceAll("{{PERSONA}}", profile.persona ?? "私")
  .replaceAll("{{SERVICE_NAME}}", service?.name ?? "TODO")
  .replaceAll("{{SERVICE_URL}}", service?.url ?? "TODO")
  .replaceAll("{{CONTACT_URL}}", profile.contact_url ?? "TODO");

fs.writeFileSync(file, `---\n${YAML.stringify(frontMatter)}---\n\n${body}`);
console.log(`created ${rel(file)} (draft)`);
const goLive = { zenn: "set published: true", qiita: "set ignorePublish: false", note: "set status: ready" }[platform];
console.log(`when it's ready: ${goLive}, then npm run check -- ${rel(file)}`);
const todos = todosFor(profile, platform);
if (todos.length) console.log(`note: fill these in profile.yml before publishing: ${todos.join(", ")}`);
