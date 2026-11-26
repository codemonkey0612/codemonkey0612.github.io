---
title: 部署別Excelの列名とステータス値をpandasで棚卸しし、統合DB設計の手戻りを防ぐ
tags:
  - Python
  - pandas
  - Excel
  - Openpyxl
  - 要件定義
private: false
updated_at: '2026-11-26T09:00:16+09:00'
id: b1c47eab37a04c8b5f55
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
部署ごとに形式が違うExcelを統合DBにまとめるとき、最初に困るのは「どの列が共通で、どの列が誰も使っていないのか」が分からないことです。この記事では、pandasで列名とステータス値を機械的に棚卸しし、DB設計の前に論点を洗い出すスクリプトを紹介します。

## 背景と考え方

私は2015年4月から2016年3月に、製造メーカー向けの生産管理・工程可視化システムを開発しました。部門ごとに管理方法やデータ形式が違うことが課題でした。

当時の細かい手順をここで語るつもりはありません。以下は「いま同じ状況なら私ならこうする」という提案です。

私なら、設計に入る前に次の2点を数字で見ます。

- 列名の一致状況（共通・一部・単独・未使用候補）
- ステータス列に実際に入っている値の種類

人の目で数十ファイルを見比べると、見落としが出ます。コードで一覧にすると、部署間の会議で使える資料にもなります。

## 前提環境

- Python 3.10以上
- pandas と openpyxl（`pip install pandas openpyxl`）
- 対象は `.xlsx` ファイルを1つのフォルダに集めた状態
- 1行目が見出し行のシート

機密情報を含む場合は、値を伏せたコピーで実行してください。

## 棚卸しスクリプト

```python:audit_headers.py
from pathlib import Path
import sys
import unicodedata

import pandas as pd

STATUS_WORDS = ("状態", "ステータス", "完了", "進捗")


def norm(name: str) -> str:
    # 全角半角・空白・大文字小文字の揺れを吸収する
    s = unicodedata.normalize("NFKC", str(name))
    return "".join(s.split()).lower()


def load_sheets(root: Path):
    for path in sorted(root.glob("*.xlsx")):
        sheets = pd.read_excel(path, sheet_name=None, dtype=str)
        for sheet, df in sheets.items():
            yield f"{path.stem}:{sheet}", df


def main(root: Path) -> None:
    rows = []
    frames = {}
    for source, df in load_sheets(root):
        frames[source] = df
        for col in df.columns:
            if str(col).startswith("Unnamed"):
                continue  # 見出しが空の列は対象外
            fill = df[col].notna().mean() if len(df) else 0.0
            rows.append(
                {"source": source, "raw": str(col),
                 "key": norm(col), "fill": fill}
            )

    all_cols = pd.DataFrame(rows)
    total = all_cols["source"].nunique()

    summary = (
        all_cols.groupby("key")
        .agg(
            sources=("source", "nunique"),
            fill=("fill", "mean"),
            variants=("raw", lambda x: " / ".join(sorted(set(x)))),
        )
        .reset_index()
    )

    def classify(r):
        if r["fill"] < 0.05:
            return "未使用候補"
        if r["sources"] == total:
            return "共通"
        if r["sources"] == 1:
            return "単独"
        return "一部"

    summary["class"] = summary.apply(classify, axis=1)
    summary = summary.sort_values(["class", "sources"], ascending=[True, False])
    summary.to_csv("columns_summary.csv", index=False, encoding="utf-8-sig")
    print(summary["class"].value_counts().to_string())

    # ステータスらしい列の値を、ファイル別に数える
    for source, df in frames.items():
        for col in df.columns:
            if any(w in norm(col) for w in STATUS_WORDS):
                counts = df[col].value_counts(dropna=False)
                print(f"\n[{source}] {col}")
                print(counts.head(10).to_string())


if __name__ == "__main__":
    main(Path(sys.argv[1]))
```

実行は次のとおりです。

```bash
python audit_headers.py ./excel_samples
```

### 各部分の役割

- `norm`：「納期」と「納 期」、「ＩＤ」と「id」のような表記揺れを同じキーにする。
- `fill`：列の中で値が入っている行の割合である。0.05未満なら「未使用候補」にする。この値は目安として置いた仮のしきい値であり、データに合わせて調整する。
- `variants`：同じキーに属する元の列名を並べる。「納期」「出荷期日」のような別名は、この列で気づける。ただし完全に別の言葉は自動では同一視できない。
- 最後のループ：ステータスらしい列の値を数える。

## 結果の読み方

`columns_summary.csv` は、次の順で見ます。

1. 共通：統合DBの中核カラムの候補である。
2. 一部：部署間で名前や粒度が違う可能性がある。`variants` を確認する。
3. 単独：その部署だけの業務固有の項目か、別名の取りこぼしかを確認する。
4. 未使用候補：外してよいか、各部署の担当者に聞く。

ステータス値の出力では、たとえば「完了」「完了(検査前)」「済」が混在していれば、用語の定義を揃える必要があるとわかります。これは仮の例ですが、こうした揺れはステータス名の設計に直結します。

## 動作確認

小さなテストデータで、期待どおり分類されるか確かめます。

```python:make_sample.py
from pathlib import Path
import pandas as pd

Path("excel_samples").mkdir(exist_ok=True)
pd.DataFrame(
    {"品番": ["A1", "A2"], "納期": ["12/1", "12/3"], "状態": ["完了", "着手"],
     "備考": [None, None]}
).to_excel("excel_samples/dept_a.xlsx", index=False)
pd.DataFrame(
    {"品　番": ["B1"], "納期": ["12/5"], "状態": ["済"], "担当": ["佐藤"]}
).to_excel("excel_samples/dept_b.xlsx", index=False)
```

このデータでは、品番と納期と状態が「共通」、備考が「未使用候補」、担当が「単独」になれば成功です。全角空白入りの「品　番」が品番と同じキーになることも確認できます。

## 落とし穴

- 見出し行が1行目にないシートは、列名が `Unnamed` だらけになる。`header=` を調整する。
- 結合セルや複数行見出しは、先に人手で整形するほうが早い場合がある。
- `dtype=str` で読むため、日付や数値は文字列のままである。型の判定は別工程にする。
- 非表示シートも読み込まれる。不要なら除外条件を足す。
- `fill` が低い列は、年に一度しか使わない項目の可能性もある。機械的に削除せず、必ず担当者に確認する。

## まとめ

統合DBの設計前に、列名とステータス値を棚卸しすると、議論の対象が具体的になります。私なら、このCSVを部署間の打ち合わせに持ち込み、「共通」「一部」の項目から定義を合意していきます。スクリプトは判断を代わりにはしませんが、判断の材料を短時間で揃えてくれます。
