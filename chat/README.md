# The site assistant (chat/)

The 「AIに質問」 button on shanaiai.com. A Cloudflare Worker at `https://chat.shanaiai.com/`
answers questions about the site with Claude, using only the site's own content:

1. The site build writes `dist/site/assets/kb.json`: the site's text as short passages
   (`scripts/lib/kb.mjs`; Lancers-only packages and anything private stay out).
2. For each question the Worker picks the closest passages (BM25 over character bigrams,
   `src/core.mjs`) and sends them to Claude as `search_result` blocks with citations on.
3. Claude answers from those passages only, cites them, and says it doesn't know when they
   don't hold the answer. The page shows the answer as it is written, then numbered links to
   the pages it came from (`site/assets/chat.js`, loaded only when the window opens).

Model: `claude-opus-5-5` at low effort, `max_tokens` 2048, with server-side refusal fallbacks
(`fallbacks: "default"`). Change it with the `MODEL` / `EFFORT` vars in `wrangler.toml`.

Limits: 15 questions per visitor per 10 minutes (hashed IP) and `DAILY_CAP` (300) per day for
the whole site. A question costs roughly 3–5 yen (about 3.5K input tokens + a short answer);
the daily cap bounds the worst day. Also set a monthly spend limit in the Anthropic Console.

Nothing is stored: KV holds only the counters. Questions go to Anthropic's API (the window
says so) and are not logged here.

## Setup (once)

1. Save your Claude API key (from https://platform.claude.com/ → API keys) where only you can read it:

   ```bash
   mkdir -p ~/.config/shanaiai && (umask 177; nano ~/.config/shanaiai/anthropic-key)
   ```

2. Run `bash chat/deploy.sh` (creates the KV namespace, deploys, stores the key as a secret,
   asks a test question). Wrangler uses your existing Cloudflare login (`npx wrangler login`).
3. Set `chat.endpoint: "https://chat.shanaiai.com/"` in `profile.yml` and rebuild the site:
   the button appears on every page but the contact page, and a Live Demo band on the
   chatbot service page.

To change the key: `tr -d '\r\n' < ~/.config/shanaiai/anthropic-key | npx wrangler secret put ANTHROPIC_API_KEY`.
To turn the assistant off: empty `chat.endpoint` and rebuild (the Worker can stay).

Tests: `npm test` at the repository root (`test/chat.test.mjs`, no API calls).
