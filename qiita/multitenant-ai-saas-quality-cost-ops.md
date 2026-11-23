---
title: pgvector検索のテナント漏えいをRLSで防ぐ：FastAPIでWHERE書き忘れを無害にする
tags:
  - PostgreSQL
  - pgvector
  - FastAPI
  - RAG
  - セキュリティ
private: false
ignorePublish: true
zenn: articles/multitenant-ai-saas-quality-cost-ops.md
published_at: 2026-11-25 09:00
---

マルチテナントのRAGでは、検索SQLの `WHERE tenant_id = ...` を1か所書き忘れるだけで他社の文書を引いてしまいます。この記事では、PostgreSQLのRow Level Security（RLS）とFastAPIを組み合わせ、書き忘れても他テナントの行が返らない構成を作ります。

私はマルチテナントのAIエージェントSaaSでテックリードを務めた経験があります。その案件で課題だったのは、情報漏えいを防ぎつつ品質・速度・コストを両立することでした。以下のコードは、その考え方を一般化した例です。案件のコードそのものではありません。

## 前提

- PostgreSQL（pgvector拡張を導入済み）
- Python 3.11以上、FastAPI、psycopg 3（psycopg_pool）
- チャンクを保存する `chunks` テーブルがある

## 考え方：アプリの条件に頼らない

アプリ側のWHERE句は、レビューで見落とせば終わりです。そこで、テナントの絞り込みをDB側のポリシーに寄せます。PostgreSQLは[公式ドキュメント](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)にあるとおり、テーブルごとに行単位のポリシーを設定できます。

押さえる点は次のとおりです。

- スーパーユーザーとBYPASSRLS属性を持つロールは、常にRLSを回避する
- テーブル所有者も通常は回避する。FORCE ROW LEVEL SECURITYで対象にできる
- RLSを有効にしてもポリシーが無ければ、[CREATE POLICYの仕様](https://www.postgresql.org/docs/current/sql-createpolicy.html)により既定で全行が拒否される

つまり、アプリ用ロールをテーブル所有者と分けるのが肝です。

## 手順1：テーブルとポリシー

```sql:migrate.sql
CREATE TABLE chunks (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  allowed_roles text[] NOT NULL DEFAULT '{}',
  content     text NOT NULL,
  embedding   vector(1536) NOT NULL
);

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON chunks
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE ROLE app_user LOGIN NOBYPASSRLS PASSWORD 'change-me';
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO app_user;
GRANT USAGE ON SEQUENCE chunks_id_seq TO app_user;
```

`current_setting` の第2引数に true を渡すと、設定が無いときにエラーではなくNULLを返します。NULLとの比較は真にならないので、未設定なら0件です。NULLIFを挟むのは、トランザクション終了後に値が空文字になり、uuidへのキャストが失敗するのを避けるためです。

`WITH CHECK` は、他テナントのIDでINSERTやUPDATEをする事故を防ぎます。パスワードの値はもちろん仮のものです。

## 手順2：トランザクション内でテナントを設定する

テナントIDは、認証済みトークンから取り出した値だけを使います。リクエスト本文の値は使いません。

```python:db.py
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException
from psycopg_pool import AsyncConnectionPool

pool = AsyncConnectionPool(
    "postgresql://app_user@localhost/app", open=False
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.open()
    yield
    await pool.close()

app = FastAPI(lifespan=lifespan)

class Principal:
    def __init__(self, tenant_id: str, roles: list[str]):
        self.tenant_id = tenant_id
        self.roles = roles

async def current_principal() -> Principal:
    # 実際にはトークン検証の結果から生成する
    raise HTTPException(status_code=401)

async def tenant_conn(p: Principal = Depends(current_principal)):
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('app.tenant_id', %s, true)",
                (p.tenant_id,),
            )
            yield conn

@app.post("/search")
async def search(
    query_vec: list[float],
    p: Principal = Depends(current_principal),
    conn=Depends(tenant_conn),
):
    cur = await conn.execute(
        """
        SELECT id, content FROM chunks
        WHERE allowed_roles && %s
        ORDER BY embedding <=> %s::vector
        LIMIT 5
        """,
        (p.roles, str(query_vec)),
    )
    return await cur.fetchall()
```

ポイントは次のとおりです。

- `set_config` の第3引数 true で、設定がトランザクション内だけに限定される。コネクションプールに戻った接続へ値が残らない
- `search` のSQLには `tenant_id` の条件がない。それでもポリシーが付加される
- ロールの条件は引き続きアプリ側のWHEREに置く。ロールもポリシー化したい場合は同様に設定値を追加する

`SET app.tenant_id = ...` を使うのは避けます。セッション全体に残り、プール接続で別テナントへ持ち越す事故につながるからです。

## 確認方法

「見えるべきものが見え、見えてはいけないものが見えない」ことを自動テストにします。

```python:test_rls.py
import psycopg

DSN = "postgresql://app_user@localhost/app"
A = "00000000-0000-0000-0000-00000000000a"
B = "00000000-0000-0000-0000-00000000000b"

def count(conn, tenant):
    with conn.transaction():
        if tenant:
            conn.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant,))
        return conn.execute("SELECT count(*) FROM chunks").fetchone()[0]

def test_isolation():
    with psycopg.connect(DSN) as conn:
        # テナント未設定なら0件
        assert count(conn, None) == 0
        # 各テナントからは自分の行が見える
        assert count(conn, A) > 0
        assert count(conn, B) > 0
        # テナントAを設定した同一トランザクションで、BのIDを直接指定しても0件
        with conn.transaction():
            conn.execute("SELECT set_config('app.tenant_id', %s, true)", (A,))
            n = conn.execute(
                "SELECT count(*) FROM chunks WHERE tenant_id = %s", (B,)
            ).fetchone()[0]
            assert n == 0
```

最後の検証は、テナントの設定とSELECTを同じトランザクションに入れるのが要点です。別トランザクションでは設定が消えるため、未設定の状態を調べるだけになります。テスト用データは両テナント分を事前に投入しておいてください。

## 落とし穴

- アプリ接続にスーパーユーザーやテーブル所有者を使うと、RLSが効かない。まず `NOBYPASSRLS` の専用ロールで接続する
- マイグレーションは所有者ロール、実行時は `app_user` と分ける
- 設定値の名前は `app.tenant_id` のようにカスタム名前空間を使う
- ポリシー式の中の関数呼び出しは行ごとに評価され得る。大きなテーブルでは、`tenant_id` の索引と実行計画を `EXPLAIN` で確認する
- ベクトル索引（HNSWなど）で近似検索をすると、絞り込み後の件数が減る場合がある。件数が足りるかは評価データで測る

## 私ならこうします

本番では二重に守ります。アプリのWHEREでも絞り、RLSを最後の安全網にします。RLSだけに頼ると、設定の漏れが「0件」という静かな不具合になるからです。0件の割合はログで監視します。

## まとめ

RLSを使うと、検索SQLのWHERE書き忘れが漏えいに直結しなくなります。専用ロール、`set_config` のトランザクション限定、未設定時は0件という3点を押さえれば、導入は小さな変更で済みます。まずは自分の環境で、他テナントのIDが0件になるテストから書いてみてください。
