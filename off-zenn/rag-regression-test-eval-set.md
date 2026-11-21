---
title: RAGの「回答テスト」を回す：評価用質問30問で参照元の外れと拒否判定の悪化を検知する
emoji: 🧪
type: tech
topics:
  - rag
  - llm
  - python
  - testing
  - ai
published: true
published_at: 2026-11-23 09:00
---

RAGのプロンプトやチャンク設定を直したあと、「前より良くなったはず」と感じたまま本番に出していないでしょうか。私なら、評価用の質問30問を毎回自動で流し、参照元の一致と「分からない」の判定だけをCIで機械的に検査します。この記事では、そのための質問セットの作り方、Pythonの回帰テスト、LLM採点を使う範囲、しきい値と差分レポートの設計を示します。RAGを運用していて、変更のたびに目視確認で疲れているエンジニア向けです。

## 「テスト通りました」では測れない：RAGの変更で起きる静かな劣化

通常のユニットテストは、関数が例外を出さず、型が合っていれば通ります。RAGは、回答が間違っていても例外を出しません。HTTP 200で、もっともらしい文章が返ってきます。

たとえば次のような変更で、静かな劣化が起きます。

- チャンクサイズを小さくして、特定の質問では精度が上がったが、表をまたぐ質問で根拠が欠けた
- システムプロンプトに「簡潔に答えてください」と足したら、根拠が足りないときの「分からない」が減った
- 埋め込みモデルや検索件数(top_k)を変えたら、別の文書が上位に来るようになった

これらは、手元で数問試しただけでは見つかりません。直した箇所の質問は良くなり、直していない箇所の質問が悪くなるからです。

私はRAG文書解析システムの開発(2023-04〜2024-03)で、評価用の質問データを使い、検索精度と回答品質の改善を繰り返しました。AIエージェント・マルチテナントSaaSの開発(2024-04〜2026-07)でも、評価用データセットで品質を検証する仕組みを整備しています。前者では、回答に参照元を表示し、情報が足りないときは回答を控える設計でした。後者では、回答に参照元を表示する設計でした。この2点は機械的に検査しやすいため、記事の中心に置きます。

## 評価用質問セットの作り方：質問・正解根拠・回答不可の3種類

評価データは、次の3種類の要素で作ります。

- 質問: 実際の利用者が書く言い回しの質問
- 正解根拠: 答えが載っている文書とその位置
- 回答不可の質問: 文書に答えがなく、「分からない」と返すべき質問

30問の内訳は、私なら次のようにします。件数は目安です。

- 答えが1か所にある質問: 18問
- 複数の文書や節にまたがる質問: 6問
- 回答不可の質問: 6問

回答不可の質問を一定数入れるのが肝です。入れないと「必ず答える」方向に寄った変更が、評価上はすべて改善に見えます。

### 正解根拠はチャンクIDで持たない

チャンク設定を変えると、チャンクIDは全部変わります。そこで正解根拠は、文書IDと節見出しなど、チャンクに依存しない単位で持ちます。

```jsonl:evals/cases.jsonl
{"id":"q001","kind":"answerable","question":"有給休暇の繰越は何日までですか","expected_sources":["hr-handbook#leave"],"must_include":["20日"]}
{"id":"q019","kind":"multi","question":"出張時の宿泊費の上限と精算期限を教えてください","expected_sources":["travel-policy#hotel","travel-policy#settlement"],"must_include":[]}
{"id":"u001","kind":"unanswerable","question":"来期の役員報酬の改定予定はいつですか","expected_sources":[],"must_include":[]}
```

上の内容はすべて仮の例です。`must_include`は、回答に必ず含まれるべき語句です。数値や固有名詞のように、表記ゆれが少ないものだけを入れます。

質問の出どころは、実際の問い合わせログと業務担当者へのヒアリングが理想です。LLMに質問を生成させる場合も、正解根拠は人が確認します。

## Pythonで書く回帰テスト：参照元一致と「分からない」判定

テスト対象のRAGには、次の戻り値の契約を置きます。ポイントは、「分からない」を文字列ではなく構造化フィールドで返すことです。「情報が見つかりませんでした」という文言を正規表現で探す方式は、プロンプトを変えた途端に壊れます。

