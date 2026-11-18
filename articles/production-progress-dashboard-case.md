---
title: 生産管理の「進捗を聞いて回る」をやめて、進捗確認を約60%短縮した話
emoji: 🏭
type: tech
topics:
  - database
  - php
  - mysql
  - dashboard
  - design
published: true
published_at: 2026-11-19 09:00
---

生産計画・工程進捗・在庫を1つのDBに統合し、担当者別の更新権限と工程別ステータスを決めた結果、手作業の管理工数は約40%減り、進捗確認にかかる時間は約60%短縮されました。部門ごとに管理方法がばらばらな製造現場で、「進捗を聞いて回る」運用から抜け出したい engineer の方に向けて、案件で決めたことと、同じ状況なら私が最初にやることを整理します。

なお、以下で「実際にやったこと」として書くのは、案件の概要に沿った範囲だけです。スキーマやコードは、同じ考え方を再現するための例示（たとえば、という前提のもの）です。

## 最初の状況：生産状況を知るには複数の担当者に聞くしかなかった

これは2015年4月から2016年3月にかけて参加した、中堅製造メーカー向けの生産管理・工程可視化システム開発です。体制は5名（PM1名、エンジニア2名、業務担当2名）で、私はフルスタックエンジニアとして、業務ヒアリングから要件定義、画面・DB設計、フロントとバックエンドの開発、テスト、導入支援までを担当しました。

課題はシンプルでした。部門ごとに管理方法とデータ形式が違い、生産状況を知るには複数の担当者に問い合わせる必要がありました。

この状態の問題は、情報が存在しないことではありません。情報が「人の頭と各部門の台帳」に分散していて、全体を見る手段がないことです。

## 転記ミスと更新漏れはどこで起きていたか

転記ミスと更新漏れが発生していたことは、案件の課題として確認できています。ここから先は一般論として、こうした現場で起きやすい箇所を書きます。

- 部門の境界：ある部門の出力を、別の部門が自分の形式に書き写すところ
- 同じ情報の複数保管：計画と実績、在庫が別々の台帳にあるところ
- 更新責任の不在：誰が更新するのか決まっていないところ

転記は、データ形式が違うから必要になります。更新漏れは、責任が曖昧だから起きます。つまり対策は「入力を頑張る」ことではなく、形式を1つにすることと、責任を明文化することです。

## 選んだこと：生産計画・工程進捗・在庫を1つのDBに統合

私たちは、生産計画・工程進捗・在庫を統合したDBを設計しました。技術スタックはPHP、JavaScript、jQuery、MySQL、HTML/CSS、Linuxです。

同じ状況なら、私は次のような構成から考えます。以下は例示のスキーマです。

