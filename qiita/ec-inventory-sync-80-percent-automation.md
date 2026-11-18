---
title: MySQLのSKIP LOCKEDで送信ジョブの多重実行を防ぐ：flock卒業とリース設計
tags:
  - MySQL
  - Python
  - バッチ処理
  - 排他制御
private: false
ignorePublish: true
zenn: off-zenn/ec-inventory-sync-80-percent-automation.md
published_at: 2026-11-20 09:00
---

在庫連携のバッチをCronとflockで動かしていると、サーバーを2台にした途端に同じジョブを二重に処理する問題が出ます。この記事では、MySQLの `SKIP LOCKED` とリース（貸出期限）で、複数ワーカーが同じジョブを取り合わない仕組みを作ります。

## 背景

以前、中堅EC事業者向けの商品・在庫統合システムで、販売サイトへの在庫送信をテーブルのキュー経由にしました。バッチはCronで定期実行し、`flock -n` で多重起動を防いでいました。

1台ならこれで足ります。ただし台数を増やすと、ファイルロックは台をまたいで効きません。私ならこの段階で、ロックの置き場所をDBに移します。

## 前提環境

- MySQL 8.0 以降（InnoDB）
- Python 3.11 と PyMySQL
- 送信キューは `stock_push_jobs`（商品×サイトで1行）

`SKIP LOCKED` は、[MySQL公式ドキュメントのLocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)にあるとおり、行ロックの待ちが発生せず、ロック中の行を読み飛ばします。

## 方針：短い取得トランザクション＋リース

考え方は3つです。

- ジョブの取得だけを短いトランザクションで行い、すぐコミットする
- 取得した行は `running` にして、持ち主と期限を書き込む
- 外部APIの呼び出しはトランザクションの外で行う

行ロックを持ったまま外部APIを呼ぶと、他の更新が詰まります。そこでロックは取得の一瞬だけにし、その後はステータスと期限で「貸出中」を表します。

### テーブルの拡張

```sql:alter_jobs.sql
ALTER TABLE stock_push_jobs
  MODIFY status ENUM('pending','running','done','failed')
    NOT NULL DEFAULT 'pending',
  ADD COLUMN locked_by VARCHAR(64) NULL,
  ADD COLUMN locked_until DATETIME NULL,
  ADD INDEX idx_pick (status, next_run_at);
```

`locked_until` が過ぎた `running` は、ワーカーが落ちたとみなして再取得の対象にします。これがリースです。

### ジョブを取得する関数

```python:claim.py
def claim_jobs(conn, worker_id, limit=50, lease_min=5):
    """未処理か期限切れのジョブを取り、running にして返す。"""
    conn.begin()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, product_id, channel, attempts "
                "FROM stock_push_jobs "
                "WHERE (status = 'pending' AND next_run_at <= NOW()) "
                "   OR (status = 'running' AND locked_until < NOW()) "
                "ORDER BY id LIMIT %s FOR UPDATE SKIP LOCKED",
                (limit,),
            )
            rows = cur.fetchall()
            if rows:
                ids = [r[0] for r in rows]
                marks = ",".join(["%s"] * len(ids))
                cur.execute(
                    "UPDATE stock_push_jobs SET status = 'running', "
                    "locked_by = %s, "
                    "locked_until = NOW() + INTERVAL %s MINUTE "
                    f"WHERE id IN ({marks})",
                    (worker_id, lease_min, *ids),
                )
        conn.commit()
        return rows
    except Exception:
        conn.rollback()
        raise
```

SELECTで行ロックを取り、同じトランザクションでUPDATEまで済ませます。別のワーカーは、ロック中の行を読み飛ばして次の行を取ります。

### 完了と失敗の書き込み

```python:finish.py
def finish(conn, job_id, worker_id, status, attempts,
           error=None, next_at=None):
    """持ち主が自分のときだけ状態を更新する。成功なら True。"""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE stock_push_jobs SET status = %s, attempts = %s, "
            "last_error = %s, next_run_at = COALESCE(%s, next_run_at), "
            "locked_by = NULL, locked_until = NULL "
            "WHERE id = %s AND locked_by = %s",
            (status, attempts, error, next_at, job_id, worker_id),
        )
        updated = cur.rowcount
    conn.commit()
    return updated == 1
```

`WHERE locked_by = %s` が肝です。処理が遅れてリースが切れ、別のワーカーに渡った後で、元のワーカーが結果を書き戻す事故を防げます。`False` が返ったら、自分のリースは失効しています。ログに残して破棄します。

## 動作確認

MySQLクライアントを2つ開いて確認します。

1. 端末Aで `START TRANSACTION;` のあと、上の `SELECT ... FOR UPDATE SKIP LOCKED` を `LIMIT 1` で実行する
2. コミットせずに、端末Bで同じSELECTを実行する
3. Bには、Aが握っていない別の行が返る

次に、`claim_jobs` を別々のworker_idで同時に呼ぶテストも用意します。戻ったidの集合に重なりがなければ成功です。期限切れの確認は、`locked_until` を過去にして再取得されることを見ます。

## 落とし穴

- 公式ドキュメントに、ロック行を飛ばす読み取りは一貫性のないビューを返すという注意がある。キュー取得専用とし、集計には使わない。
- リース時間が処理時間より短いと、同じジョブが二重に送られる。最長の処理時間より十分長く取る。
- リースが切れても、元のワーカーの送信自体は止まらない。送信は冪等にする。送信時にマスターから最新の数量を読む形なら、古い値での上書きを避けられる。
- `(status, next_run_at)` のインデックスがないと、取得のたびに多くの行へロックがかかる。
- 自動コミットが有効なままだと、SELECTのロックが即座に外れる。`conn.begin()` で明示的に開始する。

## 本番ならどうするか

台数が少なく、ジョブの量も多くない間は、DBキューで十分だと考えています。メッセージキューを足すと、運用する部品が増えるからです。

ただし、秒単位の遅延や大量のスループットが要るなら、専用のキューへ移すのが妥当です。その場合も、完了書き込みの持ち主チェックと冪等な送信は、そのまま使えます。

## まとめ

- `flock` は台をまたげないので、複数台ではDB側で取得を排他する
- 取得は `FOR UPDATE SKIP LOCKED` の短いトランザクションで行う
- 外部呼び出しはロックの外で行い、リースで貸出中を表す
- 完了は持ち主を条件にして、遅れたワーカーの書き戻しを防ぐ
