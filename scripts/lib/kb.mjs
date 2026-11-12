// The site assistant's knowledge base: the site's own content as short passages, written to
// dist/site/assets/kb.json at build time. The chat Worker (chat/) fetches it, picks the passages
// that match a question, and gives them to Claude as citable search results. Only what the site
// shows goes in: Lancers-only packages (site: false) and anything private stay out.
import fs from "node:fs";
import path from "node:path";

const yen = (n) => `${Number(n).toLocaleString("ja-JP")}円`;

/** Split text into sentence groups of at most ~140 characters (Claude cites whole blocks). */
export function blocks(text, max = 140) {
  const sentences = String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n+|(?<=[。！？])/)
    .map((s) => s.replace(/^[・\-*\s]+/, "").trim())
    .filter(Boolean);
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      out.push(cur);
      cur = "";
    }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Every passage: { id, title, url (path on the site), blocks: [text…] }. */
export function buildKnowledge(site, { faq = [], root = process.cwd() } = {}) {
  const { profile, services, works, years } = site;
  const l = profile.lancers ?? {};
  const docs = [];
  const add = (id, title, url, text) => {
    const b = Array.isArray(text) ? text.flatMap((t) => blocks(t)) : blocks(text);
    if (b.length) docs.push({ id, title, url, blocks: b });
  };

  // Who: the about text, values, facts, the Lancers record, certifications.
  const aboutFile = path.join(root, "site", "about.md");
  if (fs.existsSync(aboutFile)) add("about", `${profile.name}について`, "about/", fs.readFileSync(aboutFile, "utf8").replaceAll("{{CAREER_YEARS}}", String(years)).replace(/[#*_>`]/g, ""));
  if ((profile.values ?? []).length) add("values", "大切にしていること", "about/", profile.values.map((v) => `${v}。`));
  const f = profile.facts ?? {};
  add("facts", "働き方と基本情報", "about/", [
    `開発歴は${years}年です（${String(f.career_start ?? "").replace("-", "年")}月から）。`,
    f.work_style && `働き方：${f.work_style}。`,
    f.nda && `秘密保持契約（NDA）：${f.nda}。`,
    f.hourly_rate && `時間単価：${f.hourly_rate}。`,
  ].filter(Boolean));
  add("record", "ランサーズでの実績（数字）", "about/", [
    `ランサーズのランクは${l.rank}です。`,
    `ランサーズでのお仕事は${l.jobs}、評価は${l.reviews}です。`,
    l.completion_rate && `完了率は${l.completion_rate}、リピートのお客さまは${l.repeat_clients}、24時間以内の返信率は${l.reply_rate_24h}です。`,
    l.external_record && `ほかに、${l.external_record}があります。`,
    (l.verified ?? []).length && `ランサーズで${l.verified.join("・")}を済ませています。`,
    `数字は${l.as_of}時点のものです。`,
  ].filter(Boolean));
  if ((profile.certifications ?? []).length) add("certifications", "保有資格", "about/", profile.certifications.map((c) => `${c.name}（${c.date}）。`));

  // What: each service (overview, worries, scope, process, FAQ, prices).
  for (const s of services) {
    const u = `services/${s.id}/`;
    add(`svc-${s.id}`, `${s.name}：概要`, u, [s.lead, s.description, ...(s.approach ?? [])]);
    if ((s.problems ?? []).length || (s.scope ?? []).length)
      add(`svc-${s.id}-scope`, `${s.name}：こんな課題に・できること`, u, [...(s.problems ?? []).map((p) => `こんな課題に：${p}。`), ...(s.scope ?? []).map((x) => `できること：${x}。`), ...(s.scopeNote ?? [])]);
    if ((s.process ?? []).length)
      add(`svc-${s.id}-flow`, `${s.name}：進め方と成果物`, u, [...s.process.map((p, i) => `${i + 1}. ${p.t}：${p.d}`), (s.deliverables ?? []).length ? `主な成果物：${s.deliverables.join("、")}。` : ""]);
    if ((s.faq ?? []).length) add(`svc-${s.id}-faq`, `${s.name}：よくある質問`, u, s.faq.map((q) => `Q. ${q.q} A. ${q.a}`));
    for (const p of s.packages ?? [])
      add(`pkg-${p.id}`, `料金：${p.title}`, `${u}#price`, [
        `${s.name}のパッケージ「${p.title}」（ランサーズ、${l.as_of}時点）。`,
        ...p.plans.map((x) => `${x.name}：${yen(x.price)}${x.days ? `・納期の目安${x.days}日` : ""}。${x.desc ?? ""}`),
      ]);
  }
  // Packages no service page covers (the price list only).
  for (const p of site.packages.filter((x) => !x.service))
    add(`pkg-${p.id}`, `料金：${p.title}`, "prices/", [`パッケージ「${p.title}」（ランサーズ、${l.as_of}時点）。`, ...p.plans.map((x) => `${x.name}：${yen(x.price)}${x.days ? `・納期の目安${x.days}日` : ""}。${x.desc ?? ""}`)]);
  add("prices", "料金と進め方", "prices/", [
    "いきなり大きな投資は必要ありません。まずは課題の見極めと検証から始め、確かめながら段階的に広げていく進め方をおすすめしています。",
    "支援は3つの段階に分かれます。相談・検証：課題の整理と打ち手の検討を通じて、取り組むべきテーマと実現性を見極めます。",
    "設計・開発：要件定義から設計・実装・検証まで。業務やシステムに合った仕組みを作ります。",
    "運用・改善：公開後の保守や不具合の調査・修正、サーバー移行など、使い続けるための支援です。",
    `料金はパッケージ（ベーシック・スタンダード・プレミアム）のほか、内容に合わせた個別のお見積もりにも対応しています。パッケージにない内容も相談できます。`,
  ]);
  if (faq.length) add("faq", "よくある質問（共通）", "prices/", faq.map((q) => `Q. ${q.q} A. ${q.a}`));

  // Proof: an overview first (for "what have you done?"), then each work.
  add("works", "実績の一覧", "works/", [
    ...works.sites.map((w) => `公開中のサイト：${w.name}（${w.made ? `${w.made}を制作` : w.kind}）。`),
    ...works.lancers.map((w) => `ランサーズの案件：${w.headline ?? w.title}（${w.industry ?? "業種非公開"}）。`),
    ...(profile.cases ?? []).map((c) => `お客さまの名前を伏せた案件：${c.title}（${c.period}）。`),
    (works.showcase ?? []).length &&
      `ほかに、制作に携わった公開中のサイトが${works.showcase.length}件あります（${works.showcaseGroups.map((g) => `${g.ja}${g.list.length}件`).join("、")}）。`,
  ].filter(Boolean));
  const show = works.showcase ?? [];
  if (show.length)
    add("live-sites", `制作に携わった公開中のサイト（${works.showcaseGroups.map((g) => g.ja).join("・")}）`, "works/#live-sites", show.map((x) => `${x.groupJa}：${x.name}（${x.url}）。`));
  // Live sites, Lancers works, confidential projects, reviews.
  for (const w of works.sites) add(`work-${w.id}`, `実績：${w.name}（公開中のサイト）`, `works/${w.id}/`, [w.summary, `担当：${w.role}`, `サイト：${w.url}`]);
  for (const w of works.lancers)
    add(`work-${w.id}`, `実績：${w.headline ?? w.title}`, `works/${w.id}/`, [
      w.title,
      w.subtitle,
      w.industry && `業種：${w.industry}。`,
      w.days && `制作期間：${w.days}日。`,
      w.price && `参考価格：${yen(w.price)}〜。`,
      String(w.body ?? "").replace(/【[^】]*】/g, ""),
    ].filter(Boolean));
  for (const c of profile.cases ?? [])
    add(`case-${c.id}`, `実績（お客さまの名前は非公開）：${c.title}`, `works/${c.id}/`, [
      `期間：${c.period}。チーム：${c.team}。担当：${c.role}。`,
      `課題：${c.challenge}`,
      `取り組み：${c.actions}`,
      `成果：${c.result}`,
      `使用技術：${c.stack.join("、")}。`,
    ]);
  for (const t of profile.testimonials ?? [])
    if (t.comment) add(`review-${t.id}`, `お客さまの評価：${t.job}`, `reviews/#${t.id}`, [`${t.date}の評価（満足）。`, t.comment]);

  // How to reach you, and how confidentiality is kept.
  add("contact", "相談・お問い合わせの方法", "contact/", (site.lancersOnly
    ? [
        site.lancersOnly,
        `ご相談は、ランサーズのメッセージからお送りください（${l.profile_url}）。仕様が決まっていない段階でも大丈夫です。出品中のパッケージからもご依頼いただけます。`,
        "このサイトのお問い合わせフォームでの受付は、現在停止しています。",
      ]
    : [
        "ご相談は、このサイトのお問い合わせフォームから送れます。仕様が決まっていない段階でも大丈夫です。",
        `ランサーズのメッセージからもご相談いただけます（${l.profile_url}）。`,
      ]
  ).concat(f.nda ? ["ご希望があれば、詳しいお話を伺う前にNDA（秘密保持契約）を結びます。"] : []));
  add("nda", "機密保持について", "works/#nda", [
    f.nda && "NDA（秘密保持契約）を結べます。ご希望があれば、詳しいお話を伺う前に結びます。",
    (l.verified ?? []).length && `ランサーズで${l.verified.join("・")}を済ませています。`,
    `このサイトでは、お客さまの名前・画面・社内の数値は載せていません（公開中のサイトとして紹介している${works.sites.length}件を除きます）。`,
  ].filter(Boolean));
  return docs;
}
