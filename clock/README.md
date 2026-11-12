# 毎朝の自動実行を時間どおりに始める時計（Cloudflare Worker）

記事の執筆（Write articles）と投稿（Publish articles）は GitHub Actions で動きますが、GitHub の
「スケジュール実行」は混んでいると何時間も遅れたり、実行されなかったりします
（2026-11-11 は約5時間遅れ、2026-11-12 は 9:30 になっても1回も始まりませんでした）。

そこで、時間どおりに動く Cloudflare の「Cron Triggers」で、この小さな Worker が毎朝決まった時刻に
GitHub に「ワークフローを今すぐ実行して」と頼みます（手動実行と同じ仕組みで、数秒で始まります）。

| 時刻（日本時間） | 始めるもの |
|---|---|
| 04:13 | Write articles（次の記事と Qiita 記事を書く） |
| 06:13 | Write articles（2回目。まだ書けていないものだけ） |
| 08:50 | Publish articles（09:00 まで待ってから note・Qiita・Bluesky に投稿） |
| 09:20 | Publish articles（取りこぼしがあれば投稿） |

どのワークフローも、すでに済んだことはやり直しません。2回目の実行や、遅れて届いた GitHub の
スケジュール実行があっても、二重に投稿・執筆することはありません。GitHub のスケジュールは予備として残しています。

## 設定のしかた（初回だけ）

### 1. GitHub トークンを作る（あなたが行う）

このリポジトリのワークフローを「始める」ことだけができるトークンです。

1. GitHub にログインした状態で <https://github.com/settings/personal-access-tokens/new> を開く
2. **Token name**: `takumi-clock`
3. **Expiration**: 選べるいちばん長い期間（期限が切れたら作り直して手順 2 をもう一度）
4. **Repository access**: **Only select repositories** → `codemonkey0612/codemonkey0612.github.io`
5. **Permissions** → **Repository permissions** → **Actions**: **Read and write**
   （Metadata: Read-only は自動で付きます。ほかは何も付けない）
6. **Generate token** を押して、表示されたトークンをコピー

### 2. トークンを Worker に入れる（あなたが行う）

```sh
cd ~/dev/note/writing/clock
npx wrangler@4.154.0 secret put GITHUB_TOKEN
```

と打つと入力を求められるので、コピーしたトークンを貼り付けて Enter。トークンは Cloudflare に
暗号化して保存され、このリポジトリやサイトには書かれません。

### 3. 動作確認

トークンを入れたら教えてください（または下の「自分で確認する」）。

## 自分で確認する

`wrangler.selftest.toml`（コミットしない一時ファイル）で、1分ごとにサイトのビルド（Site ワークフロー。
投稿はしない）を始める設定を一度だけデプロイし、GitHub の Actions に `workflow_dispatch` の Site の実行が
現れたら、すぐに本来の設定に戻します:

```sh
cd ~/dev/note/writing/clock
cat > wrangler.selftest.toml <<'EOF'
name = "takumi-clock"
main = "src/worker.mjs"
compatibility_date = "2025-10-01"
workers_dev = false
preview_urls = false
[triggers]
crons = ["* * * * *"]
[vars]
REPO = "codemonkey0612/codemonkey0612.github.io"
SELF_TEST = "site.yml"
EOF
npx wrangler@4.154.0 deploy -c wrangler.selftest.toml
# 1〜2分後に Site の workflow_dispatch 実行が現れたら成功
npx wrangler@4.154.0 deploy          # 本来の設定に戻す（忘れないこと）
rm wrangler.selftest.toml
```

## 変更・停止

- 時刻を変える: `wrangler.toml` の `crons`（UTC）と `src/worker.mjs` の `JOBS` を両方直して
  `npx wrangler@4.154.0 deploy`（`node --test test/clock.test.mjs` が食い違いを見つけます）
- 止める: Cloudflare のダッシュボード → Workers → `takumi-clock` → 設定 → トリガー で Cron を削除、
  または `npx wrangler@4.154.0 delete`
- うまく動かなかった日は、Cloudflare のダッシュボードの `takumi-clock` → ログ（Observability）に
  理由が出ます（例: `HTTP 401` はトークンの期限切れ）

---

# On-time morning starts (English summary)

GitHub's `schedule:` triggers start runs hours late or not at all when GitHub is busy, so this
Cloudflare Worker's Cron Triggers start the workflows through the GitHub API
(`POST /repos/{repo}/actions/workflows/{file}/dispatches`): Write articles at 04:13 and 06:13 JST,
Publish articles at 08:50 JST with `at: 09:00` (it waits, then posts at 09:00) and again at 09:20 JST
for anything missed. Every workflow skips finished work, so extra starts are harmless; the GitHub
schedules remain as a fallback. Server errors, rate limits and network failures are retried 5 times
(20 s, 40 s, …); a 4xx (bad or expired token) fails at once and shows in the Worker's logs.

Setup: create a fine-grained personal access token limited to this repository with
**Actions: Read and write** only, then `npx wrangler@4.154.0 secret put GITHUB_TOKEN` in `clock/`.
No workers.dev address or route: the Worker can't be called from outside. Self-test: deploy the
temporary `wrangler.selftest.toml` above (every minute, starts the Site workflow), watch for a
`workflow_dispatch` Site run, then `npx wrangler@4.154.0 deploy` to restore the real schedule.
Tests: `node --test test/clock.test.mjs` (triggers match `JOBS`, the workflows accept the start and
its inputs, request shape, retries).
