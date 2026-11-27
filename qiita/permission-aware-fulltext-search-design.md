---
title: Elasticsearchの権限変更が検索に反映されない事故を防ぐ ACL同期の実装
tags:
  - Elasticsearch
  - Django
  - Python
  - 全文検索
  - セキュリティ
private: false
ignorePublish: true
zenn: off-zenn/permission-aware-fulltext-search-design.md
published_at: 2026-11-29 09:00
---

全文検索の権限制御では、検索クエリに権限フィルタを入れるだけでは足りません。権限だけが変わった文書がインデックスに反映されないと、外したはずのユーザーに文書が見え続けます。この記事では、Django と Elasticsearch の構成で、権限変更を部分更新で確実に反映する実装と、その確認方法を示します。

## 前提

- Python 3.11 以降、Django 5 系
- elasticsearch-py（Elasticsearch 8 系のクライアント）
- インデックス `documents` に、keyword 型の `allowed_groups` がある
- 権限の正本は PostgreSQL の `DocumentAccess` に置く

Elasticsearch 側の `allowed_groups` は、DB から作る写しとして扱います。写しである以上、ずれる前提で同期と検証を設計するのが私の考えです。

## 問題：権限だけが変わる更新は見落とされやすい

文書の取り込みは、本文のハッシュが変わったときだけ再処理する作りが多いです。この作りだと、本文が同じで権限だけ変わった文書は再処理の対象になりません。

私が過去に社内文書検索の基盤でバックエンドを担当した経験からも、権限は検索の正確さと同じくらい重要な要件だと考えています。ここから先は、その考えに基づく設計案です。

## 解決策の方針

- 権限変更を検知したら、本文は触らず `allowed_groups` だけを部分更新する
- DB のコミット後に同期する（ロールバックされた変更を送らない）
- 同期が失敗しても直るように、定期的な全件照合を用意する
- 権限が空の文書は、誰にも見せない（安全側に倒す）

部分更新には Update API を使います。[Update API の公式リファレンス](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-update)によると、部分ドキュメントを渡すと既存の文書にマージされます。また `refresh` に `wait_for` を指定すると、検索で見えるようになるまで待てます。

## ステップ1：同期関数

```python:search/acl_sync.py
from elasticsearch import Elasticsearch, helpers

from documents.models import Document

es = Elasticsearch("http://localhost:9200")  # 例：ローカル環境
INDEX = "documents"


def sync_acl(doc_ids: list[str]) -> tuple[int, list]:
    """DB の権限を読み、allowed_groups だけを部分更新する。"""
    docs = Document.objects.filter(doc_id__in=doc_ids).prefetch_related(
        "accesses"
    )
    actions = (
        {
            "_op_type": "update",
            "_index": INDEX,
            "_id": d.doc_id,
            "doc": {"allowed_groups": [a.group for a in d.accesses.all()]},
        }
        for d in docs
    )
    ok, errors = helpers.bulk(
        es, actions, raise_on_error=False, refresh="wait_for"
    )
    return ok, errors
```

`_id` には取り込み時と同じ文書 ID を使います。権限が 0 件なら空配列が入り、どのグループの検索にも一致しません。

配列を部分更新したときの挙動は、お使いのバージョンで一度実機で確かめてください。後述のテストがその確認も兼ねます。

## ステップ2：コミット後に同期する

```python:documents/signals.py
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from documents.models import DocumentAccess
from search.acl_sync import sync_acl


def _enqueue(doc_id: str) -> None:
    transaction.on_commit(lambda: sync_acl([doc_id]))


@receiver(post_save, sender=DocumentAccess)
@receiver(post_delete, sender=DocumentAccess)
def on_access_changed(sender, instance, **kwargs):
    _enqueue(instance.document.doc_id)
```

`transaction.on_commit` を使うと、コミットされた変更だけが送られます。ただしこの方式には弱点があります。コミット直後にプロセスが落ちると、同期の呼び出しは失われます。実運用ではジョブキューに載せ、リトライさせるのが無難です。ここでは構成を簡単にするため直接呼んでいます。

## ステップ3：全件照合のコマンド

イベント駆動の同期は、取りこぼす前提で考えます。そのため定期的に全件を洗い替えるコマンドを用意します。

```python:documents/management/commands/reconcile_acl.py
from django.core.management.base import BaseCommand

from documents.models import Document
from search.acl_sync import sync_acl

BATCH = 500


class Command(BaseCommand):
    help = "DB の権限で Elasticsearch の allowed_groups を洗い替える"

    def handle(self, *args, **options):
        ids = list(Document.objects.values_list("doc_id", flat=True))
        failed = 0
        for i in range(0, len(ids), BATCH):
            _, errors = sync_acl(ids[i : i + BATCH])
            failed += len(errors)
        self.stdout.write(f"checked={len(ids)} failed={failed}")
```

`failed` が 0 でない日は、監視で通知する運用にします。インデックスに存在しない文書の更新は失敗として返るので、取り込み漏れの発見にも使えます。

## 動作確認：権限を外したら見えなくなるテスト

```python:tests/test_acl_sync.py
import pytest

from documents.models import Document, DocumentAccess
from search.acl_sync import es, INDEX, sync_acl
from search.query import search


@pytest.mark.django_db(transaction=True)
def test_revoked_group_cannot_find():
    doc = Document.objects.create(
        doc_id="t1", title="規程", category="hr", source="x",
        content_hash="h", updated_at="2026-01-01T00:00:00Z",
    )
    acc = DocumentAccess.objects.create(document=doc, group="sales")
    es.index(
        index=INDEX, id="t1", refresh=True,
        document={"title": "規程", "body": "有給休暇", "category": "hr",
                  "allowed_groups": ["sales"]},
    )
    assert search("有給休暇", ["sales"])["hits"]["total"]["value"] == 1

    acc.delete()
    sync_acl(["t1"])
    assert search("有給休暇", ["sales"])["hits"]["total"]["value"] == 0
```

権限を外す前は 1 件ヒットし、外して同期した後は 0 件になることを確認します。`search` は、権限条件を `filter` に入れた検索関数です。このテストは CI に入れて、検索クエリや同期を変えるたびに回すのがよいと思います。

## 落とし穴

- 権限の正本が 2 か所に分かれると、どちらが正しいか決められなくなる
- グループ名の変更や統廃合は、複数文書の一括更新になる。バッチ分割を前提にする
- `refresh="wait_for"` は大量更新では遅くなる。画面で即時反映が必要な操作だけに使う
- 削除済み文書の同期は、検索から外す処理と同じ経路にする

## まとめ

権限つき検索では、クエリ側のフィルタと同じ重さで、権限の同期経路を設計します。私なら、コミット後の部分更新、定期的な全件照合、権限を外したときのテストの 3 点を最初から入れます。インデックスは写しだと割り切ると、ずれの検知と修復が設計の中心になります。
