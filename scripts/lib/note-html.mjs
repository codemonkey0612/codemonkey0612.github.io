// Markdown → the HTML note's editor stores for a post.
//
// note's editor keys every top-level block by an id it keeps in both `name` and `id`, has two
// heading levels (h2 大見出し, h3 小見出し), shows images as <figure> blocks, and has no tables,
// inline code or italics. These rules match the open-source note clients this pipeline was
// checked against (goodnasubi/note-mcp, tuuu428/Note-CLI); both were updated in 2026.
import { randomUUID } from "node:crypto";
import { marked } from "marked";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const isRemote = (href) => /^(https?:|data:)/i.test(href);
const stripComments = (md) => md.replace(/<!--[\s\S]*?-->/g, "");

/** Local image paths in the post (in order, no repeats): these get uploaded to note first. */
export function localImages(markdown) {
  const found = [];
  marked.walkTokens(marked.lexer(stripComments(markdown), { gfm: true }), (t) => {
    if (t.type === "image" && !isRemote(t.href) && !found.includes(t.href)) found.push(t.href);
  });
  return found;
}

/**
 * Converts a post body. `imageUrls` maps each local image path to its uploaded note URL.
 * Returns the HTML, its length in characters (note's `body_length`) and warnings for
 * anything note can't show.
 */
export function markdownToNote(markdown, { imageUrls = new Map(), newId = randomUUID } = {}) {
  const ctx = { imageUrls, newId, warnings: [] };
  const html = blocks(marked.lexer(stripComments(markdown).trim(), { gfm: true }), ctx);
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[e]);
  return { html, textLength: [...text].length, warnings: [...new Set(ctx.warnings)] };
}

const open = (tag, ctx, attrs = "") => {
  const id = ctx.newId();
  return `<${tag} name="${id}" id="${id}"${attrs}>`;
};

const blocks = (tokens, ctx) => tokens.map((t) => block(t, ctx)).join("");

function block(t, ctx) {
  switch (t.type) {
    case "space":
    case "def":
      return "";
    case "heading": {
      if (t.depth > 3) {
        ctx.warnings.push("h4–h6 headings became bold lines (note has two heading levels)");
        return `${open("p", ctx)}<strong>${inline(t.tokens, ctx)}</strong></p>`;
      }
      const tag = t.depth <= 2 ? "h2" : "h3";
      return `${open(tag, ctx)}${inline(t.tokens, ctx)}</${tag}>`;
    }
    case "paragraph":
      return paragraph(t.tokens, ctx);
    case "text":
      return paragraph(t.tokens ?? [t], ctx);
    case "list":
      return list(t, ctx);
    case "blockquote":
      return `${open("blockquote", ctx)}${blocks(t.tokens, ctx)}</blockquote>`;
    case "code":
      return `${open("pre", ctx)}<code>${esc(t.text)}</code></pre>`;
    case "hr":
      return "<hr>";
    case "table": {
      ctx.warnings.push("tables became one bullet per row (note can't show tables)");
      const head = t.header.map((h) => inline(h.tokens, ctx));
      const rows = t.rows.map((row) => `${open("li", ctx)}${row.map((c, i) => (head[i] ? `${head[i]}: ` : "") + inline(c.tokens, ctx)).join(" / ")}</li>`);
      return `${open("ul", ctx)}${rows.join("")}</ul>`;
    }
    case "html":
      ctx.warnings.push("raw HTML was removed (note doesn't accept it)");
      return "";
    default:
      ctx.warnings.push(`removed a Markdown element note can't show: ${t.type}`);
      return "";
  }
}

// Images are blocks in note, so a paragraph splits around each one.
function paragraph(tokens, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    const html = inline(run, ctx).replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, "");
    if (html) out.push(`${open("p", ctx)}${html}</p>`);
    run = [];
  };
  for (const t of tokens) {
    if (t.type === "image") {
      flush();
      out.push(figure(t, ctx));
    } else run.push(t);
  }
  flush();
  return out.join("");
}

function figure(img, ctx) {
  const url = ctx.imageUrls.get(img.href) ?? (isRemote(img.href) ? null : img.href);
  if (!url) {
    ctx.warnings.push(`images from other sites aren't uploaded, so this one became a link: ${img.href}`);
    return `${open("p", ctx)}<a href="${esc(img.href)}">${esc(img.text || img.href)}</a></p>`;
  }
  const id = ctx.newId();
  return `<figure name="${id}" id="${id}"><img src="${esc(url)}" alt="" width="620" height="auto"><figcaption>${esc(img.text)}</figcaption></figure>`;
}

function list(t, ctx) {
  const tag = t.ordered ? "ol" : "ul";
  const start = t.ordered && typeof t.start === "number" && t.start !== 1 ? ` start="${t.start}"` : "";
  const items = t.items.map((item) => {
    const text = [];
    const nested = [];
    for (const c of item.tokens) {
      if (c.type === "text" || c.type === "paragraph") text.push(inline(c.tokens ?? [c], ctx));
      else if (c.type === "list") nested.push(list(c, ctx));
      else if (c.type !== "space" && c.type !== "checkbox") nested.push(block(c, ctx));
    }
    const box = item.task ? (item.checked ? "☑ " : "☐ ") : "";
    return `${open("li", ctx)}${box}${text.join("<br>")}${nested.join("")}</li>`;
  });
  return `${open(tag, ctx, start)}${items.join("")}</${tag}>`;
}

const inline = (tokens = [], ctx) => tokens.map((t) => inlineToken(t, ctx)).join("");

function inlineToken(t, ctx) {
  switch (t.type) {
    case "text":
      return t.tokens?.length ? inline(t.tokens, ctx) : esc(t.text);
    case "escape":
    case "codespan":
      return esc(t.text);
    case "strong":
      return `<strong>${inline(t.tokens, ctx)}</strong>`;
    case "em":
    case "del":
      return inline(t.tokens, ctx);
    case "br":
      return "<br>";
    case "link":
      if (!/^(https?:|mailto:)/i.test(t.href)) {
        ctx.warnings.push(`kept only the text of a link that isn't http/https/mailto: ${t.href}`);
        return inline(t.tokens, ctx);
      }
      return `<a href="${esc(t.href)}">${inline(t.tokens, ctx)}</a>`;
    case "image":
      ctx.warnings.push(`an image inside a heading or list became its alt text: ${t.href}`);
      return esc(t.text);
    case "html":
      if (/^<br\s*\/?>$/i.test(t.text)) return "<br>";
      ctx.warnings.push("raw HTML was removed (note doesn't accept it)");
      return "";
    default:
      return esc(t.raw ?? "");
  }
}
