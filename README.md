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
notes/      note posts         (saved to note as drafts when status: ready)
site/       portfolio site: works (works.yml), one page per service
            (services/*.md), Lancers prices (packages.yml), images and videos
            (assets/media/), about text, styles and motion (assets/)
templates/  article and proposal-demo templates
profile.yml who you are: services, Lancers stats, past projects, certifications
            (read by the site, the templates and every check)
scripts/    new · check · validate · factcheck · note export · site
ideas.md    post ideas built from your own projects and reviews
```

## One-time setup

1. **Install:** `npm ci` (Node 22+).
2. **`profile.yml`** is filled from your Lancers profile, with your accounts
   (2026-11-09): Zenn `takumiengineer`, Qiita `takumi_engineer`, note `shanaiai`.
3. **Push to GitHub** (done 2026-11-08, along with step 4: this is
   `codemonkey0612/codemonkey0612.github.io`) as a new repository with `main` as
   the default branch. Name it `codemonkey0612.github.io` and the site lives at
   <https://codemonkey0612.github.io/>, which is what `site_url` says. With any
   other name it lives at `https://codemonkey0612.github.io/<repo>/`: update
   `site_url` to match. A custom domain works too (Settings → Pages). On the
   free plan, Pages needs a public repository, so drafts in it are public.
4. **GitHub Pages:** Settings → Pages → Source: **GitHub Actions**. The `Site`
   workflow then deploys on every push to `main`.
5. **Zenn:** signed in as `takumiengineer`, open *Dashboard → Deploys*
   (GitHub連携) on zenn.dev and connect this repository. Zenn then publishes `articles/*.md` with `published: true` on every
   push to `main`.
6. **Qiita:** signed in as `takumi_engineer`, create an access token with
   `read_qiita` and `write_qiita` at <https://qiita.com/settings/tokens/new>. Run `npx qiita login` locally (for
   preview), and add the token as the repository secret `QIITA_TOKEN`.
7. **note:** in a browser signed in to note as `shanaiai`, open
   DevTools → *Application* → *Cookies* → `https://note.com`, copy the value
   of `_note_session_v5`, and add it as the repository secret `NOTE_SESSION`.
   It's your login, so treat it like a password; it lasts about a month. When
   the Publish job says the cookie has expired, copy a fresh one the same way.
8. **Bluesky:** signed in to your account, open *Settings → Privacy and security
   → App passwords*, create one (e.g. "writing pipeline") and add it as the
   repository secret `BLUESKY_APP_PASSWORD`. It is not your account password and
   you can revoke it there at any time. Put your handle in `profile.yml`
   (`platforms.bluesky`), and a link to your site or Lancers in your Bluesky bio.
9. **Claude:** create an API key in the Claude Console and add it as the
   repository secret `ANTHROPIC_API_KEY` (done 2026-11-09). The autopilot and the
   fact-check use it. For local fact-checks,
   `export ANTHROPIC_API_KEY=…`. Without it, CI still lints and validates and
   prints a warning that fact-checking is off.
10. **Protect `main`:** *Settings → Branches → Add rule*: require a pull request
   and the status check **check**. Then nothing reaches Zenn or Qiita unchecked.

## Automatic writing (autopilot)

Every morning at 06:00 (Japan time) the **Write articles** workflow fills the next
open mornings on its own (`scripts/autowrite.mjs`, settings in `autopilot.yml`):

1. **Topic:** it rotates through three pillars by weight: small-business technical
   problems and their solutions, hands-on AI and software work, and the latest
   technology news (found with web search, from primary sources, last 14 days). It
   picks one concrete topic that ties to one of your services and your real
   projects, and isn't a repeat of a recent title.
2. **Writing:** Claude (Opus 5.5) writes it in your voice (「私」, です・ます) with
   these rules: only the experience in `profile.yml` (clients anonymous, numbers
   exactly as given), every figure or date linked to a source it checked, working
   code for engineers, the service link only in the closing paragraph, and the
   topics in `avoid:` never touched.
3. **Checks and fixes:** the same checks as a pull request (validate, textlint,
   fact-check). Anything they flag goes back to Claude to fix, up to two rounds.
4. **Publishing:** a passing article is committed with `published: true` and its
   morning's `published_at`; Zenn publishes it at 09:00 and the Publish workflow
   posts the day's separate Qiita article (see below). One that still fails is kept as an unpublished
   Zenn draft with the problems listed at its top, the morning stays open for the
   next run, and the run fails so GitHub emails you.

Every run's topic, pillar, result and cost are logged in `autopilot/history.json`
and in the run summary. Steering it: edit the pillars' `brief` and `weight`, or
the `avoid` list, in `autopilot.yml`. A change to that file also starts a run.
`enabled: false` stops it. It also writes ahead (`days_ahead: 2`), so an article
for tomorrow is in `articles/` a day early if you want to read or edit it.

**Platform rules.** Zenn's terms count posting machine-generated text as spam and
its 2026 AI policy asks that a person check the content before publishing, with
per-user posting limits and possible account freezes
([Zenn](https://info.zenn.dev/2026-03-10-ai-contents-guideline)); Qiita asks you to
check AI-written content before posting
([Qiita](https://help.qiita.com/ja/articles/qiita-community-guideline)). `mode: auto`
publishes without your review (your decision, 2026-11-09); `mode: review` opens a
pull request for each article instead, and merging it publishes it.

## Writing a post (one a day, live at 09:00)

Each post is written once, as a Zenn article. It goes live every morning at
09:00 (Japan time) on Zenn and Qiita; you post it to note yourself.

```bash
git switch -c post/rag-chunks
npm run new -- zenn rag-chunk-size-tips --title "RAGの精度が出ないときに見る3か所" --topics rag,python --service ai-chatbot
#   → published_at: "2026-11-10 09:00"  (the next morning with no post)
npm run preview:zenn
npm run check -- articles/rag-chunk-size-tips.md   # textlint → validate → fact-check
npm run schedule                                   # your calendar: what goes out which morning
```

When it's ready, set `published: true`, push and open a PR; CI runs the same
checks and comments the fact-check report. Merge any time before its morning:

1. **Zenn** publishes it at its `published_at` by itself (Zenn's own scheduled
   publishing).
2. **Qiita** gets its own article each morning (`qiita: daily` in
   `autopilot.yml`, since 2026-11-10), not a copy: Qiita's spam monitoring hid
   the first automatic copy on 2026-11-09, and its guideline wants knowledge
   useful to engineers, no posts mainly for promotion, and AI-written content
   checked before posting.
   - **Writing** (the 06:00 autopilot run): for every scheduled Zenn article
     from today on without one, Claude writes `qiita/<slug>.md`, a separate
     engineer-facing article on one technical problem in that topic, with
     working code. It goes through validate, textlint and the fact-check (up
     to two rounds of fixes) plus: no links to your site, Lancers, Zenn or note
     (validate refuses them on every Qiita article), at least one code block, a
     title different from Zenn's, and at most 15% of its prose shared word for
     word with the Zenn article. A passing one gets the Zenn article's
     `published_at`; one that still fails gets `status: failed`, is never
     posted, and the run fails. Logged in `autopilot/qiita.json`.
   - **Posting** (the 09:00 Publish run, `scripts/qiita-daily.mjs`): first it
     checks the Qiita articles this repository posted. If Qiita has hidden one
     (made it private) or it's gone, it writes `qiita/PAUSED` and posts nothing
     more until you've looked at it and deleted that file; a post Qiita refuses
     pauses it the same way. Then, if nothing went up on your Qiita today, it
     moves the oldest due article into `public/` (reusing the id if that title is
     already on Qiita) and qiita-cli posts it. At most one new Qiita article a
     day. A Qiita problem fails the run (GitHub emails you) but never stops note
     or Bluesky.

   `qiita: auto` copies each Zenn article instead (leaving out the promotional
   closing paragraph), `manual` posts only what you put in `public/`, `off`
   nothing. With `auto`, every morning the Publish workflow waits until
   09:00, copies each article that's due to `public/<slug>.md` (Zenn-only
   syntax converted: `:::message` → `:::note`, `:::details` → `<details>`,
   embeds → links, `/images/…` → their GitHub URLs) and publishes it. GitHub
   starts scheduled runs late when it's busy (5 hours late on 2026-11-10), so
   the workflow is scheduled six times between 03:47 and 08:37; the first run
   to start waits for 09:00 and posts, and the rest find nothing to do. If all
   of them start after 09:00, the article goes out as soon as the first one runs.
   Edit the Zenn article later and its Qiita copy follows. A Qiita article you
   write yourself in `public/` is never touched.
3. **note:** the same run makes `notes/<slug>.md` (Zenn syntax converted,
   tables as bullet lists, the topics as hashtags), gives it as 見出し画像 the
   Lancers package image that fits the article best, and posts it to note (see
   below). The images are `notes/covers/<id>.jpg` (1280 × 670), listed with
   their keywords in `notes/covers/covers.yml`: a keyword that is one of the
   article's topics counts 3, one in its title 2, ties go to the image used
   least, and with no match the IT consulting image is used. After you
   change a package image, update `original:` in `covers.yml` and run
   `npm run note:covers` (needs ffmpeg; reads `../portfolio`). To use your own
   見出し画像 for one post, save it as `notes/<slug>.png` or `.jpg` (1280 × 670;
   the slug is in `npm run schedule`) before 09:00 on the article's morning,
   and it's used instead. With `note: draft` in `autopilot.yml` it
   saves a draft for you instead; with `note: off` it does nothing, and
   `npm run note -- articles/<slug>.md` still gives a copy-and-paste page.

Topics become the Qiita tags, so give every article 1–5. To change a date,
edit `published_at`; `npm run schedule` flags two posts on the same morning.
GitHub pauses scheduled jobs in a repository with no activity for 60 days;
daily posts keep it active.

**note** has no posting API for individual accounts (note's "note API" from
October 2026 is for corporate note pro customers only), so the Publish job uses
the same internal endpoints note's own editor uses, signed in with your
`NOTE_SESSION` cookie (`scripts/note-draft.mjs`):

1. It turns each `notes/*.md` with `status: ready` into note's editor format
   (two heading levels; tables become bullet lists), uploads its images and its
   `cover:` as the 見出し画像, and saves it as a draft.
2. With `note: auto` (or `--publish`) it then publishes it, free, with the
   hashtags, and checks the public page. Only when that page is live does it
   write the link into `url:`; otherwise the run fails and names the draft's
   edit page so you can press 公開 yourself. With `note: draft` it stops at the
   draft and the summary links it.
3. Edit a post it has published (the text in `notes/<slug>.md`, or its
   `cover:`) and, with `note: auto`, the next run updates the public post too:
   new 見出し画像 first, then the text, without notifying your followers again.
   It then checks that note shows the new 見出し画像; if not, the run fails and
   names the edit page. (Editing the Zenn article doesn't change a note post
   that's already public.)

It records `note_id`, `note_key` and `note_hash` in the post's front matter, so
the next run updates the same post rather than making a new one, and it never
touches a post that's already public. It refuses a cookie from any account
other than `platforms.note` in `profile.yml`. The draft calls match two
independent open-source clients; the publish call (`PUT /api/v1/text_notes/{id}`)
is less well documented, which is why the public page is checked.

These endpoints are undocumented: note can change them without notice, and its
terms let it restrict accounts it judges to be misusing the service (publishing
without a person, your choice on 2026-11-09, adds to that). If the job starts
failing with "note may have changed its editor", the copy-and-paste route still
works:

```bash
npm run note:draft -- --dry-run      # what would be sent, without contacting note
npm run note -- notes/<slug>.md      # copy-and-paste page: dist/note/<slug>.html
```

**Bluesky:** after note, the Publish job announces each article that went live
on Zenn in the last two days (`scripts/bluesky-post.mjs`, Bluesky's official
API): 📝 and the title, the article's opening sentences, "💼 AI・Web開発のご相談 →"
with the service page the article ends with, up to three topics as hashtags,
and a link card to the Zenn article with the same Lancers package image as the
note copy, all within Bluesky's 300 characters. It waits until the Zenn page is
actually up. Each post is recorded in `social/bluesky.yml`, and it also checks
your recent posts for one that already links the article, so nothing is posted
twice. `bluesky: off` in `autopilot.yml` stops it;
`node scripts/bluesky-post.mjs --dry-run` prints what it would post.

## The hub site

`npm run site:preview` builds it and serves it at <http://localhost:4321/>.

- **Pages (31 routes):** home, `works/` (16 case studies, filter All/AI/Web/System),
  `services/` (8 service pages), `prices/`, `about/`, `reviews/` (all 26 Lancers
  reviews in full), `contact/` (the inquiry form), 404, plus `sitemap.xml`,
  `robots.txt` and `llms.txt`. Open Graph tags and schema.org data (Person,
  Service, CreativeWork, FAQ, breadcrumbs) on every page. Rendering lives in
  `scripts/lib/site-pages.mjs`; data loading in `scripts/lib/site-core.mjs`.
- **Design: "Celestial Atelier"** (2026-11-10, from the mockups and
  `TAKUMI-Celestial-31-Page-Prompts.md` in `~/dev/note/mockup`). Midnight
  `#081521`, pearl `#F6F7FB`, gold `#C9A24A`, ice blue `#9EC3FF`; Shippori
  Mincho headings, Noto Sans JP text, Cormorant Garamond Latin labels (Google
  Fonts, OFL). Same header (Works / Expertise / About / Contact) and footer on
  every page. Motion: section reveals, a gold line drawing through process
  steps, case-study media easing to full size, a measured layout animation on
  the works filter, one gold sweep on button hover. No scroll hijacking, no
  loader, no autoplaying video. Off for `prefers-reduced-motion` and with the
  footer's 「動きを減らす」 switch (remembered in the browser). Every page works
  without JavaScript; images carry their real width and height.
- **Hero sculptures** (`site/scene/`, three.js): each page has its own glass-and-
  gold scene — `kit.js` (materials, ribbon, frames, floor), `symbols.js`
  (shield, compass, gears, the 3D 匠 …), `scenes-main.js` (the 7 main pages,
  the Expertise orb and the inquiry portal), `scenes-services.js` and
  `scenes-works.js`. Visitors first see a **still**: `site/assets/art/<scene>.webp`
  (1920×1080, sculpture on the right) and `<scene>-m.webp` (1000×860, centred,
  shown below the headline on phones). On desktops with a fine pointer, enough
  memory and motion allowed, `app.js` loads `site/assets/celestial.js` and fades
  the live scene in over the still (gentle float, ±3° pointer tilt, the
  ribbon's glint follows scrolling; paused off-screen and in hidden tabs; pixel
  ratio capped at 1.5). After changing a scene:

  ```bash
  npm run site:scenes                       # re-bundle celestial.js only
  npm run site:scenes -- --stills home svc-shopify   # re-render these stills
  npm run site:scenes -- --stills           # all of them (~10 min, software WebGL)
  ```

  It needs Google Chrome and ffmpeg locally; commit `celestial.js` and
  `site/assets/art/` (the Pages build doesn't render).
  **Plates** (generated artwork) take precedence over the 3D still: put an image
  named after the scene (e.g. `home.png`, `svc-ai-chatbot.png`) in
  `~/dev/note/mockup/plates/` and run `npm run site:plates`. It writes
  `site/assets/plates/<scene>.webp`, a 1000×860 phone crop and `plates.json`
  (size, and light/dark measured where the headline sits). The live 3D scene is
  not loaded over a plate. What to generate: `~/dev/note/mockup/PLATES.md`.
  `art/scenes.json` records each scene's mood so the headline is light on dark
  scenes and dark on pearl ones.
- **Contact form** (`contact/`, `scripts/lib/contact-form.mjs`,
  `site/assets/contact.js`): every 相談する button goes to `/contact/` (with
  `?service=` or `?work=` so the form knows the context). The form posts to a
  Cloudflare Worker that emails you through Resend; your address lives only in
  the Worker's secrets. Until you deploy it and put its URL in `profile.yml`
  → `contact_form.endpoint`, the form says plainly that it can't send yet and
  points to Lancers. Setup: `contact/README.md`. Lancers stays as the second
  route (footer and contact page).
- **Brand art** (`site/media.yml`): the gold 匠 emblem (header, footer; the
  favicons are made from it) and the showreel (home). Each service shows its
  Lancers package images and promo videos (from `site/packages.yml`). The
  originals are in `~/dev/note/portfolio`. To rebuild the showreel, see the
  comment in `site/media.yml`.
- **Works** (`site/works.yml`): `sites:` are live sites you took part in
  building (screenshots in `site/assets/media/works/`, taken 2026-11-08);
  the Lancers items use your own images in `site/assets/media/portfolio/`;
  `lancers:` are the 14 Lancers portfolio items, each tied to its client
  reviews, so every case page quotes them in full and links to them.
  `featured: true` puts a work on the home page. To add one, copy an entry, add
  its image under `site/assets/media/works/`, and list its review ids. The
  build fails on a missing image, an unknown review or a duplicate id. Keep the
  `lancers:` text in sync with `~/dev/note/lancers-portfolio/items.mjs`.
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
- **Images and videos.** The cover image and promo video of each package on a
  service page are copied from Lancers (2026-11-08) into
  `site/assets/media/packages/<id>.webp` and `.mp4`, and listed as `cover:` and
  `video:` in `site/packages.yml`. They're served from this site because
  Lancers' video links expire. The build fails if a listed file is missing. To
  replace one, save the new files under the same names, shrunk like this:

  ```bash
  ffmpeg -i new.mp4 -vf scale=-2:720 -c:v libx264 -preset slow -crf 30 \
    -c:a aac -b:a 80k -movflags +faststart site/assets/media/packages/<id>.mp4
  python3 -c "from PIL import Image; Image.open('new.png').convert('RGB').save('site/assets/media/packages/<id>.webp', quality=82)"
  ```

  Covers should be 16:9.

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
- **One name.** Clients follow links between Lancers, Zenn, Qiita, note and
  GitHub; use the same name (匠) and the emblem everywhere.

## Commands

| Command | Does |
|---|---|
| `npm run new -- <zenn\|qiita\|note> <slug> --title "…"` | Create a draft from the template, with your CTA filled in |
| `npm run check [-- files]` | textlint, validate and fact-check (no files = changed vs. `main`); `--no-factcheck` to skip Claude |
| `npm run validate [-- files]` | Front matter, CTA, sources, placeholders, persona |
| `npm run factcheck [-- files]` | Claude fact-check; `--report r.md --json r.json`, `--replay r.json` |
| `npm run autowrite` | Write the next articles now (CI does this every morning; needs `ANTHROPIC_API_KEY`) |
| `npm run schedule` | Your calendar: each Zenn article's morning, and whether it's draft, scheduled or live |
| `npm run crosspost` | Copy the Zenn articles that are due to Qiita (the Publish workflow runs this daily at 09:00) |
| `npm run note:draft` | Save `status: ready` note posts as drafts in your note account (CI does this on push; `--dry-run` to preview) |
| `npm run note -- articles/<slug>.md` | Copy-and-paste page for note (also works for `notes/<slug>.md`) |
| `npm run preview:zenn` / `preview:qiita` | Local previews |
| `npm run site` / `site:preview` | Build the hub site (and GitHub profile README) / preview it locally |
| `npm test` | Tests for the scripts |
