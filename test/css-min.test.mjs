import assert from "node:assert/strict";
import { test } from "node:test";
import { minifyCss, usedWords } from "../scripts/lib/css-min.mjs";

const known = usedWords(['<div class="card is-in"><a id="price" class="btn">x</a></div>', 'el.classList.add("motion")']);

test("rules for classes the site uses stay; rules for missing classes go", () => {
  const { css, dropped } = minifyCss(".card { color: red; }\n.gone { color: blue; }\n.card .gone, .btn:hover { color: green; }", known);
  assert.equal(css, ".card{color:red}.btn:hover{color:green}");
  assert.equal(dropped, 1);
});

test("classes inside :not(), :is() and :has() never make a rule dead", () => {
  const { css } = minifyCss(".card:not(.gone) { a: b; } :is(.gone, .card) { c: d; } .card:has(.gone) { e: f; }", known);
  assert.match(css, /\.card:not\(\.gone\)\{a:b\}/);
  assert.match(css, /:is\(\.gone,\.card\)\{c:d\}/);
  assert.match(css, /\.card:has\(\.gone\)\{e:f\}/);
});

test("strings, calc() spacing, media queries, keyframes and descendant pseudo-classes survive", () => {
  const src = `/* c */ .card::before { content: "a  b ; } c"; width: calc(100% - 2 * var(--g)); }
@media (min-width: 1024px) and (max-width: 1279px) { .card { top: 0; } .gone { top: 1px; } }
@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }
.motion .card :is(.btn) { x: y; }
.card { background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E") 0 0 / 100% no-repeat; }`;
  const { css } = minifyCss(src, known);
  assert.match(css, /content:"a  b ; } c"/);
  assert.match(css, /calc\(100% - 2 \* var\(--g\)\)/);
  assert.match(css, /@media \(min-width:1024px\) and \(max-width:1279px\)\{\.card\{top:0\}\}/);
  assert.match(css, /@keyframes spin\{from\{rotate:0deg\}to\{rotate:360deg\}\}/);
  assert.match(css, /\.motion \.card :is\(\.btn\)\{x:y\}/);
  assert.match(css, /url\("data:image\/svg\+xml,%3Csvg xmlns='http:\/\/www\.w3\.org\/2000\/svg'%3E%3C\/svg%3E"\)/);
  assert.doesNotMatch(css, /\/\*/);
});
