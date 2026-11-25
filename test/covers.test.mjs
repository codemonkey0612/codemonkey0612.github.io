import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { imageSize } from "image-size";
import YAML from "yaml";
import { ROOT } from "../scripts/lib/common.mjs";
import { chooseCover, coverPath, loadCovers } from "../scripts/lib/note-covers.mjs";
import { coverFilter } from "../scripts/note-covers.mjs";

const covers = loadCovers();
const pick = (title, topics, used) => chooseCover(covers, { title, topics, used }).id;

test("with nothing used yet, each article gets the mascot image that fits its topic", () => {
  assert.equal(pick("Excelの転記・集計作業を約75%減らしたとき、最初にやったこと", ["excel", "python"]), "mascot-08");
  assert.equal(pick("PHPの脆弱性：自社サイトで今確認すべきこと", ["php", "security"]), "mascot-06");
  assert.equal(pick("社内問い合わせをAIチャットボットで減らす", ["chatbot"]), "mascot-02");
  assert.equal(pick("配送状況の確認時間を約70%短縮した話", ["logistics"]), "mascot-10");
  assert.equal(pick("今日の雑記", []), "mascot-01", "no match: the first in the list");
});

test("every image is used once before any is used twice; among the least used, the best fit wins", () => {
  const A = { id: "a", keywords: ["rag"] };
  const B = { id: "b", keywords: ["excel"] };
  const C = { id: "c", keywords: ["security"] };
  const choose = (used) => chooseCover([A, B, C], { title: "x", topics: ["rag"], used }).id;
  assert.equal(choose({}), "a");
  assert.equal(choose({ "covers/a.jpg": 1 }), "b", "a was used: the next least used, even without a match");
  assert.equal(choose({ "covers/a.jpg": 1, "covers/b.jpg": 1, "covers/c.jpg": 1 }), "a", "all used once: the best fit again");
  assert.equal(chooseCover([A, B, C], { title: "x", topics: ["security"], used: { "covers/a.jpg": 1 } }).id, "c");
  const used = {};
  const month = Array.from({ length: covers.length }, () => {
    const c = chooseCover(covers, { title: "RAGの回答精度を上げる", topics: ["rag"], used });
    used[coverPath(c)] = (used[coverPath(c)] ?? 0) + 1;
    return c.id;
  });
  assert.equal(new Set(month).size, covers.length, "as many posts on the same topic as there are images: all different");
});

test("English keywords match whole words only", () => {
  const T = [{ id: "t", keywords: ["test"] }, { id: "l", keywords: ["line"] }];
  assert.equal(chooseCover(T, { title: "CI/CDのpipelineを見直す", topics: ["test"] }).id, "t", "'pipeline' is not LINE");
});

test("all 85 mascot images are rendered at note's size, each with a theme and keywords", () => {
  assert.equal(covers.length, 85);
  for (const c of covers) {
    const file = path.join(ROOT, "notes", coverPath(c));
    assert.ok(fs.existsSync(file), `${coverPath(c)} is rendered (npm run note:covers -- --from ../note-covers)`);
    const { width, height } = imageSize(fs.readFileSync(file));
    assert.deepEqual([width, height], [1280, 670], coverPath(c));
    assert.ok(c.theme && c.keywords.length >= 3, c.id);
  }
});

test("a 16:9 image is cropped to fill the frame; a 4:3 or square one is refused", () => {
  assert.match(coverFilter({ y: 0.1 }, [1672, 941]), /crop=1280:670:\(iw-1280\)\/2:\(ih-670\)\*0\.1/);
  assert.match(coverFilter({ y: 0 }, [1220, 686]), /crop=1280:670:\(iw-1280\)\/2:\(ih-670\)\*0/);
  assert.throws(() => coverFilter({}, [1418, 1109]), /isn't 16:9/);
  assert.throws(() => coverFilter({}, [1254, 1254]), /isn't 16:9/);
});

test("the site's package images are 16:9 too, so none is shown squeezed or with bars", () => {
  const packages = YAML.parse(fs.readFileSync(path.join(ROOT, "site/packages.yml"), "utf8"));
  for (const [id, p] of Object.entries(packages)) {
    if (!p.cover) continue;
    const { width, height } = imageSize(fs.readFileSync(path.join(ROOT, "site/assets", p.cover)));
    assert.ok(Math.abs(width / height - 16 / 9) < 0.02, `${id}: ${p.cover} is ${width}×${height}`);
  }
});
