---
title: 社内文書RAGで「参照元つき・根拠不足は回答を控える」を選んだ理由と、評価用質問で改善を回した話
emoji: 📚
type: tech
topics:
  - rag
  - llm
  - python
  - ai
published: true
published_at: 2026-11-21 09:00
---

社内文書RAGでは、精度を上げる前に「間違え方」を先に決めることが最初の一手になると、私は考えています。私が担当した中堅企業向けの文書解析RAGでは、回答に参照元を必ず表示し、情報が足りないときは回答を控える仕組みにしました。そのうえで評価用の質問データを作り、検索精度と回答品質の改善を繰り返しました。この記事は、社内文書RAGを作り始める、または誤回答の不安で止まっているエンジニア向けです。最後に、同じ課題に直面したときに私が最初にやることと、動くコード例も載せます。

## 最初の状況：形式も書き方もばらばらな文書と、誤回答の不安

案件は「中堅企業向けChatGPT・RAG文書解析システム開発」です。期間は2023年4月から2024年3月で、体制は6名でした。内訳はPM1名、AIエンジニア2名、Webエンジニア2名、業務担当1名です。私はAIエンジニアとして、RAG設計、文書取り込み、テキスト抽出、ベクトル検索、LLM API連携、フロント・バックエンド開発を担当しました。

課題は大きく二つありました。

- 文書ごとに形式や書き方が違い、必要な情報を正確に探しにくいこと
- 生成AIの誤回答と、参照元を確認できない問題への対策が必要なこと

担当者は大量の資料を1件ずつ確認していました。そこに生成AIを入れても、答えが間違っているかもしれず、根拠も見えなければ、結局は原本を開いて確かめ直すことになります。これでは負担が減りません。

使った技術は、Python、FastAPI、OpenAI API、LangChain、PostgreSQL、React、AWSです。

## 検討した選択肢：精度を上げる前に「間違え方」を決める

RAGの改善というと、埋め込みモデルの変更やチャンク分割の調整など、精度を上げる話から入りがちです。しかし私は、精度を100%にはできない前提で設計する方が先だと考えます。

誤りには、大きく二種類あります。

- 根拠のない内容を、もっともらしく答えてしまう誤り
- 文書に答えがあるのに、見つけられない誤り

業務で怖いのは前者です。後者は「見つかりませんでした」と返せば、人が原本を探せば済みます。前者は利用者が信じてしまうため、気づかれないまま使われます。

そこで方針を次のように整理しました。

- 間違えるなら「答えない」側に倒す
- 答えるときは、利用者が自分で検証できるようにする
- 改善は感覚ではなく、評価用の質問で測って回す

この三つが、後述する「選んだこと」の①〜③に対応します。

## 選んだこと①：回答に参照元を必ず表示する

参照元の表示は、誤回答の対策であると同時に、利用者の確認コストを下げる機能でもあります。回答の横に出典があれば、全文を読み直さずに該当箇所だけ見ればよくなります。

実装で大事なのは、参照元を「LLMに書かせる」のではなく「システムが管理する」ことです。LLMが書いた出典名は、実在しない文書名になることがあります。私なら次の流れにします。

- 取り込み時に、各チャンクへ文書ID・ファイル名・ページ番号などのメタデータを付ける
- 検索結果のチャンクに連番を振り、プロンプトに渡す
- LLMには、使った連番だけを答えさせる
- 返ってきた連番が検索結果に存在するかをコードで検証する
- 表示する出典は、連番からメタデータを引いて組み立てる

これなら、存在しない参照元が画面に出ることはありません。

### 取り込み時のメタデータ

PDFやOffice文書は、抽出したテキストにページや見出しの位置情報を残しておきます。後から付け直すのは困難です。次は、たとえばのデータ構造です。

```python:models.py
from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    chunk_id: str      # 例: "doc123-p5-c2"
    doc_id: str
    file_name: str
    page: int | None   # Office文書などでページがなければ None
    text: str
    score: float       # 類似度（大きいほど近い）
```

`score` は検索時に埋めます。次の「回答を控える」判定で使います。

### 参照元を検証しながら回答を作る

次のコードは、検索済みのチャンクからLLMに回答させ、引用番号を検証します。OpenAI Python SDK（v1以降）の `chat.completions` を使った例です。モデル名は環境変数から読みます。