```python:evals/runner.py
from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class RagResult:
    text: str
    sources: list[str]   # 文書ID#節 の形式
    refused: bool        # 回答を控えたか


@dataclass
class CaseResult:
    id: str
    kind: str
    source_hit: bool
    refusal_ok: bool
    keywords_ok: bool

    @property
    def passed(self) -> bool:
        return self.source_hit and self.refusal_ok and self.keywords_ok


def load_cases(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def evaluate_case(case: dict, result: RagResult) -> CaseResult:
    expected = set(case["expected_sources"])
    is_unanswerable = case["kind"] == "unanswerable"

    if is_unanswerable:
        # 回答不可: 控えていて、参照元を出していないこと
        refusal_ok = result.refused and not result.sources
        return CaseResult(case["id"], case["kind"], True, refusal_ok, True)

    # 回答可能: 控えていないこと、正解根拠がすべて参照元に含まれること
    refusal_ok = not result.refused
    source_hit = expected.issubset(set(result.sources))
    keywords_ok = all(k in result.text for k in case.get("must_include", []))
    return CaseResult(case["id"], case["kind"], source_hit, refusal_ok, keywords_ok)


def run_all(cases: list[dict], answer_fn) -> list[CaseResult]:
    return [evaluate_case(c, answer_fn(c["question"])) for c in cases]


def summarize(results: list[CaseResult]) -> dict:
    answerable = [r for r in results if r.kind != "unanswerable"]
    unanswerable = [r for r in results if r.kind == "unanswerable"]
    return {
        "source_hit_rate": sum(r.source_hit for r in answerable) / len(answerable),
        "false_refusal_rate": sum(not r.refusal_ok for r in answerable) / len(answerable),
        "correct_refusal_rate": sum(r.refusal_ok for r in unanswerable) / len(unanswerable),
        "keyword_rate": sum(r.keywords_ok for r in answerable) / len(answerable),
        "failed_ids": [r.id for r in results if not r.passed],
        "per_case": {r.id: asdict(r) for r in results},
    }
```

見ている指標は4つです。

- 参照元一致率: 正解根拠がすべて引用されたか
- 誤拒否率: 答えられる質問で控えてしまった割合
- 正しい拒否率: 回答不可の質問で控えられた割合
- キーワード一致率: 必須の数値や語句が含まれたか

回答不可の質問で参照元が空であることも条件にしました。控えると言いながら無関係な参照元を出す挙動は、利用者を混乱させるためです。

### 実行側の書き方

`answer_fn`には、本番と同じ検索・生成の経路を渡します。評価専用の近道を作ると、本番の劣化を拾えません。LLMの温度は0に近づけます。それでも出力は揺れるので、後述のしきい値で吸収します。

## LLM採点を使う範囲と使わない範囲：本番でそうする理由

私なら、CIのゲート(通す・止める)にはLLM採点を使いません。理由は3つあります。

- 採点モデルや採点プロンプトの変更で、スコアの基準が動く
- 実行のたびに結果が揺れ、止める根拠として説明しにくい
- 実行コストと時間が、PRごとに回すには重くなりやすい

参照元一致、拒否判定、必須語句は、ルールで決まる検査です。これだけで「根拠を外した」「答えるべきなのに控えた」「答えるべきでないのに答えた」を拾えます。ただし、回答内容の誤りや言い回しの劣化までは検知できません。

回答の言い回しの適切さや、複数根拠を統合した説明の正しさは、ルールでは測れません。ここにLLM採点を使うなら、次の運用にします。

- ゲートではなく、差分レポートに添える参考値にする
- 採点モデルとプロンプトを固定し、変更したら基準値を取り直す
- 点数が下がった質問は、最終的に人が回答全文を読む

人が見るのは、LLM採点が下がった質問と、前回から回答が大きく変わった質問に絞ります。30問全部を毎回読む必要はありません。

## CIに組み込む：しきい値と差分レポートの設計

### 基準値(ベースライン)と比較する

絶対値のしきい値だけでは、現状が低い間は何も止められません。私なら、mainブランチの結果をベースラインとして保存し、そこからの悪化幅で判定します。加えて、回答不可の正しい拒否率など、守りたい指標には絶対値の下限も置きます。

```python:evals/gate.py
from __future__ import annotations

import json
import sys
from pathlib import Path

# 悪化を許す幅(30問なので1問=約3.3ポイント。揺れを1問分は許容する)
MAX_DROP = {
    "source_hit_rate": 0.04,
    "correct_refusal_rate": 0.0,   # 回答不可は1問の悪化も許さない
    "keyword_rate": 0.04,
}
MAX_RISE = {"false_refusal_rate": 0.04}
FLOOR = {"correct_refusal_rate": 0.8}


def compare(base: dict, new: dict) -> list[str]:
    errors = []
    for key, allowed in MAX_DROP.items():
        if base[key] - new[key] > allowed + 1e-9:
            errors.append(f"{key}: {base[key]:.3f} -> {new[key]:.3f}")
    for key, allowed in MAX_RISE.items():
        if new[key] - base[key] > allowed + 1e-9:
            errors.append(f"{key}: {base[key]:.3f} -> {new[key]:.3f}")
    for key, floor in FLOOR.items():
        if new[key] < floor:
            errors.append(f"{key} が下限 {floor} を下回りました: {new[key]:.3f}")
    return errors


def diff_report(base: dict, new: dict) -> str:
    lines = ["## 質問ごとの変化"]
    for cid, now in new["per_case"].items():
        before = base["per_case"].get(cid)
        if before is None:
            lines.append(f"- {cid}: 新規ケース")
            continue
        was_ok = all([before["source_hit"], before["refusal_ok"], before["keywords_ok"]])
        is_ok = all([now["source_hit"], now["refusal_ok"], now["keywords_ok"]])
        if was_ok and not is_ok:
            lines.append(f"- {cid}: 通過 -> 失敗(悪化)")
        elif not was_ok and is_ok:
            lines.append(f"- {cid}: 失敗 -> 通過(改善)")
    return "\n".join(lines)


if __name__ == "__main__":
    base = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    new = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    print(diff_report(base, new))
    problems = compare(base, new)
    if problems:
        print("\n## ゲート失敗")
        print("\n".join(f"- {p}" for p in problems))
        sys.exit(1)
```

