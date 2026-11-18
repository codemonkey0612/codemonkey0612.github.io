---
title: 配送ステータス更新の二重送信と順序逆転をPostgreSQLの冪等キーで防ぐ
tags:
  - PostgreSQL
  - Node.js
  - Express
  - API設計
  - 冪等性
private: false
ignorePublish: true
zenn: off-zenn/delivery-status-time-cut-70.md
published_at: 2026-11-19 09:00
---

配送ステータスを現場の端末から更新するAPIでは、再送による二重登録と、古い報告が新しい状態を上書きする問題が起きます。この記事では、イベントIDによる冪等化と、発生時刻による上書き判定をPostgreSQLの1トランザクションで実現する方法を、動くコードで示します。

## 問題：電波の悪い場所では「同じ更新が2回、順番も逆」で届く

たとえば、ドライバーが荷下ろし先で「配達完了」を押したとします。電波が弱く、アプリは応答がないので自動で再送します。実際は1回目も届いていた場合、サーバーには同じ更新が2回届きます。

さらに、先に押した「集荷済み」の送信が遅れ、「配達完了」より後に到着することもあります。何も対策しないと、状態が「集荷済み」に戻ります。

私はこの種の更新APIを、次の2点だけは必ず入れて設計します。

- クライアントが採番するイベントIDで、再送を無害にする
- 端末で操作が起きた時刻で、古い報告による上書きを防ぐ

## 前提

- PostgreSQL（`ON CONFLICT` が使えるもの）
- Node.js（ESM）、Express、`pg`
- 以下は考え方を示す簡略版であり、認証は省略している

## 手順1：スキーマにイベントIDと発生時刻を足す

```sql:schema.sql
CREATE TABLE deliveries (
  id            SERIAL PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','picked_up','in_transit','delivered','problem')),
  last_event_at TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_events (
  id              BIGSERIAL PRIMARY KEY,
  delivery_id     INTEGER NOT NULL REFERENCES deliveries(id),
  client_event_id UUID NOT NULL UNIQUE,
  to_status       TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  applied         BOOLEAN NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

ポイントは `client_event_id` の UNIQUE 制約です。重複排除をアプリの if 文ではなく、DBの制約に任せます。並行リクエストでも破れません。

`applied` 列は、その報告が現在状態に反映されたかを残します。古くて反映しなかった報告も、履歴には残すためです。

## 手順2：APIを実装する

```javascript:routes/events.js
import express from "express";
import { Pool } from "pg";

const pool = new Pool(); // 接続情報は環境変数（PG*）から読みます
export const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["assigned", "picked_up", "in_transit", "delivered", "problem"];
const MAX_FUTURE_MS = 5 * 60 * 1000;

router.post("/deliveries/:id/events", async (req, res, next) => {
  const id = Number(req.params.id);
  const { eventId, status, occurredAt } = req.body;

  const occurred = new Date(occurredAt);
  if (!UUID_RE.test(eventId) || !STATUSES.includes(status) || isNaN(occurred)) {
    return res.status(400).json({ error: "invalid request" });
  }
  // 端末の時計が進んでいても、未来の時刻で状態が固定されないようにする
  const limit = new Date(Date.now() + MAX_FUTURE_MS);
  const at = occurred > limit ? limit : occurred;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query(
      "SELECT last_event_at FROM deliveries WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not found" });
    }
    const last = cur.rows[0].last_event_at;
    const applied = last === null || at > last;

    const ins = await client.query(
      `INSERT INTO delivery_events
         (delivery_id, client_event_id, to_status, occurred_at, applied)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_event_id) DO NOTHING
       RETURNING id`,
      [id, eventId, status, at, applied]
    );

    if (ins.rowCount === 0) {
      await client.query("COMMIT");
      return res.status(200).json({ duplicate: true });
    }

    if (applied) {
      await client.query(
        `UPDATE deliveries
            SET status = $1, last_event_at = $2, updated_at = now()
          WHERE id = $3`,
        [status, at, id]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ duplicate: false, applied });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});
```

流れは次のとおりです。

- 入力を検証し、未来すぎる時刻は丸める
- `FOR UPDATE` で配送行をロックし、同じ配送への同時更新を直列にする
- 履歴をINSERTし、イベントIDが重複なら何もせず200で返す
- 新しい報告のときだけ、現在状態を更新する

重複時に409ではなく200を返すのが肝です。クライアントから見て「届いた」ことに変わりはなく、再送ループを止められます。

## 動作確認

同じイベントを2回送ります。

```bash
curl -s -X POST localhost:3000/deliveries/1/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"11111111-1111-4111-8111-111111111111","status":"delivered","occurredAt":"2026-11-18T10:00:00Z"}'
# {"duplicate":false,"applied":true}
```

同じコマンドをもう一度打つと、`{"duplicate":true}` が返ります。次に、より古い時刻で別のIDを送ります。

```bash
curl -s -X POST localhost:3000/deliveries/1/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"22222222-2222-4222-8222-222222222222","status":"picked_up","occurredAt":"2026-11-18T09:00:00Z"}'
# {"duplicate":false,"applied":false}
```

`deliveries.status` が `delivered` のままで、`delivery_events` には2行あることをSQLで確認してください。

## 落とし穴

- 端末の時計ずれ：時刻だけに頼ると、進んだ時計の端末が状態を固定する。上のコードでは未来側に上限を付けた。ずれが大きい現場では、サーバー受信時刻との併用を検討する
- 同時刻のイベント：`at > last` なので、同時刻は後着が反映されない。厳密に決めたいなら、タイブレーク用の列を足す
- 状態遷移の検証：順序逆転を許すと、遷移表の厳密な検査と両立しにくくなる。私は受け入れて履歴に残し、異常は後から検知するほうが現場運用に合うと考える
- イベントIDの採番：サーバーで採番すると意味がない。端末が操作時に1回だけ作り、再送でも同じ値を使う

## まとめ

再送と順序逆転は、通信が不安定な現場の更新APIでは普通に起きます。冪等キーのUNIQUE制約と、発生時刻による上書き判定、それを守る行ロックの3点で、再送による二重登録と古い報告による上書きは防げます。ただし時計ずれなどは別途対策が必要です。私なら本番でも、反映しなかった報告を捨てず `applied = false` で残します。後から原因を追えるからです。
