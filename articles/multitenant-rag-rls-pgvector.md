---
title: マルチテナントRAGの情報漏えいを防ぐ：PostgreSQLのRLSとpgvectorでの実装
emoji: 🔐
type: tech
topics:
  - rag
  - postgresql
  - security
  - python
  - llm
published: true
published_at: 2026-11-11 09:00
---

複数の企業が同じRAGを使うSaaSでは、A社への回答にB社の文書が1件混ざるだけでも、重大な情報漏えいです。一方で、すべてのクエリに `WHERE tenant_id = ?` を書き忘れない運用は、開発者や機能が増えるほど破綻しやすくなります。

結論から書きます。PostgreSQLの行レベルセキュリティ（RLS）でDB側に分離を強制し、テナントIDはトランザクション内だけで有効な設定として渡します。HNSWによる件数不足はpgvectorのiterative scanで補い、最後に「漏れないこと」を自動テストで確かめます。

私は2024年4月から2026年7月まで、中堅IT企業向けのマルチテナントSaaS（7名体制）にテックリードとして参加しました。企業単位のデータ分離やロール別権限、ベクトル検索、ログ管理を設計・実装した経験から、分離はアプリのコードだけに任せずDBでも担保すべきだと考えています。本記事のコードは、その考え方を記事用に一般化したものです。

## マルチテナントRAGで情報が漏れる経路

RAGの漏えい経路は、ベクトル検索だけではありません。設計時には次の4つを洗い出します。

- **検索**：ベクトル検索のSQLからテナント条件が抜ける。管理画面用のクエリやバッチ処理で起きやすい経路である。
- **キャッシュ**：質問文だけをキーにした回答キャッシュは、別テナントの回答をそのまま返す。キーには必ずテナントIDを含める。
- **ログ**：プロンプトに入れた検索結果は、ログやトレースにも残る。ログの閲覧権限がテナントをまたぐと、そこから漏れる。
- **プロンプト**：会話履歴や参照元の文書名を別テーブルから引くとき、条件が抜けていれば他社の文書名も回答に出る。

LLMは渡された文脈をそのまま使うため、プロンプトに入った時点で防ぐ手段はありません。RLSが守れるのはDBの行だけなので、`chunks` 以外の `documents` や会話履歴のテーブルも同じように保護します。キャッシュとログは、別途テナントIDで区切る設計が必要です。

## テナント分離の選択肢：DB分割・スキーマ分割・行レベル分離

| 方式 | 分離の強さ | 運用の負担 | 向くケース |
| --- | --- | --- | --- |
| DB（インスタンス）分割 | 最も強い | テナント数に比例して増える | 少数の大口顧客、物理分離が契約条件 |
| スキーマ分割 | 強い | マイグレーションがスキーマ数だけ必要 | 数十社程度、テナント別の拡張が多い |
| 行レベル分離＋RLS | ポリシー設計に依存 | 小さい | 多数の中小テナント、共通機能が中心 |

行レベル分離は運用が軽い反面、WHERE句の書き忘れが即漏えいにつながります。そこでRLSを使い、条件をDBが自動で付けるようにします。大口顧客だけDBを分け、それ以外を行レベル分離にする併用も現実的です。

## PostgreSQLのRLSでchunksテーブルを守る

まずテーブル所有者とアプリ用ロールを分け、RLSを有効にします。

