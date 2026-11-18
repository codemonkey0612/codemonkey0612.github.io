---
title: 配送状況の確認時間を約70%短縮した話：電話と管理表をやめて最初に作った4つの機能
emoji: 🚚
type: tech
topics:
  - react
  - nodejs
  - postgresql
  - googlemaps
  - api
published: true
published_at: 2026-11-19 09:00
---

配送状況の確認にかかる時間を約70%短縮した、中堅物流会社向け配送・運行管理システム開発の実録です。最初に作ったのは「一覧」「担当者別検索」「地図表示」「ステータス更新」の4つで、履歴はその土台として同時に入れました。電話と管理表で運用している現場の開発を任された方が、何から作り何を後回しにするかを決める材料にしてください。

## 最初の状況：配送状況が電話と複数の管理表に散らばっていた

案件は2018年4月から2019年2月にかけての、中堅物流会社向けの配送・運行管理システム開発です。チームは6名で、PM1名、エンジニア3名、物流業務担当2名でした。私はフルスタックエンジニアとして、画面、API、DB設計、配送情報管理、地図連携、テストを担当しました。

課題は、配送状況が電話や複数の管理表に分散していたことです。管理者が最新の状況をつかむまでに時間がかかっていました。

ここで大事なのは、困りごとが「機能が足りない」ではなく「状況を知るまでが遅い」だった点です。この違いが、その後の優先順位をすべて決めました。

## まず決めたこと：作る機能を「状況を知るまでの時間」で絞る

業務担当の方々と話すと、要望は際限なく出てきます。私は要望を機能名ではなく、次の問いで並べ直しました。

- 管理者が「今あの荷物はどうなっているか」を知るまでに、何回の電話と何枚の表を経由しているか
- その手間を一番減らせる画面はどれか
- その画面が正しく動くために、先に必要なデータは何か

この問いで残ったのが次の4つです。

- 配送状況の一覧：全体を1画面で見られる。表を開く手間をなくす
- 担当者別検索：「この人の荷物は」という電話の問いに答える
- 地図表示：位置関係を言葉で説明する手間をなくす
- ステータス更新：最新でなければ、他の3つは意味がない

後回しにしたのは、レポート出力や細かい権限分けのような「状況を知るまでの時間」に直結しないものです。履歴は後回しにせず、ステータス更新と同時に作りました。理由は後述します。

私なら、この順で決めます。まず更新の経路を決め、次に読む画面を作ります。読む画面から作ると、データが古いままの見栄えだけのシステムになりやすいからです。

## 実装：一覧・担当者別検索・地図表示・ステータス更新・履歴

構成は React、Node.js（Express）、PostgreSQL の REST API です。以下は考え方を示す簡略版で、実案件のコードそのものではありません。

### テーブル設計

現在の状態を持つ `deliveries` と、変更の記録を持つ `delivery_events` に分けます。

```sql:schema.sql
CREATE TABLE drivers (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE deliveries (
  id          SERIAL PRIMARY KEY,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id),
  destination TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','picked_up','in_transit','delivered','problem')),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_events (
  id           BIGSERIAL PRIMARY KEY,
  delivery_id  INTEGER NOT NULL REFERENCES deliveries(id),
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_events_delivery ON delivery_events(delivery_id, created_at);
```

ステータスは CHECK 制約で縛っています。管理表時代の表記ゆれ（「配達中」「配送中」など）を、DB の入口で止めるためです。

### 一覧と担当者別検索

一覧と担当者別検索は、同じエンドポイントに絞り込み条件を足すだけにしました。画面ごとに別 API を作らないほうが、表示のずれが起きません。

```javascript:routes/deliveries.js
import express from "express";
import { Pool } from "pg";

export const pool = new Pool(); // 接続情報は環境変数（PG*）から読みます
export const router = express.Router();

router.get("/deliveries", async (req, res, next) => {
  try {
    const { driverId, status } = req.query;
    const where = [];
    const params = [];

    if (driverId) {
      params.push(Number(driverId));
      where.push(`d.driver_id = $${params.length}`);
    }
    if (status) {
      params.push(String(status));
      where.push(`d.status = $${params.length}`);
    }

    const sql = `
      SELECT d.id, d.destination, d.status, d.lat, d.lng, d.updated_at,
             dr.name AS driver_name
      FROM deliveries d
      JOIN drivers dr ON dr.id = d.driver_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY d.updated_at DESC
      LIMIT 200`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});
```

条件値は必ずプレースホルダで渡します。文字列連結で SQL を組むと、検索条件が増えるたびに事故の元になります。

### ステータス更新と履歴

更新は「現在値の更新」と「履歴の追加」を1トランザクションにします。どちらかだけ成功する状態を作らないためです。

