---
title: 評価用の質問セットでRAGの検索精度を測る：Recall@kとMRRをPythonで実装
status: ready
hashtags:
  - rag
  - python
  - llm
  - evaluation
url: https://note.com/shanaiai/n/n38c2cef28f97
cover: covers/1351631.jpg
note_id: "191571578"
note_key: n38c2cef28f97
note_hash: 1a42410502f8
---
<!-- crossposted from articles/rag-retrieval-eval-recall-mrr.md: edit the Zenn article, not this copy -->
RAGのチャンクサイズを変えたり、ハイブリッド検索を入れたりして「前より良くなった気がする」で止まっていないでしょうか。数件の質問を手で試すだけでは、改善と悪化を区別できません。

結論から言うと、回答文ではなく検索段階を先に、固定した質問セットで測るのが近道です。指標は`Recall@k`とMRRの2つで足ります。どちらも数十行のPythonで実装できます。この記事では、質問セットの作り方、指標のコード、変更前後の比較、数値に表れない落とし穴までをまとめます。

## なぜ回答ではなく「検索」を先に測るのか

RAGの回答が悪いとき、原因は大きく2つに分かれます。必要な文書が検索で取れていないか、取れているのに生成側が使えていないかです。

回答を直接採点すると、この2つが混ざります。しかも回答の採点は人手かLLM判定になり、コストもぶれも大きくなります。

検索段階は違います。正解の文書が分かっていれば、上位`k`件に入ったかどうかを機械的に判定できます。実行は速く、結果は毎回同じで、CIにも載せられます。

検索で取れていないものは、生成側でどう工夫しても答えられません。だから私は、検索の数値を先に固めてから回答品質を見る順番にしています。

## 評価用の質問セットの作り方

### JSONLの形式

1行1問のJSONLにします。ポイントは、正解を「チャンクID」ではなく「文書ID（または節ID）」で持つことです。チャンクIDで持つと、チャンクサイズを変えた途端に正解ラベルが無効になり、設定間の比較ができなくなります。

```jsonl:eval.jsonl
{"id": "q001", "question": "有給休暇の申請は何日前までに必要ですか", "relevant_doc_ids": ["hr-rules-2025#leave"], "tags": ["規程", "言い換えなし"]}
{"id": "q002", "question": "出張時の宿泊費の上限を知りたい", "relevant_doc_ids": ["expense-policy#travel", "expense-policy#limits"], "tags": ["規程", "複数根拠"]}
{"id": "q003", "question": "VPNに繋がらないときの手順", "relevant_doc_ids": ["it-faq#vpn"], "tags": ["FAQ", "略語"]}
```

各項目の役割は次のとおりです。

- id：結果の差分を追うための固定キーである。
- question：実際のユーザーが書く言葉に近づける。
- relevant_doc_ids：正解となる文書や節のIDである。複数でも構わない。
- tags：あとで種類別に集計するための分類である。

### 作り方と件数

質問は、できれば実際の問い合わせ履歴や検索ログから集めます。文書から質問をLLMに作らせる方法もありますが、文書の言い回しをそのまま使った簡単な質問になりがちです。使うなら、人が必ず目を通して言い換えや曖昧な質問を足します。

件数に決まった正解はありません。少ないうちは1問の影響が大きいので、数値は確定した結果ではなく傾向として読みます。件数よりも偏りの管理が重要です。次の種類を混ぜてください。

- 文書の言葉をそのまま使う質問
- 言い換えや略語を含む質問
- 複数の文書にまたがる質問
- 答えが文書にない質問（検索評価からは外し、回答側のテストに回す）

質問セットは最初から完成させる必要はありません。本番で失敗した質問を足していく運用が、最も効きます。

## Recall@kとMRRをPythonで実装する

定義は次のとおりです。

- `Recall@k`：正解の文書のうち、上位`k`件に入った割合である。質問ごとに計算して平均する。
- MRR：最初に正解が現れた順位の逆数である。1位なら1、3位なら1/3、圏外なら0とし、質問ごとの値を平均する。

