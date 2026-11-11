// The inquiry form on /contact/ (markup only; behaviour in site/assets/contact.js, styles in
// site/assets/contact.css, the endpoint in contact/). No address of the site owner appears
// anywhere here: the form posts to the endpoint, which holds the recipient as a secret.
//
// One column, in the order of a conversation: what it's about (optional, one tap) → the
// message → who to reply to. Company, budget and timing fold away as optional extras.
// No confirm step: the button itself is the consent ("同意して送信する").
import { BUDGETS, LIMITS, SCHEDULES } from "../../contact/src/core.mjs";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The one-tap kinds of inquiry (values match CATEGORIES in contact/src/core.mjs). */
const KINDS = [
  ["ai", "AI導入・活用"],
  ["web", "Webサイト・EC"],
  ["system", "業務システム"],
  ["other", "その他・未定"],
];
/** What the message box suggests for each kind (contact.js swaps it in). */
export const MESSAGE_HINTS = {
  "": "例）こんなことを実現したい、いまこんなことに困っている、など。アイデアの段階でも大丈夫です。",
  ai: "例）社内の問い合わせ対応をAIで効率化したい。社内の文書を探せるチャットボットを作りたい。",
  web: "例）会社のWebサイトを新しくしたい。ネットショップを始めたい。",
  system: "例）Excelで回している業務をシステムにしたい。いまのシステムの不具合を直したい。",
  other: "例）こんなことができるか知りたい、という段階でも大丈夫です。",
};
const PILLAR_TO_CATEGORY = { AI: "ai", "Web・EC": "web", システム開発: "system", "品質・セキュリティ": "system" };

const svg = (body, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', "ic chip-check"),
  plus: svg('<path d="M12 5v14M5 12h14"/>', "ic more-ic"),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', "ic"),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.6v.01"/>', "ic"),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', "ic"),
};

/** Processing actually done by the form and contact/ (shown in the privacy panel). */
export const PRIVACY_HTML = `<h2 id="privacy-title" class="privacy-title">個人情報の取り扱い（お問い合わせフォーム）</h2>
<p>このフォームでお預かりする情報と、その扱いは次のとおりです。「同意して送信する」を押すと、この内容に同意いただいたものとして送信します。</p>
<dl class="privacy-list">
  <div><dt>お預かりする情報</dt><dd>お名前、返信先のメールアドレス、ご相談内容。ご入力いただいた場合は、ご相談の種類、会社名、ご予算、希望時期も。実績やサービスのページから来た場合は、そのページの名前（ご相談の対象）も一緒に送ります。</dd></div>
  <div><dt>使う目的</dt><dd>お問い合わせへのお返事と、そのご相談に関するご連絡のためだけに使います。</dd></div>
  <div><dt>送られ方</dt><dd>入力内容は、送信用のプログラム（Cloudflare Workers）から、メール配信サービス（Resend）を通じて、このサイトの運営者にメールで届きます。このサイト上には保存しません。どちらも米国の事業者のサービスのため、日本国外のサーバーで処理されることがあります。</dd></div>
  <div><dt>一時的に残る情報</dt><dd>短い時間に何度も送られたり、同じ内容が二重に送られたりするのを防ぐため、送信元IPアドレスを元に戻せない形（ハッシュ値）に変えたものを最長10分、送信ごとの識別番号と受付番号を最長24時間、送信用のプログラムの保存領域に残します。いずれも期限が来ると自動で消えます。</dd></div>
  <div><dt>Cookie・アクセス解析</dt><dd>このフォームでは使っていません。</dd></div>
  <div><dt>削除のご依頼</dt><dd>お返事のメールにご返信いただければ、受け取ったお問い合わせのメールを削除します。</dd></div>
</dl>`;

