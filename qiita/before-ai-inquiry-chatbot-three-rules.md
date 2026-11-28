---
title: RAG問い合わせボットの改悪をCIで検知する評価スクリプトをPythonで作る
tags:
  - Python
  - RAG
  - 生成AI
  - LLM
  - CI
private: false
ignorePublish: true
zenn: articles/before-ai-inquiry-chatbot-three-rules.md
published_at: 2026-11-30 09:00
---

## 問題と成果

RAGの問い合わせボットを改善していると、「前より良さそう」という感覚だけで判断してしまいがちです。ある質問を直した結果、別の質問で悪化していても気づけません。

この記事では、評価用の質問セットから次の3つの数字を出す小さなPythonスクリプトを作ります。しきい値を下回ったらCIを落とす仕組みも付けます。

- 正答率
- 参照元の的中率
- 答えがない質問で控えられた割合

特定のRAGライブラリには依存しません。質問を受けて答えを返す関数さえあれば使えます。

## 前提

- Python 3.9以上（型ヒントの `list[str]` は [PEP 585](https://www.python.org/dev/peps/pep-0585/) の機能で、Python 3.9が必要）
- 標準ライブラリのみ
- 自分のRAGを「質問文字列を受け取り、回答・参照元ID・控えたかどうかを返す関数」で包めること

私が過去に担当したRAG文書解析の案件（2023年4月〜2024年3月）では、評価用の質問データで検索精度と回答品質の改善を繰り返しました。また、情報が足りないときは回答を控える仕組みにしました。以下のコードはその考え方を、今ならこう書くという形にしたものです。案件で使ったコードそのものではありません。

## 手順1：評価データをJSONLで作る

1行1問のJSONLにします。差分が見やすく、問い合わせ履歴から追記しやすいためです。

```json:eval_cases.jsonl
{"id": "q001", "question": "返品したい", "answerable": true, "doc_ids": ["return-policy"], "keywords": ["7日以内"]}
{"id": "q002", "question": "返金してほしいのですが", "answerable": true, "doc_ids": ["return-policy"], "keywords": ["7日以内"]}
{"id": "q003", "question": "海外への配送はできますか", "answerable": false, "doc_ids": [], "keywords": []}
```

数字はすべて、たとえば架空の返品規定です。ポイントは次の3つです。

- 同じ意味の聞き方を複数入れる（q001とq002）
- 文書に答えがない質問を混ぜる（q003）
- 正解は完全一致の文章にせず、必須キーワードで判定する

## 手順2：評価スクリプト

```python:evaluate.py
import json
import sys
from dataclasses import dataclass
from typing import Callable


@dataclass
class Result:
    answer: str
    sources: list[str]
    refused: bool


def load_cases(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def rate(n: int, d: int) -> float:
    return n / d if d else 0.0


def evaluate(cases: list[dict], ask: Callable[[str], Result]) -> dict:
    answerable = [c for c in cases if c["answerable"]]
    unanswerable = [c for c in cases if not c["answerable"]]
    correct = cited = false_refusal = proper_refusal = 0
    failures = []

    for c in answerable:
        r = ask(c["question"])
        if r.refused:
            false_refusal += 1
            failures.append((c["id"], "false_refusal"))
            continue
        if all(k in r.answer for k in c["keywords"]):
            correct += 1
        else:
            failures.append((c["id"], "wrong_answer"))
        if set(c["doc_ids"]) & set(r.sources):
            cited += 1
        else:
            failures.append((c["id"], "wrong_source"))

    for c in unanswerable:
        r = ask(c["question"])
        if r.refused:
            proper_refusal += 1
        else:
            failures.append((c["id"], "should_refuse"))

    return {
        "accuracy": rate(correct, len(answerable)),
        "citation_hit": rate(cited, len(answerable)),
        "false_refusal": rate(false_refusal, len(answerable)),
        "proper_refusal": rate(proper_refusal, len(unanswerable)),
        "failures": failures,
    }


THRESHOLDS = {"accuracy": 0.8, "citation_hit": 0.8, "proper_refusal": 0.9}


def main() -> int:
    from my_rag import ask  # 自分のRAGをResultに包んだ関数

    report = evaluate(load_cases("eval_cases.jsonl"), ask)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    bad = [k for k, v in THRESHOLDS.items() if report[k] < v]
    if bad:
        print("FAILED:", ", ".join(bad))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 各部分の役割

- `Result` は、RAG側が返すべき3つの値を決める
- `evaluate` は、答えがある質問と、ない質問を分けて数える
- 答えがある質問で控えた場合は、`false_refusal` として別に数える
- `failures` に、失敗した質問IDと理由を残す
- `main` は、しきい値を下回ると終了コード1を返す。CIの失敗として扱える

`my_rag.py` の側は、たとえば次の形で包みます。中身は自分の実装に置き換えてください。

```python:my_rag.py
from evaluate import Result


def ask(question: str) -> Result:
    # 検索→LLM呼び出しを行い、根拠が弱ければ refused=True を返す
    return Result(answer="", sources=[], refused=True)
```

## 動作の確認

まず上のダミーのまま実行します。常に控えるので、結果は次のようになるはずです。

- `proper_refusal` が1.0
- `false_refusal` が1.0
- `accuracy` が0.0
- 終了コードが1

評価器自体が正しく落ちることを、先に確かめておきます。次に、常に正解を返す偽の関数でも試します。今度は `accuracy` が1.0、終了コードが0になるはずです。私なら、評価器のテストとしてこの2通りをリポジトリに入れます。

## 落とし穴

- 正解を完全一致にすると、言い回しの違いで落ちる。必須キーワードで見るのが現実的。ただしキーワード判定は甘いので、最終的には人の目での抜き取り確認も要る
- 控える率だけを上げると、`false_refusal` が増えて使えなくなる。必ず2つを並べて見る
- 件数が少ないと、1問で率が大きく動く。数字は傾向として見て、`failures` の中身を読むほうが学びがある
- 評価データを、プロンプト調整に使った質問だけで作ると過学習する。調整用と判定用は分けておく
- しきい値の0.8や0.9に根拠はない。まず現状値を測り、そこから決める

## 本番で私ならこうします

- 評価はプロンプトや検索設定の変更ごとに、CIで必ず回す
- 問い合わせで控えた質問のログを、評価データの候補として定期的に足す
- 失敗理由を `wrong_source` と `wrong_answer` に分けているので、検索が悪いのか生成が悪いのかを切り分けられる

## まとめ

- 評価用の質問セットとスクリプトがあれば、改善の良し悪しを数字で比べられる
- 正答率だけでなく、参照元の的中率と、答えがないときに控える割合も測る
- しきい値を割ったらCIを落とすと、悪化に早く気づける

まずは10問ほどの小さなセットから始めて、失敗した質問を足していくのが続けやすいと考えます。
