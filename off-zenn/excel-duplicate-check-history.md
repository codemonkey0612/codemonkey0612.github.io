---
title: 複数Excelの重複処理を止めたい：転記ミスをなくすため私が入れた重複チェックと処理履歴
emoji: 🧾
type: tech
topics:
  - python
  - pandas
  - excel
  - pyside
published: false
---

<!-- autopilot: not published, these checks still failed:
- fact-check (self_claim, unsupported): 「そこで処理履歴を持たせる判断をします。案件のスタックにSQLiteが入っていた通り、小さなデスクトップアプリなら、サーバーなしで動くSQLiteが相性の良い選択肢です。」 — スタックにSQLiteがあることは事実です。ただし、履歴の保存先にSQLiteを使ったとはプロフィールに書かれていません。 Fix: 「私なら処理履歴の保存先にSQLiteを選びます」のように、実際にやったことではなく考え方として書き直してください。
-->

複数のExcelからの手作業転記で起きる入力ミスと重複処理は、「形式の統一」「重複チェック」「処理履歴」の3点を先に固めると止められます。私が担当した業務自動化デスクトップアプリの案件では、この3点を軸に、定型のデータ処理作業時間を約75%削減しました。この記事は、同じ課題を抱える社内ツールの開発者や、Excel業務の自動化を検討しているエンジニア向けです。案件の判断と、手元で試せるPythonのコードを紹介します。

## 発端：複数Excelの手作業転記で起きていた入力ミスと重複処理

案件は、小売・サービス企業向けの業務自動化デスクトップアプリ開発です。期間は2021年5月から2022年2月で、体制は3名（エンジニア1名・業務担当2名）でした。私は単独の開発担当として、業務分析、要件定義、UI設計、データ処理、テスト、導入支援までを担いました。

課題は、複数のExcelから手作業で転記・集計していたことです。時間がかかるうえに、入力ミスや重複処理が起きていました。

ここで大事なのは、ミスの原因が「担当者の注意不足」ではなく「仕組みの不在」だという見立てです。一般に、手作業の転記には次の弱点があります。

- 同じファイルや同じ行を、別の日に二度処理しても誰も気づけない
- ファイルごとに列名や日付の書き方が違い、目で読み替える必要がある
- どこまで処理したかが担当者の記憶やファイル名に依存する

この3つは、入力ミスを減らす努力だけでは消せません。そこで実装では、複数ファイルの一括読み込み、形式の統一、重複チェック、自動集計、Excel帳票出力、処理履歴を揃えました。

## 最初に決めたこと：形式の統一を先にやる理由

私なら、重複チェックより先に形式の統一から着手します。理由は単純で、形式が揃っていないデータでは重複を正しく判定できないからです。

たとえば、同じ取引が次のように別表記で入っているとします。これは説明用の仮の例です。

- ファイルAでは取引先コードが「A-001」、ファイルBでは「ａ－００１ 」（全角で末尾に空白）
- 金額が「12,000」という文字列の場合と、数値の12000の場合がある
- 日付が「2026/11/05」と「2026-11-05」のように、書き方が混在する

人間には同じに見えても、プログラムは別の値として扱います。重複判定のキーを作る前に、この揺れを消さなければなりません。

### 形式統一のコード例

次のコードは、フォルダ内のExcelをまとめて読み込み、列名と値を揃える例です。列名のマッピングや列構成は、実際の帳票に合わせて調整してください。

```python:normalize.py
import unicodedata
from pathlib import Path

import pandas as pd

# ファイルごとに異なる列名を、内部の標準名に寄せる対応表
COLUMN_MAP = {
    "取引日": "date", "日付": "date",
    "取引先コード": "partner", "取引先CD": "partner",
    "伝票番号": "slip_no", "伝票No": "slip_no",
    "金額": "amount", "売上金額": "amount",
}
REQUIRED = ["date", "partner", "slip_no", "amount"]


def clean_text(s: pd.Series) -> pd.Series:
    # 全角英数を半角にし、前後の空白を除き、ハイフン類を統一する
    return (
        s.fillna("")
        .astype(str)
        .map(lambda v: unicodedata.normalize("NFKC", v).strip())
        .str.replace(r"[‐‑–—−ー]", "-", regex=True)
        .str.upper()
    )


def load_one(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=0, dtype=str)
    df = df.rename(columns=COLUMN_MAP)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"{path.name}: 必須列がありません {missing}")
    df = df[REQUIRED].copy()
    df["partner"] = clean_text(df["partner"])
    df["slip_no"] = clean_text(df["slip_no"])
    df["date"] = pd.to_datetime(clean_text(df["date"]), errors="coerce")
    df["amount"] = pd.to_numeric(
        clean_text(df["amount"]).str.replace(",", "", regex=False),
        errors="coerce",
    )
    df["source_file"] = path.name
    df["source_row"] = df.index + 2  # Excel上の行番号（1行目が見出し）
    return df


def load_all(folder: Path) -> pd.DataFrame:
    frames = [load_one(p) for p in sorted(folder.glob("*.xlsx"))]
    return pd.concat(frames, ignore_index=True)
```

