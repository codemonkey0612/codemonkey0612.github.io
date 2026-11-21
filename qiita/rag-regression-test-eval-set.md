---
title: RAGの引用元が実在するかをPythonで検査し、検索結果にない参照元を出口で防ぐ
tags:
  - Python
  - RAG
  - FastAPI
  - Pydantic
  - 生成AI
private: false
ignorePublish: true
zenn: off-zenn/rag-regression-test-eval-set.md
status: failed
---

<!-- autopilot: not posted to Qiita, these checks still failed:
- fact-check (computed, contradicted): 「今回の検索結果と突き合わせる約15行(空行除く)の検証関数」 — verify関数の本体は、空行を除くとdef行を含めて約16行です。def行を除くと15行です。ほぼ合っていますが、約15行という表現は数え方次第で多少ずれます。 Fix: 「約15行」を「15行前後」とするか、実際の行数を数え直して書いてください。
-->

RAGの回答に付く「参照元」は、LLMが書いた文字列をそのまま返すと、存在しない文書IDや検索に出ていない文書が混ざることがあります。この記事では、参照元を検索結果と突き合わせてから返す小さな検証層をPythonで作ります。検索段階で権限フィルタをかけていれば、存在しない引用や権限外の引用をAPIの出口で止められます。

## 背景

私はRAG文書解析システム(2023-04〜2024-03)で、回答に参照元を表示し、情報が足りないときは回答を控える仕組みを実装しました。AIエージェントのマルチテナントSaaS(2024-04〜2026-07)でも、回答の参照元表示を実装しています。

参照元は、利用者が回答を信用する根拠になります。だから「表示されている参照元が本当に使われた文書か」を、プロンプトに頼らずコードで保証したいと考えています。以下の例はすべて仮のものです。

## 前提環境

- Python 3.12
- Pydantic v2
- LLMにはJSONで回答と参照元IDを返させる想定(特定のAPIには依存しません)

## 方針

一般に、LLMには「引用した文書IDを返して」と頼めます。しかしその値は検証されていません。私なら次の3段階で検証します。

- 返ってきたIDが、今回の検索結果(ユーザーが閲覧可能な文書だけ)に含まれるか
- 含まれないIDは捨てる
- 有効な参照元が1件も残らなければ、回答を控える応答に差し替える

ポイントは、突き合わせる相手を「全文書」ではなく「今回の検索結果」にすることです。検索の段階で権限フィルタをかけておけば、権限外の文書は検索結果に入らず、引用もできません。

## 実装

```python:citations.py
from __future__ import annotations

from pydantic import BaseModel, Field


class Chunk(BaseModel):
    doc_id: str
    section: str
    text: str


class LlmOutput(BaseModel):
    answer: str
    cited: list[str] = Field(default_factory=list)  # "doc_id#section"


class Verified(BaseModel):
    answer: str
    sources: list[str]
    refused: bool
    dropped: list[str]


REFUSAL = "資料内に十分な根拠が見つかりませんでした。"


def verify(output: LlmOutput, retrieved: list[Chunk]) -> Verified:
    allowed = {f"{c.doc_id}#{c.section}" for c in retrieved}
    seen: set[str] = set()
    valid: list[str] = []
    dropped: list[str] = []
    for ref in output.cited:
        if ref in seen:
            continue
        seen.add(ref)
        (valid if ref in allowed else dropped).append(ref)

    if not valid:
        return Verified(answer=REFUSAL, sources=[], refused=True, dropped=dropped)
    return Verified(answer=output.answer, sources=valid, refused=False, dropped=dropped)
```

`allowed`は検索結果から作る集合です。`cited`の各要素を重複除去しつつ振り分け、有効なものだけを`sources`に残します。`dropped`はログと監視のために返します。

### FastAPIへの組み込み

```python:main.py
from fastapi import FastAPI
from citations import Chunk, LlmOutput, verify

app = FastAPI()


def retrieve(question: str, tenant_id: str) -> list[Chunk]:
    # 実際にはテナントと権限で絞ったベクトル検索を呼ぶ
    return [Chunk(doc_id="hr", section="leave", text="繰越は20日まで")]


def call_llm(question: str, chunks: list[Chunk]) -> LlmOutput:
    # 実際にはLLM APIを呼び、JSONを LlmOutput に変換する
    return LlmOutput(answer="繰越は20日までです。", cited=["hr#leave", "hr#ghost"])


@app.post("/ask")
def ask(question: str, tenant_id: str):
    chunks = retrieve(question, tenant_id)
    result = verify(call_llm(question, chunks), chunks)
    if result.dropped:
        print("dropped citations:", result.dropped)  # 本番では構造化ログへ
    return result
```

`retrieve`が返したチャンクだけを`verify`に渡すのが肝です。ここで全文書を渡すと、検証の意味がなくなります。

## 動作確認

pytestで、捏造・重複・全滅の3パターンを固定します。

```python:test_citations.py
from citations import Chunk, LlmOutput, verify

C = [Chunk(doc_id="hr", section="leave", text="x")]


def test_drop_ghost():
    r = verify(LlmOutput(answer="a", cited=["hr#leave", "hr#ghost"]), C)
    assert r.sources == ["hr#leave"] and r.dropped == ["hr#ghost"]


def test_dedupe():
    r = verify(LlmOutput(answer="a", cited=["hr#leave", "hr#leave"]), C)
    assert r.sources == ["hr#leave"]


def test_all_invalid_refuses():
    r = verify(LlmOutput(answer="a", cited=["x#y"]), C)
    assert r.refused and r.sources == []
```

`pytest`で3件が通れば、検証層は期待どおりです。

## 落とし穴

- 参照元が実在しても、回答の内容を支えているとは限らない。この検証は「存在」と「権限」しか保証しない。
- 引用ゼロの回答を全部拒否にすると、雑談的な質問まで拒否される。用途に応じて分岐を設けるべきである。
- IDの表記ゆれ(大文字小文字や全角)で正しい引用まで落ちることがある。LLMに渡すIDは短く機械的な形にするとよい。
- `dropped`が増えたらプロンプトか検索の劣化のサインである。件数を監視対象にすると、早く気づける。

## 本番での私の判断

- 検証はLLMではなく、決定的なコードで行う。結果が揺れず、説明しやすいからである。
- 権限フィルタは検索の段階でかける。回答後に消す方式だと、漏れたときの影響が大きいためである。
- 拒否は文言ではなく`refused`フィールドで返す。UIとテストの両方が楽になる。

## まとめ

LLMが返す参照元は、そのままでは信用できません。今回の検索結果と突き合わせる約15行(空行除く)の検証関数を出口に置くと、検索段階で権限フィルタをかけている場合に、捏造された引用や権限外の引用を防げます。内容の正しさまでは保証できないので、評価用データでの確認と併用するのが現実的です。