```sql:migrations/001_chunks.sql
CREATE EXTENSION IF NOT EXISTS vector;

-- 所有者はマイグレーション専用、アプリは別ロールで接続する
CREATE ROLE rag_owner NOLOGIN;
CREATE ROLE rag_app LOGIN NOSUPERUSER NOBYPASSRLS;  -- パスワードは別途設定

CREATE TABLE chunks (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   uuid NOT NULL,
    document_id uuid NOT NULL,
    content     text NOT NULL,
    embedding   vector(1536) NOT NULL
);
ALTER TABLE chunks OWNER TO rag_owner;

CREATE INDEX chunks_tenant_idx ON chunks (tenant_id);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO rag_app;

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON chunks
    FOR ALL TO rag_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

各部分の意味は次のとおりです。

- **ENABLEとFORCE**：所有者は通常RLSを素通りする。`FORCE` を付けると所有者にも適用される（[Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)）。
- **ポリシーのないロール**：ポリシーが1つもなければ既定で拒否され、行は見えない（同ページ）。`TO rag_app` に限定すれば、他のロールは何も読めない。FORCEと組み合わせると所有者も0件になるため、データ移行は別の手順を用意する。
- **USINGとWITH CHECK**：USINGは条件に合わない行を黙って除外し、WITH CHECKは条件外の行の書き込みをエラーで拒否する（[CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)）。
- **current_settingの第2引数**：`true` にすると未設定時にNULLを返す。一度設定した接続では空文字が返ることがあるため、`NULLIF` でNULLに寄せる。比較がNULLになれば行は返らず、失敗しても安全側に倒れる。

TRUNCATEやREFERENCESのようにテーブル全体に作用する操作はRLSの対象外です（[Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)）。アプリ用ロールにTRUNCATE権限は付けません。

スーパーユーザーとBYPASSRLS属性を持つロールは、常にRLSを迂回します（[Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)）。FORCEを付けてもこの2つは防げないため、アプリの接続ロールの属性を必ず確認してください。

### RLSが迂回される典型パターン

- 開発環境の設定のまま、アプリがスーパーユーザーや所有者で接続している
- 分析用にBYPASSRLS付きのロールを作り、アプリと共有している
- `SECURITY DEFINER` 関数から検索している（関数所有者の権限で実行される）
- ビューを経由している（既定はビュー所有者の権限で評価されるため、`security_invoker` を付ける）
- `documents` や会話履歴など、`tenant_id` を持つ別テーブルにRLSが未設定

## FastAPIでテナントIDをセッションに渡す

テナントIDは、認証済みトークンから取り出した値だけを使います。リクエストのヘッダーやボディで受け取った値をそのまま使うと、RLSがあっても他社として振る舞えてしまいます。

```python:app/db.py
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

pool = AsyncConnectionPool(
    conninfo=os.environ["APP_DATABASE_URL"],  # rag_app ロールの接続文字列
    min_size=1,
    max_size=10,
    kwargs={"autocommit": True},  # BEGIN/COMMIT は transaction() で明示する
    open=False,
)


@asynccontextmanager
async def tenant_transaction(tenant_id: UUID) -> AsyncIterator[AsyncConnection]:
    async with pool.connection() as conn:
        async with conn.transaction():
            # 第3引数 true = SET LOCAL 相当。トランザクション終了で消える
            await conn.execute(
                "SELECT set_config('app.tenant_id', %s, true)", (str(tenant_id),)
            )
            await conn.execute("SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)")
            await conn.execute("SELECT set_config('hnsw.ef_search', '100', true)")
            yield conn
```

```python:app/main.py
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from .db import pool, tenant_transaction


@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.open()
    yield
    await pool.close()


app = FastAPI(lifespan=lifespan)


def current_tenant(request: Request) -> UUID:
    # 認証ミドルウェアが検証済みトークンから設定した値だけを使う
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise HTTPException(status_code=401)
    return tenant_id


async def get_conn(tenant_id: UUID = Depends(current_tenant)):
    async with tenant_transaction(tenant_id) as conn:
        yield conn


class SearchRequest(BaseModel):
    embedding: list[float]  # 記事では質問文の埋め込み計算を省略
    k: int = Field(default=8, ge=1, le=50)


SEARCH_SQL = """
WITH candidates AS MATERIALIZED (
    SELECT id, document_id, content, embedding <=> %(vec)s::vector AS distance
    FROM chunks
    ORDER BY distance
    LIMIT %(k)s
)
SELECT id, document_id, content, distance FROM candidates ORDER BY distance + 0
"""


@app.post("/search")
async def search(req: SearchRequest, conn: AsyncConnection = Depends(get_conn)):
    vec = "[" + ",".join(map(str, req.embedding)) + "]"
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(SEARCH_SQL, {"vec": vec, "k": req.k})
        return await cur.fetchall()
