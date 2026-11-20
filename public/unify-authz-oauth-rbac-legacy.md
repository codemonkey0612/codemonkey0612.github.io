---
title: PostgreSQLのRLSでテナント越えを防ぐ：WHERE句の書き忘れを無効化する
tags:
  - PostgreSQL
  - TypeScript
  - Node.js
  - Security
  - マルチテナント
private: false
updated_at: '2026-11-20T09:00:10+09:00'
id: b2ce326296020c430d23
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
マルチテナントのAPIでは、`WHERE tenant_id = $1` を1か所書き忘れるだけで他社のデータが見えます。この記事では、PostgreSQLの行レベルセキュリティ（RLS）を使い、書き忘れてもDB側で止める構成をNode.js/TypeScriptで作ります。

アプリ側の認可ミドルウェアに加えて、DB側にも最後の防壁を置く設計を私ならおすすめします。以下のコードは一般的な例であり、特定の案件の実コードではありません。

## 前提環境

- PostgreSQL（公式ドキュメントはv18の記述を参照）
- Node.js と TypeScript、`pg`（node-postgres）
- テナントIDはJWTなどで検証済みで、アプリ側に `tenantId` として届いている

認証とロール判定は済んでいる前提です。ここで扱うのは「データの所有関係」だけです。

## 問題：アプリ側の条件だけだと抜けが出る

テナントの絞り込みを各クエリに手で書く方式は、クエリが増えるほど抜けやすくなります。レビューで見落とすこともあります。

そこでテナントの条件をテーブル側に持たせます。アプリは「今どのテナントか」をトランザクションに伝えるだけにします。

## 手順1：テーブルにRLSとポリシーを設定する

```sql:001_rls.sql
CREATE TABLE reports (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title     text NOT NULL
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE ROLE app_user LOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO app_user;
```

ポイントは次のとおりです。

- `USING` は見える行、`WITH CHECK` は書き込める行を制限する
- `current_setting` の第2引数に true を渡すと、設定がないときにエラーではなく NULL が返る。[PostgreSQL公式ドキュメント](https://www.postgresql.org/docs/current/functions-admin.html)にこの挙動の記載がある
- NULL との比較は真にならないので、テナント未設定なら0件になる。安全側に倒れる

### 所有者とスーパーユーザーに注意

ここが最大の落とし穴です。[公式ドキュメント](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)によると、スーパーユーザーと BYPASSRLS 属性を持つロールは常にRLSを回避します。テーブル所有者も通常は回避しますが、`FORCE ROW LEVEL SECURITY` で対象にできます。

そのため、アプリの接続には所有者でもスーパーユーザーでもないロール（上の `app_user`）を使います。マイグレーション用のロールとは分けてください。

## 手順2：トランザクション内でテナントを設定する

`set_config` の第3引数を true にすると、値は現在のトランザクションの間だけ有効です。公式ドキュメントでは、セッション全体に効かせたい場合は false を使うと説明されています。コネクションプールでは、前のリクエストの値が残る事故を防ぐため、true を使うのが基本です。

```typescript:db.ts
import { Pool, type PoolClient } from "pg";

const pool = new Pool(); // 接続情報は環境変数から読みます

export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

`SET` 文はプレースホルダを使えません。そのため `set_config` 関数で値を渡しています。文字列連結でSQLを組み立てないでください。

## 手順3：ハンドラから使う

```typescript:routes/reports.ts
import { Router } from "express";
import { withTenant } from "../db";

export const router = Router();

router.get("/reports/:id", async (req, res) => {
  const rows = await withTenant(req.user!.tenantId, async (c) => {
    const r = await c.query("SELECT id, title FROM reports WHERE id = $1", [req.params.id]);
    return r.rows;
  });
  if (rows.length === 0) return res.status(404).json({ error: "not_found" });
  res.json(rows[0]);
});
```

`WHERE` に `tenant_id` がありません。それでも他テナントのIDを指定すると0件になるので、404を返せます。存在の有無を漏らさない点も保てます。

## 動作確認：テナント越えが0件になるテスト

RLSは設定ミスが静かに起きる機能です。私なら、必ず自動テストを置きます。

```typescript:rls.test.ts
import { withTenant } from "./db";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("他テナントの行は見えない", async () => {
  const id = await withTenant(A, async (c) => {
    const r = await c.query(
      "INSERT INTO reports (tenant_id, title) VALUES ($1, 't') RETURNING id", [A]);
    return r.rows[0].id as string;
  });
  const rows = await withTenant(B, async (c) =>
    (await c.query("SELECT id FROM reports WHERE id = $1", [id])).rows);
  expect(rows).toHaveLength(0);
});

test("他テナント向けの書き込みは拒否される", async () => {
  await expect(
    withTenant(A, (c) =>
      c.query("INSERT INTO reports (tenant_id, title) VALUES ($1, 'x')", [B]))
  ).rejects.toThrow();
});

test("テナント未設定なら0件", async () => {
  const { Pool } = await import("pg");
  const rows = (await new Pool().query("SELECT id FROM reports")).rows;
  expect(rows).toHaveLength(0);
});
```

3本目は、`withTenant` を通さない接続でも漏れないことを確かめます。接続ロールが所有者やスーパーユーザーだと、このテストは失敗します。接続設定の誤りを検出する目的もあります。

## 落とし穴

- 接続ロールが所有者やBYPASSRLSのままで、RLSが効いていない
- `set_config` の第3引数を false にして、プール内で値が残る
- 管理画面や集計バッチが全テナントを読む必要があるのに、専用の仕組みを用意しない
- ポリシーの列に索引がなく、検索が遅くなる

最後の点は、`tenant_id` を含む複合インデックスを張り、実行計画で確認してください。バッチは別ロールと別ポリシーに分けるのが無難です。

## 本番で私ならこうする

RLSは認可の代わりではなく、保険です。ロールによる操作の可否はミドルウェアで判定し、所有関係はアプリのクエリとRLSの二重で守ります。二重にすると冗長ですが、書き忘れの被害を0件に抑えられます。

## まとめ

- テナント条件はテーブルのポリシーに持たせる
- アプリ接続は所有者・スーパーユーザー以外にする
- テナントIDはトランザクション単位で `set_config` に渡す
- 越境の0件を自動テストで固定する

まずは1つのテーブルで試し、テストが通ることを確認してから広げてください。
