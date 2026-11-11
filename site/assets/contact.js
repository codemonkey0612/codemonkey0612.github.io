// Inquiry form on /contact/: gentle validation, one-step sending, an honest result.
// Markup: scripts/lib/contact-form.mjs. Endpoint: contact/ (form[data-endpoint]).
// Success is shown only after the endpoint answers {ok:true, ref}.
(function () {
  "use strict";
  var form = document.getElementById("inquiry");
  if (!form) return;
  var card = form.closest(".inq-card");
  var endpoint = (form.dataset.endpoint || "").trim();
  var lancers = form.dataset.lancers || "";
  var LIM = { name: 80, company: 120, email: 254, messageMin: 10, message: 4000 };
  var EMAIL = /^[^\s@<>()[\]\\,;:"']{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  var MSG = {
    name: { required: "お名前を教えてください。", too_long: "80文字以内でお願いします。" },
    company: { too_long: "120文字以内でお願いします。" },
    email: { required: "お返事先のメールアドレスを教えてください。", invalid: "メールアドレスの形をご確認ください。", too_long: "254文字以内でお願いします。" },
    category: { invalid: "ご相談の種類を選び直してください。" },
    budget: { invalid: "ご予算を選び直してください。" },
    schedule: { invalid: "希望時期を選び直してください。" },
    message: { required: "ご相談内容をひとことお書きください。", too_short: "もう少しだけ詳しく（10文字以上）お書きください。", too_long: "4000文字以内でお願いします。" },
  };
  var ORDER = ["category", "message", "name", "email", "company"];
  // The site sets html.motion when movement is welcome (its toggle and prefers-reduced-motion).
  var reduce = !document.documentElement.classList.contains("motion");

  var q = function (s, r) {
    return (r || card).querySelector(s);
  };
  var done = q(".inq-done");
  var submit = q(".inq-submit");
  var submitLabel = q(".inq-submit-label");
  var errBox = q(".inq-error");
  var errText = q(".inq-error-text");
  var errAlt = q(".inq-error-alt");
  var status = q(".inq-status");
  var msg = form.elements.message;
  var count = q(".field-count");
  var ctxInput = form.elements.context;
  var ctxBox = q(".inq-context");
  var touched = {};
  var sending = false;
  var idem = "";
  var LABEL = submitLabel.textContent;

  form.classList.add("is-enhanced");

  var len = function (s) {
    return Array.from(s).length;
  };
  var picked = function (name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : "";
  };
  function values() {
    var e = form.elements;
    return {
      name: e.name.value.trim(),
      company: e.company.value.trim(),
      email: e.email.value.trim(),
      category: picked("category"),
      budget: picked("budget"),
      schedule: picked("schedule"),
      message: msg.value.replace(/\r\n?/g, "\n").trim(),
      consent: true, // the button says "同意して送信する"
      context: ctxInput.value,
      website: e.website.value,
    };
  }
  function check(name, v) {
    switch (name) {
      case "name":
        return !v.name ? "required" : len(v.name) > LIM.name ? "too_long" : "";
      case "company":
        return len(v.company) > LIM.company ? "too_long" : "";
      case "email":
        return !v.email ? "required" : v.email.length > LIM.email ? "too_long" : EMAIL.test(v.email) ? "" : "invalid";
      case "message":
        return !v.message ? "required" : len(v.message) < LIM.messageMin ? "too_short" : len(v.message) > LIM.message ? "too_long" : "";
      default:
        return "";
    }
  }
  function show(name, code) {
    var box = q('[data-field="' + name + '"]');
    if (!box) return;
    var err = q("#f-" + name + "-err");
    box.classList.toggle("has-error", !!code);
    var el = form.elements[name];
    var filled = el && el.value && String(el.value).trim() !== "";
    box.classList.toggle("is-valid", !code && !!filled && !!touched[name] && el.type !== "radio" && !(el instanceof RadioNodeList));
    if (err) {
      err.textContent = code ? (MSG[name] && MSG[name][code]) || "入力内容をご確認ください。" : "";
      err.hidden = !code;
    }
    if (el && el.setAttribute) {
      if (code) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    }
  }
  function validateAll() {
    var v = values();
    var bad = [];
    ORDER.forEach(function (n) {
      touched[n] = true;
      var code = check(n, v);
      show(n, code);
      if (code) bad.push(n);
    });
    return bad;
  }

  // Check a field once it's been left with something in it, then on every change.
  ["name", "email", "message", "company"].forEach(function (name) {
    var el = form.elements[name];
    el.addEventListener("blur", function () {
      if (el.value.trim() === "" && !touched[name]) return; // passing through isn't an error
      touched[name] = true;
      show(name, check(name, values()));
    });
    el.addEventListener("input", function () {
      idem = ""; // content changed: a new attempt
      if (touched[name]) show(name, check(name, values()));
      if (!errBox.hidden && !sending) errBox.hidden = true;
    });
  });

  // ---- chips: one tap to choose, a second tap on the same chip to clear ----
  Array.prototype.forEach.call(card.querySelectorAll(".chip input"), function (input) {
    var was = false;
    input.parentNode.addEventListener("pointerdown", function () {
      was = input.checked;
    });
    input.addEventListener("click", function () {
      if (was) {
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      was = false;
    });
    input.addEventListener("change", function () {
      idem = "";
      if (input.name === "category") hint();
    });
  });

  // ---- the message: a hint that follows the chosen kind, growth, a counter near the end ----
  var topics = {};
  try {
    topics = JSON.parse(q(".inq-topics").textContent) || {};
  } catch (e) {
    topics = {};
  }
  var hints = topics.hints || {};
  function hint() {
    var text = hints[picked("category")] || hints[""] || "";
    if (msg.placeholder === text) return;
    if (reduce || msg.value) return void (msg.placeholder = text);
    msg.classList.add("is-hinting");
    setTimeout(function () {
      msg.placeholder = text;
      msg.classList.remove("is-hinting");
    }, 160);
  }
  var autoSize = !(window.CSS && CSS.supports && CSS.supports("field-sizing", "content"));
  function grow() {
    if (!autoSize) return;
    msg.style.height = "auto";
    msg.style.height = Math.min(msg.scrollHeight + 2, 520) + "px";
  }
  function counter() {
    var n = len(msg.value);
    var left = LIM.message - n;
    count.hidden = left > 400;
    count.textContent = left >= 0 ? "あと " + left + " 文字" : left * -1 + " 文字多いようです";
    count.classList.toggle("is-over", left < 0);
  }
  msg.addEventListener("input", function () {
    grow();
    counter();
  });

  // ---- what the inquiry is about (?service=<id>, ?work=<id> or ?topic=estimate) ----
  (function () {
    var params = new URLSearchParams(location.search);
    var kind = params.get("service") ? "service" : params.get("work") ? "work" : "";
    var t = kind && topics[kind] && topics[kind][params.get(kind)];
    var name = t ? t.name : params.get("topic") === "estimate" ? "お見積もりのご依頼" : "";
    if (!name) return;
    ctxInput.value = t ? (kind === "service" ? "サービス：" : "実績：") + t.name : name;
    q(".inq-context-name").textContent = name;
    ctxBox.hidden = false;
    var chip = t && form.querySelector('input[name="category"][value="' + t.cat + '"]');
    if (chip) chip.checked = true;
    hint();
  })();
  q(".inq-context-x").addEventListener("click", function () {
    ctxInput.value = "";
    ctxBox.hidden = true;
    idem = "";
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
    msg.focus();
  });

  // ---- sending ----
  function fail(text, withLancers) {
    errText.textContent = text;
    errAlt.hidden = !withLancers || !lancers;
    errBox.hidden = false;
    submitLabel.textContent = "もう一度送信する";
    errBox.focus();
  }
  function busy(on) {
    sending = on;
    card.dataset.state = on ? "sending" : "input";
    form.setAttribute("aria-busy", on ? "true" : "false");
    submit.disabled = on;
    if (on) submitLabel.textContent = "送信しています…";
    status.textContent = on ? "送信しています。" : "";
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.prototype.map
      .call(b, function (x) {
        return ("0" + x.toString(16)).slice(-2);
      })
      .join("");
  }
  function nudge(el) {
    if (reduce || !el) return;
    el.classList.remove("is-nudged");
    void el.offsetWidth;
    el.classList.add("is-nudged");
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (sending) return;
    errBox.hidden = true;
    var bad = validateAll();
    if (bad.length) {
      status.textContent = "入力内容をご確認ください（" + bad.length + "か所）。";
      var first = form.elements[bad[0]];
      if (first && first.focus) first.focus();
      bad.forEach(function (n) {
        nudge(q('[data-field="' + n + '"]'));
      });
      return;
    }
    if (!endpoint) {
      return fail("申し訳ありません。いまはここから送信できません。お手数ですが、Lancersからご相談ください。", true);
    }
    if (!idem) idem = uuid(); // kept for retries of the same content
    var v = values();
    var payload = JSON.stringify({
      name: v.name,
      company: v.company,
      email: v.email,
      category: v.category,
      budget: v.budget,
      schedule: v.schedule,
      message: v.message,
      consent: v.consent,
      context: v.context,
      website: v.website,
      idempotency: idem,
    });
    busy(true);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 20000);
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, credentials: "omit", mode: "cors", signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { res: res, body: body || {} };
          });
      })
      .then(function (r) {
        clearTimeout(timer);
        busy(false);
        if (r.res.ok && r.body.ok === true && r.body.ref) return succeed(r.body.ref, v);
        if (r.res.status === 429) return fail("短い時間に送信が続いたため、受け付けを少し止めています。10分ほどしてから、もう一度お試しください。", false);
        if (r.res.status === 409) return fail("前回の送信を処理しています。少し待ってから、もう一度お試しください。", false);
        if (r.res.status === 400 && r.body.fields) {
          var keys = Object.keys(r.body.fields);
          keys.forEach(function (k) {
            touched[k] = true;
            show(k, r.body.fields[k]);
          });
          submitLabel.textContent = LABEL;
          var first = form.elements[keys[0]];
          if (first && first.focus) first.focus();
          return;
        }
        fail("送信できませんでした。時間をおいてもう一度お試しいただくか、Lancersからご相談ください。", true);
      })
      .catch(function (err) {
        clearTimeout(timer);
        busy(false);
        var timedOut = err && err.name === "AbortError";
        fail(
          timedOut
            ? "送信に時間がかかり、受け付けを確認できませんでした。時間をおいてもう一度お試しいただくか、Lancersからご相談ください。"
            : "通信できませんでした。インターネットの接続を確かめて、もう一度お試しいただくか、Lancersからご相談ください。",
          true,
        );
      });
  });

  function succeed(ref, v) {
    // "ありがとうございます、山田 太郎様。": the comma stays with the greeting, the name stays whole.
    var who = q(".inq-done-name");
    who.textContent = "";
    if (v.name) {
      who.appendChild(document.createTextNode("、"));
      var nm = document.createElement("span");
      nm.className = "nw";
      nm.textContent = v.name + "様";
      who.appendChild(nm);
    }
    q(".inq-done-mail").textContent = v.email;
    q(".inq-ref-no").textContent = ref;
    submitLabel.textContent = LABEL;
    var swap = function () {
      form.hidden = true;
      done.hidden = false;
      card.dataset.state = "done";
      var top = card.getBoundingClientRect().top;
      if (top < 0) window.scrollTo({ top: top + window.scrollY - 96, behavior: reduce ? "auto" : "smooth" });
      q(".inq-done-title").focus({ preventScroll: true });
    };
    if (reduce) return swap();
    card.dataset.state = "leaving";
    setTimeout(swap, 320);
  }

  // ---- privacy panel ----
  var dialog = document.getElementById("privacy");
  if (dialog && typeof dialog.showModal === "function") {
    var opener = null;
    document.querySelectorAll(".privacy-open").forEach(function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        opener = a;
        dialog.showModal();
        dialog.querySelector(".privacy-close").focus();
      });
    });
    dialog.querySelector(".privacy-close").addEventListener("click", function () {
      dialog.close();
    });
    dialog.addEventListener("click", function (ev) {
      if (ev.target === dialog) dialog.close(); // a click on the backdrop
    });
    dialog.addEventListener("close", function () {
      if (opener) opener.focus();
    });
  }
})();
