// A small CSS optimizer for the site build (no dependencies: the Site workflow installs
// without dev tools). It
//   1. drops style rules whose selectors can never match: a selector is dead when it needs
//      a class or id that appears nowhere in the built HTML or the site's scripts
//      (classes inside :not() / :is() / :where() / :has() are not counted, to stay safe), and
//   2. removes comments and the whitespace CSS doesn't need.
// Anything it doesn't understand is kept as written.

/** Split CSS into a tree: { type: "rule", sel, body } | { type: "at", head, body?: tree | string }. */
function parse(css, i = 0, nested = false) {
  const out = [];
  let buf = "";
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      buf += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "{") {
      const head = buf.trim();
      buf = "";
      if (head.startsWith("@")) {
        const name = /^@([\w-]+)/.exec(head)?.[1] ?? "";
        if (["media", "supports", "layer", "container", "document"].includes(name)) {
          const [body, next] = parse(css, i + 1, true);
          out.push({ type: "at", head, body });
          i = next;
        } else {
          const [text, next] = block(css, i + 1);
          out.push({ type: "at", head, body: text });
          i = next;
        }
      } else {
        const [text, next] = block(css, i + 1);
        out.push({ type: "rule", sel: head, body: text });
        i = next;
      }
      continue;
    }
    if (c === "}") {
      if (nested) return [out, i + 1];
      i++;
      continue;
    }
    if (c === ";" && buf.trim().startsWith("@")) {
      out.push({ type: "at", head: buf.trim() });
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return nested ? [out, i] : out;
}

/** The raw text of a declaration block (balanced braces, strings and comments respected). */
function block(css, i) {
  let depth = 1;
  let text = "";
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      text += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return [text, i + 1];
    text += c;
    i++;
  }
  return [text, i];
}

/** Split on top-level commas (not inside parentheses or strings). */
function splitList(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      cur += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** True when the selector needs a class or id that the site never uses. */
function deadSelector(sel, known) {
  // Drop functional pseudo-classes with their arguments (their classes may legitimately be absent).
  let s = sel;
  for (let k = 0; k < 10 && /:[\w-]+\([^()]*\)/.test(s); k++) s = s.replace(/:[\w-]+\([^()]*\)/g, "");
  s = s.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"|'[^']*'/g, "");
  for (const m of s.matchAll(/([.#])(-?[A-Za-z_][\w-]*)/g)) if (!known.has(m[2])) return true;
  return false;
}

/** Whitespace CSS doesn't need, outside strings. */
function squeeze(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      while (i + 1 < s.length && /\s/.test(s[i + 1])) i++;
      const prev = out.at(-1) ?? "";
      const next = s[i + 1] ?? "";
      // Spaces are kept between words and around + - * / (calc() needs them).
      if (!prev || /[{};:,>(]/.test(prev) || /[{};,>)]/.test(next)) continue;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

function declarations(body) {
  return squeeze(body).replace(/;\s*$/, "").trim();
}

function emit(tree, known, stats) {
  let out = "";
  for (const node of tree) {
    if (node.type === "rule") {
      const keep = splitList(node.sel).filter((x) => !deadSelector(x, known));
      if (!keep.length) {
        stats.dropped++;
        continue;
      }
      const body = declarations(node.body);
      if (!body) continue;
      out += `${keep.map(squeeze).join(",")}{${body}}`;
    } else if (node.body == null) {
      out += `${squeeze(node.head)};`;
    } else if (typeof node.body === "string") {
      out += `${squeeze(node.head)}{${squeeze(node.body).replace(/;\s*}/g, "}").replace(/;$/, "")}}`;
    } else {
      const inner = emit(node.body, known, stats);
      if (inner) out += `${squeeze(node.head)}{${inner}}`;
    }
  }
  return out;
}

/** Every word used in the given texts (class names, ids, strings in scripts…). */
export function usedWords(texts) {
  const known = new Set();
  for (const t of texts) for (const m of t.matchAll(/[A-Za-z_][\w-]*/g)) known.add(m[0]);
  return known;
}

/** Minify `css`, dropping rules that need a class/id not in `known`. Returns { css, dropped }. */
export function minifyCss(css, known) {
  const stats = { dropped: 0 };
  const out = emit(parse(css), known, stats);
  return { css: out, dropped: stats.dropped };
}
