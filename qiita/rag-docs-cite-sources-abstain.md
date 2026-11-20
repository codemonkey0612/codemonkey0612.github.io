---
title: pgvectorのHNSWでテナント絞り込みすると検索が0件になる問題と対策
tags:
  - PostgreSQL
  - pgvector
  - RAG
  - マルチテナント
  - Python
private: false
ignorePublish: true
zenn: off-zenn/rag-docs-cite-sources-abstain.md
published_at: 2026-11-22 09:00
---

マルチテナントのRAGで、pgvectorのHNSWインデックスに `WHERE tenant_id = ...` を付けると、LIMITより少ない件数しか返らないことがあります。この記事では、その仕組みと、再現・対策・検知までをコードで示します。

私はマルチテナントのAI業務基盤を、PostgreSQLとベクトル検索で作った経験があります。企業ごとのデータ分離が必須なので、この絞り込みは避けて通れません。以下は一般的な技術の話として書きます。

## 前提環境

- PostgreSQL 15以降
- pgvector 0.8.0以降（反復スキャンを使うため）
- Python 3.11 と psycopg 3

## 何が起きるのか

HNSWはまず距離の近い上位候補をインデックスから取り、そのあとでWHEREの条件を当てます。選択性の高い条件では、候補の大半が落ちて件数が足りなくなります。

[Supabaseのドキュメント](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)によると、pgvector 0.8.0以降は反復インデックススキャンが使えます。十分な件数が揃うまでインデックスを追加でたどる仕組みで、`hnsw.iterative_scan` で制御します。既定はoffです。

RAGでこれが起きると「該当なし」と区別がつきません。本当は文書があるのに、回答を控えてしまいます。

## 手順1：テーブルとインデックス

```sql:schema.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
  id        bigserial PRIMARY KEY,
  tenant_id integer NOT NULL,
  doc_id    text NOT NULL,
  body      text NOT NULL,
  embedding vector(1536) NOT NULL
);

CREATE INDEX chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tenant_idx ON chunks (tenant_id);
```

次元数（1536）は使う埋め込みモデルに合わせて変えてください。

## 手順2：反復スキャンを検索トランザクション内だけで有効にする

```python:search.py
import psycopg

SQL = """
SELECT doc_id, body, embedding <=> %(q)s::vector AS distance
FROM chunks
WHERE tenant_id = %(tenant)s
ORDER BY embedding <=> %(q)s::vector
LIMIT %(k)s
"""


def to_literal(vec: list[float]) -> str:
    return "[" + ",".join(str(x) for x in vec) + "]"


def search(conn: psycopg.Connection, tenant: int,
           vec: list[float], k: int = 10) -> list[dict]:
    with conn.transaction():
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SET LOCAL hnsw.iterative_scan = strict_order")
            cur.execute(SQL, {"q": to_literal(vec), "tenant": tenant, "k": k})
            rows = cur.fetchall()
    if len(rows) < k:
        print(f"warn: tenant={tenant} returned {len(rows)} < {k}")
    return rows
```

ポイントは三つです。

- `SET LOCAL` はそのトランザクション内だけ有効になる。他のクエリの挙動を変えない
- `strict_order` は距離順を保つ。順序のずれを許せるなら `relaxed_order` も選べる
- 返却件数が指定件数に満たないときにログを出す。取りこぼしの検知になる

テナントIDはSQLに文字列連結せず、必ずパラメータで渡します。分離の要なので、アプリ側の条件漏れが最大のリスクです。

## 確かめ方

小さいテナントを大量の他テナントに混ぜ、反復スキャンのoffとonで件数を比べます。

```python:check.py
import random
import psycopg
from search import to_literal

def rand_vec(d=1536):
    return [random.random() for _ in range(d)]

with psycopg.connect("dbname=ragtest") as conn:
    q = to_literal(rand_vec())
    for mode in ("off", "strict_order"):
        with conn.transaction():
            conn.execute(f"SET LOCAL hnsw.iterative_scan = {mode}")
            n = conn.execute(
                "SELECT count(*) FROM (SELECT 1 FROM chunks "
                "WHERE tenant_id = 99 "
                "ORDER BY embedding <=> %s::vector LIMIT 10) t",
                (q,),
            ).fetchone()[0]
        print(mode, n)
```

テナント99を50件ほど、他テナントを数万件入れておくと、offでは10件に満たず、strict_orderでは10件に近づくはずです。数値は環境で変わるので、自分のデータで確認してください。

## 落とし穴

- 反復スキャンにも上限がある。[pgEdgeのpgvectorドキュメント](https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/)では `hnsw.max_scan_tuples` の既定が20,000とされている。極端に小さいテナントでは上限まで走っても足りない場合がある
- 計画によってはインデックスが使われず、テナント絞り込みの全件走査になることもある。`EXPLAIN` で確認する
- グローバル設定で有効にすると、他のベクトル検索の性能に影響しうる。私ならまず検索処理の中だけで有効にする

## 本番での私の方針

- 反復スキャンを検索トランザクション内で有効にする
- 小さなテナントは、距離計算を全件で行う正確な検索に切り替える
- 巨大なテナントはパーティションや部分インデックスで分ける選択肢を持つ
- 返却件数不足のログを必ず出す

件数不足を放置すると、評価データの検索ヒット率が下がった原因を、チャンク分割や閾値のせいにしてしまいます。分離と検索の層を先に疑うのが近道です。

## まとめ

HNSWのフィルタ付き検索は、条件が厳しいほど件数が足りなくなります。pgvector 0.8.0以降の反復スキャンを `SET LOCAL` で使い、件数不足をログで検知すれば、マルチテナントのRAGで「実は文書があったのに控えた」を減らせます。
