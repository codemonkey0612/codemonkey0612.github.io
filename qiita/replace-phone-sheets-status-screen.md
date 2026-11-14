---
title: PostgreSQLとFastAPIで作る、状態遷移を守る更新APIと履歴テーブル
tags:
  - PostgreSQL
  - FastAPI
  - Python
  - SQL
  - API設計
private: false
ignorePublish: true
zenn: articles/replace-phone-sheets-status-screen.md
published_at: 2026-11-16 09:00
---

## 解決したい問題

配送や案件の一覧画面を作ると、更新APIで必ず同じ問題が出ます。「配達済」から「出発」へ戻るような不正な遷移と、二人が同時に更新したときの上書きです。さらに「誰がいつ変えたか」も残す必要があります。

この記事では、遷移ルールを表で持ち、更新と履歴の記録を1本のSQLにまとめる方法を示します。

## 前提

- PostgreSQL 10以降（`GENERATED ALWAYS AS IDENTITY` が使える版）
- Python 3 と FastAPI、psycopg 3
- 接続先は環境変数 `DATABASE_URL` から読む

動作確認はローカルのPostgreSQLで行う想定です。`GENERATED AS IDENTITY` は[PostgreSQL Identity Column（Neon）](https://neon.com/postgresql/tutorial/identity-column)にあるとおり、バージョン10で導入された機能です。そのためPostgreSQL 10以降で動作します。それ以外にバージョン固有の機能は使っていません。

## 方針

アプリのコードに `if` で遷移ルールを書くと、画面とバッチで条件がずれやすくなります。そこで次の三つをDB側に寄せます。

- 許可する遷移は `status_transitions` テーブルに持つ
- 楽観ロックとして `version` 列を使う
- 履歴は更新と同じSQL文の中で挿入する

私が関わった配送・運行管理システムでも、ステータス更新と配送履歴は一覧画面の土台でした。ここではその考え方を、新しく書き起こした最小構成で示します。

## スキーマ

```sql:schema.sql
CREATE TABLE status_transitions (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

CREATE TABLE deliveries (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      text NOT NULL,
  assignee   text NOT NULL,
  status     text NOT NULL DEFAULT 'accepted',
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id bigint NOT NULL REFERENCES deliveries(id),
  from_status text NOT NULL,
  to_status   text NOT NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON deliveries (assignee, status);

INSERT INTO status_transitions VALUES
  ('accepted', 'arranged'),
  ('arranged', 'departed'),
  ('departed', 'delivered'),
  ('accepted', 'on_hold'),
  ('arranged', 'on_hold'),
  ('on_hold',  'accepted');
```

`deliveries` の `(assignee, status)` 索引は、担当者別に絞り込む一覧画面を想定したものです。保留だけは別枠として、戻れる先を `accepted` に限っています。

## 更新APIの実装

更新は、対象行のロック、遷移の確認、versionの照合、履歴の挿入を1文で行います。

```python:main.py
import os

import psycopg
from fastapi import FastAPI, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

app = FastAPI()
DSN = os.environ["DATABASE_URL"]

UPDATE_SQL = """
WITH target AS (
  SELECT id, status AS old_status
  FROM deliveries
  WHERE id = %(id)s
  FOR UPDATE
), updated AS (
  UPDATE deliveries d
  SET status = %(to)s, version = d.version + 1, updated_at = now()
  FROM target t
  WHERE d.id = t.id
    AND d.version = %(version)s
    AND EXISTS (
      SELECT 1 FROM status_transitions s
      WHERE s.from_status = t.old_status AND s.to_status = %(to)s
    )
  RETURNING d.id, d.version, t.old_status
)
INSERT INTO delivery_history (delivery_id, from_status, to_status, changed_by)
SELECT id, old_status, %(to)s, %(by)s FROM updated
RETURNING delivery_id
"""


class StatusChange(BaseModel):
    to: str
    version: int
    by: str


@app.patch("/deliveries/{delivery_id}/status")
async def change_status(delivery_id: int, body: StatusChange):
    params = {"id": delivery_id, "to": body.to,
              "version": body.version, "by": body.by}
    async with await psycopg.AsyncConnection.connect(
        DSN, row_factory=dict_row
    ) as conn:
        cur = await conn.execute(UPDATE_SQL, params)
        if await cur.fetchone():
            return {"ok": True}
        cur = await conn.execute(
            "SELECT status, version FROM deliveries WHERE id = %s",
            (delivery_id,),
        )
        current = await cur.fetchone()
    if current is None:
        raise HTTPException(404, "not found")
    raise HTTPException(409, {"message": "conflict", "current": current})
```

### 各部分の役割

- `FOR UPDATE` で対象行をロックし、同時更新を順番に処理する
- `d.version = %(version)s` で、画面を開いた後に他者が更新していないかを確認する
- `EXISTS` で許可された遷移だけを通す
- 最後の `INSERT ... SELECT` は、更新が成功した行にだけ履歴を作る

どれか一つでも満たさないと、`updated` が空になり履歴も作られません。更新と履歴が食い違うことはありません。

### 接続の扱い

`async with` を抜けるときに、例外がなければコミットされます。例では簡単さを優先して、リクエストごとに接続しています。本番では接続プールを使ってください。

## 動作確認

テストデータを入れて、次の順に試します。

```sql
INSERT INTO deliveries (title, assignee) VALUES ('テスト配送', 'tanaka');
```

```bash
# 1. 正常な遷移（accepted -> arranged）は 200
curl -X PATCH localhost:8000/deliveries/1/status \
  -H 'Content-Type: application/json' \
  -d '{"to":"arranged","version":1,"by":"tanaka"}'

# 2. 古い version で別ユーザーが更新すると 409（現在の status と version が返る）
curl -X PATCH localhost:8000/deliveries/1/status \
  -H 'Content-Type: application/json' \
  -d '{"to":"departed","version":1,"by":"sato"}'

# 3. 不正な遷移（arranged -> delivered）は 409
curl -X PATCH localhost:8000/deliveries/1/status \
  -H 'Content-Type: application/json' \
  -d '{"to":"delivered","version":2,"by":"tanaka"}'
```

その後 `SELECT * FROM delivery_history;` で、成功した1件だけが残っていることを確認します。

## 落とし穴

### 409の理由が一つにまとまる

versionの不一致と不正な遷移は、どちらも409です。画面側では、返ってきた現在値を見て再読み込みを促します。理由を分けたい場合は、失敗後の `SELECT` で遷移表も引いて判定します。

### ステータス名の誤字

`deliveries.status` に外部キーがないと、存在しない値が入り得ます。更新は遷移表を通るので防げますが、初期値や手作業のSQLは別です。`status_transitions` を参照する外部キーや、別のマスターテーブルの追加を検討してください。

### 履歴の改ざん

履歴テーブルは追記専用にします。アプリ用のDBロールには `UPDATE` と `DELETE` の権限を与えないのが安全です。

### 遷移を変えたいとき

遷移表の行を足すだけで済みます。これがコードに `if` を書かない利点です。ただし変更時は、現場で使っている状況の言葉と合っているかを先に確認してください。

## まとめ

- 許可する遷移は表で持ち、更新SQLの `EXISTS` で強制する
- `version` の照合で、同時更新による上書きを防ぐ
- 履歴は更新と同じ文で挿入し、食い違いを作らない
- 409の応答に現在値を含め、画面側で再読み込みしやすくする

一覧画面の価値は、表示されている状況を信頼できることにあります。その土台として、更新APIを小さく堅く作っておくと後の拡張が楽になります。
