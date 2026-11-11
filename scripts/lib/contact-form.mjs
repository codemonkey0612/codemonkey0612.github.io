// The inquiry form on /contact/ (markup only; behaviour in site/assets/contact.js, styles in
// site/assets/contact.css, the endpoint in contact/). No address of the site owner appears
// anywhere here: the form posts to the endpoint, which holds the recipient as a secret.
import { BUDGETS, CATEGORIES, LIMITS, SCHEDULES } from "../../contact/src/core.mjs";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CATEGORY_HINT = { ai: "生成AI・チャットボット・AI導入", web: "WordPress・Shopify・サイト制作", system: "業務システム・改修・診断", other: "まだ決まっていない" };
const PILLAR_TO_CATEGORY = { AI: "ai", "Web・EC": "web", システム開発: "system", "品質・セキュリティ": "system" };

/** Processing actually done by the form and contact/ (shown in the privacy panel). */
export const PRIVACY_HTML = `<h2 id="privacy-title" class="privacy-title">個人情報の取り扱い（お問い合わせフォーム）</h2>
<p>このフォームでお預かりする情報と、その扱いは次のとおりです。</p>
<dl class="privacy-list">
  <div><dt>お預かりする情報</dt><dd>お名前、会社名（任意）、返信先のメールアドレス、相談したいこと、ご予算・希望時期（任意）、ご相談内容。実績やサービスのページから来た場合は、そのページの名前（ご相談の対象）も一緒に送ります。</dd></div>
  <div><dt>使う目的</dt><dd>お問い合わせへのお返事と、そのご相談に関するご連絡のためだけに使います。</dd></div>
  <div><dt>送られ方</dt><dd>入力内容は、送信用のプログラム（Cloudflare Workers）から、メール配信サービス（Resend）を通じて、このサイトの運営者にメールで届きます。このサイト上には保存しません。どちらも米国の事業者のサービスのため、日本国外のサーバーで処理されることがあります。</dd></div>
  <div><dt>一時的に残る情報</dt><dd>短い時間に何度も送られたり、同じ内容が二重に送られたりするのを防ぐため、送信元IPアドレスを元に戻せない形（ハッシュ値）に変えたものを最長10分、送信ごとの識別番号と受付番号を最長24時間、送信用のプログラムの保存領域に残します。いずれも期限が来ると自動で消えます。</dd></div>
  <div><dt>Cookie・アクセス解析</dt><dd>このフォームでは使っていません。</dd></div>
  <div><dt>削除のご依頼</dt><dd>お返事のメールにご返信いただければ、受け取ったお問い合わせのメールを削除します。</dd></div>
</dl>`;

/**
 * The form section body. Place it inside <section class="inq-sec">; load contact.css and
 * contact.js (defer) on the page. `base` is the relative path to the site root ("../").
 */
