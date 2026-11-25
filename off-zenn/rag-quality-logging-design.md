---
title: LLM APIのエラー監視で、RAGの「静かな品質劣化」に気づく：ログ設計を私ならこう決める
emoji: 🔍
type: tech
topics:
  - rag
  - llm
  - python
  - fastapi
  - observability
published: true
published_at: 2026-11-27 09:00
---

RAGの運用で本当に怖いのは、500エラーではありません。HTTP 200で返ってきた「それらしいが的外れな回答」です。この記事では、エラー監視だけでは見えない品質劣化に気づくために、私ならどんなログを残すかをFastAPIのコードで示します。RAGを本番運用している、またはこれから出す方で、監視設計に迷っているエンジニアに向けて書いています。

結論から言うと、ログは「リクエスト・検索・生成・判定」の4分類に分け、判定ログに品質の代理指標を入れます。それをテナント別・参照元別に集計し、評価用の質問セットと同じ形式で比べられるようにします。

## RAGはエラーにならないまま品質が落ちる

通常のAPI監視は、エラー率とレイテンシを見れば足ります。LLM APIの429や5xx、タイムアウトは確かに監視すべきです。しかし、それだけではRAGの劣化は拾えません。

たとえば次のような変化は、すべてHTTP 200のまま起きます。

- 文書の更新でチャンク分割の結果が変わり、検索が関係ない段落を返すようになる
- 特定テナントの文書だけ取り込みに失敗し、インデックスが古いままになる
- モデルやプロンプトを変えた後、参照元に触れない回答が増える
- 検索ヒットが弱いのに、LLMが一般論で埋めて答えてしまう

これらはユーザーの「なんか役に立たない」という感覚でしか表に出ません。気づいたときには、すでに利用が減っています。

私はマルチテナントのAI SaaSと、社内文書向けのRAG文書解析システムの開発に関わりました。マルチテナントのAI SaaSでは、参照元表示、ログ管理、エラー監視、評価用データでの品質検証を整備しました。RAG文書解析システムでは、参照元表示と評価用質問での改善に取り組みました。その経験から、「例外にならない失敗」を数値に落とす仕組みが要ると考えています。以下は、その考え方をコードにしたものです。個別案件の実装そのものではありません。

## 残すログの4分類：リクエスト・検索・生成・判定

1回の質問に対して、同じ `request_id` でつながる4種類のイベントを出します。

### 1. リクエストログ

誰が、いつ、どの経路で聞いたかです。

- request_id、tenant_id、user_id（内部ID）、ロール
- クエリの文字数、クエリのHMACハッシュ
- 評価実行かどうか（eval_run_id）

### 2. 検索ログ

検索が何を返したかです。劣化の原因は多くがここにあります。

- ヒット件数、上位の件の doc_id と chunk_id とスコア
- 権限フィルタ適用後の件数
- インデックスのバージョンや取り込み日時

### 3. 生成ログ

LLM呼び出しの実測値です。

- モデル名、プロンプトのバージョン名
- 入力・出力トークン数、所要時間
- リトライ回数、finish_reason、APIエラー種別

### 4. 判定ログ

私が最も重視する分類です。回答の質を機械的に判定できる範囲で数値化します。

- 回答を控えたか（no_answer）
- 回答が参照元IDを引用しているか
- 引用した参照元が、実際に検索結果に含まれているか
- 上位1件のスコアが閾値未満か

判定ログは完璧な品質評価ではありません。あくまで「普段と違う」ことに気づくための代理指標です。

## FastAPIで構造化ログを出す実装例

標準の `logging` だけで、JSON Lines形式のログを出します。外部ライブラリなしなので、バージョン差で壊れにくい構成です。

### ログの基盤

```python:logging_setup.py
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        payload.update(getattr(record, "fields", {}))
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("rag")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False


def log_event(event: str, **fields) -> None:
    logging.getLogger("rag").info(event, extra={"fields": fields})
```

`event` にイベント名を、`fields` に任意の項目を入れます。標準出力に出せば、コンテナ環境ではログ基盤が拾えます。

### アプリ本体

request_id は `contextvars` で持ち回します。こうすると、各関数に引数で渡さなくても全イベントに同じIDが付きます。

