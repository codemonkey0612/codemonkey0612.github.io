---
title: Excelの転記・集計作業を約75%減らしたとき、最初にやったこと（pandasの最小例つき）
tags:
  - Python
  - Excel
  - pandas
  - 業務効率化
  - 自動化
private: false
updated_at: '2026-11-10T21:13:38+09:00'
id: e82696ebcc5f745696a3
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
毎月届く複数のExcelから、集計用のファイルへ手で数字を写す作業の自動化を頼まれることがあります。小売・サービス企業の案件では、定型のデータ処理にかかる時間を約75%減らせました。そのとき最初にやったのはコードを書くことではなく、今の作業手順と扱っているファイルを書き出すことでした。

この記事では、その書き出し方と道具の選び方を整理します。後半には、一括読み込み・列名の統一・重複チェック・処理履歴を入れたpandasの最小例を載せます。

## 案件の前提

- 期間：2021年5月〜2022年2月
- 体制：3名（エンジニアは私1名、業務担当の方が2名）
- 担当：業務分析・要件定義・画面設計・データ処理・テスト・導入支援

複数のExcelから手作業で転記と集計をしていて、困りごとは三つありました。

- **時間**：ファイルを開いて探し、写して確かめる作業が毎回発生する
- **入力ミス**：数字の打ち間違いや行のずれが、そのまま集計に入る
- **重複処理**：同じデータを二度取り込み、合計が実際より大きくなる

## コードより先に、作業手順とファイルを書き出す

いきなり作り始めると、例外の処理が後から次々に見つかり、手戻りが増えます。最初に次の表を埋めました。

| 書き出す項目 | 具体的に書くこと | 見落としやすい点 |
| --- | --- | --- |
| ファイル | 名前、送り主、届く頻度 | 古い様式で届くことがあるか |
| 中身の形 | 列の並び、見出し、日付の書き方 | 担当者ごとの書き方の違い |
| 作業手順 | 開く順番、写す先、確かめ方 | 頭の中だけにある手順 |
| 判断 | 人が目で見て決めている箇所 | 例外のときの対応 |
| 出力 | 最終的に誰に何を渡すか | 実は使われていない帳票 |

書き出したら、手順を「毎回同じやり方で済む手順」と「人の判断が必要な手順」に分けます。自動化するのは前者だけです。後者は無理に機械へ任せず、判断しやすい形で人に見せます。

たとえば「空欄の金額には前月の値を使う」という決まりが、担当者の頭の中だけにあったとします。書き出さないまま作ると、空欄の行で集計が止まるツールになります。書き出しの目的は、こうした暗黙の決まりを表に出すことです。

## マクロ・Power Query・専用アプリの使い分け

書き出しが終われば、合う道具を比べて選べます。

| 選択肢 | 向いている場面 | 注意点 |
| --- | --- | --- |
| マクロ（VBA） | 一つのファイル内で完結する作業 | 作った人しか直せない状態になりやすい |
| Power Query | 同じ形のファイルをまとめる作業 | 例外が多いと設定も複雑になる |
| 専用アプリ | 例外や履歴の管理まで必要な作業 | 初期費用と保守の体制が必要 |