```sql:schema.sql
CREATE TABLE products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE production_orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_processes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  process_code VARCHAR(16) NOT NULL,
  seq TINYINT UNSIGNED NOT NULL,
  status ENUM('not_started','in_progress','done','hold') NOT NULL DEFAULT 'not_started',
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_order_proc (order_id, process_code),
  FOREIGN KEY (order_id) REFERENCES production_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inventory (
  product_id INT UNSIGNED PRIMARY KEY,
  stock_qty INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

ポイントは、計画（production_orders）、工程進捗（order_processes）、在庫（inventory）が、共通の製品マスタと注文IDでつながっていることです。これで「転記」という作業の入る余地がなくなります。

## 担当者別の更新権限と工程別ステータスで「誰が何を更新するか」を決める

案件では、担当者別の更新権限と工程別ステータスを実装しました。考え方は「工程ごとに更新できる人を1つに絞る」です。

### 権限の持ち方

私なら、ユーザーと工程の対応表を用意します。

```sql:permissions.sql
CREATE TABLE user_process_permissions (
  user_id INT UNSIGNED NOT NULL,
  process_code VARCHAR(16) NOT NULL,
  PRIMARY KEY (user_id, process_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

更新時は、この表に該当行があるときだけ許可します。PHPでの例です。

```php:update_status.php
<?php
declare(strict_types=1);

const ALLOWED = ['not_started', 'in_progress', 'done', 'hold'];

function updateStatus(PDO $pdo, int $userId, int $orderId, string $process, string $status): bool
{
    if (!in_array($status, ALLOWED, true)) {
        return false;
    }
    $chk = $pdo->prepare(
        'SELECT 1 FROM user_process_permissions WHERE user_id = ? AND process_code = ?'
    );
    $chk->execute([$userId, $process]);
    if (!$chk->fetchColumn()) {
        return false; // 担当外の工程は更新不可
    }
    $upd = $pdo->prepare(
        'UPDATE order_processes
            SET status = ?, updated_by = ?, updated_at = NOW()
          WHERE order_id = ? AND process_code = ?'
    );
    return $upd->execute([$status, $userId, $orderId, $process]);
}
```

説明すると、まずステータス値をホワイトリストで検証します。次に権限表で担当工程かを確認し、プリペアドステートメントで更新します。updated_by と updated_at が残るので、「いつ誰が更新したか」も追えます。

### ステータス設計のコツ

ステータスは少なく、意味が重ならないようにします。上の例では未着手・作業中・完了・保留の4つです。現場の言葉に合わせて増やすのは構いません。ただし、増やす前に「ダッシュボードで区別して見たいか」を確認します。見ないなら増やさないほうが、更新漏れは減ります。

## 進捗ダッシュボードと検索の実装、結果

案件では検索と進捗ダッシュボードを実装しました。例として、注文ごとの工程の進み具合を1クエリで取る形を示します。

```sql:dashboard.sql
SELECT o.id, p.code, p.name, o.due_date,
       SUM(op.status = 'done') AS done_cnt,
       COUNT(op.id) AS total_cnt,
       MAX(op.status = 'hold') AS has_hold
FROM production_orders o
JOIN products p ON p.id = o.product_id
JOIN order_processes op ON op.order_id = o.id
GROUP BY o.id, p.code, p.name, o.due_date
ORDER BY o.due_date;
```

これに製品コードなどの絞り込みを足せば、検索になります。フロントは jQuery で、一定間隔で JSON を取りに行く形が素直です。

```javascript:dashboard.js
function loadDashboard(keyword) {
  $.getJSON('/api/dashboard.php', { q: keyword || '' }, function (rows) {
    var $tbody = $('#board tbody').empty();
    $.each(rows, function (_, r) {
      var pct = Math.round((r.done_cnt / r.total_cnt) * 100);
      var $tr = $('<tr>');
      $tr.append($('<td>').text(r.code));
      $tr.append($('<td>').text(r.name));
      $tr.append($('<td>').text(r.due_date));
      $tr.append($('<td>').text(pct + '%'));
      if (Number(r.has_hold) === 1) { $tr.addClass('hold'); }
      $tbody.append($tr);
    });
  });
}
$('#search').on('input', function () { loadDashboard($(this).val()); });
```

ここでは `.text()` を使い、値をそのまま HTML に差し込まないようにしています。XSS を避けるための基本です。

### 結果

結果として、手作業による管理工数は約40%削減、進捗確認にかかる時間は約60%短縮されました。聞いて回る代わりに、画面を1つ見れば済むようになったということです。

## 同じ問題に直面したら最初にやること

私なら、コードを書く前に次の順で進めます。

- 現状の台帳を全部集め、項目と形式の違いを一覧にする
- 同じ情報が複数の場所にある箇所を洗い出す
- 工程ごとに「誰が更新するか」を1人（1役割）に決める
- ステータスの種類を、ダッシュボードで見たい区別に絞る
- 最初のリリースは、計画・進捗・在庫の最小限の項目だけにする

業務担当者と画面のイメージを早く共有することも大切です。現場が使わなければ、更新漏れは元に戻ります。

## 落とし穴

- ステータスを増やしすぎると、入力が面倒になり更新が止まる。
- 権限を厳しくしすぎると、緊急時に誰も更新できなくなる。例外時の運用も決めておく。
- 既存データの移行は、形式の揺れの確認に時間がかかる。余裕を見ておく。

## まとめ

部門ごとの管理がばらばらな現場では、まず形式を1つにし、更新責任を工程単位で決めることが先です。そのうえで進捗を1画面で見られるようにすると、「聞いて回る」作業を大幅に減らせます。この案件では、管理工数約40%削減、進捗確認約60%短縮という結果になりました。

---
私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。生産管理のように部門をまたぐ業務データの統合と可視化は、このサービスの典型的なテーマです。
→ [Web・業務システム／アプリ開発について](https://shanaiai.com/services/system/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
