import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { ROOT } from "../scripts/lib/common.mjs";
import worker, { dispatch, JOBS } from "../clock/src/worker.mjs";

const toml = fs.readFileSync(path.join(ROOT, "clock/wrangler.toml"), "utf8");
const crons = [...toml.match(/crons = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const workflow = (file) => YAML.parse(fs.readFileSync(path.join(ROOT, ".github/workflows", file), "utf8"));
/** "13 19 * * *" (UTC) → minutes after midnight JST. */
const jst = (cron) => {
  const [m, h] = cron.split(" ").map(Number);
  return ((h + 9) % 24) * 60 + m;
};

test("every Cron Trigger has a job, every job a trigger, and each starts a workflow that can be started", () => {
  assert.deepEqual([...crons].sort(), Object.keys(JOBS).sort());
  for (const [cron, job] of Object.entries(JOBS)) {
    const on = workflow(job.workflow).on;
    assert.ok(on && "workflow_dispatch" in on, `${job.workflow} needs workflow_dispatch (${cron})`);
    for (const k of Object.keys(job.inputs ?? {})) assert.ok(on.workflow_dispatch?.inputs?.[k], `${job.workflow} has no input "${k}"`);
  }
});

test("the writer starts well before 09:00 JST; Publish starts just before and waits until 09:00, then once more after", () => {
  const at = (file) => Object.entries(JOBS).filter(([, j]) => j.workflow === file);
  for (const [cron] of at("write.yml")) assert.ok(jst(cron) <= 7 * 60, `${cron} writes by 07:00 JST`);
  const [early, late] = at("publish.yml").sort(([a], [b]) => jst(a) - jst(b));
  assert.ok(jst(early[0]) < 9 * 60 && jst(early[0]) >= 8 * 60 + 30, "the first Publish start is 08:30–09:00 JST");
  assert.equal(early[1].inputs?.at, "09:00");
  assert.ok(jst(late[0]) > 9 * 60, "a catch-up run after 09:00");
  assert.equal(late[1].inputs, undefined, "the catch-up posts at once");
});

test("the Publish workflow only passes a well-formed time to crosspost", () => {
  const step = workflow("publish.yml").jobs.publish_articles.steps.find((s) => s.name === "Copy due Zenn articles to Qiita and note");
  assert.match(step.env.AT, /github\.event_name == 'schedule' && '09:00' \|\| inputs\.at/);
  assert.match(step.run, /\^\[0-2\]\[0-9\]:\[0-5\]\[0-9\]\$/);
  assert.doesNotMatch(step.run, /\$\{\{/, "no expression inside the shell command");
});

const env = { REPO: "owner/repo", GITHUB_TOKEN: "github_pat_test0token\n" };
function fakeFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const r = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (r instanceof Error) throw r;
      return new Response(r.body ?? null, { status: r.status });
    },
  };
}
const noWait = async () => {};

test("dispatch asks GitHub to start the workflow on main, with its inputs", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 204 }]);
  assert.equal(await dispatch(env, JOBS["50 23 * * *"], { fetchImpl, wait: noWait }), 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://api.github.com/repos/owner/repo/actions/workflows/publish.yml/dispatches");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer github_pat_test0token", "the pasted newline is trimmed");
  assert.ok(init.headers["user-agent"]);
  assert.deepEqual(JSON.parse(init.body), { ref: "main", inputs: { at: "09:00" } });
});

test("server errors and network failures are retried; a bad token fails at once; no token, no call", async () => {
  const flaky = fakeFetch([{ status: 502 }, new Error("connect ETIMEDOUT"), { status: 204 }]);
  assert.equal(await dispatch(env, JOBS["13 19 * * *"], { fetchImpl: flaky.fetchImpl, wait: noWait }), 3);
  const denied = fakeFetch([{ status: 401, body: '{"message":"Bad credentials"}' }]);
  await assert.rejects(dispatch(env, JOBS["13 19 * * *"], { fetchImpl: denied.fetchImpl, wait: noWait }), /write\.yml: HTTP 401: .*Bad credentials/);
  assert.equal(denied.calls.length, 1);
  const down = fakeFetch([{ status: 503 }]);
  await assert.rejects(dispatch(env, JOBS["13 19 * * *"], { fetchImpl: down.fetchImpl, wait: noWait }), /HTTP 503/);
  assert.equal(down.calls.length, 5);
  await assert.rejects(dispatch({ REPO: "owner/repo" }, JOBS["13 19 * * *"]), /GITHUB_TOKEN secret is not set/);
});

test("a secret that isn't a token (say, the prompt pasted by mistake) is named as such and never sent", async () => {
  const never = fakeFetch([{ status: 204 }]);
  const pasted = { REPO: "owner/repo", GITHUB_TOKEN: "? Enter a secret value: ›" };
  await assert.rejects(dispatch(pasted, JOBS["13 19 * * *"], { fetchImpl: never.fetchImpl }), /isn't a GitHub token \(it should start with github_pat_\)/);
  assert.equal(never.calls.length, 0);
});

test("an unknown trigger is an error, not a silent no-op", async () => {
  await assert.rejects(worker.scheduled({ cron: "0 0 1 1 *" }, env), /no job for the cron/);
});