```

検索SQLに `tenant_id` の条件はありません。条件はRLSが自動で付けます。

### SET LOCALを使う理由と接続プールの注意点

`SET` 文はバインド変数を受け付けないため、同等の関数 `set_config` を使います。`SET LOCAL` の効果は現在のトランザクション内だけで、COMMITやROLLBACKの後はセッションの値に戻ります（[PostgreSQL: SET](https://www.postgresql.org/docs/devel/sql-set.html)）。

危ないのは、セッション単位の `SET` や `set_config(..., false)` です。接続をプールに返しても値が残り、次に同じ接続を借りた別テナントのリクエストが前のテナントIDで動きます。エラーにならず静かに漏れるため、気づくのが遅れます。

また、`SET LOCAL` をトランザクションの外で実行すると、警告が出るだけで、効果はありません（同ページ）。上のコードで `transaction()` を明示しているのはこのためです。仮に忘れてもポリシーの比較がNULLになり、0件が返るだけで済みます。PgBouncerのトランザクションモードを使う場合も、設定をトランザクション内に閉じておけば持ち越しは起きません。

## pgvectorのフィルタ付き検索：HNSWで件数が足りなくなる問題

RLSの条件は、HNSWインデックスによる近傍探索の*後*に行を絞り込むフィルタとして働きます。pgvectorのREADMEによると、条件に合う行が10%なら、既定の `hnsw.ef_search` = 40では平均4件しか残りません（[pgvector](https://github.com/pgvector/pgvector)）。

共有テーブルの中で小さなテナントほど、検索結果が `k` 件に届かなくなります。漏えいではありませんが、RAGが「該当する情報はありません」と答える品質事故になります。

### iterative scanを有効にする

pgvector 0.8.0以降では、iterative scanが使えます。件数が足りるまで、インデックスを追加で走査する機能です（[pgvector](https://github.com/pgvector/pgvector)）。上限は `hnsw.max_scan_tuples` で、既定は20,000です（[pgvector](https://github.com/pgvector/pgvector)）。

- `strict_order`：距離の順序を厳密に保つ。
- `relaxed_order`：順序の多少の前後と引き換えに、再現率が上がる（[pgEdge: Iterative Index Scans](https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/)）。

記事のコードは `relaxed_order` を使い、`MATERIALIZED` のCTEで取り出し、外側のクエリで並べ直しています。並べ直しの式は `ORDER BY distance + 0` とします。Postgres 17以降ではこの `+ 0` が必要です（[pgvector](https://github.com/pgvector/pgvector)）。これで最終的な順序は厳密になります。設定は `set_config(..., true)` で、テナントIDと同じトランザクションに閉じています。

効いているかは、テナントを設定した状態の実行計画で確認します。

```sql
BEGIN;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true);
-- '[...]' は実際の質問ベクトルの文字列に置き換える
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM chunks ORDER BY embedding <=> '[...]'::vector LIMIT 8;
ROLLBACK;
```

`chunks_embedding_idx` が使われているか、返る行数が `LIMIT` に届いているかを見ます。

### 大口テナントには部分インデックス

READMEでは、値の種類が少ない条件には部分インデックス、多い条件にはパーティショニングを勧めています（[pgvector](https://github.com/pgvector/pgvector)）。データ量が突出したテナントだけ、専用のHNSWインデックスを作る方法です。

```sql
CREATE INDEX chunks_embedding_tenant_large
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
```

注意点として、RLSの条件は `current_setting()` を含むため、計画時に部分インデックスの条件と一致するとは判断されません。使わせたい場合はクエリにも `AND tenant_id = %(tenant_id)s` を明示し、EXPLAINで確認します。RLSは残したままにして、二重の条件にします。

## 漏えいしないことをテストで確かめる

最後に、分離が効いていることをCIで毎回確かめます。pgvector入りのPostgreSQLコンテナにマイグレーションを流し、`rag_app` で接続して実行する想定です。

```python:tests/test_tenant_isolation.py
import os
import uuid

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege
from psycopg_pool import ConnectionPool

DSN = os.environ["TEST_APP_DSN"]  # rag_app ロールで接続する
TENANT_A, TENANT_B = uuid.uuid4(), uuid.uuid4()
VEC = "[" + ",".join(["0.01"] * 1536) + "]"
INSERT = "INSERT INTO chunks (tenant_id, document_id, content, embedding) VALUES (%s, %s, %s, %s::vector)"


def use_tenant(conn, tenant_id):
    conn.execute("SELECT set_config('app.tenant_id', %s, true)", (str(tenant_id),))


