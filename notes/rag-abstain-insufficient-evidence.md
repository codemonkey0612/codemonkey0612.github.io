---
title: RAGの回答を「分からない」で止める：根拠不足の判定をPythonで実装する
status: ready
hashtags:
  - rag
  - llm
  - python
  - ai
url: https://note.com/shanaiai/n/n641dd5cc9d23
cover: covers/1351631.jpg
note_id: "191000080"
note_key: n641dd5cc9d23
note_hash: cc13d25e55ea
---
<!-- crossposted from articles/rag-abstain-insufficient-evidence.md: edit the Zenn article, not this copy -->
社内文書のRAGを作ると、資料に書かれていないことまで、もっともらしく答えてしまう場面に出会います。プロンプトで「分からなければ分からないと答えて」と書いても、完全には止まりません。

結論から言うと、回答を控える判断はLLMの良心に任せず、アプリケーション側のコードで行うのが確実です。本記事では「検索スコアと件数の関門」「根拠チェック」「評価用質問での閾値調整」の3段構えを、PythonとFastAPIで実装します。

## なぜRAGは根拠がなくても答えてしまうのか

原因は主に3つあります。

- ベクトル検索は、どんなに無関係な質問でも必ず上位の数件を返す。「該当なし」という結果が仕組み上ない。
- LLMに渡した文脈が的外れでも、モデルは文脈と自分の知識を混ぜて、それらしい文章を作れる。
- プロンプトの指示は確率的に効くだけで、保証ではない。

つまり「検索結果が返ってきた」ことは「根拠がある」ことを意味しません。この差を埋めるのが、生成の前後に置く判定です。

## 判定の3段構え：検索スコア・件数・根拠チェック

### 第1段：検索スコアと件数（生成前）

最上位チャンクのスコアが低ければ、そもそも関連文書がありません。また、スコアが高いチャンクが1件だけの場合、たまたま語彙が似ただけの可能性があります。そこで次の2条件を見ます。

- 最上位スコアが `top_score_min` 以上であること
- `hit_score_min` 以上のチャンクが `min_hits` 件以上あること

この段階は、LLMを呼ぶ前に落とせるため、コストも速度も有利です。

### 第2段：根拠チェック（生成後）

スコアが高くても、質問の答えがその文書に書かれているとは限ります。そこで、LLMに「答えられるか」「根拠となる原文の引用」をJSONで返させます。次に、引用が本当に検索結果の中に存在するかをコードで照合します。存在しない引用があれば、回答を破棄します。

### 第3段：評価用の質問セットで閾値を決める

閾値はモデルや埋め込みの種類、文書の性質で変わります。他所の値を流用せず、自分のデータで決める必要があります。これは後の章で扱います。

## Pythonでの実装例（FastAPIで検索結果を判定する）

まず、第1段の判定です。スコアは「大きいほど類似」（コサイン類似度）とします。距離を返す検索基盤なら、変換してから渡してください。

```python:gate.py
from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    id: str
    source: str
    text: str
    score: float  # コサイン類似度。大きいほど近い


@dataclass(frozen=True)
class Policy:
    # 以下は仮の初期値です。評価セットで必ず調整します
    top_score_min: float = 0.55
    hit_score_min: float = 0.45
    min_hits: int = 2


def retrieval_gate(chunks: list[Chunk], policy: Policy) -> tuple[bool, str]:
    """生成前の判定。(通過したか, 理由コード) を返す。"""
    if not chunks:
        return False, "no_chunks"
    top = max(c.score for c in chunks)
    if top < policy.top_score_min:
        return False, "low_top_score"
    hits = [c for c in chunks if c.score >= policy.hit_score_min]
    if len(hits) < policy.min_hits:
        return False, "few_hits"
    return True, "ok"
```

理由コードを返すのが要点です。後でログを集計し、どの関門で断ったかを分析できます。

次に、第2段の根拠チェックです。引用の照合は、全角半角や空白の揺れを正規化してから行います。

