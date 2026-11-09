// The automatic writer: plan a topic → write the article → check it → fix it → schedule it.
// Each Claude step is one runSubmitTask (web search allowed). The checks are the ones CI runs
// on a pull request: validate, textlint and the Claude fact-check. Steps and checks are
// passed in, so the pipeline can be tested without calling Claude.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { z } from "zod";
import { addUsage, costUsd, emptyUsage, runSubmitTask } from "./claude-run.mjs";
import { factcheck, severity } from "./factcheck-core.mjs";
import { careerYears } from "./site-core.mjs";
import { jstDay, PUBLISH_TIME, publishedAt, zennArticles } from "./schedule.mjs";
import { validateArticle } from "./validate-core.mjs";

export class WriterError extends Error {}

// ---------- configuration and state ----------

const Pillar = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  weight: z.number().positive(),
  label: z.string().min(1),
  audience: z.enum(["buyer", "engineer"]),
  brief: z.string().min(1),
});
const Config = z.object({
  enabled: z.boolean(),
  mode: z.enum(["auto", "review"]),
  days_ahead: z.number().int().min(1).max(7),
  max_per_run: z.number().int().min(1).max(3),
  pillars: z.array(Pillar).min(1),
  avoid: z.array(z.string()).default([]),
});

export function loadConfig(root) {
  const file = path.join(root, "autopilot.yml");
  const parsed = Config.safeParse(YAML.parse(fs.readFileSync(file, "utf8")) ?? {});
  if (!parsed.success) throw new WriterError(`autopilot.yml: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

const HISTORY = (root) => path.join(root, "autopilot", "history.json");
export const readHistory = (root) => (fs.existsSync(HISTORY(root)) ? JSON.parse(fs.readFileSync(HISTORY(root), "utf8")) : []);
function appendHistory(root, entry) {
  const list = readHistory(root);
  list.push(entry);
  fs.mkdirSync(path.dirname(HISTORY(root)), { recursive: true });
  fs.writeFileSync(HISTORY(root), `${JSON.stringify(list, null, 2)}\n`);
}

/**
 * Mornings (09:00 JST) in the next `daysAhead` days that have no article yet, counting one
 * waiting in a pull request (review mode) as taken. A morning counts while it's ≥ 60 min away.
 */
export function openSlots(root, now, daysAhead, history = readHistory(root)) {
  const taken = new Set(zennArticles(root).filter((a) => a.at).map((a) => jstDay(a.at)));
  for (const h of history) if (h.status === "in review" && publishedAt(h.date)) taken.add(jstDay(publishedAt(h.date)));
  const first = publishedAt(`${jstDay(now)} ${PUBLISH_TIME}`) - now >= 60 * 60 * 1000 ? 0 : 1;
  const slots = [];
  for (let d = first; d < first + daysAhead; d++) {
    const day = jstDay(new Date(now.getTime() + d * 86_400_000));
    if (!taken.has(day)) slots.push(`${day} ${PUBLISH_TIME}`);
  }
  return slots;
}

/** The pillar furthest behind its share over recent posts (weights from autopilot.yml). */
export function pickPillar(config, history) {
  const total = config.pillars.reduce((n, p) => n + p.weight, 0);
  const recent = history.filter((h) => h.status !== "failed").slice(-Math.ceil(total * 2));
  const count = (id) => recent.filter((h) => h.pillar === id).length;
  let best = config.pillars[0];
  let bestScore = -Infinity;
  for (const p of config.pillars) {
    const score = (p.weight / total) * (recent.length + 1) - count(p.id);
    if (score > bestScore + 1e-9) [best, bestScore] = [p, score];
  }
  return best;
}

// ---------- what Claude is told ----------

export function authorContext(profile) {
  const site = profile.site_url;
  return {
    name: profile.name,
    title: profile.title,
    years_of_experience: careerYears(profile.facts?.career_start),
    persona: profile.persona ?? "私",
    work_style: profile.facts?.work_style,
    lancers: profile.lancers && { rank: profile.lancers.rank, reviews: profile.lancers.reviews, repeat_clients: profile.lancers.repeat_clients },
    certifications: (profile.certifications ?? []).map((c) => c.name),
    services: (profile.services ?? []).map((s) => ({ id: s.id, name: s.name, summary: s.summary, url: new URL(`services/${s.id}/`, site).href })),
    cases: (profile.cases ?? []).map(({ id, title, period, team, role, challenge, actions, result, stack }) => ({ id, title, period, team, role, challenge, actions, result, stack })),
  };
}

const list = (xs) => xs.map((x) => `- ${x}`).join("\n");

export function topicPrompt({ author, config, pillar, recentTitles, ideas, today }) {
  const system = `You plan one article a day for ${author.name}, a freelance AI and web engineer in Japan with ${author.years_of_experience} years of experience, who publishes on Zenn and Qiita. The goal of every article: a reader who could hire the author (an owner or staff member of a small or medium-sized Japanese company, or an engineer who refers work) finishes it thinking "this person really knows this and could solve our problem", and the article is genuinely useful even to readers who never hire anyone.

Pick ONE topic for the pillar given in the request. A good topic:
- solves a concrete problem, or settles a decision the reader actually faces, with a clear takeaway;
- is something the author can speak to from their listed experience (cases) or from reliable public sources;
- leads naturally to one of the author's services (the article ends with a short invitation to consult);
- is specific (not 「AIの活用法」), timely where possible, and clearly different from every recent title listed.
For a news pillar, search the web for developments from the last 14 days, open the primary source (official blog, release notes, government page) and pick only something you confirmed there.
Never pick anything that involves: ${config.avoid.join("、")}.

Then call submit_topic once. title: Japanese, 25–50 characters, concrete, no clickbait, promising nothing the article can't deliver. slug: 3–6 lowercase English words joined by hyphens, 12–50 characters. topics: 1–5 lowercase ASCII Zenn topics such as ai, rag, python, wordpress, security. outline: 4–7 Japanese section headings. sources: the pages where you confirmed facts (empty if none). cases: ids of the author's cases the article will draw on (empty if none).`;
  const user = [
    `Today is ${today} (Japan time).`,
    `Pillar: ${pillar.label}\nAudience: ${pillar.audience === "buyer" ? "people who hire developers (non-engineers)" : "engineers"}\n${pillar.brief}`,
    `Author:\n${JSON.stringify(author, null, 2)}`,
    `Recent titles (don't repeat these):\n${recentTitles.length ? list(recentTitles) : "(none yet)"}`,
    ...(pillar.id !== "news" && ideas ? [`Idea backlog you may use or ignore:\n${ideas}`] : []),
  ].join("\n\n");
  return { system, user };
}

const RULES = (author, config) => `Write in Japanese, です・ます調, in the first person 「${author.persona}」.
Experience: describe only the author's real experience listed under "cases" or "lancers". Keep clients anonymous (industry and size only) and keep their numbers exactly as given. Never invent projects, clients, results, numbers, quotes or conversations. A made-up example must start with 「たとえば」 and be plainly hypothetical.
Facts: every statistic, price, date, version, release or legal point must come from a page you checked with web search in this session, or one given as a source, and be linked inline as [出典名](URL) where it's used. Prefer primary sources (official docs and announcements, the survey itself). Never write a URL you didn't see. If you can't confirm something, leave it out.
Code (engineering readers): short, complete and correct for current versions, in fenced blocks with the language (and a file name like \`\`\`python:main.py where useful), with what each part does explained; no secrets or real endpoints.
Markdown: Zenn flavour. ## headings, ### for sub-sections, never #. At most one :::message block. No HTML, no images, no tables wider than four columns.
Style (checked by textlint): sentences under 100 characters, at most three 読点 per sentence, no doubled particles, no 「！」.
Never: ${config.avoid.join("、")}.`;

export function writePrompt({ author, config, pillar, topic, service, contactUrl, today }) {
  const system = `You write one article for Zenn and Qiita in the name of ${author.name}, a freelance AI and web engineer in Japan. Readers who might hire the author judge their expertise by it, so it must be accurate, specific and genuinely useful.

${RULES(author, config)}

Shape: open with the reader's situation in 2–4 sentences, give the conclusion early, then the sections of the outline, concrete steps or a checklist the reader can use today, and a short まとめ. 3,000–6,000 characters. Don't repeat the title as a heading. The article must stand on its own: don't advertise in the body. The only mention of the author's services is the closing paragraph, after a horizontal rule (---) at the very end, in this form:
${author.persona}は「${service.name}」をお仕事としてお受けしています。（one sentence linking this article's topic to the service）
→ [${service.name}について](${service.url}) ／ [ランサーズで相談する](${contactUrl})

When it's finished, call submit_article once with the whole article body.`;
  const cases = author.cases.filter((c) => topic.cases.includes(c.id));
  const user = [
    `Today is ${today} (Japan time).`,
    `Readers: ${pillar.audience === "buyer" ? "people who hire developers; explain every technical term in one line" : "engineers; be precise and show working code or configuration"}.`,
    `Title (fixed): ${topic.title}\nAngle: ${topic.angle}\nOutline:\n${list(topic.outline)}`,
    `Sources found while planning:\n${topic.sources.length ? list(topic.sources.map((s) => `${s.title} ${s.url}`)) : "(none)"}`,
    `The author's experience you may use:\n${JSON.stringify({ cases, lancers: author.lancers, years_of_experience: author.years_of_experience, certifications: author.certifications }, null, 2)}`,
  ].join("\n\n");
  return { system, user };
}

export function revisePrompt({ author, config, title, body, problems, today }) {
  const system = `You fix a Japanese article that automated checks flagged before publication. Fix every problem listed and keep everything else as it is: structure, voice, length and the closing paragraph with its links. For a fact that is wrong or unsourced: search the web, correct it and link the source inline, or remove the claim. Never add new unsourced facts or invented experience.

${RULES(author, config)}

Call submit_article once with the complete corrected article body.`;
  const user = [`Today is ${today} (Japan time).`, `Title: ${title}`, `Problems to fix:\n${list(problems)}`, `<article>\n${body}\n</article>`].join("\n\n");
  return { system, user };
}

// ---------- tools and schemas ----------

const str = (description) => ({ type: "string", description });
export function topicTool(author) {
  return {
    name: "submit_topic",
    description: "Submit the chosen topic. Call exactly once, after any searches.",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "slug", "emoji", "topics", "service_id", "angle", "outline", "sources", "cases"],
      properties: {
        title: str("Japanese title, 25–50 characters."),
        slug: str("3–6 lowercase English words joined by hyphens, 12–50 characters."),
        emoji: str("One emoji for Zenn."),
        topics: { type: "array", items: str("lowercase ASCII Zenn topic"), description: "1–5 topics." },
        service_id: { type: "string", enum: author.services.map((s) => s.id) },
        angle: str("What the reader gets, 1–2 Japanese sentences."),
        outline: { type: "array", items: str("Japanese section heading"), description: "4–7 headings." },
        sources: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: str("page title"), url: str("URL you opened") } },
        },
        cases: { type: "array", items: author.cases.length ? { type: "string", enum: author.cases.map((c) => c.id) } : { type: "string" } },
      },
    },
  };
}

