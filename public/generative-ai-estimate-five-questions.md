---
title: RAGの「分からない」と参照元を自動検証するPython評価スクリプトの作り方
tags:
  - Python
  - rag
  - 生成AI
  - LLM
  - テスト
private: false
updated_at: '2026-11-18T09:00:10+09:00'
id: 8287c5fb775d834086a4
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
RAGを作ったあとで、「参照元を出す」「根拠がなければ答えない」という動作が、改修のたびに壊れていないかを確認するのは意外と手間です。この記事では、その2点と検索ヒット率を、標準ライブラリだけで自動チェックする評価スクリプトを作ります。

## 前提

- Python 3 が動く環境である
- 外部ライブラリは使わない
- RAG本体は `answer_question` に差し替えるだけで評価できる
- 以下のコードはダミー実装で動作確認済みである

私が担当した社内文書向けRAGの案件では、回答に参照元を表示し、情報が足りないときは回答を控える仕組みにしました。そのうえで、評価用の質問データを使い、検索精度と回答品質の改善を繰り返しました。この記事は、その考え方を最小構成で書き直したものです。実際のコードとは別物です。

## 何を測るか

指標は3つに絞ります。

- hit@k：正解文書が、検索結果の上位 `k` 件に入った割合
- abstain_ok：答えがない質問で、きちんと回答を控えた割合
- cite_valid：回答に付けた参照元が、実際に検索された文書と一致した割合

3つ目が重要です。LLMは、検索していない文書IDを根拠として書いてしまうことがあります。検索結果との突き合わせで機械的に検出できます。

## 評価セットを作る

1行1問のJSONLにします。答えが資料にない質問は `expected_doc_ids` を空にします。

```jsonl:evalset.jsonl
{"id": "q1", "question": "有給休暇はいつ付与されますか", "expected_doc_ids": ["d1"]}
{"id": "q2", "question": "経費精算の締切はいつですか", "expected_doc_ids": ["d2"]}
{"id": "q3", "question": "社長の誕生日は", "expected_doc_ids": []}
```

「答えられない質問」を必ず混ぜてください。正答する質問だけだと、何でも答えるシステムが高得点になります。

## 評価スクリプト

```python:eval_rag.py
import json
import sys
from dataclasses import dataclass


@dataclass
class Answer:
    text: str
    cited_ids: list
    retrieved_ids: list
    abstained: bool


def answer_question(question):
    """差し替え対象。ここでは動作確認用のダミー実装。"""
    kb = {"d1": "有給休暇は入社6か月後に付与されます", "d2": "経費精算は翌月5日が締切です"}
    scored = [(sum(c in t for c in set(question)), i) for i, t in kb.items()]
    scored.sort(reverse=True)
    retrieved = [i for s, i in scored[:2]]
    if scored[0][0] < 4:
        return Answer("資料からは分かりません", [], retrieved, True)
    return Answer(kb[scored[0][1]], [scored[0][1]], retrieved, False)


def evaluate(path, k=2):
    rows = [json.loads(line) for line in open(path, encoding="utf-8")]
    stats = {"answerable": 0, "hit": 0, "unanswerable": 0,
             "abstain_ok": 0, "cited": 0, "cite_valid": 0}
    failures = []
    for r in rows:
        a = answer_question(r["question"])
        if r["expected_doc_ids"]:
            stats["answerable"] += 1
            if set(r["expected_doc_ids"]) & set(a.retrieved_ids[:k]):
                stats["hit"] += 1
            else:
                failures.append((r["id"], "retrieval_miss"))
            if a.abstained:
                failures.append((r["id"], "over_abstain"))
        else:
            stats["unanswerable"] += 1
            if a.abstained:
                stats["abstain_ok"] += 1
            else:
                failures.append((r["id"], "should_abstain"))
        if not a.abstained:
            stats["cited"] += 1
            if a.cited_ids and set(a.cited_ids) <= set(a.retrieved_ids):
                stats["cite_valid"] += 1
            else:
                failures.append((r["id"], "bad_citation"))
    return stats, failures


def rate(n, d):
    return "n/a" if d == 0 else f"{n / d:.2f}"


if __name__ == "__main__":
    s, f = evaluate(sys.argv[1])
    print("hit@k      ", rate(s["hit"], s["answerable"]))
    print("abstain_ok ", rate(s["abstain_ok"], s["unanswerable"]))
    print("cite_valid ", rate(s["cite_valid"], s["cited"]))
    for fid, kind in f:
        print("FAIL", fid, kind)
    sys.exit(1 if f else 0)
```

### コードのポイント

- `Answer` は、回答文、引用ID、検索されたID、回答を控えたかの4つを持つ。自作のRAGの戻り値をこの形に合わせる
- `evaluate` は、答えのある質問と無い質問で判定を分ける
- 答えのある質問で控えた場合は `over_abstain` として失敗にする。控えすぎも不具合として扱うためである
- 回答した場合は、引用IDが空でなく、検索結果に含まれることを確認する
- 失敗が1件でもあれば終了コード1を返すので、CIに組み込める

## 動作確認

```bash
python eval_rag.py evalset.jsonl
```

ダミー実装では、次のように出力され、終了コードは0になります。数値は1.00が満点です。

```text
hit@k       1.00
abstain_ok  1.00
cite_valid  1.00
```

次に、`answer_question` の閾値 `4` を `0` に変えてみてください。q3が回答されて `FAIL q3 should_abstain` が出れば、検出ができています。

## 落とし穴

- 質問が少なすぎると、1問の差で割合が大きく動く。実際の問い合わせから質問を集める
- 正解文書IDは、チャンクIDではなく元文書IDで持つと、分割方法を変えても使い回せる
- 回答文の正しさは、このスクリプトでは測れない。人手の確認か、別の採点方法を足す必要がある
- 閾値を厳しくすると `over_abstain` が増える。3指標を同時に見て調整する

## まとめ

- 参照元の妥当性と「分からない」の動作は、機械的に検証できる
- 答えられない質問を評価セットに混ぜることが重要である
- 終了コードを使えば、改修のたびに自動で回帰を確認できる

回答の中身まで見たい場合は、このスクリプトに採点処理を足して拡張してください。