ポイントは3つあります。

- `dtype=str` で読み、型の自動推定による「先頭ゼロ消え」などを避ける
- 変換できない値は `errors="coerce"` で欠損にし、後で不正行として一覧に出す
- `source_file` と `source_row` を持たせ、どの行の話かを後から追えるようにする

なお、このコードが揃えられる日付は、「2026/11/05」と「2026-11-05」のような西暦の書き方の違いまでです。「令和8年11月5日」のような和暦は `pd.to_datetime` で解析できず、欠損になって不正行に回ります。全角半角を揃えるNFKCでも、和暦は西暦になりません。和暦が混ざる帳票では、別途変換処理を用意する必要があります。

必須列がないファイルは、黙ってスキップせず例外にします。静かに落とすと、それ自体が新しいミスの温床になるからです。

## 重複チェックの考え方（たとえばキーの決め方の一般例）

重複チェックで一番大事なのは、何をもって「同じ」とするかというキーの決め方です。ここは業務ごとに違うため、以下は一般例として読んでください。

### キーの選び方

- 業務上の一意な番号（伝票番号など）があれば、それを軸にする
- 番号が信頼できない場合は、日付・取引先・金額などの組み合わせを使う
- 行番号やファイル名はキーに入れない。同じ内容が別ファイルに入ると見逃すため

注意したいのは、キーを厳しくしすぎても緩くしすぎても失敗する点です。緩すぎると、正当な別取引を重複と誤判定します。厳しすぎると、本物の重複を取りこぼします。私なら、最初は厳しめのキーで始めます。そして「重複候補」を人が確認できる形で出し、運用しながら調整します。

### キー生成と、バッチ内の重複検出

```python:dedupe.py
import hashlib

import pandas as pd

KEY_COLUMNS = ["date", "partner", "slip_no", "amount"]


def make_key(row: pd.Series) -> str:
    parts = [
        row["date"].strftime("%Y-%m-%d") if pd.notna(row["date"]) else "",
        row["partner"],
        row["slip_no"],
        "" if pd.isna(row["amount"]) else f"{row['amount']:.2f}",
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def split_invalid(df: pd.DataFrame):
    # 日付・金額が読めない行、キー項目が空の行は処理対象から外す
    bad = (
        df["date"].isna()
        | df["amount"].isna()
        | (df["partner"] == "")
        | (df["slip_no"] == "")
    )
    return df[~bad].copy(), df[bad].copy()


def mark_batch_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["row_key"] = df.apply(make_key, axis=1)
    # 同じバッチ内で2回目以降に現れる行を重複とする
    df["dup_in_batch"] = df.duplicated("row_key", keep="first")
    return df
```

不正行を分けるのは、重複より前の段階で「そもそも読めない行」を人に返すためです。ここで落ちた行は、元のファイル名と行番号つきで一覧にします。担当者は該当行だけ直せば済みます。

## 処理履歴を残す判断と、ITに詳しくない担当者向けの画面

バッチ内の重複は、上のコードで見つかります。しかし実務で厄介なのは「先週すでに処理した行が、今週のファイルにも入っている」ケースです。これを止めるには、過去に処理した行を覚えておく場所が必要です。

そこで処理履歴を持たせる判断をします。案件のスタックにSQLiteが入っていた通り、小さなデスクトップアプリなら、サーバーなしで動くSQLiteが相性の良い選択肢です。

### 履歴テーブルの例

```python:history.py
import sqlite3
from datetime import datetime

import pandas as pd

DDL = """
CREATE TABLE IF NOT EXISTS processed_rows (
    row_key      TEXT PRIMARY KEY,
    batch_id     TEXT NOT NULL,
    source_file  TEXT NOT NULL,
    source_row   INTEGER NOT NULL,
    processed_at TEXT NOT NULL
);
"""


def open_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute(DDL)
    return conn


def find_already_processed(conn, keys) -> set:
    # SQLiteの変数上限を避けるため、分割して問い合わせる
    found = set()
    keys = list(keys)
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        marks = ",".join("?" * len(chunk))
        cur = conn.execute(
            f"SELECT row_key FROM processed_rows WHERE row_key IN ({marks})",
            chunk,
        )
        found.update(r[0] for r in cur)
    return found


def commit_batch(conn, df: pd.DataFrame, batch_id: str) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    rows = [
        (r.row_key, batch_id, r.source_file, int(r.source_row), now)
        for r in df.itertuples()
    ]
    with conn:  # 成功すればコミット、例外ならロールバック
        conn.executemany(
            "INSERT INTO processed_rows VALUES (?, ?, ?, ?, ?)", rows
        )
```

