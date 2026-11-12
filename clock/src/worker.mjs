// Starts the autopilot's GitHub Actions workflows on time. GitHub's own `schedule:` triggers start
// hours late or not at all when GitHub is busy (about 5 hours late on 2026-11-11; on 2026-11-12
// none had started by 09:30), while a workflow_dispatch starts within seconds. Cloudflare runs
// these Cron Triggers on time. The workflows skip work that's already done, so an extra start
// (a retry here, or GitHub's own late schedule) never posts or writes anything twice.
// Setup: clock/README.md. Needs the GITHUB_TOKEN secret (fine-grained, Actions: read and write
// on this repository only).

/** Each Cron Trigger (UTC, as in wrangler.toml) and the workflow it starts. */
export const JOBS = {
  "13 19 * * *": { workflow: "write.yml", what: "04:13 JST: write the next articles" },
  "13 21 * * *": { workflow: "write.yml", what: "06:13 JST: second try (only what's still open)" },
  "50 23 * * *": { workflow: "publish.yml", inputs: { at: "09:00" }, what: "08:50 JST: start Publish, which posts at 09:00" },
  "20 0 * * *": { workflow: "publish.yml", what: "09:20 JST: post anything still missing" },
};

const TRIES = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks GitHub to start `job.workflow` on the default branch. Retries server errors, rate limits
 * and network failures; a 4xx means the token or the workflow is wrong, so it fails at once.
 * Returns the number of tries it took.
 */
export async function dispatch(env, job, { fetchImpl = fetch, wait = sleep } = {}) {
  const token = String(env.GITHUB_TOKEN ?? "").trim(); // a pasted token often ends in a newline
  if (!token) throw new Error("the GITHUB_TOKEN secret is not set (clock/README.md)");
  // Never logged: only whether it looks like a GitHub token at all.
  if (!/^(github_pat_|ghp_)\w+$/.test(token)) throw new Error("the GITHUB_TOKEN secret isn't a GitHub token (it should start with github_pat_); set it again (clock/README.md)");
  const url = `https://api.github.com/repos/${env.REPO}/actions/workflows/${job.workflow}/dispatches`;
  const body = JSON.stringify({ ref: env.BRANCH || "main", ...(job.inputs ? { inputs: job.inputs } : {}) });
  let last = "";
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          "user-agent": "takumi-clock",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return attempt;
      last = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = err.message;
    }
    if (attempt < TRIES) await wait(attempt * 20_000);
  }
  throw new Error(`GitHub didn't start ${job.workflow}: ${last}`);
}

export default {
  async scheduled(controller, env) {
    // wrangler.selftest.toml (README) starts a harmless workflow every minute to check the token.
    const job = env.SELF_TEST ? { workflow: env.SELF_TEST, what: "self-test" } : JOBS[controller.cron];
    if (!job) throw new Error(`no job for the cron "${controller.cron}"`);
    const tries = await dispatch(env, job);
    console.log(`${job.what}: started ${job.workflow}${tries > 1 ? ` (try ${tries})` : ""}`);
  },
};