```python:answer.py
import json
import os

from openai import OpenAI

from models import Chunk

client = OpenAI()  # APIキーは環境変数 OPENAI_API_KEY から読まれる
MODEL = os.environ["ANSWER_MODEL"]

SYSTEM = """あなたは社内文書の検索アシスタントです。
次のルールを守ってください。
- 回答は、渡された資料の内容だけに基づくこと
- 資料から答えられない場合は answerable を false にすること
- 回答に使った資料の番号を citations に入れること
JSONのみで出力します。
形式: {"answerable": bool, "answer": str, "citations": [int]}"""


def build_context(chunks: list[Chunk]) -> str:
    return "\n\n".join(f"[{i}] {c.text}" for i, c in enumerate(chunks, start=1))


def generate(question: str, chunks: list[Chunk]) -> dict:
    res = client.chat.completions.create(
        model=MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": f"資料:\n{build_context(chunks)}\n\n質問: {question}",
            },
        ],
    )
    data = json.loads(res.choices[0].message.content)

    valid = [n for n in data.get("citations", []) if 1 <= n <= len(chunks)]
    if data.get("answerable") and not valid:
        # 回答するのに根拠番号がない場合は、控える側に倒す
        return {"answerable": False, "answer": "", "sources": []}

    return {
        "answerable": bool(data.get("answerable")),
        "answer": data.get("answer", ""),
        "sources": [
            {"file": chunks[n - 1].file_name, "page": chunks[n - 1].page}
            for n in valid
        ],
    }
```

ポイントは三つです。

- `temperature=0` で出力のぶれを抑え、評価の比較をしやすくする
- 範囲外の引用番号は捨てる
- 回答するのに有効な引用が一つもなければ、回答を控える扱いにする

最後の点が、①と②をつなぐ部分です。

## 選んだこと②：情報が足りないときは回答を控える

回答を控える判定は、一段ではなく二段で持つのが安全だと私は考えます。

- 検索段階：上位チャンクの類似度が低ければ、LLMを呼ばずに控える
- 生成段階：LLM自身が「資料から答えられない」と判断したら控える

さらに前節のとおり、引用が検証できない場合も控えます。

### 検索段階の判定

```python:guard.py
from models import Chunk

MIN_SCORE = 0.35   # 仮の値。評価用データで決める
MIN_HITS = 1


def enough_evidence(chunks: list[Chunk]) -> bool:
    hits = [c for c in chunks if c.score >= MIN_SCORE]
    return len(hits) >= MIN_HITS


def answer_question(question: str, chunks: list[Chunk]) -> dict:
    from answer import generate

    if not enough_evidence(chunks):
        return {
            "answerable": False,
            "answer": "該当する情報が文書内に見つかりませんでした。",
            "sources": [],
        }
    result = generate(question, [c for c in chunks if c.score >= MIN_SCORE])
    if not result["answerable"]:
        result["answer"] = "文書内の情報だけでは回答できません。"
    return result
```

`MIN_SCORE = 0.35` は説明用の仮の値です。この閾値は、埋め込みモデルや類似度の種類（コサイン類似度か距離か）で意味が変わります。他の環境の値は流用できません。決め方は次の節の評価用データで行います。

### 控え方の設計

控えたときの画面も設計対象です。単に「分かりません」だけだと、利用者は次の行動に困ります。私なら、次を返します。

- 控えた理由（該当情報なし、または根拠不足）
- 検索で見つかった、近い文書の候補（あれば）
- 質問の言い換えの提案

これにより、「答えない」ことが行き止まりではなく、原本に当たるための入口になります。

## 選んだこと③：評価用の質問データで検索精度と回答品質を繰り返し改善

参照元表示と回答の抑制を入れても、閾値やチャンク分割が適切かは測らないと分かりません。そこで評価用の質問データを使い、改善を回しました。ここから先の具体的な指標や閾値は、私が「こうする」という設計案です。

### 評価データの作り方

最低限、次の項目を持つ質問集を用意します。

- 質問文
- 正解が載っている文書IDとページ（答えられる質問の場合）
- 答えられない質問かどうかのフラグ

「答えられない質問」を混ぜるのが重要です。これがないと、控える仕組みの良し悪しを測れません。質問は、業務担当の方に実際に聞きたいことを出してもらうのが近道です。手元で作るなら、文書の表現と違う言い回しの質問も混ぜます。

```jsonl:eval/questions.jsonl
{"id": "q001", "question": "出張の宿泊費の上限はいくらですか", "answerable": true, "gold_doc_ids": ["doc-travel-rules"]}
{"id": "q002", "question": "来期の採用目標人数を教えてください", "answerable": false, "gold_doc_ids": []}
```