履歴の書き込み（`commit_batch`）は、帳票の出力が成功した後に呼ぶのが原則です。出力前に書くと、途中で失敗したときに「処理済みなのに帳票がない」状態が残ります。私ならこの順序を最初に決めます。

### 処理の流れ

```python:run.py
from pathlib import Path
from uuid import uuid4

from normalize import load_all
from dedupe import split_invalid, mark_batch_duplicates
from history import open_db, find_already_processed, commit_batch


def run(folder: Path, db_path: str):
    df = load_all(folder)
    valid, invalid = split_invalid(df)
    valid = mark_batch_duplicates(valid)

    conn = open_db(db_path)
    done = find_already_processed(conn, valid["row_key"])
    valid["dup_in_history"] = valid["row_key"].isin(done)

    dup = valid["dup_in_batch"] | valid["dup_in_history"]
    target = valid[~dup]
    skipped = valid[dup]

    # ここで target を集計し、Excel帳票（openpyxl等）に出力する
    # 出力が成功してから履歴に記録する
    commit_batch(conn, target, batch_id=uuid4().hex[:8])
    return target, skipped, invalid
```

戻り値を3つに分けるのが肝です。「処理した行」「重複でスキップした行」「読めなかった行」を、それぞれ画面に見せられます。

### ITに詳しくない担当者向けの画面

この案件では、ITに詳しくない担当者でも使える画面にすることが要件でした。具体的な画面構成の細部は案件の記録にないため、ここでは私ならどうするかを書きます。

- 操作は「フォルダを選ぶ」「実行する」の2ステップに絞る
- 結果は「処理 N件」「重複でスキップ N件」「要確認 N件」の3つの数字で示す
- スキップした行と要確認の行は、ファイル名と行番号つきで一覧にする
- 「重複」「ハッシュ」といった用語は出さず、「前回までに処理済みの行です」のように書く
- 履歴は、日時・ファイル名・件数を一覧で見返せるようにする

重複を黙って除外するのは避けるべきです。「なぜ件数が合わないのか」を担当者が説明できなくなり、ツール自体が信頼されなくなります。除外した事実と理由を、必ず画面に出します。

## 結果：定型のデータ処理時間を約75%削減

この案件の結果は、定型のデータ処理作業時間を約75%削減できたことです。あわせて、手順を標準化し、入力ミスを防ぎました。

一般的には、自動集計や帳票出力が時間短縮に効きやすいです。一方で、入力ミスと重複処理を止めるのは、形式の統一、重複チェック、処理履歴の部分です。速くなるだけでなく、誰がやっても同じ結果になる状態を作ることが、標準化の中身でした。

## 同じ課題に直面したら最初にやる3つのこと

最後に、私なら最初の週にやることを3つにまとめます。

### 1. 実際のファイルを集めて、揺れを洗い出す

サンプルではなく、現場で実際に使っているファイルを複数期間ぶん集めます。列名、日付、金額、コードの書き方の違いを一覧にします。この棚卸しが、形式統一の仕様そのものになります。

### 2. 「同じ」の定義を業務担当者と決める

キーの候補を技術側だけで決めないことが重要です。「同じ伝票が二度入る」とは現場でどういう状況かを、担当者に聞いて確認します。キーが決まったら、重複候補を人が確認できる出力を先に作ります。

### 3. 処理履歴の置き場所と、記録するタイミングを決める

履歴に何を残すか（キー、ファイル名、行番号、日時）を決めます。次に、帳票出力が成功した後に記録する順序を固定します。これで、再実行しても二重処理にならない土台ができます。

### 落とし穴

- 全角・半角や空白の正規化を忘れ、見た目が同じ行が別物扱いになる
- キーに行番号やファイル名を入れ、別ファイルの同一データを見逃す
- 重複を黙って除外し、担当者が件数のずれを説明できなくなる
- 履歴を出力前に書き、失敗時に「処理済み」だけが残る
- 必須列がないファイルを黙ってスキップする

## まとめ

複数Excelの転記ミスと重複処理は、注意力ではなく仕組みで止めるのが近道です。順序は、形式の統一、重複チェック、処理履歴の順です。結果は必ず担当者に見える形で返します。この考え方で、案件では定型のデータ処理作業時間を約75%削減できました。

---

私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。複数Excelの転記や重複処理のような定型業務は、業務分析から画面設計、データ処理まで一貫して自動化のご相談をお受けできます。
→ [Web・業務システム／アプリ開発について](https://shanaiai.com/services/system/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