マクロを使う場合は、[インターネットから入手したファイルのマクロが既定でブロックされる](https://learn.microsoft.com/ja-jp/microsoft-365-apps/security/internet-macros-blocked)点に注意します。メールの添付ファイルで届くブックのマクロを動かす運用なら、事前の動作確認が欠かせません。

ファイルの形がそろっているなら、まずPower Queryを試す価値があります。[同じ形の複数ファイルを一つの表に結合](https://learn.microsoft.com/ja-jp/power-query/combine-files-overview)でき、[重複の削除](https://learn.microsoft.com/ja-jp/power-query/working-with-duplicates)もできます。

この案件ではファイルの形がばらばらで、処理の記録も残したかったため、デスクトップアプリとして作りました。

## pandasでの最小例

ここから先のコードは案件のものではなく、考え方を示すために書いた最小例です。フォルダ内の`.xlsx`をまとめて読み、列名をそろえます。問題があれば集計せずに「要確認.xlsx」へ書き出して止まります。

```python:aggregate.py
from datetime import datetime
from pathlib import Path
import sqlite3

import pandas as pd

# 担当者ごとに違う見出しを、決めた列名にそろえる
COLUMNS = {
    "日付": "date", "取引日": "date",
    "店舗": "store", "店舗名": "store",
    "商品コード": "sku",
    "金額": "amount", "売上金額": "amount",
}
NAMES = ["date", "store", "sku", "amount"]
KEY = ["date", "store", "sku"]  # 同じ取引かどうかを見る列


def load(folder: Path) -> pd.DataFrame:
    frames = []
    for path in sorted(folder.glob("*.xlsx")):
        df = pd.read_excel(path).rename(columns=COLUMNS)
        missing = set(NAMES) - set(df.columns)
        if missing:
            raise ValueError(f"{path.name}: 列が見つかりません {sorted(missing)}")
        df = df[NAMES].copy()
        df["row"] = df.index + 2  # Excel上の行番号（1行目は見出し）
        df["source"] = path.name
        df["sku"] = df["sku"].astype("string")
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def main(folder="inbox", out="集計.xlsx", review="要確認.xlsx", db="history.db"):
    df = load(Path(folder))
    with sqlite3.connect(db) as con:
        con.execute("CREATE TABLE IF NOT EXISTS history (at TEXT, file TEXT, rows INTEGER)")
        done = {f for (f,) in con.execute("SELECT file FROM history")}

        # 直さずに止めて、人が確認できる形で渡す
        unreadable = df[df["date"].isna() | df["amount"].isna()]
        duplicated = df[df.duplicated(KEY, keep=False)].sort_values(KEY)
        again = sorted(set(df["source"]) & done)
        if len(unreadable) or len(duplicated) or again:
            with pd.ExcelWriter(review) as w:
                unreadable.to_excel(w, sheet_name="読み取れない行", index=False)
                duplicated.to_excel(w, sheet_name="重複の候補", index=False)
                pd.DataFrame({"file": again}).to_excel(w, sheet_name="取り込み済み", index=False)
            print(f"要確認: 読み取れない行 {len(unreadable)}件, 重複の候補 {len(duplicated)}件, "
                  f"取り込み済み {len(again)}件 → {review}")
            return

        df["month"] = df["date"].dt.strftime("%Y-%m")
        summary = df.pivot_table(index="store", columns="month", values="amount",
                                 aggfunc="sum", fill_value=0)
        summary.to_excel(out)
        now = datetime.now().isoformat(timespec="seconds")
        con.executemany("INSERT INTO history VALUES (?, ?, ?)",
                        [(now, f, int(n)) for f, n in df.groupby("source").size().items()])
        print(f"{len(df)}行を集計しました → {out}")


if __name__ == "__main__":
    main()
```

ポイントは四つです。

- **列名の対応表**：担当者ごとに違う見出しを`COLUMNS`で一つの名前にそろえる。足りない列があれば、ファイル名つきで止める
- **Excel上の行番号**：`row`列を持たせておくと、「b_店舗B.xlsxの3行目」のように元のファイルで探せる
- **重複は消さずに見せる**：`duplicated(KEY, keep=False)`で重複の両方を抜き出し、人の確認に回す。いきなり`drop_duplicates()`すると、本当に二件あった取引まで消える
- **処理履歴**：取り込んだファイル名をSQLiteに残し、同じファイルの二重取り込みを止める

## 実際のアプリに入れた機能

案件で作ったアプリには、次の機能を入れました。

1. **一括読み込み**：複数のExcelファイルをまとめて取り込む
2. **形式の統一**：列の並びや日付の書き方を一つの形にそろえる
3. **重複チェック**：二重計上を集計の前に止める
4. **自動集計とExcel帳票の出力**：受け取る側の手順は変えない
5. **処理履歴**：いつ、どのファイルを処理したかを残す

使った技術はPython、pandas、OpenPyXL、SQLite、PySide（画面）、REST API（他システムとの連携）です。

約75%の削減は、どれか一つの機能だけで生まれたものではありません。効いたのは二つの組み合わせだと考えています。転記の手作業がなくなったことと、ミスを取り込む前の段階で見つけられるようになったことです。

## 使い続けてもらうための画面の工夫

ツールは毎月使われて初めて効果が出ます。ITに詳しくない担当者が使う前提で、次の点を押さえました。

- ボタンは作業の順番どおりに並べ、次に押す場所が一目で分かるようにする
- エラーは「3行目の日付が読み取れません」のように、場所と理由を日常の言葉で伝える
- 重複が見つかっても勝手に消さず、一覧で見せて人の確認を挟む
- 結果はいつものExcel形式で出し、受け取る側の仕事を変えない
- 処理の記録を画面から見られるようにし、問い合わせに担当者が自分で答えられるようにする

全部を自動にするより、機械が迷った箇所だけ人に見せるほうが、安心して使い続けてもらえます。

## 着手前に依頼元と用意しておくもの

最初から全部の作業を対象にせず、毎月必ず発生し、手順が決まっている作業を一つ選びます。そのうえで、依頼元と次のものを用意しておくと検証が楽になります。

- 実際のファイル数か月分（個人情報などは伏せた写し）
- 手作業で作った「正しい集計結果」（完成したツールの答え合わせに使う）
- 例外のときに人がどう判断しているかの箇条書き
- 今の作業にかかっている時間（導入前の数字がないと効果を判断できない）
- 様式が変わったときに、社内で直す範囲と開発側に頼む範囲

書き出しの結果、マクロやPower Queryで足りると分かることもあります。そのときは、そう伝えるのも仕事のうちです。

## まとめ

- 転記と集計の手作業は、時間・入力ミス・重複処理の三つの問題を生みやすい
- 最初にやるのは、作業手順とファイルの書き出し
- 書き出しの内容から、マクロ・Power Query・専用アプリのうち合うものを選ぶ
- 重複は消さずに見せ、取り込んだファイルは履歴に残す
- 導入前の作業時間を計っておくと、効果を説明できる
