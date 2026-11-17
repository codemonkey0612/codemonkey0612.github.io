---
title: マルチテナントRAGの検索で他社文書が混ざらないかをpytestで自動検査する
tags:
  - Python
  - pytest
  - RAG
  - PostgreSQL
  - マルチテナント
private: false
ignorePublish: true
zenn: articles/rag-retrieval-eval-recall-mrr.md
status: failed
---

<!-- autopilot: not posted to Qiita, these checks still failed:
- textlint (line 22): 箇条書き: "である"調 でなければなりません
=> "である"調 であるべき箇所に、次の "ですます"調 の箇所があります: "ます。"
Total:
である  : 1
ですます: 1

- fact-check (computed, contradicted): 「私の手元では9件すべて通りました（越境検査6件、自テナント検査3件）。」 — 越境検査は TENANTS（2件）×QUESTIONS（3件）で6件、自テナント検査は3件なので合計9件になります。件数は正しいです。一方、通るかどうかを追うと、q1（tenant_a）の自テナント検査は a-leave が1件ヒットし、通ります。q2、q3も同様に通ります。結果として9件通ります。矛盾は見つかりませんでした。
-->

## 解決したい問題

マルチテナントのRAGでは、検索精度が上がっても、他のテナントの文書が1件でも混ざれば重大な事故になります。Recall@kのような精度指標は「正解が取れたか」しか見ません。「取ってはいけないものが取れていないか」は別のテストが必要です。

この記事では、テナント越境を `pytest` で機械的に検査する方法を書きます。検索の実装には依存せず、関数を1つ差し替えれば使えます。

## 前提

- Python 3.9以上（型ヒントに `list[Hit]` を使います。標準のコレクションをジェネリクスとして使える仕様は、[Python 3.9 typing ドキュメント](https://docs.python.org/3.9/library/typing.html)にあるPEP 585で導入されました）
- pytest
- 検索関数が `search(tenant_id, question, top_n)` の形で呼べること

ベクトルDBやPostgreSQLの有無は問いません。ここでは動作確認のため、キーワード一致だけの簡単な検索をメモリ上に置きます。

## 考え方

検査は2種類に分けます。

- 越境検査：全テナントが全質問を投げ、返った文書の所有テナントが呼び出し元と一致するかを見る
- 自テナント検査：自分の質問で、正解文書が上位に入るかを見る

ポイントは越境検査で「他テナントの質問」も投げることです。テナントAの質問をテナントBとして投げると、Aの文書が類似度で上位に来やすく、フィルタ漏れを見つけやすくなります。

また、所有テナントは検索結果の付帯情報ではなく、コーパスの台帳から引きます。検索結果自身の `tenant_id` を信じると、メタデータごと壊れたときに検出できないためです。

## 実装

### 検索関数（差し替え対象）

```python:retriever.py
from dataclasses import dataclass


@dataclass(frozen=True)
class Hit:
    doc_id: str
    tenant_id: str
    score: float


CORPUS = [
    {"doc_id": "a-leave", "tenant_id": "tenant_a", "text": "有給休暇 申請 3日前"},
    {"doc_id": "a-vpn", "tenant_id": "tenant_a", "text": "VPN 接続 手順"},
    {"doc_id": "b-leave", "tenant_id": "tenant_b", "text": "有給休暇 申請 1週間前"},
]


def search(tenant_id: str, question: str, top_n: int = 5) -> list[Hit]:
    words = set(question.split())
    hits = []
    for d in CORPUS:
        if d["tenant_id"] != tenant_id:  # 本番ではSQLのWHERE句に相当
            continue
        score = len(words & set(d["text"].split()))
        if score:
            hits.append(Hit(d["doc_id"], d["tenant_id"], float(score)))
    return sorted(hits, key=lambda h: -h.score)[:top_n]
```

本番では、この `if` の位置がベクトル検索のSQLの `WHERE tenant_id = ...` にあたります。テストでは、この部分をわざと消しても落ちることを確認します。

### テスト本体

```python:test_tenant.py
import pytest
from retriever import CORPUS, search

QUESTIONS = [
    {"id": "q1", "tenant_id": "tenant_a", "question": "有給休暇 申請", "relevant": {"a-leave"}},
    {"id": "q2", "tenant_id": "tenant_a", "question": "VPN 手順", "relevant": {"a-vpn"}},
    {"id": "q3", "tenant_id": "tenant_b", "question": "有給休暇 申請", "relevant": {"b-leave"}},
]
TENANTS = sorted({d["tenant_id"] for d in CORPUS})
OWNER = {d["doc_id"]: d["tenant_id"] for d in CORPUS}


@pytest.mark.parametrize("caller", TENANTS)
@pytest.mark.parametrize("q", QUESTIONS, ids=lambda q: q["id"])
def test_no_cross_tenant_hits(caller, q):
    hits = search(caller, q["question"], top_n=50)
    leaked = [h.doc_id for h in hits if OWNER[h.doc_id] != caller]
    assert not leaked, f"{caller} に他テナントの文書が返りました: {leaked}"


@pytest.mark.parametrize("q", QUESTIONS, ids=lambda q: q["id"])
def test_own_tenant_recall_at_3(q):
    ids = [h.doc_id for h in search(q["tenant_id"], q["question"])[:3]]
    assert q["relevant"] & set(ids)
```

各部分の役割は次のとおりです。

- `OWNER`：文書IDから所有テナントを引く台帳
- `caller` のparametrize：全テナントを呼び出し元にする設定で、質問の持ち主とは無関係に全組み合わせを試す
- `top_n=50`：多めに取る指定で、上位5件に出なくても下位に漏れていれば検出できる
- 自テナント検査：上位3件に正解が入ることだけを確認する

## 動作の確認

```bash
python -m pytest -q
```

私の手元では9件すべて通りました（越境検査6件、自テナント検査3件）。

次に、検査が本当に効くかを確かめます。`retriever.py` の `if d["tenant_id"] != tenant_id:` の2行をコメントアウトして再実行してください。越境検査が落ち、漏れた文書IDがメッセージに出れば成功です。落ちないテストは、通っていても安心材料になりません。

## 実運用での注意点

- 実際のコーパスの一部を使う場合、台帳 `OWNER` は検索DBとは別経路で作る。同じテーブルから作ると同じ不具合を共有する。
- ベクトル検索で近似検索を使う場合、フィルタの適用順で返る件数が減ることがある。自テナント検査のRecallが急に落ちたら、まずフィルタ条件を疑う。
- キャッシュも検査対象である。回答や検索結果をキャッシュするなら、キーにテナントIDが入っているかを同じ方法で試す。
- 参照元表示も確認する。回答に出る出典IDが `OWNER` と一致するかを同様に検査できる。
- 質問に固有名詞を入れておくと、越境時に類似度が高くなり、検出しやすくなる。

私はAIエージェントのマルチテナントSaaS開発で、企業単位のデータ分離や権限を実装し、評価用データセットでの品質検証も整備しました。その経験からも、精度の検査と分離の検査は、別々のテストとして持つほうが管理しやすいと感じています。

## まとめ

- 精度指標は「取れたか」しか測らないため、越境は別に検査する。
- 全テナントが全質問を投げる組み合わせテストで、フィルタ漏れを見つけやすくなる。
- 所有テナントは検索結果ではなく、独立した台帳から引く。
- フィルタをわざと外して、テストが落ちることも確認する。
