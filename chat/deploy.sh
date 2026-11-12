#!/usr/bin/env bash
# One-time setup and deploy of the site assistant (run it yourself: bash chat/deploy.sh).
# 1. creates the KV namespace for rate limits (first run only) and writes its id into wrangler.toml
# 2. deploys the Worker to https://chat.shanaiai.com/
# 3. stores your Claude API key as the Worker secret ANTHROPIC_API_KEY (read from the file, never printed)
# 4. asks one test question
set -euo pipefail
cd "$(dirname "$0")"
KEY="$HOME/.config/shanaiai/anthropic-key"
[ -s "$KEY" ] || { echo "First save your Claude API key to $KEY (see chat/README.md)."; exit 1; }
W="npx --yes wrangler@4"
[ -d node_modules/@anthropic-ai/sdk ] || npm install --no-audit --no-fund
if grep -q REPLACE_WITH_KV_ID wrangler.toml; then
  id=$($W kv namespace create CHAT_KV 2>&1 | grep -oE '[0-9a-f]{32}' | head -1 || true)
  [ -n "$id" ] || { echo "Could not create the KV namespace (are you logged in? npx wrangler login)."; exit 1; }
  sed -i "s/REPLACE_WITH_KV_ID/$id/" wrangler.toml
  echo "KV namespace CHAT_KV: $id"
fi
$W deploy
tr -d '\r\n' < "$KEY" | $W secret put ANTHROPIC_API_KEY
echo "Waiting a few seconds for the new secret…"; sleep 8
echo "Test question: NDAは結べますか？"
curl -s -N -X POST -H 'Origin: https://shanaiai.com' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"NDAは結べますか？"}]}' https://chat.shanaiai.com/ | grep -E '^event: (done|error)' -A1 | tail -2
echo
echo "Done. Tell Claude it's deployed, so the site gets its 「AIに質問」 button."