export const Topic = z.object({
  title: z.string().refine((t) => [...t].length >= 10 && [...t].length <= 70, "title must be 10–70 characters"),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)+$/, "slug: lowercase words joined by hyphens").min(12).max(50),
  emoji: z.string().refine((e) => [...new Intl.Segmenter().segment(e.trim())].length === 1 && /\p{Extended_Pictographic}/u.test(e), "emoji must be one emoji"),
  topics: z.array(z.string().regex(/^[a-z0-9]{1,18}$/, "topics: lowercase letters and digits")).min(1).max(5),
  service_id: z.string(),
  angle: z.string().min(1),
  outline: z.array(z.string().min(1)).min(3).max(8),
  sources: z.array(z.object({ title: z.string(), url: z.string().url() })),
  cases: z.array(z.string()),
});

export const ARTICLE_TOOL = {
  name: "submit_article",
  description: "Submit the finished article. Call exactly once.",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["body", "summary"],
    properties: {
      body: str("The whole article in Zenn Markdown, without the title heading or front matter."),
      summary: str("One Japanese sentence saying what the article covers."),
    },
  },
};
export const Article = z.object({
  body: z
    .string()
    .min(1500, "the article is too short")
    .refine((b) => !/^#\s/m.test(b), "use ## and ### headings only (no #)"),
  summary: z.string(),
});

// ---------- the pieces that call Claude (the CLI passes these in) ----------

export function claudeSteps(client, log) {
  const run = (prompt, tool, schema, what, maxSearches) =>
    runSubmitTask({ client, ...prompt, submitTool: tool, schema, maxSearches, task: `write this ${what}`, what, ErrorClass: WriterError, log });
  return {
    chooseTopic: (ctx) => run(topicPrompt(ctx), topicTool(ctx.author), Topic, "topic", ctx.pillar.id === "news" ? 12 : 6),
    writeArticle: (ctx) => run(writePrompt(ctx), ARTICLE_TOOL, Article, "article", 10),
    reviseArticle: (ctx) => run(revisePrompt(ctx), ARTICLE_TOOL, Article, "article", 6),
    factcheck: (article, profile) => factcheck({ client, article, profile, log }),
  };
}

/** textlint errors (not warnings) for one file, as readable lines. */
export function textlintErrors(root, file) {
  const r = spawnSync("npx", ["textlint", "--format", "json", path.relative(root, file)], { cwd: root, encoding: "utf8" });
  let results;
  try {
    results = JSON.parse(r.stdout);
  } catch {
    throw new WriterError(`textlint did not run: ${(r.stderr || r.stdout).slice(0, 300)}`);
  }
  return results.flatMap((f) => f.messages.filter((m) => m.severity === 2).map((m) => `textlint (line ${m.line}): ${m.message}`));
}

// ---------- the pipeline ----------

function writeFile(file, frontMatter, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n${YAML.stringify(frontMatter)}---\n\n${body.trim()}\n`);
}

function uniqueSlug(root, slug) {
  let s = slug;
  for (let n = 2; fs.existsSync(path.join(root, "articles", `${s}.md`)); n++) s = `${slug}-${n}`.slice(0, 50);
  return s;
}

async function check({ root, file, profile, steps, textlint }) {
  const { data, content } = matter(fs.readFileSync(file, "utf8"));
  const article = { file, platform: "zenn", data, content, raw: "" };
  const problems = [];
  const v = validateArticle(article, profile);
  problems.push(...v.errors.map((e) => `validate: ${e}`));
  problems.push(...textlint(root, file));
  const fc = await steps.factcheck(article, profile);
  const findings = fc.report.findings.map((f) => ({ ...f, level: severity(f) }));
  for (const f of findings.filter((x) => x.level === "error"))
    problems.push(`fact-check (${f.claim_type}, ${f.verdict}): 「${f.quote}」 — ${f.explanation}${f.suggested_fix ? ` Fix: ${f.suggested_fix}` : ""}`);
  const warnings = findings.filter((x) => x.level === "warning").length;
  return { problems, warnings, usage: fc.usage };
}

/**
 * Fills the open mornings. For each one: plan a topic, write, check, fix (up to two rounds).
 * A passing article is saved scheduled for its morning (published: true in auto mode, and in
 * review mode for the pull request to carry). A failing one is saved as an unscheduled Zenn
 * draft (published: false, no date) with the remaining problems at the top, so the morning
 * stays open for the next run.
 */
export async function autowrite({ root, profile, config, now = new Date(), steps, textlint = textlintErrors, ideas = "", log = () => {} }) {
  const author = authorContext(profile);
  const today = jstDay(now);
  const results = [];
  for (const slot of openSlots(root, now, config.days_ahead).slice(0, config.max_per_run)) {
    const usage = emptyUsage();
    const pillar = pickPillar(config, readHistory(root));
    const recentTitles = [...new Set([...zennArticles(root).map((a) => a.data.title), ...readHistory(root).map((h) => h.title)].filter(Boolean))].slice(-60);
    const entry = { date: slot, pillar: pillar.id, written_at: now.toISOString() };
    try {
      log(`autowrite: ${slot} — planning a ${pillar.id} article`);
      const t = await steps.chooseTopic({ author, config, pillar, recentTitles, ideas, today });
      addUsage(usage, t.usage);
      const topic = t.value;
      const service = author.services.find((s) => s.id === topic.service_id) ?? author.services[0];
      const slug = uniqueSlug(root, topic.slug);
      const file = path.join(root, "articles", `${slug}.md`);
      Object.assign(entry, { slug, title: topic.title, service: service.id });
      const frontMatter = {
        title: topic.title,
        emoji: topic.emoji.trim(),
        type: pillar.audience === "engineer" ? "tech" : "idea",
        topics: topic.topics,
        published: true,
        published_at: slot,
      };

      log(`autowrite: writing 「${topic.title}」`);
      const w = await steps.writeArticle({ author, config, pillar, topic, service, contactUrl: profile.contact_url, today });
      addUsage(usage, w.usage);
      let body = w.value.body;
      writeFile(file, frontMatter, body);

      let result;
      for (let round = 0; ; round++) {
        log(`autowrite: checking (round ${round + 1})`);
        result = await check({ root, file, profile, steps, textlint });
        addUsage(usage, result.usage);
        if (!result.problems.length || round === 2) break;
        log(`autowrite: fixing ${result.problems.length} problem(s)`);
        const r = await steps.reviseArticle({ author, config, title: topic.title, body, problems: result.problems, today });
        addUsage(usage, r.usage);
        body = r.value.body;
        writeFile(file, frontMatter, body);
      }

      if (result.problems.length) {
        const { published_at, ...draft } = frontMatter;
        const note = `<!-- autopilot: not published, these checks still failed:\n${result.problems.map((p) => `- ${p.replace(/--/g, "‐‐")}`).join("\n")}\n-->`;
        writeFile(file, { ...draft, published: false }, `${note}\n\n${body}`);
        Object.assign(entry, { status: "failed", problems: result.problems });
      } else {
        Object.assign(entry, { status: config.mode === "auto" ? "scheduled" : "in review", fact_check_warnings: result.warnings });
      }
      Object.assign(entry, { file: path.relative(root, file) });
    } catch (err) {
      Object.assign(entry, { status: "failed", problems: [err.message] });
    }
    Object.assign(entry, { usage, cost_usd: Number(costUsd(usage).toFixed(2)) });
    appendHistory(root, entry);
    results.push(entry);
    log(`autowrite: ${entry.status} — ${entry.title ?? "(no topic)"} ($${entry.cost_usd})`);
  }
  return results;
}
