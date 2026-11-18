---
title: 在庫更新の約80%を自動化したとき、二重更新と取りこぼしを防ぐために入れた4つの仕組み
emoji: 📦
type: tech
topics:
  - backend
  - api
  - mysql
  - php
  - python
published: true
published_at: 2026-11-20 09:00
---

販売サイトごとに商品コードも在庫形式も違うEC事業者の在庫更新を、約80%自動化した案件がありました。この記事ではその実録に沿って、二重更新と取りこぼしを防ぐために入れた4つの仕組みを紹介します。複数チャネルの在庫管理を自動化したいバックエンドエンジニアや、手作業の更新に限界を感じている運用担当の方に向けた内容です。

なお、コードは考え方を示すために書き直した最小例です。実案件のソースそのものではありません。

## 最初の状況：コードも在庫形式もバラバラだった

案件は2017年5月から11月にかけての、中堅EC事業者向け商品・在庫統合システムの開発です。体制はPM1名、エンジニア2名、EC運営担当2名の5名でした。私はバックエンドを担当し、DB設計、API連携、在庫同期、受注データ処理、エラー管理、テストを受け持ちました。

課題は次のとおりです。

- 販売サイトごとに商品コードが違う
- 在庫データの形式もサイトごとに違う
- 手作業で更新するため、在庫のずれや販売機会の損失が起きるおそれがあった

手作業の怖さは、ミスの量よりも「ずれに気づけないこと」にあります。そこで、先に「何を正とするか」を決めることにしました。

## 仕組み1：商品マスターを一本化して各サイトのコードを対応づける

最初に決めたのは、自社の商品マスターを唯一の正とすることです。各サイトの商品コードは、マスターに紐づく「外部コード」として持ちます。在庫の数字もマスター側の1か所だけに置きます。

私なら、在庫同期の実装より先にここを固めます。理由は、対応表が曖昧なままだと、後段の排他や再試行をどれだけ作っても、違う商品の在庫を正確に更新してしまうからです。

```sql:schema.sql
CREATE TABLE products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  sku VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE channel_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  channel VARCHAR(32) NOT NULL,
  channel_code VARCHAR(128) NOT NULL,
  UNIQUE KEY uq_channel_code (channel, channel_code),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE stocks (
  product_id BIGINT PRIMARY KEY,
  quantity INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

ポイントは `channel_items` の一意制約です。同じサイトの同じコードが2つの商品に結びつく事態を、DBが拒否します。対応表の誤りを運用ではなく制約で防ぎます。

対応づけできないコードが届いたときは、推測で補わずエラーとして記録します。これは後述のエラー通知につながります。

## 仕組み2：更新履歴を冪等キーとして使う

在庫更新で最も多い事故は、同じ注文や同じ連携データを2回処理することです。通信が途中で切れて再送された場合や、バッチが重なって動いた場合に起きます。

対策として、すべての増減を履歴テーブルに記録し、その一意制約で二重処理を弾きました。

```sql:stock_history.sql
CREATE TABLE stock_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  channel VARCHAR(32) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  delta INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event (channel, event_id)
);
```

`event_id` には、受注番号などサイト側が発行する一意の値を使います。同じ `(channel, event_id)` は2回入りません。

在庫を更新する処理の例です。

```python:apply_event.py
import pymysql


def apply_event(conn, channel, event_id, product_id, delta):
    """同じイベントは1回だけ反映する。反映したら True を返す。"""
    try:
        conn.begin()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO stock_history "
                "(product_id, channel, event_id, delta) "
                "VALUES (%s, %s, %s, %s)",
                (product_id, channel, event_id, delta),
            )
            cur.execute(
                "UPDATE stocks SET quantity = quantity + %s "
                "WHERE product_id = %s",
                (delta, product_id),
            )
        conn.commit()
        return True
    except pymysql.err.IntegrityError as e:
        conn.rollback()
        if e.args[0] == 1062:  # 重複キー。処理済みとみなす
            return False
        raise
    except Exception:
        conn.rollback()
        raise
