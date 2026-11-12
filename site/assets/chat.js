// The site assistant's window. Loaded only when someone opens it (app.js: [data-ask]).
// It sends the conversation to the chat Worker (chat/) and shows the answer as it is written,
// then the passages of this site it was based on. Answers are inserted as text, never as HTML.
const SUGGEST = ["どんなサービスがありますか？", "RAGチャットボットの料金は？", "NDAは結べますか？", "どんな実績がありますか？"];
const SITE = "https://shanaiai.com/";
let dlg = null;
let log;
let form;
let input;
let send;
let endpoint = "";
let busy = false;
const history = [];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
// Only links to this site's own pages are shown.
const safeUrl = (u) => (typeof u === "string" && u.startsWith(SITE) ? u : null);

function build() {
  dlg = el("dialog", "ask");
  dlg.setAttribute("aria-labelledby", "ask-title");
  dlg.innerHTML = `<div class="ask-head">
      <p class="ask-eyebrow" lang="en">Ask TAKUMI</p>
      <h2 class="ask-title" id="ask-title">このサイトについて、AIに質問</h2>
      <button class="ask-x" type="button"><span class="sr-only">閉じる</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="ask-log" role="log" aria-live="polite"></div>
    <form class="ask-form">
      <label class="sr-only" for="ask-in">質問</label>
      <textarea id="ask-in" rows="1" maxlength="400" placeholder="例：RAGチャットボットの料金は？" autocomplete="off"></textarea>
      <button class="ask-send" type="submit"><span class="sr-only">送信</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button>
    </form>
    <p class="ask-note">AI（Anthropic社のClaude）が、このサイトの内容だけをもとに答えます。間違えることがあるため、正式なお見積もりはお問い合わせください。個人情報や機密情報は入力しないでください。入力内容はAnthropic社に送られ、このサイトでは保存しません。</p>`;
  document.body.append(dlg);
  log = dlg.querySelector(".ask-log");
  form = dlg.querySelector(".ask-form");
  input = dlg.querySelector("#ask-in");
  send = dlg.querySelector(".ask-send");

  const hello = el("div", "ask-msg ask-bot");
  hello.append(el("p", null, "こんにちは。サービス・料金・実績・進め方など、このサイトに書いてあることをもとにお答えします。"));
  const chips = el("ul", "ask-sugg");
  for (const q of SUGGEST) {
    const li = el("li");
    const b = el("button", null, q);
    b.type = "button";
    b.addEventListener("click", () => ask(q));
    li.append(b);
    chips.append(li);
  }
  hello.append(chips);
  log.append(hello);

  dlg.querySelector(".ask-x").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close(); // a click on the backdrop
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
}

const scrollDown = () => {
  log.scrollTop = log.scrollHeight;
};

function addMsg(who, text) {
  // Class names written out in full: the build keeps only CSS whose class names appear in the scripts.
  const m = el("div", who === "user" ? "ask-msg ask-user" : "ask-msg ask-bot");
  if (text) m.append(el("p", null, text));
  log.append(m);
  scrollDown();
  return m;
}

/** The final answer: text with numbered citations, then the sources. */
function render(bubble, data) {
  bubble.textContent = "";
  const p = el("p");
  for (const b of data.blocks ?? []) {
    p.append(document.createTextNode(b.text));
    for (const n of b.cites ?? []) {
      const s = (data.sources ?? []).find((x) => x.n === n);
      const url = s && safeUrl(s.url);
      if (!url) continue;
      const sup = el("sup", "ask-cite");
      const a = el("a", null, `[${n}]`);
      a.href = url;
      a.setAttribute("aria-label", `出典${n}：${s.title}`);
      sup.append(a);
      p.append(sup);
    }
  }
  bubble.append(p);
  const srcs = (data.sources ?? []).filter((s) => safeUrl(s.url));
  if (srcs.length) {
    const box = el("div", "ask-src");
    box.append(el("p", "ask-src-h", "出典（このサイトのページ）"));
    const ol = el("ol");
    for (const s of srcs) {
      const li = el("li");
      li.value = s.n;
      const a = el("a", null, s.title);
      a.href = safeUrl(s.url);
      li.append(a);
      ol.append(li);
    }
    box.append(ol);
    bubble.append(box);
  }
  return (data.blocks ?? []).map((b) => b.text).join("");
}

async function ask(raw) {
  const q = String(raw ?? "").trim();
  if (!q || busy) return;
  busy = true;
  send.disabled = true;
  input.value = "";
  input.style.height = "auto";
  addMsg("user", q);
  history.push({ role: "user", content: q });
  const bubble = addMsg("bot", "");
  bubble.classList.add("is-typing");
  log.setAttribute("aria-busy", "true");
  const p = el("p");
  bubble.append(p);
  let text = "";
  let answered = false;
  const fail = (msg) => {
    bubble.classList.add("is-error");
    bubble.textContent = "";
    bubble.append(el("p", null, msg));
    history.pop(); // the question goes unanswered: don't send it as history
  };
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history.slice(-10) }) });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "うまく接続できませんでした。");
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(raw)?.[1];
        const data = JSON.parse(/^data: (.+)$/m.exec(raw)?.[1] ?? "{}");
        if (event === "delta") {
          text += data.t ?? "";
          p.textContent = text;
          scrollDown();
        } else if (event === "done") {
          const final = render(bubble, data);
          history.push({ role: "assistant", content: final });
          answered = true;
        } else if (event === "error") {
          fail(data.message || "うまくお答えできませんでした。");
          answered = true;
        }
      }
    }
    if (!answered) fail("回答が途中で止まりました。もう一度お試しください。");
  } catch (err) {
    fail(err.message || "うまく接続できませんでした。");
  } finally {
    bubble.classList.remove("is-typing");
    log.removeAttribute("aria-busy");
    busy = false;
    send.disabled = false;
    scrollDown();
    input.focus();
  }
}

/** Open the window (and ask `question` right away when given). */
export function open(ep, question = "") {
  endpoint = ep;
  if (!dlg) build();
  if (!dlg.open) dlg.showModal();
  if (question) ask(question);
  else input.focus();
}
