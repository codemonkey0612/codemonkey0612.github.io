# お問い合わせフォームの送信先（Cloudflare Worker）

サイトの `/contact/` のフォームは、ここにある小さなプログラム（Cloudflare Worker）に送られ、
メール配信サービス Resend を通じて、あなたのメールアドレスに届きます。
**あなたのメールアドレスは Worker の「シークレット」にだけ置き、サイトやこのリポジトリには書きません。**

まだ設定していない間は、フォームは「送信先がまだ設定されていません」と表示し、Lancers を案内します（送れたふりはしません）。

## できること

- 入力チェック（文字数の上限、メールアドレスの形式、改行によるメールヘッダーの書き換えを防止）
- 許可したサイト（`ALLOWED_ORIGINS`）からの送信だけを受け付ける
- 同じ送信元から 10 分に 5 回まで（IP アドレスはハッシュ値にしてから 10 分だけ保存）
- 二重送信の防止（同じ送信は 24 時間、同じ受付番号を返し、メールは 1 通だけ）
- ボット対策のおとり項目（入力されていたら、送ったふりをして何もしない）
- 返信先（Reply-To）はお問い合わせした人のアドレス。メールに返信すればその人に届きます
- Resend が受け付けたときだけ「送信しました」と受付番号を返す。失敗や時間切れは正直にエラーを返す

## 設定のしかた（初回だけ）

1. [Cloudflare](https://dash.cloudflare.com/sign-up) と [Resend](https://resend.com/signup) のアカウントを作る（どちらも無料枠あり）。
2. Resend で API キーを作る。送信元に使うドメインを Resend で認証する（DNS に TXT/MX レコードを追加）。
   - ドメインがない間は、送信元 `onboarding@resend.dev` で **Resend に登録した自分のアドレス宛てにだけ** 送れます。最初の動作確認にはこれで十分です。
3. このフォルダで:

   ```sh
   cd contact
   npx wrangler login
   npx wrangler kv namespace create CONTACT_KV   # 表示された id を wrangler.toml の id に入れる
   npx wrangler secret put RESEND_API_KEY        # Resend の API キー
   npx wrangler secret put CONTACT_TO            # 受け取るあなたのアドレス（例: you@example.com）
   npx wrangler secret put CONTACT_FROM          # 送信元（例: TAKUMI <form@your-domain.example> / 最初は onboarding@resend.dev）
   npx wrangler deploy
   ```

4. 表示された URL（`https://takumi-contact.<あなたのサブドメイン>.workers.dev`）を、`profile.yml` の
   `contact_form.endpoint` に入れて、サイトを再ビルドする。
5. サイトのドメインを変えたら、`wrangler.toml` の `ALLOWED_ORIGINS` も直して `npx wrangler deploy`。

ローカルで試すとき（`npm run site:preview` は `http://localhost:4321`）は、`contact/.dev.vars` に
`ALLOWED_ORIGINS="http://localhost:4321"` と書いて `npx wrangler dev`（`.dev.vars` はコミットしない）。

テスト: リポジトリのルートで `node --test test/contact.test.mjs`。

---

# Inquiry form endpoint (English summary)

`/contact/` posts to this Cloudflare Worker, which emails you through Resend. Your address is a Worker
secret only; it never appears in the site, its bundles or this repo. Until you deploy, the form says it
cannot send and points to Lancers.

Setup: create Cloudflare and Resend accounts; verify a sending domain in Resend (without one, Resend only
delivers to your own account address from `onboarding@resend.dev` — fine for a first test). Then in
`contact/`: `npx wrangler kv namespace create CONTACT_KV` (put the id in `wrangler.toml`),
`npx wrangler secret put RESEND_API_KEY`, `… CONTACT_TO`, `… CONTACT_FROM`, `npx wrangler deploy`, and put
the worker URL in `profile.yml` → `contact_form.endpoint`.

Behaviour: origin allow-list, 16 KB body cap, server-side validation with CR/LF stripped from header
values, honeypot, 5 posts / 10 min per hashed IP (429), 24 h idempotency (a retry returns the same
reference and sends nothing), 10 s provider timeout (504), provider errors never echoed (502),
`{ ok: true, ref: "TK-XXXXXX" }` only after Resend accepted the message. A form-encoded POST (no
JavaScript) gets a small HTML result page.
