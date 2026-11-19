---
title: 工程ステータスの「古い画面からの上書き」をMySQLの楽観ロックと遷移表で防ぐ
tags:
  - MySQL
  - PHP
  - PDO
  - Database
  - 排他制御
private: false
updated_at: '2026-11-19T09:00:12+09:00'
id: c653a8e7b2567fb98e28
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
## 問題と得られるもの

工程ごとのステータスを複数人が更新する画面では、後から保存した人が先の更新を黙って上書きします。「完了」だった工程が、古い画面からの操作で「作業中」に戻る事故です。この記事では、MySQLとPHPで楽観ロックと遷移ルール、履歴テーブルを組み合わせ、この関数を通る更新について、この上書きを防ぐ実装を示します。

## 前提

- PHP 8.x、PDO（MySQL）、InnoDBを使う
- テーブルは `order_processes(order_id, process_code, status, updated_by, updated_at)` のような構成を想定する
- 以下のスキーマとコードは、この問題を再現するための例示である
- 防げるのは、この関数経由の更新だけである。関数を通らない直接のUPDATEや、他の経路からの更新は防げない

## なぜ上書きが起きるのか

典型的な流れは次のとおりです。

- 画面Aと画面Bが、同じ工程を「作業中」で表示している
- Aが「完了」に更新する
- Bは古い表示のまま「保留」を押し、「完了」が消える

`UPDATE ... WHERE order_id = ? AND process_code = ?` だけでは、更新時点の状態を誰も確認していません。私なら、画面が読んだ版（version）を更新時に突き合わせます。

## 手順1：version列と履歴テーブルを足す

```sql:migration.sql
ALTER TABLE order_processes
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE order_process_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  process_code VARCHAR(16) NOT NULL,
  from_status VARCHAR(16) NOT NULL,
  to_status VARCHAR(16) NOT NULL,
  changed_by INT UNSIGNED NOT NULL,
  changed_at DATETIME NOT NULL,
  KEY idx_order_proc (order_id, process_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

versionは更新のたびに1ずつ増やします。履歴には成功した遷移だけが残ります。version検査で拒否された更新は記録されないため、正常な遷移の経緯を追うための記録です。

## 手順2：遷移ルールとversion検査を1つの関数にまとめる

```php:ProcessStatus.php
<?php
declare(strict_types=1);

const TRANSITIONS = [
    'not_started' => ['in_progress'],
    'in_progress' => ['done', 'hold'],
    'hold'        => ['in_progress'],
    'done'        => [], // 戻すときは別の管理者操作にする
];

/** @return string ok | conflict | invalid | notfound */
function changeStatus(
    PDO $pdo, int $userId, int $orderId,
    string $process, string $to, int $expectedVersion
): string {
    $pdo->beginTransaction();
    try {
        $sel = $pdo->prepare(
            'SELECT status, version FROM order_processes
              WHERE order_id = ? AND process_code = ? FOR UPDATE'
        );
        $sel->execute([$orderId, $process]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $pdo->rollBack();
            return 'notfound';
        }
        if ((int)$row['version'] !== $expectedVersion) {
            $pdo->rollBack();
            return 'conflict';
        }
        if (!in_array($to, TRANSITIONS[$row['status']] ?? [], true)) {
            $pdo->rollBack();
            return 'invalid';
        }
        $upd = $pdo->prepare(
            'UPDATE order_processes
                SET status = ?, version = version + 1,
                    updated_by = ?, updated_at = NOW()
              WHERE order_id = ? AND process_code = ?'
        );
        $upd->execute([$to, $userId, $orderId, $process]);
        $his = $pdo->prepare(
            'INSERT INTO order_process_history
             (order_id, process_code, from_status, to_status, changed_by, changed_at)
             VALUES (?, ?, ?, ?, ?, NOW())'
        );
        $his->execute([$orderId, $process, $row['status'], $to, $userId]);
        $pdo->commit();
        return 'ok';
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
```

要点は次の3つです。

- `FOR UPDATE` で同じ行の更新を直列にし、versionの比較と更新の間に割り込まれないようにする
- versionが違えば `conflict` を返す。呼び出し側は、最新の状態を取り直して再表示する
- 遷移表にない変更は `invalid` にする。`done` から `in_progress` への巻き戻しを、通常の画面から出せなくする

画面には、表示時のversionを隠し値として持たせ、更新リクエストでそのまま送り返します。HTTPでは `conflict` を409で返すのが素直です。

## 動作の確認

MySQLクライアントを2つ開き、画面AとBを再現します。

- 両方で行を読む（version=0）
- Aが `changeStatus(..., 'in_progress', 0)` を実行する。`ok` になり、versionは1になる
- Bが同じ `expectedVersion=0` で `hold` を送る。`conflict` が返り、行は変わらない

`order_process_history` に1行だけ増えていれば成功です。PHPUnitでは、同じversionで2回呼んだ2回目が `conflict` になることをテストにできます。

## 落とし穴

- 完了の戻し方を決めずに `done` を終端にすると、現場が困る。管理者専用の操作を別に用意する
- `FOR UPDATE` を使うトランザクションは短くする。HTTP通信や重い処理を中に入れない
- 更新対象の行が存在しない場合、`FOR UPDATE` は何も確保しない。存在しない行は `notfound` として扱う
- 工程ごとの更新権限の検査は、この関数の前段で行う。版の検査と権限は別の関心事である
- 関数を通らない更新経路（直接のUPDATEや別のバッチなど）は、この仕組みでは止められない。更新経路を関数に一本化する必要がある

## 本番で私ならこうする

遷移表はコードにベタ書きせず、設定ファイルかテーブルに出します。現場の言葉でステータスが増えたとき、変更箇所を1つにするためです。409のときは、操作を黙って捨てず、最新の状態を見せて再操作してもらいます。上書きより、操作の失敗が見えるほうが現場の信頼を守れます。

## まとめ

ステータス更新の事故は、権限だけでは防げません。versionによる楽観ロック、遷移表、履歴の3点を1つの関数に入れると、この関数経由の更新については、古い画面からの上書きを防げます。履歴からは、成功した正常な遷移を追跡できます。拒否された更新は履歴に残らない点と、関数を通らない更新は防げない点には注意してください。まずは更新頻度の高い工程から、この関数に差し替えてみてください。