@pytest.fixture(scope="module", autouse=True)
def seed():
    with psycopg.connect(DSN, autocommit=True) as conn:
        for t in (TENANT_A, TENANT_B):
            with conn.transaction():
                use_tenant(conn, t)
                conn.execute(INSERT, (t, uuid.uuid4(), f"secret of {t}", VEC))


def test_search_returns_only_own_tenant():
    with psycopg.connect(DSN, autocommit=True) as conn, conn.transaction():
        use_tenant(conn, TENANT_A)
        rows = conn.execute(
            "SELECT tenant_id FROM chunks ORDER BY embedding <=> %s::vector LIMIT 50", (VEC,)
        ).fetchall()
    assert rows and all(r[0] == TENANT_A for r in rows)


def test_no_tenant_means_no_rows():
    with psycopg.connect(DSN, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM chunks").fetchone()[0] == 0


def test_cannot_write_to_other_tenant():
    with psycopg.connect(DSN, autocommit=True) as conn:
        with pytest.raises(InsufficientPrivilege):
            with conn.transaction():
                use_tenant(conn, TENANT_A)
                conn.execute(INSERT, (TENANT_B, uuid.uuid4(), "x", VEC))


def test_setting_does_not_carry_over_in_pool():
    with ConnectionPool(DSN, min_size=1, max_size=1, kwargs={"autocommit": True}, open=False) as pool:
        with pool.connection() as conn, conn.transaction():
            use_tenant(conn, TENANT_A)
        with pool.connection() as conn:  # 同じ物理接続を借り直す
            value = conn.execute("SELECT NULLIF(current_setting('app.tenant_id', true), '')").fetchone()[0]
    assert value is None


def test_role_and_tables_are_locked_down():
    with psycopg.connect(DSN) as conn:
        su, bypass = conn.execute(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
        ).fetchone()
        unsafe = conn.execute(
            """SELECT c.relname FROM pg_class c
               JOIN pg_attribute a ON a.attrelid = c.oid
               WHERE a.attname = 'tenant_id' AND NOT a.attisdropped
                 AND c.relkind IN ('r', 'p')
                 AND NOT (c.relrowsecurity AND c.relforcerowsecurity)"""
        ).fetchall()
    assert not su and not bypass
    assert unsafe == []
```

上から順に、B社の行が混ざらないこと、設定忘れで全件ではなく0件になることを確かめます。WITH CHECK違反のINSERTは `InsufficientPrivilege`（SQLSTATE 42501）で失敗します。接続数1のプールでは同じ接続を借り直し、前のテナントIDが残らないことを見ます。

最後のテストは接続ロールの迂回権限と、`tenant_id` を持つ全テーブルのRLS強制を確認します。新しいテーブルを追加したときの設定漏れも検出できるので、特におすすめです。

## 今日から確認できるチェックリスト

- [ ] アプリの接続ロールで `rolsuper` と `rolbypassrls` がどちらも false
- [ ] `tenant_id` を持つ全テーブルで `relrowsecurity` と `relforcerowsecurity` が true
- [ ] コードからセッション単位の `SET` と `set_config(..., false)` を検索し、ゼロにする
- [ ] テナントIDは認証済みトークン由来の値だけを使う
- [ ] 回答キャッシュのキーとログにテナントIDを含め、ログの閲覧権限をテナント単位で分ける
- [ ] 小規模テナントで検索結果が `k` 件に届くかを、EXPLAINと件数で確認する
- [ ] 上記の自動テストをCIで毎回実行する

## まとめ

マルチテナントRAGの分離は、WHERE句の書き忘れに頼らずRLSでDBに強制するのが確実です。ただしRLSには、スーパーユーザーやBYPASSRLSロールによる迂回、接続プールでの設定の持ち越し、HNSWでの件数不足という落とし穴があります。専用ロールとFORCE、`set_config(..., true)`、iterative scanで対処します。そのうえで、自動テストで「漏れないこと」を継続的に確かめてください。

---

私は「AIチャットボット・社内文書検索（RAG）」をお仕事としてお受けしています。複数の企業や部署が使うRAGで、RLSによるデータ分離から検索品質の検証まで含めた設計・実装をご相談いただけます。
→ [AIチャットボット・社内文書検索（RAG）について](https://codemonkey0612.github.io/services/ai-chatbot/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
