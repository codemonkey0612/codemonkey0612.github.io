---
title: RAG検索の改善は誤差か本物か：nDCGとペアbootstrapをPythonで実装
tags:
  - Python
  - RAG
  - 評価
  - 検索
  - 生成AI
private: false
ignorePublish: true
zenn: articles/rag-retrieval-eval-recall-mrr.md
status: failed
---

<!-- autopilot: not posted to Qiita, these checks still failed:
- fact-check (statistic, supported): 「`ndcg_at_k(["a", "b", "c"], {"b": 2, "c": 1}, 3)`は約0.670になります。」 — DCGは2/log2(3)+1/log2(4)、IDCGは2+1/log2(3)で、比は0.6697です。約0.670と一致します。
-->

## 解決したい問題

RAGの検索を改善して、評価用の質問セットで平均スコアが少し上がったとします。ただ質問が数十件しかないと、その差が誤差なのか本物なのかを判断できません。

この記事では、段階的な正解ラベルを扱えるnDCG@kと、ペアbootstrapによる差の信頼区間を、標準ライブラリだけのPythonで実装します。ペアbootstrapで差の95%区間を見る方法は、情報検索の評価で有意性検定を比べた研究（[A comparison of statistical significance tests for information retrieval evaluation](https://www.researchgate.net/publication/221613597_A_comparison_of_statistical_significance_tests_for_information_retrieval_evaluation)）でも扱われています。

## 前提

- Python 3.9以降を想定（`list[str]`などの組み込みジェネリクスのため）。
- 外部ライブラリは使わない。
- 質問ごとのスコアを、同じ質問順で2つの設定について出せる状態にする。
- 検索結果は、スコア順の文書IDのリストとして扱う。

Recall@kやMRRは、すでに手元にある前提です。ここではその先の「差の読み方」を扱います。

## 手順1：段階的な正解ラベルを持つ

正解が「当たり」か「外れ」だけだと、情報の足りない文書も十分な文書も同じ扱いになります。そこで0〜2などの整数で関連度を付けます。

```jsonl:eval.jsonl
{"id": "q001", "question": "出張の宿泊費の上限は", "gains": {"expense#limits": 2, "expense#travel": 1}}
{"id": "q002", "question": "VPNに繋がらない", "gains": {"it-faq#vpn": 2}}
```

- 2：その文書だけで答えられる。
- 1：補足にはなるが、単独では答えにくい。
- 書かれていない文書：0として扱う。

ラベル付けのコストは上がります。そのため、最初は全問ではなく、複数根拠が必要な質問だけ段階を付ける形でも構いません。

## 手順2：nDCG@kを実装する

nDCGは、関連度の高い文書ほど上位にあると高くなる指標です。順位の割引にはlog2を使います。理想の並びで割って、0〜1に正規化します。

```python:stats.py
import math
import random


def ndcg_at_k(ranked: list[str], gains: dict[str, int], k: int) -> float:
    dcg = sum(
        gains.get(doc_id, 0) / math.log2(i + 1)
        for i, doc_id in enumerate(ranked[:k], start=1)
    )
    ideal = sorted(gains.values(), reverse=True)[:k]
    idcg = sum(g / math.log2(i + 1) for i, g in enumerate(ideal, start=1))
    return dcg / idcg if idcg > 0 else 0.0
```

- `ranked[:k]`で、上位の`k`件だけを見る。
- `ideal`は、ラベルを大きい順に並べた理想の並びである。
- 正解が1件もない質問は0を返すため、検索評価の対象から外すこと。

動作確認です。`ndcg_at_k(["a", "b", "c"], {"b": 2, "c": 1}, 3)`は約0.670になります。理想は「b、c」の順なので、先頭に外れ文書がある分だけ下がります。

## 手順3：ペアbootstrapで差の信頼区間を出す

質問ごとのスコア差を並べ、その差を重複ありで再抽出して平均を何度も計算します。平均の分布から、95%区間を取ります。

```python:stats.py
def paired_bootstrap(base: list[float], new: list[float],
                     n_boot: int = 10000, seed: int = 0) -> dict:
    if len(base) != len(new) or not base:
        raise ValueError("同じ質問順で同じ長さの配列が必要です")
    rng = random.Random(seed)
    diffs = [n - b for b, n in zip(base, new)]
    size = len(diffs)
    means = sorted(
        sum(rng.choices(diffs, k=size)) / size for _ in range(n_boot)
    )
    return {
        "mean_diff": sum(diffs) / size,
        "ci95": (means[int(n_boot * 0.025)], means[int(n_boot * 0.975) - 1]),
        "improved": sum(d > 0 for d in diffs),
        "worsened": sum(d < 0 for d in diffs),
    }
```

- 同じ質問どうしで差を取る「ペア」にすると、質問の難しさの違いを打ち消せる。
- `seed`を固定すると、実行のたびに結果が変わらない。
- `improved`と`worsened`は、良くなった質問数と悪くなった質問数である。

## 手順4：使い方

```python:run.py
from stats import ndcg_at_k, paired_bootstrap


def per_question_ndcg(retriever, dataset, k=5):
    return [
        ndcg_at_k(retriever(row["question"]), row["gains"], k)
        for row in dataset
    ]

# base = per_question_ndcg(base_retriever, dataset)
# new = per_question_ndcg(new_retriever, dataset)
# print(paired_bootstrap(base, new))
```

`retriever`は、質問文を受けて文書IDのリストを返す関数です。チャンク単位の検索なら、文書IDに変換して重複を除いてから渡してください。

## 結果の読み方

たとえば、40問で比べて次のような出力が得られたとします。以下は読み方を示すための架空の値です。

```text
{'mean_diff': 0.039, 'ci95': (-0.025, 0.101), 'improved': 25, 'worsened': 15}
```

平均は0.039上がっています。しかし95%区間が0をまたぐため、この差だけでは改善と言い切れません。区間が0を含まない場合に、はじめて「改善の傾向がある」と読みます。

## 落とし穴

- 質問が少なすぎると、区間が広くなる。差が小さい改善は検出できない。
- 質問は互いに独立でない場合がある。同じ文書から作った質問が多いと、区間が実際より狭く出る。
- 何通りも設定を試して、有意に見えたものだけ採用すると、偶然の当たりを拾う。最終確認用の質問を別に取り置くこと。
- 信頼区間は、回答の品質を保証しない。検索が良くなっても、生成側の確認は別に必要である。
- `improved`と`worsened`が両方多いなら、平均の差が小さくても中身は大きく動いている。悪化した質問を必ず読むこと。

## まとめ

- 段階的な関連度を持てば、nDCG@kで複数根拠の質問を扱いやすくなる。
- 質問ごとのスコア差をペアbootstrapにかけると、改善が誤差かどうかの目安になる。
- 区間が0をまたぐ間は、結論を急がず質問を増やす。
- 実装は標準ライブラリだけで数十行に収まる。CIに載せて、変更のたびに差を確認できる。
