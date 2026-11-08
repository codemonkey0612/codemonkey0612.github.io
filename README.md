# Writing pipeline and hub site: note · Zenn · Qiita · GitHub Pages

One Git repo for everything you publish. Zenn and Qiita articles go live from
`main`; note drafts become a page you copy and paste into note's editor; the hub
site (your service pages) is rebuilt and deployed to GitHub Pages. Every pull
request is linted, validated and fact-checked by Claude first, and the
fact-check report is posted on the PR.

Every post links to a service page on the hub site, and every "相談する" button on
the site goes to your Lancers profile, so contracts and payment stay on Lancers.

```
articles/   Zenn articles      (live when published: true)
public/     Qiita articles     (live when ignorePublish: false)
notes/      note drafts        (ready when status: ready; pasted by hand)
site/       hub site: one page per service (services/*.md), Lancers prices
            (packages.yml), about text, styles
templates/  article and proposal-demo templates
profile.yml who you are: services, Lancers stats, past projects, certifications
            (read by the site, the templates and every check)
scripts/    new · check · validate · factcheck · note export · site
ideas.md    post ideas built from your own projects and reviews
```

## One-time setup

1. **Install:** `npm ci` (Node 22+).
2. **`profile.yml`** is filled from your Lancers profile. Two TODOs are left: your
   Qiita username and note urlname. Create those accounts and fill them in; until
   then, only Qiita/note posts are blocked (Zenn posts aren't).
3. **Push to GitHub** as a new repository with `main` as the default branch.
   Name it `codemonkey0612.github.io` and the site lives at
   <https://codemonkey0612.github.io/>, which is what `site_url` says. With any
   other name it lives at `https://codemonkey0612.github.io/<repo>/`: update
   `site_url` to match. A custom domain works too (Settings → Pages). On the
   free plan, Pages needs a public repository, so drafts in it are public.
4. **GitHub Pages:** Settings → Pages → Source: **GitHub Actions**. The `Site`
   workflow then deploys on every push to `main`.
5. **Zenn:** on zenn.dev open *Dashboard → Deploys* (GitHub連携), connect this
   repository. Zenn then publishes `articles/*.md` with `published: true` on every
   push to `main`.
6. **Qiita:** create an access token with `read_qiita` and `write_qiita` at
   <https://qiita.com/settings/tokens/new>. Run `npx qiita login` locally (for
   preview), and add the token as the repository secret `QIITA_TOKEN`.
7. **Claude:** create an API key in the Claude Console and add it as the
   repository secret `ANTHROPIC_API_KEY`. For local fact-checks,
   `export ANTHROPIC_API_KEY=…`. Without it, CI still lints and validates and
   prints a warning that fact-checking is off.
8. **Protect `main`:** *Settings → Branches → Add rule*: require a pull request
   and the status check **check**. Then nothing reaches Zenn or Qiita unchecked.

## Writing a post

```bash
git switch -c post/rag-chunks
npm run new -- zenn rag-chunk-size-tips --title "RAGの精度が出ないときに見る3か所" --topics rag,python --service rag
#   qiita: npm run new -- qiita <slug> --title "…" --tags Python,RAG
#   note:  npm run new -- note  <slug> --title "…" --hashtags 中小企業,AI導入
npm run preview:zenn                 # or preview:qiita
npm run check -- articles/rag-chunk-size-tips.md   # textlint → validate → fact-check
```

When it's ready, flip the switch (`published: true` / `ignorePublish: false` /
`status: ready`), push, and open a PR. CI runs the same checks and comments the
fact-check report. Merge, and Zenn and Qiita publish within a minute or two.

**note** has no posting API. After merging:

```bash
npm run note -- notes/<slug>.md      # writes dist/note/<slug>.html
```

Open the page, click **Copy body**, paste into note's editor, then copy the title
and hashtags the same way. note supports two heading levels, so `####` becomes
bold text. It can't take tables or pasted images; the page warns you and marks
where to upload images. After publishing on note, paste the post's link into
`url:` in its front matter and push: the hub site then lists it.

## The hub site

`npm run site:preview` builds it and serves it at <http://localhost:4321/>.

- **Pages:** home (services, Lancers stats, past projects, client reviews,
  how you work, latest articles, certifications), one page per service, a price
  list of all 20 Lancers packages, works, all 26 client reviews in full,
  profile, 404, plus `sitemap.xml`, `robots.txt` and `llms.txt`. Pages carry
  Open Graph tags and schema.org data (Person, Service, FAQ, breadcrumbs).
- **Where things come from:** names, summaries, projects, reviews and
  certifications from `profile.yml`; each service page's text and FAQ from
  `site/services/<id>.md`; the price tables from `site/packages.yml`; the
  latest articles from `articles/`, `public/` and `notes/` once they're live.
