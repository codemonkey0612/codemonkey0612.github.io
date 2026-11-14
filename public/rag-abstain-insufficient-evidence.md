---
title: pgvectorの距離を類似度に直して根拠不足を判定する：RAG検索層とpytest回帰
tags:
  - Python
  - PostgreSQL
  - pgvector
  - rag
  - pytest
private: false
updated_at: '2026-11-14T09:00:08+09:00'
id: 93db73ccf114bad454f1
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
## 解きたい問題

RAGで「根拠が弱ければ回答を控える」判定を入れようとして、最初につまずくのがスコアの向きです。pgvectorが返すのは距離で、類似度ではありません。

距離のまま閾値に使うと、大小の判定が逆になります。本記事では、検索SQLで類似度に変換して返す層と、判定が壊れていないかを確かめるpytestを作ります。

## 前提

- PostgreSQL に pgvector を入れ、`chunks` テーブルに埋め込みを保存済み
- Python 3.11 以上、psycopg 3、pytest
- 埋め込みはコサイン距離で比較する前提

テーブルは次の形を想定します。次元数は使う埋め込みモデルに合わせてください。

```sql:schema.sql
CREATE TABLE chunks (
  id        text PRIMARY KEY,
  tenant_id text NOT NULL,
  source    text NOT NULL,
  body      text NOT NULL,
  embedding vector(1536) NOT NULL
);

CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

## 距離と類似度の関係

[pgvectorのREADME](https://github.com/pgvector/pgvector/blob/master/README.md)では、`<=>` がコサイン距離の演算子です。コサイン類似度が欲しいときは、1からコサイン距離を引く方法が示されています。

また、HNSWインデックスでコサイン距離を使うには `vector_cosine_ops` を指定します。演算子クラスとクエリの演算子が食い違うと、インデックスの恩恵を受けられません。

ポイントは次の2つです。

- 並び替えは距離の昇順（`ORDER BY embedding <=> ...`）で行う
- 返す値だけを `1 - 距離` にして、判定側には類似度で渡す

## 検索層の実装

類似度への変換は、判定コードではなく検索層に閉じ込めます。判定側が距離か類似度かを意識しなくて済むからです。

```python:search.py
from dataclasses import dataclass

import psycopg

SQL = """
SELECT id, source, body, 1 - (embedding <=> %(q)s::vector) AS score
FROM chunks
WHERE tenant_id = %(tenant)s
ORDER BY embedding <=> %(q)s::vector
LIMIT %(k)s
"""


@dataclass(frozen=True)
class Chunk:
    id: str
    source: str
    text: str
    score: float  # コサイン類似度。大きいほど近い


def to_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


def search(conn: psycopg.Connection, tenant: str,
           vec: list[float], k: int = 5) -> list[Chunk]:
    with conn.cursor() as cur:
        cur.execute(SQL, {"q": to_literal(vec), "tenant": tenant, "k": k})
        return [Chunk(i, s, b, float(sc)) for i, s, b, sc in cur.fetchall()]
```

解説です。

- `WHERE tenant_id` で、企業単位のデータ分離を検索の入口で効かせる。私が関わったマルチテナントのAI基盤でも、分離は検索の段階で行う方針だった。
- `ORDER BY` は距離のままにして、インデックスが使われる形を保つ。
- ベクトルは文字列リテラルにして `::vector` でキャストする。専用のアダプタが無くても動く。

## 判定関数と理由コード

判定は、依存を持たない純粋関数にします。DBもLLMも呼ばないので、テストが速く回ります。

```python:gate.py
from dataclasses import dataclass

from search import Chunk


@dataclass(frozen=True)
class Policy:
    top_score_min: float = 0.55  # 仮の初期値。評価セットで決め直す
    hit_score_min: float = 0.45
    min_hits: int = 2


def gate(chunks: list[Chunk], p: Policy) -> tuple[bool, str]:
    if not chunks:
        return False, "no_chunks"
    if max(c.score for c in chunks) < p.top_score_min:
        return False, "low_top_score"
    hits = sum(c.score >= p.hit_score_min for c in chunks)
    if hits < p.min_hits:
        return False, "few_hits"
    return True, "ok"
```

## 回帰テストで向きの取り違えを防ぐ

次に、保存済みの検索結果を使うテストを置きます。質問ごとの検索結果をJSONLに残しておけば、LLMもDBも呼ばずに検証できます。

```json:cases.jsonl
{"q":"出張の宿泊費上限","answerable":true,"scores":[0.71,0.62,0.40]}
{"q":"海外赴任の住居手当","answerable":false,"scores":[0.50,0.41,0.33]}
{"q":"社食のメニュー","answerable":false,"scores":[0.21,0.18,0.10]}
```

この数値は、仕組みを示すための仮のものです。実際の値は、自分の文書と埋め込みで取り直してください。

```python:test_gate.py
import json
from pathlib import Path

import pytest

from gate import Policy, gate
from search import Chunk

ROWS = [json.loads(l) for l in
        Path("cases.jsonl").read_text(encoding="utf-8").splitlines() if l]


def to_chunks(scores):
    return [Chunk(f"c{i}", "s", "t", s) for i, s in enumerate(scores)]


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r["q"])
def test_gate_matches_label(row):
    passed, _ = gate(to_chunks(row["scores"]), Policy())
    assert passed == row["answerable"]


def test_distance_would_break_gate():
    # 距離を類似度として渡す事故の再現。近い文書ほど拒否される
    near = [1 - s for s in (0.71, 0.62, 0.40)]
    passed, _ = gate(to_chunks(near), Policy())
    assert passed is False
```

2つ目のテストは、距離を誤って渡した場合に判定が反転することを、あえて固定します。実装を変えたときに、変換の責務がどこにあるかを思い出せます。

## 動作確認

```bash
pytest -q
```

3件のラベル一致テストと、反転の再現テストが通れば、判定の向きは正しい状態です。閾値を変えて落ちるケースが出たら、その質問が境界にあるということです。

次に、実DBでの確認です。同じ質問の埋め込みを使い、SQLの `score` が1に近い順に並んでいるかを見ます。先頭が最大になっていなければ、`ORDER BY` を距離で書けていません。

## 落とし穴

- 距離の種類が違う：L2距離やinner productで作ったインデックスに `<=>` を使うと、順序と値の意味がずれる。演算子クラスを揃える。
- 値域の思い込み：埋め込みが正規化されているかで、スコアの分布は変わる。閾値は実データで決める。
- 絞り込みと件数：`tenant_id` で絞ると、`LIMIT` で返る件数が想定より減る場合がある。`few_hits` が増えたら、取得件数 `k` を見直す。
- 質問文のログ：理由コードと最上位スコアは残すが、質問文は機密になり得る。保存方針を先に決める。

## まとめ

- pgvectorの `<=>` は距離である。類似度は `1 - 距離` で作る。
- 並び替えは距離のまま、返す値だけを変換する。
- 判定は純粋関数にして、保存した検索結果でpytestに載せる。
- 距離を誤って渡す事故も、テストで固定しておける。
