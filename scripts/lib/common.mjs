// Shared helpers: profile, article parsing, platform detection, changed files.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PLATFORM_DIRS = { zenn: "articles", qiita: "public", note: "notes" };

export function platformOf(file) {
  const rel = path.relative(ROOT, path.resolve(file)).split(path.sep);
  for (const [platform, dir] of Object.entries(PLATFORM_DIRS)) {
    if (rel[0] === dir && rel.length === 2 && rel[1].endsWith(".md")) return platform;
  }
  return null;
}

export function loadProfile(file = path.join(ROOT, "profile.yml")) {
  const profile = YAML.parse(fs.readFileSync(file, "utf8")) ?? {};
  const todos = [];
  const walk = (value, at) => {
    if (typeof value === "string" && /^\s*TODO\b/.test(value)) todos.push(at);
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k);
  };
  walk(profile, "");
  // Service pages live at <site_url>services/<id>/ unless a service sets its own url.
  const services = (profile.services ?? []).map((s) => ({ ...s, url: s.url ?? serviceUrl(profile.site_url, s.id) }));
  return { ...profile, services, todos };
}

function serviceUrl(siteUrl, id) {
  try {
    return new URL(`services/${id}/`, siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`).href;
  } catch {
    return undefined;
  }
}

/** TODOs that matter for a post on this platform (other platforms' usernames don't). */
export function todosFor(profile, platform) {
  return profile.todos.filter((t) => {
    const m = /^platforms\.(\w+)$/.exec(t);
    return !m || m[1] === platform;
  });
}

export function readArticle(file) {
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  return { file, platform: platformOf(file), data, content, raw };
}

/** Is this article set to go live on its next publish? */
export function isPublishReady(article) {
  const { platform, data } = article;
  if (platform === "zenn") return data.published === true;
  if (platform === "qiita") return data.ignorePublish === false && data.private !== true;
  if (platform === "note") return data.status === "ready";
  return false;
}

/** Article files changed vs. the main branch, plus untracked ones. */
export function changedArticleFiles(base = "main") {
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
  let files = [];
  try {
    files = git("diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`);
  } catch {
    // No main branch yet (fresh repo): fall back to everything tracked.
    files = git("ls-files");
  }
  files.push(...git("ls-files", "--others", "--exclude-standard"));
  files.push(...git("diff", "--name-only", "--diff-filter=AM"));
  return [...new Set(files)]
    .map((f) => path.join(ROOT, f))
    .filter((f) => platformOf(f) && fs.existsSync(f));
}

/** Resolve CLI file args; with none, use changed article files. */
export function resolveFiles(args) {
  const files = args.length ? args.map((f) => path.resolve(f)) : changedArticleFiles();
  return files.filter((f) => {
    if (!fs.existsSync(f)) return false; // e.g. an unexpanded glob
    if (platformOf(f)) return true;
    console.error(`skip: ${path.relative(ROOT, f)} is not in articles/, public/ or notes/`);
    return false;
  });
}

export const rel = (f) => path.relative(ROOT, f);