```python:main.py
import hashlib
import hmac
import os
import time
import uuid
from contextvars import ContextVar

from fastapi import FastAPI, Header, Request
from pydantic import BaseModel

from logging_setup import log_event, setup_logging

setup_logging()
app = FastAPI()

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
HASH_KEY = os.environ.get("LOG_HASH_KEY", "dev-only").encode()
LOW_SCORE = 0.35  # 運用で見直す仮の閾値


def emit(event: str, **fields) -> None:
    log_event(event, request_id=request_id_var.get(), **fields)


def hash_query(text: str) -> str:
    norm = " ".join(text.split()).lower()
    return hmac.new(HASH_KEY, norm.encode(), hashlib.sha256).hexdigest()[:16]


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id_var.set(request.headers.get("x-request-id") or uuid.uuid4().hex)
    response = await call_next(request)
    response.headers["x-request-id"] = request_id_var.get()
    return response


class AskBody(BaseModel):
    question: str


# 以下の3関数は差し替え前提のスタブです
def retrieve(tenant_id: str, question: str) -> list[dict]:
    return [{"doc_id": "doc-1", "chunk_id": "c-3", "score": 0.52}]


def generate(question: str, hits: list[dict]) -> dict:
    return {
        "text": "回答本文 [doc-1]",
        "cited": ["doc-1"],
        "model": "your-model",
        "prompt_version": "v3",
        "input_tokens": 900,
        "output_tokens": 120,
    }


@app.post("/ask")
def ask(
    body: AskBody,
    x_tenant_id: str = Header(),  # 実運用では認証トークンから取得する
    x_eval_run: str | None = Header(default=None),
):
    emit(
        "request",
        tenant_id=x_tenant_id,
        query_len=len(body.question),
        query_hash=hash_query(body.question),
        eval_run_id=x_eval_run,
    )

    t0 = time.perf_counter()
    hits = retrieve(x_tenant_id, body.question)
    emit(
        "retrieval",
        tenant_id=x_tenant_id,
        hit_count=len(hits),
        top=[{"doc": h["doc_id"], "chunk": h["chunk_id"], "score": h["score"]} for h in hits[:5]],
        latency_ms=int((time.perf_counter() - t0) * 1000),
    )

    t1 = time.perf_counter()
    out = generate(body.question, hits)
    emit(
        "generation",
        tenant_id=x_tenant_id,
        model=out["model"],
        prompt_version=out["prompt_version"],
        input_tokens=out["input_tokens"],
        output_tokens=out["output_tokens"],
        latency_ms=int((time.perf_counter() - t1) * 1000),
    )

    hit_docs = {h["doc_id"] for h in hits}
    cited = set(out["cited"])
    top1 = hits[0]["score"] if hits else 0.0
    emit(
        "verdict",
        tenant_id=x_tenant_id,
        eval_run_id=x_eval_run,
        no_answer=not out["text"],
        has_citation=bool(cited),
        citation_valid=cited <= hit_docs,
        top1_score=top1,
        low_score=top1 < LOW_SCORE,
    )
    return {"answer": out["text"], "sources": sorted(cited)}
```

ポイントは3つあります。

- `verdict` に、エラーでは出ない品質の兆候をまとめて入れている。特に `citation_valid` は、検索結果にない文書を引用していないかを見る指標である
- `tenant_id` を全イベントに入れている。テナント別集計の前提になる
- クエリ本文は出さず、長さとHMACハッシュだけである。理由は後述する

実際には、LLMのAPIエラーも `generation` 側で `try/except` して `error_type` を残します。例外を握りつぶさず、ログを出して再送出するのが基本です。

## テナント別・参照元別に集計して異常に気づく

JSON Linesをログ基盤からPostgreSQLなどに取り込めば、SQLで集計できます。ここでは `rag_verdict` というテーブルに判定ログが入っている前提です。

```sql
-- テナント別・日別の品質指標
SELECT
  date_trunc('day', ts)                          AS day,
  tenant_id,
  count(*)                                       AS asks,
  avg(top1_score)                                AS avg_top1,
  avg((low_score)::int)                          AS low_score_rate,
  avg((NOT has_citation)::int)                   AS no_citation_rate,
  avg((NOT citation_valid)::int)                 AS bad_citation_rate,
  avg((no_answer)::int)                          AS no_answer_rate
FROM rag_verdict
WHERE eval_run_id IS NULL
  AND ts >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY 2, 1;
```

見るべきは絶対値より、同じテナントの過去との差です。テナントごとに文書の質も質問の傾向も違います。全体平均だけを見ると、1社の劣化が薄まって見えなくなります。

私なら、まず次の2つにアラートを置きます。

- low_score_rate が、そのテナントの直近2週間平均から大きく上がった
- bad_citation_rate が0を超えた

### 参照元別に見る

検索ログの `top` には doc_id が入っています。これを展開すれば、どの文書がよく引かれ、どの文書が低スコアで引かれているかが分かります。

- 特定の文書だけ低スコアで頻出するなら、抽出やチャンク分割に問題がある可能性がある
- 長期間まったく引かれない文書は、取り込み漏れを疑える
- 引用が1文書に偏り始めたら、検索の多様性が落ちているかもしれない

これは原因の仮説を立てるための材料です。確定には、実際の文書と突き合わせる必要があります。

## 評価用の質問セットと本番ログをつなぐ