実装上の注意が一つあります。チャンク単位で検索すると、同じ文書が上位に複数並びます。文書IDに変換したあと、順序を保ったまま重複を除いてから測ります。

```python:metrics.py
import json
from collections import defaultdict
from typing import Callable

# retriever(question, top_n) -> 文書IDのリスト（スコア順。重複可）
Retriever = Callable[[str, int], list[str]]


def load_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def dedupe(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for x in ids:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        raise ValueError("relevant が空の質問は評価できません")
    return len(set(ranked[:k]) & relevant) / len(relevant)


def reciprocal_rank(ranked: list[str], relevant: set[str]) -> float:
    for rank, doc_id in enumerate(ranked, start=1):
        if doc_id in relevant:
            return 1.0 / rank
    return 0.0


def evaluate(retriever: Retriever, dataset: list[dict],
             ks=(1, 3, 5, 10), fetch_n: int = 50) -> dict:
    per_q = {}
    for row in dataset:
        relevant = set(row["relevant_doc_ids"])
        # チャンクの重複を除くため、多めに取ってから文書IDに畳む
        ranked = dedupe(retriever(row["question"], fetch_n))
        scores = {f"recall@{k}": recall_at_k(ranked, relevant, k) for k in ks}
        scores["mrr"] = reciprocal_rank(ranked, relevant)
        per_q[row["id"]] = scores

    summary = {
        m: sum(s[m] for s in per_q.values()) / len(per_q)
        for m in next(iter(per_q.values()))
    }
    return {"summary": summary, "per_question": per_q}


def summarize_by_tag(result: dict, dataset: list[dict], metric="recall@5"):
    groups = defaultdict(list)
    for row in dataset:
        for tag in row.get("tags", []):
            groups[tag].append(result["per_question"][row["id"]][metric])
    return {t: sum(v) / len(v) for t, v in groups.items()}
```

ここでは `retriever` を関数として受け取っています。ベクトル検索でもBM25でも、文書IDのリストを返せば同じ評価器で測れます。MRRは正解が複数あっても最初の1件だけを見る指標です。複数根拠が必要な質問は、`Recall@k`のほうを重視してください。

## チャンクサイズや検索方式を変えて比較する

比較で守るルールは「変えるのは1か所だけ」です。チャンクサイズと検索方式を同時に変えると、どちらが効いたのか分かりません。

### 設定ごとのretrieverを用意する

ベクトル検索とキーワード検索の結果を混ぜる方法として、順位だけを使うRRF（Reciprocal Rank Fusion）がよく使われます。スコアの尺度が違う検索同士でも、正規化せずに混ぜられるのが利点です。

```python:fusion.py
from collections import defaultdict


def rrf(rankings: list[list[str]], c: int = 60) -> list[str]:
    """複数の順位リスト（チャンクID）をRRFで統合する。"""
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] += 1.0 / (c + rank)
    return sorted(scores, key=scores.get, reverse=True)
```

定数 `c` は上位と下位の差をどれだけ効かせるかを決めるパラメータです。60がよく例に挙がりますが、固定せず評価セットで確かめるのが安全です。

### 差分を出して比較する

平均だけを見ると、一部の質問が悪化したことに気づけません。質問単位で差分を出します。

```python:compare.py
from metrics import load_jsonl, evaluate


def compare(base: dict, new: dict, metric: str = "recall@5"):
    print("--- summary ---")
    for m in base["summary"]:
        print(f"{m:10s} {base['summary'][m]:.3f} -> {new['summary'][m]:.3f}")

    worse = [
        (qid, base["per_question"][qid][metric], s[metric])
        for qid, s in new["per_question"].items()
        if s[metric] < base["per_question"][qid][metric]
    ]
    print(f"--- {metric} が悪化した質問: {len(worse)}件 ---")
    for qid, before, after in sorted(worse):
        print(qid, f"{before:.2f} -> {after:.2f}")


if __name__ == "__main__":
    dataset = load_jsonl("eval.jsonl")
    # build_retriever は自分の検索実装を返す関数（ここでは省略）
    # base = evaluate(build_retriever(chunk_size=800), dataset)
    # new = evaluate(build_retriever(chunk_size=400), dataset)
    # compare(base, new)
```