/**
 * The form panel (and its privacy dialog). The contact page sets it beside its introduction
 * inside <section class="inq-sec inq-scene">; load contact.css and contact.js (defer) on the
 * page. `base` is the relative path to the site root ("../").
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
    hints: MESSAGE_HINTS,
  };
  const err = (name) => `<p class="field-err" id="f-${name}-err" hidden></p>`;
  const chips = (name, list, label) => `<fieldset class="chips-set" data-field="${name}">
          <legend class="chips-label">${label}</legend>
          <div class="chips">
            ${list.map(([v, text]) => `<label class="chip"><input type="radio" name="${name}" value="${esc(v)}">${ICON.check}<span>${esc(text)}</span></label>`).join("\n            ")}
          </div>
        </fieldset>`;

  return `<div class="inq-card" data-state="input">
  <form class="inq" id="inquiry" novalidate data-endpoint="${esc(ep)}" data-lancers="${lancers}"${ep ? ` action="${esc(ep)}" method="post"` : ""} aria-labelledby="inq-title">
    <header class="inq-head">
      <h2 class="inq-title" id="inq-title">ご相談フォーム</h2>
      <p class="inq-time">${ICON.clock}1分ほどで送れます</p>
    </header>
    <noscript><p class="inq-notice">${ep ? "JavaScriptが無効のため、送信後に結果のページが開きます。" : `このフォームはJavaScriptを使います。お手数ですが、${ext("Lancers")}からご相談ください。`}</p></noscript>
    ${ep ? "" : `<p class="inq-notice">${ICON.alert}<span>このフォームからの送信は、現在準備中です。お手数ですが、ご相談は${ext("Lancers")}からお送りください。</span></p>`}
    <script type="application/json" class="inq-topics">${JSON.stringify(topics).replace(/</g, "\\u003c")}</script>
    <input type="hidden" name="context" value="">
    <p class="inq-context" hidden>
      <span class="inq-context-k">ご相談の対象</span><b class="inq-context-name"></b>
      <button type="button" class="inq-context-x"><span aria-hidden="true">×</span><span class="sr-only">ご相談の対象を外す</span></button>
    </p>

    <fieldset class="chips-set chips-kind" data-field="category">
      <legend class="field-label">どんなご相談ですか？<span class="opt">任意</span></legend>
      <div class="chips">
        ${KINDS.map(([v, text]) => `<label class="chip"><input type="radio" name="category" value="${v}">${ICON.check}<span>${esc(text)}</span></label>`).join("\n        ")}
      </div>
      ${err("category")}
    </fieldset>

    <div class="field" data-field="message">
      <label class="field-label" for="f-message">ご相談内容</label>
      <textarea class="field-input" id="f-message" name="message" rows="5" placeholder="${esc(MESSAGE_HINTS[""])}" maxlength="${LIMITS.message}" required aria-describedby="f-message-err f-message-count"></textarea>
      <p class="field-count" id="f-message-count" aria-live="polite" hidden></p>
      ${err("message")}
    </div>

    <div class="field-pair">
      <div class="field" data-field="name">
        <label class="field-label" for="f-name">お名前</label>
        <input class="field-input" id="f-name" name="name" type="text" placeholder="山田 太郎" autocomplete="name" maxlength="${LIMITS.name}" required aria-describedby="f-name-err">
        ${err("name")}
      </div>
      <div class="field" data-field="email">
        <label class="field-label" for="f-email">お返事先のメールアドレス</label>
        <input class="field-input" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" maxlength="${LIMITS.email}" required aria-describedby="f-email-err">
        ${err("email")}
      </div>
    </div>

    <details class="inq-more">
      <summary>${ICON.plus}<span>会社名・ご予算・時期も伝える</span><span class="opt">任意</span></summary>
      <div class="inq-more-body">
        <div class="field" data-field="company">
          <label class="field-label" for="f-company">会社名・団体名</label>
          <input class="field-input" id="f-company" name="company" type="text" autocomplete="organization" maxlength="${LIMITS.company}" aria-describedby="f-company-err">
          ${err("company")}
        </div>
        ${chips("budget", BUDGETS.filter((b) => b !== "未定").map((b) => [b, b]), "ご予算")}
        ${chips("schedule", SCHEDULES.filter((s) => s !== "未定").map((s) => [s, s]), "希望時期")}
      </div>
    </details>

    <div class="inq-hp" aria-hidden="true">
      <label for="f-website">Webサイト（入力しないでください）</label>
      <input id="f-website" name="website" type="text" tabindex="-1" autocomplete="off">
    </div>
    <input type="hidden" name="consent" value="on">

    <div class="inq-error" role="alert" tabindex="-1" hidden>${ICON.alert}<p><span class="inq-error-text"></span> <span class="inq-error-alt">${ext("Lancersで相談する")}</span></p></div>
    <div class="inq-send${ep ? "" : " inq-needs-js"}">
      <button class="btn btn-gold btn-lg inq-submit" type="submit"><span class="inq-submit-label">同意して送信する</span>${ICON.arrow}</button>
      <p class="inq-consent"><a href="#privacy" class="privacy-open" aria-haspopup="dialog">個人情報の取り扱い</a>をご確認のうえ、送信してください。</p>
    </div>
    <p class="inq-status sr-only" role="status" aria-live="polite"></p>
  </form>

  <div class="inq-done" hidden>
    <div class="inq-seal" aria-hidden="true">
      <svg viewBox="0 0 80 80" width="80" height="80" focusable="false"><circle class="seal-ring" cx="40" cy="40" r="36"/><path class="seal-check" d="M25 41.5l10 10L56 30"/></svg>
      <i class="glint g1"></i><i class="glint g2"></i><i class="glint g3"></i><i class="glint g4"></i><i class="glint g5"></i>
    </div>
    <h2 class="inq-done-title" tabindex="-1">ありがとうございます<span class="inq-done-name"></span>。</h2>
    <p class="inq-done-text">ご相談を受け付けました。内容を拝見して、<span class="inq-done-mail-wrap"><b class="inq-done-mail"></b> に</span>お返事します。</p>
    <p class="inq-ref">受付番号 <b class="inq-ref-no"></b></p>
    <p class="inq-done-note">お返事が見当たらないときは、迷惑メールのフォルダもご確認ください。</p>
    <p class="inq-done-actions"><a class="btn btn-ghost" href="${esc(base)}works/">実績を見る</a><a class="inq-link" href="${esc(base)}">トップへ戻る</a></p>
  </div>

</div>
<dialog class="privacy" id="privacy" aria-labelledby="privacy-title">
  <div class="privacy-body">
    ${PRIVACY_HTML}
  </div>
  <p class="privacy-actions"><button type="button" class="btn btn-ghost privacy-close">閉じる</button></p>
</dialog>`;
}