30問という少なさでは、1問が約3.3ポイントです。許容幅を0.04にしたのは、1問分の揺れを吸収するためです。回答不可だけは問数が少なく、1問の悪化が重大なので幅を0にしました。この数値は例であり、自分のデータで揺れを測ってから決めてください。30問では小さな劣化を見逃すこともあります。

### ワークフローの形

実行の流れは次のとおりです。

1. PRのブランチで`evals/runner.py`から結果JSONを作る
2. mainの結果JSONをベースラインとして取得する
3. `python evals/gate.py base.json new.json`を実行する
4. 出力をPRコメントまたはジョブサマリーに貼る

```yaml:.github/workflows/rag-eval.yml
name: rag-eval
on:
  pull_request:
    paths:
      - "app/prompts/**"
      - "app/rag/**"
      - "evals/**"
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<現行のメジャーバージョン>
      - uses: actions/setup-python@<現行のメジャーバージョン>
        with:
          python-version: "3.12"
      - run: pip install -r requirements.txt
      - run: python -m evals.run_eval --out new.json
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
      - run: python evals/gate.py evals/baseline.json new.json
```

`uses`のバージョンは、各アクションの公式ドキュメントで現行のものを確認して固定してください。`evals.run_eval`は、`load_cases`と`run_all`と`summarize`をつないでJSONを書き出す、数十行のスクリプトを想定しています。APIキーはリポジトリのシークレットに置き、コードには書きません。

`paths`で、プロンプトとRAGのコードが変わったPRだけ実行すると、無駄な呼び出しを減らせます。ベースラインの更新は、意図した変更をマージしたときに、人が確認して行います。自動で上書きすると、悪化が基準になってしまいます。

## 失敗パターンと、私なら本番でこうする

### 失敗パターン

- 評価セットを一度作って放置する。文書が更新されると、正解根拠が古くなる。
- 評価セットに合わせてプロンプトを調整しすぎる。30問に過適合し、本番の質問で効かなくなる。
- 正解根拠をチャンクIDで持つ。設定変更のたびに全件が失敗する。
- 「分からない」を文言で判定する。言い回しの変更でテストが壊れる。
- テナントや権限ごとの文書差を無視する。マルチテナントなら、権限外の文書を引用していないかも検査対象である。

最後の点は、権限のある文書だけが検索対象になることを、別の専用テストで確かめるのが筋です。回答品質の評価と混ぜないほうが、失敗の原因を切り分けられます。

### 私ならこうします

- 最初は30問で始め、本番で誤回答が出るたびに質問を1問ずつ足す。
- 追加した質問は、直した変更と同じPRで入れる。再発防止のテストになる。
- 評価セットを「開発用」と「検証用」に分け、検証用は調整に使わない。
- ゲートはルール判定のみとし、LLM採点は人が読む対象を絞る補助とする。
- ベースライン更新は人の承認つきとする。

## まとめ

RAGの変更による劣化は、例外も出さずに静かに進みます。評価用質問30問を、答えられる質問・複数根拠の質問・回答不可の質問に分けて持ち、参照元一致と拒否判定をルールで検査すれば、参照元の外れや拒否判定の悪化を、CIで検知しやすくなります。回答内容の誤りや言い回しの劣化は、この検査だけでは拾えません。LLM採点は止める根拠にせず、人が読む箇所を絞る補助に使うのが、私の線引きです。まずは過去の誤回答から10問を作り、ベースラインを取るところから始めてみてください。

---

私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。回答品質を数値で見張る評価用データセットとCIの設計は、RAGを安心して改善し続けるための土台として、構築の一部に含めてご相談いただけます。
→ [AIチャットボット・社内文書検索（RAG）について](https://shanaiai.com/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