```python:grounding.py
import json
import re
import unicodedata

from openai import OpenAI

from gate import Chunk

client = OpenAI()  # APIキーは環境変数から読み込まれます

SYSTEM = """あなたは社内文書の回答担当です。
与えられた【文脈】だけを根拠に答えてください。
文脈に答えが無い場合は answerable を false にしてください。
必ず次のJSONだけを返してください。
{"answerable": bool, "answer": str, "quotes": [str]}
quotes には、答えの根拠となる文脈の原文を、一字一句そのまま抜き出して入れてください。"""


def norm(s: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def build_context(chunks: list[Chunk]) -> str:
    return "\n\n".join(f"[{c.id}] {c.text}" for c in chunks)


def generate(question: str, chunks: list[Chunk], model: str) -> dict:
    res = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": f"【文脈】\n{build_context(chunks)}\n\n【質問】\n{question}",
            },
        ],
    )
    return json.loads(res.choices[0].message.content)


def quotes_are_grounded(quotes: list[str], chunks: list[Chunk]) -> bool:
    if not quotes:
        return False
    corpus = norm("".join(c.text for c in chunks))
    return all(norm(q) and norm(q) in corpus for q in quotes)
```

LLMに「一字一句そのまま」と指示しても、微妙に言い換える場合があります。その場合は断る側に倒れます。これは安全側の失敗なので、後述する誤拒否率で観測します。

最後に、FastAPIでつなぎます。`search` は自分の検索基盤に差し替えるスタブです。

```python:main.py
import logging
import os

from fastapi import FastAPI
from pydantic import BaseModel

from gate import Chunk, Policy, retrieval_gate
from grounding import generate, quotes_are_grounded

app = FastAPI()
policy = Policy()
MODEL = os.environ["ANSWER_MODEL"]
REFUSAL = "ご質問に答えられる根拠が、登録された文書から見つかりませんでした。"
log = logging.getLogger("rag")


def search(question: str, k: int = 5) -> list[Chunk]:
    raise NotImplementedError  # ベクトル検索に差し替える


class Ask(BaseModel):
    question: str


@app.post("/ask")
def ask(body: Ask):
    chunks = search(body.question)
    top = max((c.score for c in chunks), default=0.0)

    passed, reason = retrieval_gate(chunks, policy)
    if not passed:
        log.info("refuse reason=%s top=%.3f q=%s", reason, top, body.question)
        return {"answer": REFUSAL, "sources": [], "refused": True}

    out = generate(body.question, chunks, MODEL)
    if not out.get("answerable") or not quotes_are_grounded(
        out.get("quotes", []), chunks
    ):
        log.info("refuse reason=ungrounded top=%.3f q=%s", top, body.question)
        return {"answer": REFUSAL, "sources": [], "refused": True}

    sources = sorted({c.source for c in chunks})
    log.info("answer top=%.3f q=%s", top, body.question)
    return {"answer": out["answer"], "sources": sources, "refused": False}
```

ログに質問文をそのまま残す場合は、個人情報や機密の扱いを事前に決めてください。

## 閾値は評価用の質問セットで決める

初期値のまま本番に出すのは避けます。次の2種類の質問を用意します。

- 答えられる質問：文書に答えがある。期待する参照元も付けておく
- 答えてはいけない質問：文書に答えが無い。関連語は含むが答えは無い質問を多めにする

後者は「近いのに答えが無い」質問が最も大切です。たとえば社内規程の検索なら、「出張時の宿泊費上限」は載っているのに「海外赴任時の住居手当」は載っていない、という具合の質問です。無関係な質問は第1段で簡単に落ちるので、閾値の調整には役に立ちません。

検索結果を質問ごとに保存しておけば、閾値の探索はLLMを呼ばずに回せます。

