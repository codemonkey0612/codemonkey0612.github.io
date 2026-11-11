---
title: 引き継ぎ先不明の社内システムの証明書期限をPython標準ライブラリで棚卸しする
tags:
  - Python
  - SSL
  - 証明書
  - 運用
  - 棚卸し
private: false
ignorePublish: true
zenn: articles/inherited-system-first-week-checklist.md
published_at: 2026-11-13 09:00
---

## 解決したい問題

前任者がいなくなった業務システムを引き継ぐと、まず困るのが「どのホスト名がまだ生きていて、証明書がいつ切れるのか」が分からないことです。

請求書やメールから拾ったホスト名を、手作業でブラウザで開いて確認するのは手間がかかります。そこで、ホスト名の一覧から DNS 解決と TLS 証明書の期限を一括で調べるスクリプトを作ります。

## 前提

- Python 3 系（標準ライブラリのみ使用。追加パッケージは不要）
- 調査対象は 443 番ポートで HTTPS を公開しているホスト
- 実行環境から対象ホストへ接続できること

私はこの種の棚卸しを、コードを読む前の最初の作業として行うことが多いです。機能ごとに認証の作りがばらばらだった既存の Web アプリを調べたときも、まず「何がどこにあるか」の確認から入りました。

## 手順1：ホスト名の一覧を用意する

`hosts.txt` に 1 行 1 ホストで書きます。`#` で始まる行はコメントとして無視します。

```text:hosts.txt
# 請求書とメールの履歴から拾ったもの
www.example.com
admin.example.com
old-portal.example.jp
```

ここでは `example.com` などの予約済みの例を使っています。実際には、自社で確認できたホスト名を書いてください。

## 手順2：スクリプトを書く

```python:cert_inventory.py
import csv
import socket
import ssl
import sys
from datetime import datetime, timezone

WARN_DAYS = 30
FIELDS = ["host", "ip", "status", "not_after", "days_left", "issuer"]


def check(host, port=443, timeout=5):
    row = dict.fromkeys(FIELDS, "")
    row["host"] = host

    # 1) DNS 解決。名前が引けなければ、ここで終了
    try:
        info = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        row["ip"] = info[0][4][0]
    except socket.gaierror as e:
        row["status"] = f"DNS_ERROR: {e}"
        return row

    # 2) TLS 接続。検証はデフォルトの設定に任せる
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as tls:
                cert = tls.getpeercert()
    except ssl.SSLCertVerificationError as e:
        row["status"] = f"CERT_INVALID: {e.verify_message}"
        return row
    except OSError as e:
        row["status"] = f"CONNECT_ERROR: {e}"
        return row

    # 3) 有効期限を日数に直す
    ts = ssl.cert_time_to_seconds(cert["notAfter"])
    expires = datetime.fromtimestamp(ts, tz=timezone.utc)
    days = (expires - datetime.now(timezone.utc)).days
    issuer = dict(item[0] for item in cert["issuer"])

    row["not_after"] = expires.strftime("%Y-%m-%d")
    row["days_left"] = days
    row["issuer"] = issuer.get("organizationName", issuer.get("commonName", ""))
    row["status"] = "OK" if days > WARN_DAYS else "EXPIRING"
    return row


def main(path):
    with open(path, encoding="utf-8") as f:
        hosts = [
            line.strip()
            for line in f
            if line.strip() and not line.lstrip().startswith("#")
        ]

    writer = csv.DictWriter(sys.stdout, fieldnames=FIELDS)
    writer.writeheader()

    bad = 0
    for host in hosts:
        row = check(host)
        writer.writerow(row)
        if row["status"] != "OK":
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "hosts.txt"))
```

### 各部分の役割

- `check()` は DNS、TLS 接続、期限計算の 3 段階に分けた。失敗した段階が `status` に残り、原因の切り分けに使える。
- `ssl.create_default_context()` は証明書チェーンとホスト名を検証する。期限切れや名前の不一致は `SSLCertVerificationError` になる。
- `ssl.cert_time_to_seconds()` は、証明書の `notAfter` 文字列を UNIX 時間に変換する。自前で日付をパースせずに済む。
- `main()` は異常が 1 件でもあれば終了コード 1 を返す。cron や CI から呼ぶときに使える。

## 手順3：実行して結果を保存する

```bash
python cert_inventory.py hosts.txt > inventory.csv
echo $?
```

出力は CSV なので、そのまま表計算ソフトで開けます。契約名義や更新担当の列を足して、棚卸しの一覧に統合してください。

## 動作の確認方法

- 正常系：公開中のサイトを 1 件入れ、`status` が `OK` で `days_left` に妥当な日数が入ることを確認する。
- 警告系：`WARN_DAYS` を一時的に 9999 にし、すべてが `EXPIRING` になれば判定の分岐が動いている。
- DNS 系：存在しない名前（例：`no-such-host.example.invalid`）を入れ、`DNS_ERROR` になることを確認する。
- 異常終了コード：1 件でも `OK` でなければ `echo $?` が 1 になる。

## 注意点

### 期限切れは「日数」ではなくエラーで出る

期限切れの証明書は検証で弾かれるため、`days_left` ではなく `CERT_INVALID` として出ます。期限の過ぎた日付までは取れません。日付が必要なら、ブラウザの証明書表示や `openssl s_client` で個別に確認します。

### 自己署名や社内 CA の証明書

社内 CA の証明書は、既定の検証では `CERT_INVALID` になります。検証を無効にして通す書き方は、中間者攻撃に気づけなくなるので避けてください。社内 CA のルート証明書を `ctx.load_verify_locations()` で読み込ませる方法が安全です。

### 調査元の環境に依存する

社内ネットワークだけで引ける名前は、外部の PC からは `DNS_ERROR` になります。結果が「存在しない」を意味するとは限りません。どこから実行したかを、CSV と一緒に記録しておくと混乱を防げます。

### 443 以外のポート

メールや管理画面が別のポートで TLS を使う場合は、`check()` の `port` 引数を変えます。STARTTLS 方式のポートには、このスクリプトはそのままでは使えません。

### 対象は自社の資産だけにする

他者のホストへの無断接続は避けてください。契約書や請求書で自社のものと確認できた名前だけを一覧に入れます。

## まとめ

- 引き継ぎの最初の一歩は、ホスト名と証明書期限の一覧化である。
- 標準ライブラリだけで、DNS 解決と期限確認を CSV にできる。
- 失敗した段階を `status` に残すと、原因の切り分けが速くなる。
- 検証を無効化せず、社内 CA は読み込みで対応する。
- 終了コードを使えば、そのまま定期実行の監視にも転用できる。
