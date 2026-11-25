---
title: RAGの検索スコア分布をKS統計量でテナント別に監視し、HTTP 200の劣化を検知する
tags:
  - Python
  - RAG
  - pandas
  - 監視
  - FastAPI
private: false
ignorePublish: true
zenn: off-zenn/rag-quality-logging-design.md
published_at: 2026-11-27 09:00
---

RAGの検索スコアは、閾値だけで見ていると劣化に気づくのが遅れます。この記事では、直近7日と過去4週間のスコア分布をテナント別に比べ、ずれたらCIやcronで失敗させる小さなスクリプトを作ります。依存はPythonとpandas（numpy）だけです。

## 解決したい問題

平均スコアは、文書更新やチャンク分割の変更で少しずつ動きます。固定の閾値（たとえば0.35未満の割合）だと、全体が一律に下がったときは気づけます。しかしテナントごとに文書の質が違うため、「そのテナントにとっての普段」からのずれは見えません。

私はマルチテナントのAI SaaS開発で、ログ管理やエラー監視、評価用データでの品質検証を整備する立場でした。その経験から、テナントごとに自分の過去と比べる仕組みが要ると考えています。以下は私ならこう組む、という例です。個別案件の実装ではありません。

## 前提

- Python 3.10以上、pandasとnumpy
- アプリが検索のたびにJSON Linesで次の形のイベントを出している
- 評価実行のトラフィックには `eval_run_id` が付いている

```json
{"ts":"2026-11-20T01:02:03+00:00","event":"retrieval","tenant_id":"t1","top":[{"doc":"d1","chunk":"c3","score":0.52}]}
```

## 考え方：2標本KS検定の統計量だけ使う

比べたいのは「直近7日の上位1件スコア」と「その前28日のスコア」です。分布の差を測るには、Kolmogorov–Smirnov統計量が手軽です。2つの累積分布の差の最大値で、0なら同じ、1なら完全に分離しています。

p値は使いません。ログが数千件あると、わずかな差でも有意になるためです。運用では「統計量が一定を超えたら見に行く」という単純な基準のほうが扱いやすいと私は考えます。

## 実装

```python:drift.py
import json
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

MIN_N = 30        # これ未満は判定しない
KS_LIMIT = 0.25   # 仮の値。運用で調整する
LOW_SCORE = 0.35  # 参考表示用の仮の閾値


def load(path: str) -> pd.DataFrame:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            if e.get("event") != "retrieval" or e.get("eval_run_id"):
                continue
            top = e.get("top") or []
            rows.append({
                "ts": pd.to_datetime(e["ts"], utc=True),
                "tenant_id": e["tenant_id"],
                "top1": top[0]["score"] if top else 0.0,
            })
    return pd.DataFrame(rows)


def ks_stat(a: np.ndarray, b: np.ndarray) -> float:
    grid = np.sort(np.concatenate([a, b]))
    cdf_a = np.searchsorted(np.sort(a), grid, side="right") / len(a)
    cdf_b = np.searchsorted(np.sort(b), grid, side="right") / len(b)
    return float(np.max(np.abs(cdf_a - cdf_b)))


def check(df: pd.DataFrame, now: datetime) -> list[dict]:
    recent_from = now - timedelta(days=7)
    base_from = now - timedelta(days=35)
    out = []
    for tenant, g in df.groupby("tenant_id"):
        recent = g[g.ts >= recent_from]["top1"].to_numpy()
        base = g[(g.ts >= base_from) & (g.ts < recent_from)]["top1"].to_numpy()
        if len(recent) < MIN_N or len(base) < MIN_N:
            out.append({"tenant": tenant, "status": "skip", "n": len(recent)})
            continue
        ks = ks_stat(recent, base)
        out.append({
            "tenant": tenant,
            "status": "alert" if ks > KS_LIMIT else "ok",
            "ks": round(ks, 3),
            "low_recent": round(float((recent < LOW_SCORE).mean()), 3),
            "low_base": round(float((base < LOW_SCORE).mean()), 3),
        })
    return out


if __name__ == "__main__":
    res = check(load(sys.argv[1]), datetime.now(timezone.utc))
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(1 if any(r["status"] == "alert" for r in res) else 0)
```

各部分の役割です。

- `load` は検索イベントだけを拾い、評価実行を除いて、上位1件のスコアを取り出す
- `ks_stat` は結合した値を格子にして、2つの経験的累積分布の差を出す。scipyなしで書ける
- `check` はテナントごとに2つの期間へ分け、件数が足りなければ `skip` にする
- 終了コードを1にするので、cronやCIの失敗通知にそのまま載せられる

## 動作確認

ログ基盤がなくても、疑似ログで確かめられます。疑似ログで試すなら、2テナントに各600件ほど作り、片方の直近7日のスコアの平均を0.55から0.35に下げます。出力は次のような形になるはずです。数値は目安であり、実測値ではありません。

```text
tenant a: ok     ks=0.1前後
tenant b: alert  ks=大きな値
```

劣化させたテナントだけが `alert` になり、終了コードは1になります。変化のないテナントは、KS統計量が小さい値にとどまるはずです。本番での適切な閾値は、自分のログで確かめてください。

## 本番での注意点

- 件数が少ないテナントは `skip` にする。少数同士の比較は、KS統計量が大きくぶれる
- 評価実行を必ず除外する。評価セットは質問が偏るため、分布を歪める
- 週末や月末に質問が偏る業務では、比較期間を7日の倍数にそろえる
- スコアの意味は、埋め込みモデルや距離関数を変えると変わる。切り替え時は基準期間をリセットする
- `KS_LIMIT` は最初は緩めに置く。誤報が続くと、通知が無視されるようになる

alert が出たら、私ならまず取り込み日時とチャンク分割の変更履歴を確認します。次に、低スコアだった質問を人が読み、評価セットへ足すか検討します。KS統計量は原因を教えてくれません。見に行く合図にすぎないと割り切るのが大切です。

## まとめ

- 固定閾値では、テナントごとの普段とのずれが見えない
- 直近と過去のスコア分布をKS統計量で比べれば、外部ライブラリなしで検知できる
- 件数の下限、評価トラフィックの除外、基準期間のリセットが運用の要になる
- 閾値は仮の値なので、自分のログで調整してください
