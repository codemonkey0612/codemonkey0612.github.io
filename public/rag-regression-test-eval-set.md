---
title: マルチテナントRAGの越境漏えいをpytestのカナリア文書で検知する
tags:
  - Python
  - pytest
  - rag
  - PostgreSQL
  - Security
private: false
updated_at: '2026-11-23T09:00:14+09:00'
id: aeef0c55f1583fd57492
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
マルチテナントのRAGでは、検索のWHERE句が一箇所抜けるだけで、他社の文書が回答に混ざります。この記事では、テナントごとに「カナリア文書」を仕込み、pytestで越境を機械的に検知する方法を示します。回答の品質評価とは切り離した、権限境界だけのテストです。

## 前提と考え方

- Python 3.11以降、pytest
- 検索層は `search(tenant_id, role_level, query, top_n)` という一つの関数に集約されている

私はAIエージェント・マルチテナントSaaSの開発(2024-04〜2026-07)で、企業単位のデータ分離とロール別権限を実装しました。その経験から言えるのは、権限の検査は「回答が良いか」の評価と混ぜないほうがよい、ということです。原因の切り分けができなくなるからです。

方針は単純です。各テナントに、他では絶対に出てこない目印の文字列を持つ文書を入れます。別テナントとして検索し、その目印が結果に出たら失敗とします。

## 検索層のインターフェース

テストしやすいように、検索を小さな型に閉じ込めます。ここでは動作確認用にメモリ上の実装を置きます。

```python:app/retriever.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    doc_id: str
    tenant_id: str
    min_role: int  # 閲覧に必要なロールの最小値
    text: str


class InMemoryRetriever:
    def __init__(self, chunks: list[Chunk]) -> None:
        self._chunks = chunks

    def search(self, tenant_id: str, role_level: int,
               query: str, top_n: int = 5) -> list[Chunk]:
        words = set(query.lower().split())
        allowed = [
            c for c in self._chunks
            if c.tenant_id == tenant_id and c.min_role <= role_level
        ]
        scored = [
            (len(words & set(c.text.lower().split())), c) for c in allowed
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        return [c for _, c in scored[:top_n]]
```

本番ではここがベクトル検索になります。PostgreSQLなら、権限条件を必ず検索クエリの内側に入れます。取得後にPython側で絞ると、上位件数が他社の文書で埋まる問題も起きます。

```python:app/pg_retriever.py
SEARCH_SQL = """
SELECT doc_id, tenant_id, min_role, text
FROM chunks
WHERE tenant_id = %(tenant_id)s
  AND min_role <= %(role_level)s
ORDER BY embedding <=> %(qvec)s
LIMIT %(top_n)s
"""
```

`<=>` はpgvectorの距離演算子です。`qvec` は質問の埋め込みで、パラメータとして渡します。

## カナリア文書とテスト

```python:tests/test_tenant_isolation.py
import itertools

import pytest

from app.retriever import Chunk, InMemoryRetriever

TENANTS = ["a", "b", "c"]
ROLE_ADMIN, ROLE_MEMBER = 9, 1


def build_chunks() -> list[Chunk]:
    chunks = []
    for t in TENANTS:
        chunks.append(Chunk(f"{t}-pub", t, ROLE_MEMBER,
                            f"vacation policy CANARY-{t.upper()}-PUB"))
        chunks.append(Chunk(f"{t}-adm", t, ROLE_ADMIN,
                            f"salary table CANARY-{t.upper()}-ADM"))
    return chunks


@pytest.fixture
def retriever():
    return InMemoryRetriever(build_chunks())


@pytest.mark.parametrize("me,other", itertools.permutations(TENANTS, 2))
def test_no_cross_tenant_leak(retriever, me, other):
    # 他テナントの目印を質問に含めても、結果に出ないこと
    queries = [
        "vacation policy",
        "salary table",
        f"CANARY-{other.upper()}-PUB",
        f"CANARY-{other.upper()}-ADM",
    ]
    for q in queries:
        for chunk in retriever.search(me, ROLE_ADMIN, q, top_n=10):
            assert chunk.tenant_id == me
            assert f"CANARY-{other.upper()}" not in chunk.text


@pytest.mark.parametrize("t", TENANTS)
def test_role_filter(retriever, t):
    hits = retriever.search(t, ROLE_MEMBER, "salary table", top_n=10)
    assert all(c.min_role <= ROLE_MEMBER for c in hits)
    assert not any("-ADM" in c.text for c in hits)
```

`itertools.permutations` で全テナントの組み合わせを網羅します。質問に他社のカナリアをそのまま入れるのが肝です。キーワード一致でもベクトル一致でも、最も上位に来やすい状況を作れるからです。

## 動作確認

```bash
pytest tests/test_tenant_isolation.py -q
```

次に、わざと壊して失敗することを確かめます。`InMemoryRetriever` の `c.tenant_id == tenant_id` を消してください。`test_no_cross_tenant_leak` が全組み合わせで落ちれば、テストは機能しています。落ちないテストは、通っても安心材料になりません。

## 本番に近づけるには

メモリ実装では、SQLの書き間違いは検出できません。私なら、次の構成にします。

- CIで使い捨てのPostgreSQLを立て、カナリア文書を実際に投入する
- `app.retriever` と同じ `search` 関数を、本番の実装に差し替えて同じテストを流す
- 回答生成まで含めた経路でも、最終テキストにカナリア文字列が出ないことを検査する

RAGの場合、検索で止まっていても、キャッシュや会話履歴経由で漏れる経路があります。そのため、回答側の検査も一本入れておくのが安全です。

## 落とし穴

- カナリアが自然な文章だと、本物の文書と衝突する。`CANARY-` のような固有の接頭辞を使う。
- 管理者ロールだけで試すと、ロール境界の漏れを見逃す。一般ロールの検査も必ず入れる。
- テナントが2つだけだと、組み合わせの不備に気づきにくい。3つ以上を使う。
- 検索の取得件数が少ないと、漏れても上位に出ないことがある。テストでは件数を大きくする。
- アプリ側の絞り込みだけに頼らず、データベース側の行レベルセキュリティなど、二重の防御も検討する。

## まとめ

テナント越境は、例外もエラーも出さずに起きます。テナントごとのカナリア文書と全組み合わせのテストで、検索層の権限条件の抜けをCIで検知できます。私なら、この検査を回答品質の評価とは別のテストとして常に流し、本番の検索実装に対して同じテストを実行します。