本番ログだけでは「良い状態」の基準がありません。そこで、正解の分かっている評価用の質問セットを、同じAPIに流します。

```python:run_eval.py
import json
import uuid

import httpx

run_id = f"eval-{uuid.uuid4().hex[:8]}"

with open("eval_set.jsonl", encoding="utf-8") as f:
    cases = [json.loads(line) for line in f]

with httpx.Client(base_url="http://localhost:8000", timeout=60) as client:
    for c in cases:
        r = client.post(
            "/ask",
            json={"question": c["question"]},
            headers={"x-tenant-id": c["tenant_id"], "x-eval-run": run_id},
        )
        r.raise_for_status()
        got = set(r.json()["sources"])
        ok = bool(got & set(c["expected_docs"]))
        print(json.dumps({"id": c["id"], "run": run_id, "hit": ok}))
```

`eval_set.jsonl` には、質問、テナントID、正解として期待する文書IDを1行1件で持たせます。このスクリプトは、期待した文書が引用に含まれたかだけを判定します。回答文の正しさまでは見ません。

大事なのは、評価実行にも `eval_run_id` を付けて同じログ経路を通すことです。これで次のことができます。

- 評価時の `top1_score` の分布と、本番の分布を並べて比べられる
- プロンプトやモデル変更の前後で、評価の命中率とログ指標を同時に見られる
- 本番集計では `eval_run_id IS NULL` で評価トラフィックを除外できる

評価で命中率が保たれているのに本番の低スコア率だけ上がるなら、ユーザーの質問傾向が変わったか、評価セットが現実とずれています。その場合は本番で低スコアだった質問を、人が確認して評価セットに足します。この往復が品質改善の本体だと私は考えています。

## 個人情報・機密を残さないための割り切り

社内文書RAGでは、質問も回答も機密を含みえます。ログに本文を残すと、ログ基盤が新しい漏えい経路になります。マルチテナントなら、テナントをまたいで見えてしまう事故にもなりえます。

私なら次のように割り切ります。

- 質問と回答の本文は、通常ログに残さない
- 代わりに、文字数・HMACハッシュ・doc_id・スコアを残す
- ハッシュは秘密鍵付きにする。単純なSHA-256だと、短い定型文は推測で逆引きされうるためである
- 本文が必要な調査は、期間と閲覧者を限定した別の保管先で行う
- ログの保持期間は、短い期間から始めて必要なら延ばす

HMACハッシュがあれば、同じ質問が何度も来ているかを本文なしで数えられます。「よく聞かれるのに低スコアな質問」は、ハッシュで特定し、必要なときだけ人が経緯を確認できます。

この割り切りには代償があります。本文がないので、個別の回答の良し悪しは、ログだけでは判断できません。それでも、最初は漏らさないことを優先するほうが安全だと考えます。保持期間や本文の扱いは、契約や社内規程に従って決めてください。

## 私なら最初に入れるログと、まだ入れないログ

### 最初に入れるもの

- request_id と tenant_id が全イベントに入る仕組み
- 検索ログのヒット件数と上位スコア、doc_id
- 判定ログの no_answer、has_citation、citation_valid、low_score
- 生成ログのトークン数、所要時間、APIエラー種別
- 評価実行を区別する eval_run_id

私なら、小さな構成であれば1日程度を目安にします（環境次第です）。それでも、劣化に気づく力は大きく変わります。

### まだ入れないもの

- 回答本文の全文保存。機密リスクと保管コストが先に来る
- LLMによる自動採点を全リクエストに行うこと。コストが増え、採点自体のぶれも管理が必要なため、サンプリングで始める
- ユーザーの高評価・低評価ボタンの集計。UIの導入が必要なので後回しにする
- 埋め込みベクトルの保存。容量が大きく、最初の調査には不要である

運用が進んで「この指標だと原因が絞れない」と分かった時点で、足すべきログが見えてきます。先に全部入れるより、足りない理由を持って追加するほうが無駄がありません。

## まとめ

- RAGの品質劣化はHTTP 200のまま進むので、エラー監視だけでは足りない
- ログは、リクエスト・検索・生成・判定の4分類で、同じ request_id でつなぐ
- 判定ログに、引用の有無や妥当性、低スコア率を入れて異常の代理指標にする
- テナント別に過去との差を見て、評価用質問セットと同じ経路で基準を作る
- 本文は残さず、ハッシュとIDとスコアで運用するのが私の初期方針である

閾値や指標は、文書の性質で変わります。この記事のコードは出発点として使い、自分の環境の数字で調整してください。

---

私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。RAGは公開後の品質監視まで設計して初めて使い続けられる仕組みになるため、ログ設計や評価セットの整備も含めてご相談いただけます。
→ [AIチャットボット・社内文書検索（RAG）について](https://shanaiai.com/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