出力のイメージです。たとえば、チャンクサイズを小さくしてRecall@5が上がり、MRRはほぼ変わらず、3問だけ悪化した、という結果が出るとします。この場合は平均の上昇を喜ぶ前に、悪化した3問を開いて原因を確認します。

実験の記録として、設定（チャンクサイズ、オーバーラップ、埋め込みモデル名、検索件数、RRFの定数）と結果のJSONを、コミットハッシュと一緒に残しておくと後で再現できます。

## 数値が上がっても回答が悪くなるケースと見落としやすい失敗

検索の指標は回答品質の十分条件ではありません。よくある落とし穴を挙げます。

- チャンクを小さくして指標が上がったが、前後の文脈が切れて回答が不正確になる。検索は当たっても、LLMに渡る情報が足りない。
- 検索件数を大きくしてRecallが上がったが、ノイズが増えて回答が散漫になる。Recall@10だけで判断せず、実際にLLMへ渡す件数での`Recall@k`を見る。
- 正解ラベルが文書単位で粗すぎる。長い文書では、文書が当たっても該当箇所が渡っていない場合がある。節単位のIDにするなど、粒度を調整する。
- 評価セットへの過学習。同じ質問で何度も調整すると、その質問にだけ強くなる。調整用と最終確認用に分けておくと安全である。
- 答えが文書にない質問の扱い。検索指標では測れない。回答を控える挙動は、別のテストで確認する。

私の経験でも、検索精度の改善と回答品質の確認は別の作業でした。文書解析のRAG開発では評価用の質問データで検索精度と回答品質の改善を繰り返し、情報が足りないときは回答を控える仕組みも入れました。検索の数値は入口にすぎず、最終的には回答も見る必要があります。

## 本番運用での回帰テストと、私ならこうする

評価コードができたら、変更のたびに自動で走らせます。

1. 質問セットをリポジトリに置き、バージョン管理する。
2. 検索ロジック、チャンク設定、埋め込みモデルの変更時にCIで `evaluate` を実行する。
3. 基準値（直近のmainの結果）を保存し、Recall@5やMRRが一定以上下がったら失敗にする。
4. 悪化した質問のIDを、ログに出す。
5. 本番で「参照元が違う」と指摘された質問を、質問セットに追加する。

しきい値は、最初は緩めに決めます。評価セットが小さいうちは1問の影響が大きく、わずかな揺れで落ちると運用が続かないためです。

私ならこの順で始めます。まず小さな質問セットとRecall@5・MRRの計測だけを作ります。次に、チャンクサイズかハイブリッド検索のどちらか1つを試し、悪化した質問を読みます。その後に、CIへ載せます。マルチテナントのSaaS開発でも、評価用データセットでの品質検証を整備した経験から、この小さく始めて質問を育てる進め方が、続けやすいと感じています。

マルチテナントでは、テナントごとに文書も言い回しも違います。可能なら質問セットをテナント別に持ち、タグで集計できる形にしておくと、特定の顧客だけ悪化する問題に気づけます。

## まとめ

- 回答ではなく検索段階を先に測ると、原因の切り分けが速くなる。
- 質問セットはJSONLで持ち、正解はチャンクIDではなく文書IDや節IDにする。
- `Recall@k`とMRRは数十行で実装でき、平均だけでなく質問ごとの悪化を見る。
- 1回に変えるのは1か所だけにして、設定と結果を記録する。
- 検索の数値が上がっても回答が悪くなることはあるため、回答側の確認も別に残す。

---
私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。検索精度を質問セットと指標で測りながら改善する進め方は、社内文書検索を作る際にそのまま使えます。
→ [AIチャットボット・社内文書検索（RAG）について](https://shanaiai.com/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