- **Add a service:** add it to `services:` in `profile.yml`, write
  `site/services/<id>.md` (copy an existing one), and list its Lancers package
  ids under `packages:`. The build fails if a page, package, project or review
  it references doesn't exist.
- **Keep it in sync with Lancers.** When your stats, prices or packages change,
  update `lancers:` in `profile.yml` and `site/packages.yml` (the site shows the
  "as of" date). For a new review, add it at the top of `testimonials:` and bump
  `lancers.reviews`. The tests fail if the number of reviews or packages doesn't
  match the counts in `lancers:`. Each service page links to its Lancers package.
- **Price list only** (on purpose): the real-time face swap, AI business-partner
  matching, game development and web scraping packages appear on the price list
  but have no service page with plan details. They don't fit the AI/Web
  positioning, and their Lancers plans make claims or offers (95% accuracy, a
  3.2× guarantee, getting around bot protection) the site shouldn't repeat.

`npm run site` also writes `dist/github-profile/README.md`: copy it into your
`codemonkey0612/codemonkey0612` repository so your GitHub profile shows the same
services, projects and certifications.

## What the checks catch

| Check | Blocks the merge | Advises |
|---|---|---|
| **textlint** (`.textlintrc.json`, `prh.yml`) | です/ます mixed with だ/である, misspelled product names (GitHub, JavaScript…), sentence-ending punctuation | long sentences, too many commas, doubled particles |
| **validate** | Zenn/Qiita front-matter rules (the same rules their CLIs enforce); a publish-ready post with no link to your site; statistics with no outside source link (your own results from `profile.yml`, like 「約75%削減」, are exempt); leftover `TODO`s; unfilled `profile.yml` | mixed first-person words (私/僕/筆者…) |
| **fact-check** (Claude) | a claim a source contradicts; a statistic or survey with no source linked in the post; a title that claims more than the body shows | claims it couldn't confirm |

These target the mistakes that cost freelance writers credibility: misread
survey numbers, a headline stronger than the data, security advice that's wrong,
an author bio that changes from post to post.

### About the fact-check

- Runs `claude-opus-5-5` with adaptive thinking at effort `high` and up to 15 web
  searches per article. It quotes each claim, gives a verdict, the evidence URL
  and a suggested fix, in the article's language.
- Refusal fallback is on (`fallbacks: "default"`): if Claude declines a request,
  the API reruns it on Anthropic's recommended fallback model and the report
  says so.
- Tune with `FACTCHECK_MODEL`, `FACTCHECK_EFFORT` and `FACTCHECK_MAX_SEARCHES`.
- Billed to your API key per run (tokens plus web searches). CI checks only the
  articles a PR changes; each report ends with the tokens and searches used.
- `--json out.json` keeps the raw results; `--replay out.json` re-renders them
  without calling the API.
- Treat it as a careful second reader: open the evidence link before you change
  a claim.

## Publishing playbook

- **Two audiences.** note is for the people who hire you: their problem, a real
  case with numbers, what to do today, and a link to your service. Zenn/Qiita is
  for engineers: reproducible steps and working code that prove you can do the
  work. Aim for one or two note posts and one technical post a week; consistency
  beats volume.
- **Every post leads somewhere.** The CTA check makes each post link to a
  service page or your contact form.
- **Pin your best "client pain" story** on your note profile. It's what new
  readers see first.
- **Show, don't claim.** Use a real project (with permission) and its before and
  after numbers instead of "in my experience".
- **Proposal demos.** For a job you really want on Lancers or similar, build a
  small working demo and publish it with `templates/demo-README.md`. Use made-up
  company names and dummy data unless the client agrees; check the platform's
  rules before quoting the job post.
- **One bio.** Your facts, Lancers stats, past projects and certifications are in
  `profile.yml`; the fact-checker flags any post that contradicts them
  (「開発歴10年」, a project you didn't list, a review count that's out of date).
- **One name.** Lancers says 匠, Zenn says なび, GitHub says codemonkey. Clients
  follow links between them; use the same name and photo everywhere.

## Commands

| Command | Does |
|---|---|
| `npm run new -- <zenn\|qiita\|note> <slug> --title "…"` | Create a draft from the template, with your CTA filled in |
| `npm run check [-- files]` | textlint, validate and fact-check (no files = changed vs. `main`); `--no-factcheck` to skip Claude |
| `npm run validate [-- files]` | Front matter, CTA, sources, placeholders, persona |
| `npm run factcheck [-- files]` | Claude fact-check; `--report r.md --json r.json`, `--replay r.json` |
| `npm run note -- notes/<slug>.md` | Copy-and-paste page for note |
| `npm run preview:zenn` / `preview:qiita` | Local previews |
| `npm run site` / `site:preview` | Build the hub site (and GitHub profile README) / preview it locally |
| `npm test` | Tests for the scripts |