```

ここでの選択理由は3つあります。

- 履歴の追加と在庫の更新を同じトランザクションに入れ、片方だけ成功する状態を作らない
- 在庫は「読んで計算して書く」のではなく `quantity = quantity + %s` で相対更新する。読み書きの隙間で他の更新を上書きしない
- 重複エラーは失敗ではなく「処理済み」として扱う。再送を安全にする

履歴は監査にも役立ちます。「この在庫はいつ、どのサイトの、どのイベントで変わったか」をたどれるため、ずれの調査が速くなります。

### 絶対値で上書きしたい場合の排他

サイトから「現在の在庫は10」と絶対値が届く場合は、相対更新が使えません。このときは行ロックで順序を守ります。MySQLのInnoDBでは、[MySQL公式ドキュメントのLocking Reads](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/innodb-locking-reads.html)にあるとおり、`SELECT ... FOR UPDATE` で読んだ行をロックできます。

```sql
START TRANSACTION;
SELECT quantity FROM stocks WHERE product_id = 1 FOR UPDATE;
-- アプリ側で差分を計算し、履歴に記録する
UPDATE stocks SET quantity = 10 WHERE product_id = 1;
COMMIT;
```

同じ商品の更新が同時に来ても、後続はロック解放を待つので競合しません。ただしロックを持ったまま外部APIを呼ぶのは避けます。待ち時間が延び、他の更新が詰まるためです。

履歴をまとめて取り込むときは、[INSERT ... ON DUPLICATE KEY UPDATE](https://docs.oracle.com/cd/E17952_01/mysql-8.0-en/insert-on-duplicate.html) も選択肢です。ただし私は、重複を「更新」ではなく「無視」したい場面が多いため、上のように明示的に重複エラーを判定する形を好みます。

## 仕組み3：定期実行バッチは「送信キュー」を処理する

マスターの在庫が変わったら、各サイトへ反映する必要があります。ここで、在庫が変わった瞬間にAPIを直接叩くのは避けました。かわりに、送信ジョブをテーブルに積み、Cronで動くバッチが処理します。

```sql:push_jobs.sql
CREATE TABLE stock_push_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  channel VARCHAR(32) NOT NULL,
  status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_run_at DATETIME NOT NULL,
  last_error TEXT NULL,
  UNIQUE KEY uq_job (product_id, channel)
);
```

このテーブルは、商品とサイトの組み合わせごとに1行だけ持つ設計です。在庫が変わったら新しい行を足すのではなく、既存のジョブを `pending` に戻して再利用します。

```sql
INSERT INTO stock_push_jobs (product_id, channel, next_run_at)
VALUES (1, 'site_a', NOW())
ON DUPLICATE KEY UPDATE
  status = 'pending', attempts = 0, next_run_at = NOW();
```

一意制約に `status` を含めていないので、同じ組み合わせの未処理ジョブが重なりません。完了や失敗の履歴はこの表ではなく、`last_error` と `stock_history` で追います。

バッチは、送信する数量を「ジョブ作成時」ではなく「送信時」にマスターから読みます。理由は、再試行で遅れたジョブが古い数量を送り、新しい在庫を上書きする事故を避けるためです。

```python:push_batch.py
import datetime as dt


def run_batch(conn, push_fn, max_attempts=5):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, product_id, channel, attempts FROM stock_push_jobs "
            "WHERE status = 'pending' AND next_run_at <= NOW() "
            "ORDER BY id LIMIT 100"
        )
        jobs = cur.fetchall()

    for job_id, product_id, channel, attempts in jobs:
        try:
            qty = read_quantity(conn, product_id)  # 送信時の最新値
            push_fn(channel, product_id, qty)
            mark(conn, job_id, "done", attempts + 1, None, None)
        except Exception as e:
            n = attempts + 1
            if n >= max_attempts:
                mark(conn, job_id, "failed", n, str(e), None)
                notify_failure(job_id, product_id, channel, str(e))
            else:
                wait = dt.timedelta(minutes=2 ** n)  # 2,4,8,16分
                next_at = dt.datetime.now() + wait
                mark(conn, job_id, "pending", n, str(e), next_at)