上の2行は、形式を示すための架空の例です。

### 測る指標

指標は、検索と回答を分けて見ます。

- 検索：正解文書が上位の数件に入った割合（ヒット率）
- 控え：答えられない質問で正しく控えた割合
- 誤回答：答えられるのに控えた割合、答えるべきでない質問に答えた割合

```python:eval/run_eval.py
import json
import sys

from guard import answer_question


def load(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def run(path: str, search) -> None:
    """search(question) -> list[Chunk] を呼び出し側から渡す"""
    rows = load(path)
    hit = hit_total = 0
    refuse_ok = refuse_total = 0
    over_refuse = answer_total = 0

    for r in rows:
        chunks = search(r["question"])
        result = answer_question(r["question"], chunks)

        if r["answerable"]:
            answer_total += 1
            hit_total += 1
            if {c.doc_id for c in chunks} & set(r["gold_doc_ids"]):
                hit += 1
            if not result["answerable"]:
                over_refuse += 1
        else:
            refuse_total += 1
            if not result["answerable"]:
                refuse_ok += 1

    print(f"検索ヒット率: {hit}/{hit_total}")
    print(f"正しく控えた: {refuse_ok}/{refuse_total}")
    print(f"答えるべきなのに控えた: {over_refuse}/{answer_total}")


if __name__ == "__main__":
    from my_search import search  # 自前の検索関数
    run(sys.argv[1], search)
```

ここでは回答の中身の正誤は、人の目で確認する前提にしています。件数が少ないうちは、人が読んで〇×を付ける方が確実です。

### 改善ループの回し方

私なら、次の順で一度に一つだけ変えます。

- 評価を走らせ、失敗した質問を一覧にする
- 失敗を「検索で拾えていない」「拾えているが答えが間違い」「控えすぎ・控えなさすぎ」に分類する
- 原因に対応する一か所だけを変える
- 再度評価し、他の質問が悪化していないか確認する

変える箇所の候補は次のとおりです。

- 検索で拾えない：チャンクの大きさと重なり、テキスト抽出の品質、表や見出しの扱い
- 拾えているのに誤る：プロンプト、渡すチャンク数
- 控え方の偏り：閾値

形式がばらばらな文書では、テキスト抽出の失敗が原因のことが多いのではないかと考えます。表が崩れて文字列になっていないかを、先に目で確認します。

## 結果：資料を1件ずつ確認する負担の軽減

この案件の成果は、担当者が大量の資料を1件ずつ確認する負担を減らし、社内文書の活用を効率化できたことです。数値での削減率は、ここでは示しません。

私が振り返って大きかったと考えるのは、利用者が「答えを信じるか、原本を見るか」を判断できる状態にしたことです。参照元があれば確認は該当箇所だけで済みます。控える場合は、AIが推測で埋めないため、誤情報を前提に作業が進むリスクが下がります。

## 同じ課題に直面したら最初にやること

私なら、次の順で進めます。

- 誤り方の方針を決める：業務上、答えないのと間違えるのはどちらが痛いかを、業務担当と合意する
- 取り込み時にメタデータを付ける：文書ID、ファイル名、ページ位置を後付けしない
- 引用はコードで検証する：LLMが書いた出典名を、そのまま表示しない
- 控える条件を二段で持つ：検索スコアと、LLMの判断の両方を使う
- 評価用の質問を、まず20〜30件でも作る：答えられない質問を混ぜる。この件数は私の目安
- 一度に一つだけ変えて、毎回測る

### 落とし穴

- 閾値を他の環境の値から流用する：類似度の尺度が変わると意味が変わる
- 評価用質問を、文書の言い回しに寄せすぎる：実際の質問より簡単になり、精度が高く見える
- 控えすぎて使われなくなる：控え率も指標に入れ、利用者の声と併せて確認する
- 抽出品質を確認せずに検索だけ調整する：原因が別にあると、改善が進まない

## まとめ

社内文書RAGで最初にやるのは、精度の追求ではなく「間違え方」の設計です。参照元をシステム側で管理して表示し、根拠が足りなければ控え、評価用の質問で測りながら一つずつ直します。この三点を揃えると、利用者が確認しやすい形で、AIを業務に入れやすくなります。

---

私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。参照元表示や回答を控える設計、評価用質問による改善ループは、社内文書検索を実務で使える状態にするための中心になる部分です。
→ [AIチャットボット・社内文書検索（RAG）について](https://shanaiai.com/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