```python:tune.py
import itertools

from gate import Chunk, Policy, retrieval_gate


def evaluate(rows: list[dict], policy: Policy) -> tuple[float, float]:
    """rows: {"answerable": bool, "chunks": list[Chunk]}
    戻り値は (誤拒否率, 誤回答率)。"""
    n_ok = n_ng = false_refuse = false_answer = 0
    for r in rows:
        passed, _ = retrieval_gate(r["chunks"], policy)
        if r["answerable"]:
            n_ok += 1
            false_refuse += not passed
        else:
            n_ng += 1
            false_answer += passed
    return false_refuse / max(n_ok, 1), false_answer / max(n_ng, 1)


def grid(rows, max_false_answer=0.05):
    best = None
    for top, hit, hits in itertools.product(
        [x / 100 for x in range(40, 80, 5)],
        [x / 100 for x in range(30, 70, 5)],
        [1, 2, 3],
    ):
        p = Policy(top, hit, hits)
        fr, fa = evaluate(rows, p)
        if fa <= max_false_answer and (best is None or fr < best[0]):
            best = (fr, fa, p)
    return best
```

誤回答率の上限を先に決め、その条件で誤拒否率が最小になる組み合わせを選ぶ設計です。上限の値（ここでは例として0.05）は、業務の重さで決めてください。

### トレードオフ

閾値を上げると、誤回答は減りますが、誤拒否が増えます。両者はゼロにできません。社内ヘルプデスクの一次回答なら、少し緩めて参照元で確認させる運用が成立します。規程や契約を扱う用途では、厳しめにして「担当者へ確認」の導線を置く方が安全です。

質問セットが少ないと、閾値は過学習します。調整用と検証用に分けて、検証用では閾値を動かさずに確認してください。

## 失敗パターンと本番での運用

### 誤って断る

- 質問が短すぎて、スコアが全体的に低くなる
- 答えが複数文書に分散していて、`min_hits` を満たしても根拠の引用が揃わない
- 表やPDF抽出の崩れで、原文の引用が照合に失敗する

対策は、断った質問と理由コードを集計することです。`few_hits` が多ければチャンク分割や検索件数を見直します。`ungrounded` が多ければ、テキスト抽出の品質か、引用の正規化を疑います。

### 誤って答える

- 古い版と新しい版の文書が混在していて、古い内容で答える
- 質問と同じ語を含むだけの別の話題の文書で、スコアが高くなる
- 引用は正しいが、質問の条件（対象部署や期間）を取り違えている

最後のパターンは、文字列照合では防げません。権限や版管理はメタデータでの絞り込みで対応し、重要な回答は参照元の確認を前提にします。誤回答の報告を受けたら、その質問を「答えてはいけない質問」へ加えるのが基本です。

## 参照元表示とログで改善を回し続ける

回答を控える仕組みは、一度作って終わりではありません。私が関わったRAG文書解析システムの開発（中堅企業向け）でも、回答に参照元を表示し、情報が足りないときは回答を控える設計にしました。そのうえで、評価用の質問データを使って検索精度と回答品質の改善を繰り返しました。マルチテナントのAI業務基盤の開発でも、参照元表示とログ管理、評価用データセットでの品質検証を整備しています。

運用では、次の流れを回します。

- 参照元をすべての回答に表示し、利用者が原文を確認できるようにする
- 質問、最上位スコア、判定理由、参照元IDをログに残す
- 週次などで、断った質問と「役に立たなかった」報告を確認する
- 見つかった失敗を評価セットに追加し、閾値を再計算する
- 文書やモデルを変えたときは、必ず評価セットで回帰を確認する

## まとめ

- RAGは、検索が必ず何かを返すため、根拠がなくても答えられてしまう。
- 判定は、検索スコアと件数、根拠の引用照合の二重で、コード側に持たせる。
- 閾値は、答えられる質問と答えてはいけない質問の評価セットで決める。
- 誤拒否と誤回答はトレードオフなので、業務の重さで許容度を先に決める。
- 理由コード付きのログと参照元表示で、失敗を評価セットへ戻し続ける。

---

私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。回答を控える判定や評価セットの設計は、社内文書RAGを安心して使える品質にするための中心的な作業です。
→ [AIチャットボット・社内文書検索（RAG）について](https://shanaiai.com/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
