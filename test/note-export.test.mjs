import assert from "node:assert/strict";
import { test } from "node:test";
import { toNoteHtml } from "../scripts/note-export.mjs";

test("maps headings to note's two levels and strips comments", () => {
  const { html, warnings } = toNoteHtml("<!-- secret -->\n# A\n## B\n### C\n#### D\n\ntext");
  assert.doesNotMatch(html, /secret/);
  assert.match(html, /<h2>A<\/h2>/);
  assert.match(html, /<h3>C<\/h3>/);
  assert.match(html, /<p><strong>D<\/strong><\/p>/);
  assert.match(warnings.join(), /h4/);
});

test("warns about tables and swaps images for upload markers", () => {
  const { html, warnings } = toNoteHtml("|a|b|\n|-|-|\n|1|2|\n\n![図1](x.png)");
  assert.match(warnings.join(), /tables/);
  assert.match(warnings.join(), /images/);
  assert.match(html, /［画像: 図1］/);
});