export function renderInquiryForm({ endpoint = "", lancersUrl, services = [], works = [], base = "../" } = {}) {
  const ep = String(endpoint ?? "").trim();
  const lancers = esc(lancersUrl);
  const ext = (text) => `<a href="${lancers}" target="_blank" rel="noopener">${text}<span class="sr-only">（新しいタブで開きます）</span></a>`;
  // Names for ?service=<id> / ?work=<id>, read by contact.js.
  const topics = {
    service: Object.fromEntries(services.map((s) => [s.id, { name: s.name, cat: PILLAR_TO_CATEGORY[s.pillar] ?? "other" }])),
    work: Object.fromEntries(
      works.map((w) => [w.id, { name: w.name ?? w.headline ?? w.id, cat: PILLAR_TO_CATEGORY[w.service?.pillar] ?? "other" }]),
    ),
  };
  const field = (name, label, input, { optional = false, hint = "", hintAfter = false } = {}) => `<div class="field" data-field="${name}">
        <label class="field-label" for="f-${name}">${label}${optional ? '<span class="opt">任意</span>' : '<span class="req">必須</span>'}</label>
        ${hint && !hintAfter ? `<p class="field-hint" id="f-${name}-hint">${hint}</p>` : ""}
        ${input}
        ${hint && hintAfter ? `<p class="field-hint field-hint-after" id="f-${name}-hint">${hint}</p>` : ""}
        <p class="field-err" id="f-${name}-err" hidden></p>
      </div>`;
  const describedBy = (name, hint) => `aria-describedby="${hint ? `f-${name}-hint ` : ""}f-${name}-err"`;
  const select = (name, list) =>
    `<select class="field-input" id="f-${name}" name="${name}" ${describedBy(name)}><option value="">選択してください</option>${list.map((x) => `<option>${esc(x)}</option>`).join("")}</select>`;

  return `<div class="inq-card">
  <div class="inq-intro">
    <p class="inq-label">Contact</p>
    <h2 class="inq-title">一緒に、<br>次の景色へ。</h2>
    <p>アイデアの段階でも、まだ整理できていないご構想でも、どうぞお気軽にご相談ください。</p>
    <p>内容を確認して、ご入力いただいたメールアドレスにお返事します。</p>
    <p class="inq-alt">ランサーズからのご相談も受け付けています。<br>${ext("Lancersで相談する")}</p>
  </div>
  <form class="inq" id="inquiry" novalidate data-endpoint="${esc(ep)}" data-lancers="${lancers}"${ep ? ` action="${esc(ep)}" method="post"` : ""} aria-labelledby="inq-form-title">
    <h2 class="sr-only" id="inq-form-title">お問い合わせフォーム</h2>
    <ol class="inq-steps" aria-label="お問い合わせの流れ">
      <li class="is-current" aria-current="step"><span class="inq-step-no" aria-hidden="true">1</span>入力</li>
      <li><span class="inq-step-no" aria-hidden="true">2</span>確認</li>
      <li><span class="inq-step-no" aria-hidden="true">3</span>完了</li>
    </ol>
    <noscript><p class="inq-note">${ep ? "JavaScriptが無効のため、確認画面を省いてそのまま送信します。" : `このフォームはJavaScriptを使います。お手数ですが、${ext("Lancers")}からご相談ください。`}</p></noscript>
    <div class="inq-summary" role="alert" tabindex="-1" hidden>
      <p class="inq-summary-title">入力内容をご確認ください</p>
      <ul></ul>
    </div>
    <script type="application/json" class="inq-topics">${JSON.stringify(topics).replace(/</g, "\\u003c")}</script>

    <div class="inq-panel" data-step="input">
      ${ep ? "" : `<p class="inq-notice"><svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.6v.01"/></svg><span>このフォームからの送信は、現在準備中です。お手数ですが、ご相談は${ext("Lancers")}からお送りください。</span></p>`}
      <div class="inq-context" hidden>
        <span>ご相談の対象：<b class="inq-context-name"></b></span>
        <button type="button" class="inq-context-x"><span aria-hidden="true">×</span><span class="sr-only">ご相談の対象を外す</span></button>
      </div>
      <input type="hidden" name="context" value="">
      ${field("name", "お名前", `<input class="field-input" id="f-name" name="name" type="text" placeholder="例）山田 太郎" autocomplete="name" maxlength="${LIMITS.name}" required ${describedBy("name")}>`)}
      ${field("company", "会社名・団体名", `<input class="field-input" id="f-company" name="company" type="text" placeholder="例）株式会社〇〇" autocomplete="organization" maxlength="${LIMITS.company}" ${describedBy("company")}>`, { optional: true })}
      ${field("email", "返信先メールアドレス", `<input class="field-input" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" maxlength="${LIMITS.email}" required ${describedBy("email", true)}>`, { hint: "お返事はこのアドレスにお送りします。", hintAfter: true })}
      <fieldset class="field field-choice" data-field="category" aria-describedby="f-category-err">
        <legend class="field-label">相談したいこと<span class="req">必須</span></legend>
        <div class="choices">
          ${Object.entries(CATEGORIES)
            .map(([v, label]) => `<label class="choice"><input type="radio" name="category" value="${v}" required><span class="choice-body"><b>${esc(label)}</b><small>${esc(CATEGORY_HINT[v])}</small></span></label>`)
            .join("\n          ")}
        </div>
        <p class="field-err" id="f-category-err" hidden></p>
      </fieldset>
      <div class="field-row">
        ${field("budget", "ご予算", select("budget", BUDGETS), { optional: true })}
        ${field("schedule", "希望時期", select("schedule", SCHEDULES), { optional: true })}
      </div>
      <div class="field" data-field="message">
        <label class="field-label" for="f-message">ご相談内容<span class="req">必須</span></label>
        <p class="field-hint" id="f-message-hint">ご相談の背景、実現したいこと、いまの課題などを、分かる範囲でご記入ください（${LIMITS.messageMin}〜${LIMITS.message}文字）。</p>
        <textarea class="field-input" id="f-message" name="message" rows="8" placeholder="ご相談の背景、実現したいこと、いまの課題などをご自由にご記入ください。" maxlength="${LIMITS.message}" required ${describedBy("message", true)}></textarea>
        <p class="field-count" aria-hidden="true"><span class="field-count-n">0</span> / ${LIMITS.message}</p>
        <p class="field-err" id="f-message-err" hidden></p>
      </div>
      <div class="field field-consent" data-field="consent">
        <div class="consent">
          <input id="f-consent" name="consent" type="checkbox" value="on" required aria-describedby="f-consent-err">
          <label for="f-consent">個人情報の取り扱いに同意します<span class="req">必須</span></label>
        </div>
        <p class="consent-link"><a href="#privacy" class="privacy-open" aria-haspopup="dialog">個人情報の取り扱いを読む</a></p>
        <p class="field-err" id="f-consent-err" hidden></p>
      </div>
      <div class="inq-hp" aria-hidden="true">
        <label for="f-website">Webサイト（入力しないでください）</label>
        <input id="f-website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <div class="inq-actions${ep ? "" : " inq-needs-js"}">
        <button class="btn btn-gold inq-next" type="submit">送信する</button>
      </div>
      <p class="inq-time"><svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M20 4C11 4.5 6.5 9.5 5.5 19.5"/><path d="M5.5 19.5C12 19 16.5 15.5 18 9"/><path d="M4 21l2-2"/></svg>ご入力は数分で完了します。</p>
    </div>

    <div class="inq-panel" data-step="confirm" hidden>
      <h3 class="inq-h" tabindex="-1">入力内容の確認</h3>
      <p class="inq-lead">この内容で送信します。直す場合は「修正する」を押してください。</p>
      <dl class="inq-review"></dl>
      <div class="inq-error" role="alert" tabindex="-1" hidden>
        <svg class="inq-error-ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v6M12 16.6v.01"/></svg>
        <p class="inq-error-text"></p>
        <p class="inq-error-alt">${ext("Lancersで相談する")}</p>
      </div>
      <div class="inq-actions">
        <button type="button" class="btn btn-ghost" data-action="edit">修正する</button>
        <button type="button" class="btn btn-gold" data-action="send">この内容で送信する</button>
      </div>
    </div>

    <div class="inq-panel inq-done" data-step="done" hidden>
      <div class="inq-done-card">
        <span class="inq-orb" aria-hidden="true"><svg class="inq-check" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="29"/><path d="M19 33.5l8.5 8.5L45 23.5"/></svg></span>
        <div class="inq-done-text">
          <h3 class="inq-h" tabindex="-1">送信しました</h3>
          <p>お問い合わせを受け付けました。<br>内容を確認のうえ、ご入力いただいたメールアドレスにお返事します。</p>
          <p class="inq-ref">受付番号：<b class="inq-ref-no"></b></p>
        </div>
      </div>
      <p class="inq-note">しばらくたってもお返事が届かない場合は、迷惑メールのフォルダもご確認ください。</p>
      <p><a class="btn btn-ghost" href="${esc(base)}">トップへ戻る</a></p>
    </div>
  </form>
</div>
<dialog class="privacy" id="privacy" aria-labelledby="privacy-title">
  <div class="privacy-body">
    ${PRIVACY_HTML}
  </div>
  <p class="privacy-actions"><button type="button" class="btn btn-ghost privacy-close">閉じる</button></p>
</dialog>`;
}
