// Inquiry form on /contact/: validation, the confirm step, sending, and honest results.
// Markup: scripts/lib/contact-form.mjs. Endpoint: contact/ (form[data-endpoint]).
// Success is shown only after the endpoint answers {ok:true, ref}.
(function () {
  "use strict";
  var form = document.getElementById("inquiry");
  if (!form) return;

  var endpoint = (form.dataset.endpoint || "").trim();
  var lancers = form.dataset.lancers || "";
  var LIM = { name: 80, company: 120, email: 254, messageMin: 10, message: 4000 };
  var EMAIL = /^[^\s@<>()[\]\\,;:"']{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  var LABEL = { name: "お名前", company: "会社名・団体名", email: "返信先メールアドレス", category: "相談したいこと", budget: "ご予算", schedule: "希望時期", message: "ご相談内容", consent: "個人情報の取り扱い", context: "ご相談の対象" };
  var MSG = {
    name: { required: "お名前を入力してください。", too_long: "80文字以内で入力してください。" },
    company: { too_long: "120文字以内で入力してください。" },
    email: { required: "返信先のメールアドレスを入力してください。", invalid: "メールアドレスの形式が正しくありません。", too_long: "254文字以内で入力してください。" },
    category: { required: "相談したいことを1つ選んでください。", invalid: "相談したいことを選び直してください。" },
    budget: { invalid: "ご予算を選び直してください。" },
    schedule: { invalid: "希望時期を選び直してください。" },
    message: { required: "ご相談内容を入力してください。", too_short: "10文字以上で入力してください。", too_long: "4000文字以内で入力してください。" },
    consent: { required: "送信するには、個人情報の取り扱いへの同意が必要です。" },
  };
  var ORDER = ["name", "company", "email", "category", "budget", "schedule", "message", "consent"];

  var q = function (s, r) {
    return (r || form).querySelector(s);
  };
  var panels = { input: q('[data-step="input"]'), confirm: q('[data-step="confirm"]'), done: q('[data-step="done"]') };
  var stepItems = form.querySelectorAll(".inq-steps li");
  var summary = q(".inq-summary");
  var errBox = q(".inq-error");
  var errText = q(".inq-error-text");
  var errAlt = q(".inq-error-alt");
  var nextBtn = q(".inq-next");
  var sendBtn = q('[data-action="send"]');
  var editBtn = q('[data-action="edit"]');
  var ctxInput = form.elements.context;
  var ctxBox = q(".inq-context");
  var touched = {};
  var sending = false;
  var idem = "";
  var sendLabel = sendBtn.textContent;

  nextBtn.textContent = "入力内容を確認する";
  form.classList.add("is-enhanced");

  // ---- values and validation (mirrors contact/src/core.mjs) ----
  var len = function (s) {
    return Array.from(s).length;
  };
  function values() {
    var e = form.elements;
    var cat = form.querySelector('input[name="category"]:checked');
    return {
      name: e.name.value.trim(),
      company: e.company.value.trim(),
      email: e.email.value.trim(),
      category: cat ? cat.value : "",
      budget: e.budget.value,
      schedule: e.schedule.value,
      message: e.message.value.replace(/\r\n?/g, "\n").trim(),
      consent: e.consent.checked,
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
      case "category":
        return v.category ? "" : "required";
      case "message":
        return !v.message ? "required" : len(v.message) < LIM.messageMin ? "too_short" : len(v.message) > LIM.message ? "too_long" : "";
      case "consent":
        return v.consent ? "" : "required";
      default:
        return "";
    }
  }
  function control(name) {
    return name === "category" ? form.querySelector('input[name="category"]') : form.elements[name];
  }
  function showError(name, code) {
    var box = q('[data-field="' + name + '"]');
    if (!box) return;
    var err = q("#f-" + name + "-err");
    var text = code ? (MSG[name] && MSG[name][code]) || "入力内容を確認してください。" : "";
    box.classList.toggle("has-error", !!code);
    if (err) {
      err.textContent = text;
      err.hidden = !code;
    }
    var inputs = name === "category" ? form.querySelectorAll('input[name="category"]') : [form.elements[name]];
    Array.prototype.forEach.call(inputs, function (el) {
      if (!el) return;
      if (code) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    });
  }
  function validateAll() {
    var v = values();
    var errors = [];
    ORDER.forEach(function (name) {
      var code = check(name, v);
      showError(name, code);
      if (code) errors.push([name, code]);
    });
    return errors;
  }
  function showSummary(errors) {
    var ul = q("ul", summary);
    ul.textContent = "";
    errors.forEach(function (e) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + (e[0] === "category" ? "f-category-err" : "f-" + e[0]);
      a.textContent = LABEL[e[0]] + "：" + ((MSG[e[0]] && MSG[e[0]][e[1]]) || "入力内容を確認してください。");
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var el = control(e[0]);
        if (el) el.focus();
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
    summary.hidden = false;
    summary.focus();
  }

  // Validate as people go: after a field is left once, re-check it on every change.
  ORDER.forEach(function (name) {
    var els = name === "category" ? form.querySelectorAll('input[name="category"]') : [form.elements[name]];
    Array.prototype.forEach.call(els, function (el) {
      if (!el) return;
      el.addEventListener("blur", function () {
        if (name === "category") return;
        touched[name] = true;
        showError(name, check(name, values()));
      });
      el.addEventListener(el.type === "checkbox" || el.type === "radio" || el.tagName === "SELECT" ? "change" : "input", function () {
        idem = ""; // content changed: a new attempt
        if (touched[name] || el.getAttribute("aria-invalid") === "true") showError(name, check(name, values()));
        if (!summary.hidden && !validateQuiet()) summary.hidden = true;
      });
    });
  });
  function validateQuiet() {
    var v = values();
    return ORDER.some(function (n) {
      return check(n, v);
    });
  }

  // Message counter.
  var msg = form.elements.message;
  var countN = q(".field-count-n");
  function count() {
    var n = len(msg.value);
    countN.textContent = String(n);
    countN.parentNode.classList.toggle("is-over", n > LIM.message);
  }
  msg.addEventListener("input", count);
  count();

  // ---- the subject of the inquiry (?service=<id> or ?work=<id>) ----
  var topics = {};
  try {
    topics = JSON.parse(q(".inq-topics").textContent) || {};
  } catch (e) {
    topics = {};
  }
  (function () {
    var params = new URLSearchParams(location.search);
    var kind = params.get("service") ? "service" : params.get("work") ? "work" : "";
    var t = kind && topics[kind] && topics[kind][params.get(kind)];
    if (!t) return;
    ctxInput.value = (kind === "service" ? "サービス：" : "実績：") + t.name;
    q(".inq-context-name").textContent = t.name;
    ctxBox.hidden = false;
    var radio = form.querySelector('input[name="category"][value="' + t.cat + '"]');
    if (radio && !form.querySelector('input[name="category"]:checked')) radio.checked = true;
  })();
  q(".inq-context-x").addEventListener("click", function () {
    ctxInput.value = "";
    ctxBox.hidden = true;
    idem = "";
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
    form.elements.name.focus();
  });

  // ---- steps ----
  function go(step) {
    Object.keys(panels).forEach(function (k) {
      panels[k].hidden = k !== step;
    });
    var at = { input: 0, confirm: 1, done: 2 }[step];
    Array.prototype.forEach.call(stepItems, function (li, i) {
      li.classList.toggle("is-current", i === at);
      li.classList.toggle("is-past", i < at);
      if (i === at) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    form.dataset.state = step;
  }
  function review() {
    var v = values();
    var catLabel = "";
    var cat = form.querySelector('input[name="category"]:checked');
    if (cat) catLabel = cat.parentNode.querySelector("b").textContent;
    var rows = [
      ["name", v.name],
      ["company", v.company || "（未入力）"],
      ["email", v.email],
      ["category", catLabel],
      ["budget", v.budget || "（未選択）"],
      ["schedule", v.schedule || "（未選択）"],
    ];
    if (v.context) rows.push(["context", v.context]);
    rows.push(["message", v.message]);
    var dl = q(".inq-review");
    dl.textContent = "";
    rows.forEach(function (r) {
      var div = document.createElement("div");
      var dt = document.createElement("dt");
      var dd = document.createElement("dd");
      dt.textContent = LABEL[r[0]];
      dd.textContent = r[1];
      if (r[0] === "message") dd.className = "is-long";
      div.appendChild(dt);
      div.appendChild(dd);
      dl.appendChild(div);
    });
  }
  function scrollToForm() {
    var top = form.getBoundingClientRect().top + window.scrollY - 96;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (form.dataset.state && form.dataset.state !== "input") return;
    form.dataset.state = "validating";
    var errors = validateAll();
    ORDER.forEach(function (n) {
      touched[n] = true;
    });
    if (errors.length) {
      form.dataset.state = "input";
      showSummary(errors);
      return;
    }
    summary.hidden = true;
    errBox.hidden = true;
    sendBtn.textContent = sendLabel;
    review();
    go("confirm");
    scrollToForm();
    q(".inq-h", panels.confirm).focus();
  });

  editBtn.addEventListener("click", function () {
    if (sending) return;
    errBox.hidden = true;
    go("input");
    scrollToForm();
    form.elements.name.focus();
  });

  // ---- sending ----
  function fail(text, withLancers) {
    errText.textContent = text;
    errAlt.hidden = !withLancers || !lancers;
    errBox.hidden = false;
    sendBtn.textContent = "もう一度送信する";
    errBox.focus();
  }
  function busy(on) {
    sending = on;
    form.setAttribute("aria-busy", on ? "true" : "false");
    sendBtn.setAttribute("aria-busy", on ? "true" : "false");
    sendBtn.disabled = on;
    editBtn.disabled = on;
    if (on) sendBtn.textContent = "送信しています…";
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) {
      return ("0" + x.toString(16)).slice(-2);
    }).join("");
  }

  sendBtn.addEventListener("click", function () {
    if (sending) return;
    errBox.hidden = true;
    if (!endpoint) {
      fail("申し訳ありません。フォームの送信先がまだ設定されていないため、ここからは送信できません。お手数ですが、Lancersからご相談ください。", true);
      sendBtn.textContent = sendLabel;
      return;
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
        if (r.res.ok && r.body.ok === true && r.body.ref) return succeed(r.body.ref);
        if (r.res.status === 429) return fail("短い時間に送信が続いたため、受け付けを一時的に止めています。10分ほど待ってから、もう一度お試しください。", false);
        if (r.res.status === 409) return fail("前回の送信を処理しています。少し待ってから、もう一度お試しください。", false);
        if (r.res.status === 400 && r.body.fields) {
          var errors = Object.keys(r.body.fields).map(function (k) {
            showError(k, r.body.fields[k]);
            return [k, r.body.fields[k]];
          });
          go("input");
          sendBtn.textContent = sendLabel;
          return showSummary(errors);
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

  function succeed(ref) {
    q(".inq-ref-no").textContent = ref;
    go("done");
    sendBtn.textContent = sendLabel;
    var check = q(".inq-check");
    if (check) {
      check.classList.remove("is-drawn");
      void check.getBoundingClientRect();
      check.classList.add("is-drawn");
    }
    scrollToForm();
    q(".inq-h", panels.done).focus();
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

  go("input");
})();