```

`read_quantity`、`mark`、`notify_failure` は、それぞれ数量の取得、ジョブ状態の更新、通知をする関数です。ここでは省略しています。

Cronの設定は次のようにします。

```cron
*/5 * * * * flock -n /tmp/push_batch.lock python3 /opt/app/push_batch.py
```

`flock -n` で、前回のバッチが終わっていなければ今回は起動しません。バッチの多重起動が、二重更新の典型的な原因だからです。複数台で動かす場合はファイルロックでは足りないので、DB側でジョブを「処理中」に変える手順が要ります。

## 仕組み4：エラー通知と再試行で「止まっても気づける」ようにする

自動化で一番怖いのは、静かに止まることです。手作業なら「やっていない」ことに誰かが気づきますが、バッチは失敗しても何も言いません。そこで次のルールにしました。

- 一時的な失敗（通信エラーなど）は、間隔を空けて自動で再試行する
- 規定回数を超えたら `failed` にして、担当者へ通知する
- 商品コードの対応が見つからないデータも、捨てずにエラーとして残す
- `failed` の件数を確認できる画面や集計を用意する

再試行の間隔を指数的に延ばすのは、相手のサイトが不調のときに、こちらが追い打ちをかけないためです。回数に上限を設けるのは、永遠に失敗し続けるジョブがキューを埋めるのを防ぐためです。

通知は「失敗した事実」だけでなく、商品、サイト、直近のエラー内容を含めます。受け取った運用担当が、開発者に聞かず判断できる情報量にするのが目安です。通知が多すぎると無視されるので、一時的な失敗では鳴らさず、再試行が尽きた時点で鳴らす設計にしました。

## 結果：在庫更新作業の約80%を自動化

商品マスターの統一、在庫同期API、定期実行バッチ、更新履歴、エラー通知、再試行処理を実装し、更新の競合や重複を防ぐ仕組みにしました。結果として、在庫更新作業の約80%を自動化し、複数チャネルの管理負担を減らせました。

残りの約20%は、例外的な対応や判断が要る作業です。無理に全自動を狙わず、人が見るべきものをエラー通知で人に渡す設計にしたことが、運用に馴染んだ理由だと考えています。

## 同じ問題に直面したら最初にやること

私なら、次の順で進めます。

1. 販売サイトごとのコードと在庫形式を、一覧にして洗い出す
2. 自社の商品マスターを正として決め、対応表に一意制約をかける
3. 在庫の増減はすべて履歴に残し、イベントごとの一意キーを決める
4. 更新は相対更新にするか、行ロックで順序を守る
5. 各サイトへの送信はキュー化し、再試行と失敗通知を先に作る

### たとえば、の例

たとえば、3つの販売サイトで同じ商品が別々のコードで売られているとします。この場合、最初の作業は同期処理を書くことではなく、1つの `sku` に3つの `channel_code` を結びつける表を作ることです。

次に、サイトAの注文番号を `event_id` として履歴に入れます。同じ注文が再送されても、重複キーで弾かれて在庫は減りません。こうして二重更新の入口を先に塞いでから、送信側の再試行を作ります。

## 落とし穴

- 対応表の整備を後回しにすると、後からの修正が大変になる。まず棚卸しに時間をかける
- `event_id` が安定しないサイトでは、複数の項目から合成した値を使う。ただし合成が変わると重複を検知できない
- ロックを持ったまま外部APIを呼ぶと、他の更新が詰まる
- 通知が多すぎると、本当に重要なものが埋もれる
- 再試行をただ増やすと、相手のサイトに負荷をかける

## まとめ

在庫の自動化では、同期の速さよりも「同じ更新を2回しない」「失敗を取りこぼさない」ことが大切です。商品マスターの一本化、履歴による重複排除、キューとロックによる競合回避、通知付きの再試行の4つが、私の案件で効いた仕組みです。まず商品コードの対応表から始めるのをおすすめします。

---

私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。複数チャネルの在庫連携や更新履歴、エラー通知を備えた業務システムの設計・開発も、この記事の経験を踏まえてご相談いただけます。
→ [Web・業務システム／アプリ開発について](https://shanaiai.com/services/system/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
