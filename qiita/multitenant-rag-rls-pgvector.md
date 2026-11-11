---
title: SQLAlchemy 2.0非同期でRLSのテナントIDを自動設定する：after_beginフック実装
tags:
  - PostgreSQL
  - SQLAlchemy
  - FastAPI
  - Python
  - RAG
private: false
ignorePublish: true
zenn: articles/multitenant-rag-rls-pgvector.md
published_at: 2026-11-11 09:00
---

## 解決したい問題

PostgreSQLの行レベルセキュリティ（RLS）でテナント分離をする場合、各トランザクションの先頭でテナントIDを設定する必要があります。これを各エンドポイントで手書きすると、コミット後の再開始や新しい処理で設定が抜けます。

この記事では、SQLAlchemy 2.0の非同期セッションで、トランザクションが始まるたびにテナントIDを自動で設定する方法を書きます。設定漏れ時は、黙って0件を返すのではなく例外で止めます。

## 前提

- Python 3.11以降、SQLAlchemy 2.0系（asyncio拡張）、asyncpgを使う
- PostgreSQL側のRLSは設定済みである
- アプリ用ロールはスーパーユーザーでも BYPASSRLS でもない

ポリシーは次のような形を想定します。テーブル名やカラム名は例です。

```sql
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON chunks
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

## 方針：after_beginでset_configを実行する

PostgreSQLの `set_config` は、第3引数 `is_local` が true なら[現在のトランザクションだけに値が適用されます](https://www.postgresql.org/docs/12/functions-admin.html)。false ならセッション全体に残ります。

接続プールでは、セッション全体に残る設定が次のリクエストに持ち越されます。そのため必ず true を使います。

true の設定はトランザクション終了で消えます。SQLAlchemyのセッションは、commitの後に次の処理を始めると新しいトランザクションを開きます。このたびに設定し直す必要があります。

そこで、SQLAlchemyの [after_begin イベント](https://docs.sqlalchemy.org/en/20/orm/events.html) を使います。接続でトランザクションが始まった直後に呼ばれます。

公式ドキュメントには、このフック内でSQLを実行するときは引数で渡される Connection を使い、Session を直接使わないよう書かれています。実装もそれに従います。

## 実装

```python:app/db.py
import os
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

engine = create_async_engine(
    os.environ["APP_DATABASE_URL"],  # postgresql+asyncpg://（アプリ用ロール）
    pool_size=10,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(Session, "after_begin")
def set_tenant(session, transaction, connection):
    tenant_id = session.info.get("tenant_id")
    if tenant_id is None:
        raise RuntimeError("tenant_id が未設定のままDBにアクセスしました")
    connection.execute(
        text("SELECT set_config('app.tenant_id', :tid, true)"),
        {"tid": str(tenant_id)},
    )


def new_session(tenant_id: UUID) -> AsyncSession:
    session = SessionLocal()
    session.sync_session.info["tenant_id"] = tenant_id
    return session
```

ポイントは次の3つです。

- `Session` クラス全体にリスナーを付ける。非同期セッションは内部の同期 `Session` を使うため、全セッションに効く
- テナントIDは `session.info` に持たせる。セッションごとの辞書なので、リクエスト間で混ざらない
- 未設定なら例外にする。RLSだけなら0件で済むが、バグに気づけなくなるためである

テナントIDは、検証済みトークンから取り出した値だけを渡してください。ヘッダーやボディの値をそのまま使うと、RLSがあっても他社として振る舞えます。

### FastAPIの依存関係

```python:app/deps.py
from uuid import UUID

from fastapi import HTTPException, Request

from .db import new_session


def current_tenant(request: Request) -> UUID:
    # 認証ミドルウェアが検証済みトークンから設定した値だけを使う
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise HTTPException(status_code=401)
    return tenant_id


async def get_session(request: Request):
    async with new_session(current_tenant(request)) as session:
        yield session
```

エンドポイントは `Depends(get_session)` を受け取り、`tenant_id` の条件なしでクエリを書きます。

```python:app/routes.py
from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_session


@app.get("/chunks/count")
async def chunk_count(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text("SELECT count(*) FROM chunks"))
    return {"count": result.scalar_one()}
```

`app` は既存の `FastAPI` インスタンスを使います。

## 動作確認

pytestで、設定漏れと分離の2点を確認します。テスト用DBには、各テナントのデータが事前に入っている前提です。

```python:tests/test_session_tenant.py
import os
import uuid

import pytest
from sqlalchemy import text

from app.db import SessionLocal, new_session

TENANT_A = uuid.UUID(os.environ["TEST_TENANT_A"])
TENANT_B = uuid.UUID(os.environ["TEST_TENANT_B"])


@pytest.mark.asyncio
async def test_missing_tenant_raises():
    async with SessionLocal() as session:
        with pytest.raises(RuntimeError):
            await session.execute(text("SELECT 1"))


@pytest.mark.asyncio
async def test_tenant_is_reapplied_after_commit():
    async with new_session(TENANT_A) as session:
        await session.execute(text("SELECT 1"))
        await session.commit()
        value = (await session.execute(
            text("SELECT current_setting('app.tenant_id', true)")
        )).scalar_one()
    assert value == str(TENANT_A)


@pytest.mark.asyncio
async def test_rows_are_isolated():
    async with new_session(TENANT_B) as session:
        rows = (await session.execute(text("SELECT DISTINCT tenant_id FROM chunks"))).all()
    assert [r[0] for r in rows] == [TENANT_B]
```

1つ目は、未設定のセッションが例外で止まることを見ます。2つ目は、commit後の新しいトランザクションでも値が入り直すことを見ます。3つ目は、見えるテナントが自分だけであることを見ます。

## 注意点

- 管理用バッチなど、全テナントを横断する処理に同じセッションを使わない。専用の別ロールと別エンジンを用意する
- `session.info` を後から書き換えると、次のトランザクションから別テナントになる。リクエストの途中で変更しない
- 生のconnectionをエンジンから直接取得すると、このフックを通らない。アプリ内では `new_session` 経由に統一する
- PgBouncerのトランザクションモードでも、`is_local` を true にしておけば設定は持ち越されない

## まとめ

`after_begin` で `set_config(..., true)` を実行すると、トランザクションごとにテナントIDが入ります。設定漏れは例外で検出できます。エンドポイントの実装からテナント条件を消せるので、書き忘れそのものが起きにくくなります。RLSのポリシーと組み合わせ、テストで常に確認してください。