```javascript:routes/status.js
import { router, pool } from "./deliveries.js";

const ALLOWED = {
  assigned: ["picked_up", "problem"],
  picked_up: ["in_transit", "problem"],
  in_transit: ["delivered", "problem"],
  problem: ["in_transit"],
  delivered: [],
};

router.patch("/deliveries/:id/status", async (req, res, next) => {
  const id = Number(req.params.id);
  const { status: next_status, note } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      "SELECT status FROM deliveries WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not found" });
    }
    const from = cur.rows[0].status;
    if (!ALLOWED[from]?.includes(next_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `${from} -> ${next_status} は不可` });
    }
    await client.query(
      "UPDATE deliveries SET status = $1, updated_at = now() WHERE id = $2",
      [next_status, id]
    );
    await client.query(
      `INSERT INTO delivery_events (delivery_id, from_status, to_status, note)
       VALUES ($1, $2, $3, $4)`,
      [id, from, next_status, note ?? null]
    );
    await client.query("COMMIT");
    res.json({ id, status: next_status });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});
```

ポイントは3つあります。

- `FOR UPDATE` で行をロックし、同時更新による遷移の食い違いを防ぐ
- 許可された遷移だけ受け付け、不正な更新は 409 で返す
- 履歴は更新と同じトランザクションで書く

履歴を最初から入れた理由は、電話をやめると「誰がいつ何と言ったか」の記録が消えるからです。電話の代わりになる証跡がないと、現場は新しい画面を信用してくれません。

### 地図表示

地図表示は、一覧と同じ API の `lat` と `lng` を使います。地図専用のデータ源は作りません。画面側は、位置を持つ行だけを Google Maps API のマーカーに変換します。

```javascript:src/toMarkers.js
export function toMarkers(deliveries) {
  return deliveries
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => ({
      id: d.id,
      position: { lat: d.lat, lng: d.lng },
      title: `${d.driver_name}：${d.destination}（${d.status}）`,
    }));
}
```

地図ライブラリ側のマーカー描画 API は更新されることがあります。実装時は必ず公式ドキュメントで最新の書き方を確認してください。変換部分を分けておけば、その差し替えも小さく済みます。

### 一覧の React 側

```jsx:src/DeliveryList.jsx
import { useEffect, useState } from "react";

export function DeliveryList({ driverId }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const q = driverId ? `?driverId=${encodeURIComponent(driverId)}` : "";
    const ctrl = new AbortController();
    fetch(`/api/deliveries${q}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setRows)
      .catch(() => {});
    return () => ctrl.abort();
  }, [driverId]);

  return (
    <ul>
      {rows.map((d) => (
        <li key={d.id}>
          {d.driver_name} / {d.destination} / {d.status}
        </li>
      ))}
    </ul>
  );
}
```

担当者を切り替えたときに古いリクエストの結果で上書きされないよう、`AbortController` で中断しています。

## API連携で更新と共有を一本化した判断

この案件では、API連携で情報の更新と共有を効率化しました。判断の軸は「書く場所を1つにする」ことです。

管理表が増えたのは、人や部署ごとに「自分の見たい形」で控えを作ったからです。そこで、更新は必ず REST API を通し、一覧、検索、地図、履歴はすべて同じデータを読む形にしました。

この形には利点が3つあります。

- 更新が1回で全画面に反映され、転記が要らない
- 遷移ルールの検証が API 1か所に集まる
- 将来、別のシステムや端末から更新する場合も、同じ API に載せられる

たとえば、新しい報告手段として別の入力画面を足す場面を考えます。そのときも直接 DB を触らせず、同じ更新 API を呼ばせます。そうすれば履歴と検証が自動で効きます。

## 結果：配送状況の確認時間を約70%短縮

結果として、配送状況の確認にかかる時間を約70%短縮しました。電話をかけて管理表を突き合わせる作業が、一覧を開いて担当者で絞り、必要なら地図で見る操作に置き換わったためです。

数字はこの案件の実績で、他の現場で同じ値が出ると保証するものではありません。削れる時間は、元の手間の大きさに左右されます。

## 同じ問題を抱えたら最初にやること

私なら次の順で進めます。

- 現状の「状況を知るまで」の手順を、電話の回数と表の枚数で書き出す
- 更新の経路を1つに決める（誰が、どの画面や API で書くか）
- ステータスの種類と遷移を、現場と一緒に表にして DB の制約にする
- 一覧と絞り込みを先に作り、現場で使ってもらう
- 地図と履歴は、同じデータを読む形で足す

### 落とし穴

- 読む画面を先に作り込む：更新が回らず、データが古くなる
- ステータスを自由入力にする：表記ゆれが管理表時代と同じ問題を再現する
- 履歴を後回しにする：後から付けても、過去の経緯は復元できない
- 画面ごとに API を分ける：画面間で表示が食い違う

## まとめ

要望を機能名ではなく「状況を知るまでの時間」で並べ直すと、作るものが4つに絞れました。更新の入口を API に一本化し、更新と履歴を同じトランザクションで書いたことが、現場の信頼につながったと考えています。まず更新経路、次に一覧、最後に地図という順を、判断の基準として持ち帰っていただければ幸いです。

---

私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。配送状況のように複数の場所に散らばった情報を一覧・検索・更新の仕組みに集約したい場合に、この記事の進め方がそのまま役立ちます。
→ [Web・業務システム／アプリ開発について](https://shanaiai.com/services/system/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
