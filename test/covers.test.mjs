import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { imageSize } from "image-size";
import { ROOT } from "../scripts/lib/common.mjs";
import { chooseCover, coverPath, loadCovers } from "../scripts/lib/note-covers.mjs";
import { coverFilter } from "../scripts/note-covers.mjs";

const covers = loadCovers();
const pick = (title, topics, used) => chooseCover(covers, { title, topics, used }).id;

test("each article gets the package image that fits its topic", () => {
  assert.equal(pick("Excelの転記・集計作業を約75%減らしたとき、最初にやったこと", ["excel", "python", "automation", "dx"]), "1351569");
  assert.equal(pick("マルチテナントRAGの情報漏えいを防ぐ：PostgreSQLのRLSとpgvectorでの実装", ["rag", "postgresql", "security"]), "1351631");
  assert.equal(pick("PHPの脆弱性「PHP2shell」IPA注意喚起：自社サイトで今確認すべきこと", ["php", "security", "wordpress"]), "1319677");
  assert.equal(pick("社内問い合わせをLINEのAIチャットボットで減らす", ["chatbot", "line"]), "1351686");
  assert.equal(pick("生成AIを社内に導入する前に決めておくルール", ["ai", "dx"]), "1351667");
  assert.equal(pick("ShopifyでECサイトを始める前に", ["shopify"]), "1351689");
  assert.equal(pick("今日の雑記", []), "1319674", "no match: the default image");
});

test("English keywords match whole words only, and equally good images take turns", () => {
  assert.equal(pick("CI/CDのpipelineを見直す", []), "1351769", "'pipeline' is not LINE, but CI is testing");
  assert.equal(pick("WordPressの始め方", ["wordpress"]), "1319797");
  assert.equal(pick("WordPressの始め方", ["wordpress"], { "covers/1319797.jpg": 2 }), "1351723", "the less used WordPress image");
});

test("every package image is rendered at note's size, and the excluded services aren't offered", () => {
  assert.ok(covers.length >= 10);
  assert.equal(covers.filter((c) => c.default).length, 1);
  for (const c of covers) {
    const file = path.join(ROOT, "notes", coverPath(c));
    assert.ok(fs.existsSync(file), `${coverPath(c)} is rendered (npm run note:covers)`);
    const { width, height } = imageSize(fs.readFileSync(file));
    assert.deepEqual([width, height], [1280, 670], coverPath(c));
  }
  const services = covers.map((c) => c.service).join(" ");
  assert.doesNotMatch(services, /顔交換|フェイス|スクレイピング|ゲーム|ビジネスパートナー/);
});

test("crop keeps the chosen part of the height; contain fills both sides exactly", () => {
  assert.match(coverFilter({ fit: "crop", y: 0.1 }, [1672, 941]), /crop=1280:670:\(iw-1280\)\/2:\(ih-670\)\*0\.1/);
  const f = coverFilter({ fit: "contain" }, [1418, 1109]);
  assert.match(f, /scale=212:670/);
  assert.match(f, /scale=856:670\[fg\]/);
});
