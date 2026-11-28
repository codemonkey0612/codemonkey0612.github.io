---
title: Javaの更新通知に慌てない：サーバー内のJavaと配布元を数分で棚卸しするPythonスクリプト
tags:
  - Java
  - Python
  - Security
  - 脆弱性
  - Linux
private: false
updated_at: '2026-11-28T09:00:18+09:00'
id: fb13f1322adea36c84bf
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
2026年11月18日(日本時間)に、IPAがOracle Javaのセキュリティ更新について注意喚起を出しました。こうした通知で最初に困るのは、「うちのサーバーのどこで、どの配布元の、どのバージョンのJavaが動いているか」を誰も即答できないことです。

この記事では、Linuxサーバー上のJavaを洗い出して一覧にする小さなPythonスクリプトを紹介します。更新作業そのものではなく、その前段の棚卸しが対象です。

## 前提と一次情報

- Python 3.9以上(標準ライブラリのみ)
- Linuxサーバー(`/proc`を使います)
- 実行はrootでなくても動きますが、他ユーザーのプロセスは見えません

対策や対象バージョンは、必ず一次情報で確認してください。[IPAの「Oracle Java の脆弱性対策について(2026年11月)」](https://www.ipa.go.jp/security/security-alert/2026/1118-jre.html)は、Oracle社が提供する最新版への更新を対策として示しています。このページはあわせて、Oracle社が2019年4月16日以降のJavaのリリースについてライセンス変更を案内していることにも触れています。

対象バージョンの一覧は、この記事には転記しません。転記すると、古い情報が残る原因になるためです。スクリプトは事実の収集だけを担当し、判定は人がIPAとOracleのページを見て行います。

## 何が問題か

`java -version`を1台で打つだけなら簡単です。実際には次の3つが見落としの原因になります。

- PATH上のJavaと、実際にプロセスが使っているJavaが違う
- 複数のJDKが`/opt`や`/usr/lib/jvm`に同居している
- 配布元がOracleとは限らない

そこで、起動中のプロセスと、ディスク上のJava実行ファイルの両方を集めます。各実行ファイルに`-XshowSettings:properties`を付けて起動すれば、`java.vendor`と`java.version`を機械的に取れます。

## スクリプト

```python:java_inventory.py
#!/usr/bin/env python3
"""サーバー内のJavaを列挙し、JSON Linesで出力する。"""
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

SEARCH_ROOTS = ["/usr/lib/jvm", "/opt", "/usr/local", "/home"]
WANTED = ("java.vendor", "java.version", "java.home")


def running_javas():
    """起動中プロセスのJava実行ファイルとPIDを返す。"""
    result = {}
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            exe = os.readlink(proc / "exe")
        except OSError:
            continue
        if os.path.basename(exe) == "java":
            result.setdefault(exe, []).append(int(proc.name))
    return result


def disk_javas():
    """ディスク上の bin/java を探す。"""
    found = set()
    for root in SEARCH_ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            if "java" in files and os.path.basename(dirpath) == "bin":
                path = os.path.realpath(os.path.join(dirpath, "java"))
                if os.access(path, os.X_OK):
                    found.add(path)
    return found


def probe(java_path):
    """java.vendor などを取得する。失敗時はerrorを返す。"""
    try:
        out = subprocess.run(
            [java_path, "-XshowSettings:properties", "-version"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"error": str(e)}
    props = {}
    for line in out.stderr.splitlines():
        key, sep, value = line.strip().partition(" = ")
        if sep and key in WANTED:
            props[key] = value
    return props


def main():
    running = running_javas()
    paths = set(running) | disk_javas()
    host = socket.gethostname()
    for path in sorted(paths):
        row = {"host": host, "path": path, "pids": running.get(path, [])}
        row.update(probe(path))
        print(json.dumps(row, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
```

### 各部分の役割

- `running_javas`は`/proc/<pid>/exe`のシンボリックリンクを読む関数である。PATHの設定に左右されず、実際に動いているJavaが分かる。
- `disk_javas`は、現在は止まっていても、起動すれば使われるJavaを拾う関数である。
- `probe`は、Javaの設定情報を標準エラーから読み取る関数である。この出力先は仕様上のものなので、`stderr`を見ている。
- `pids`が空でない行が、優先して確認すべき行である。

## 実行と結果の確認

```bash
python3 java_inventory.py | tee java_$(hostname).jsonl
```

出力は次のような形になります。値は仮の例です。

```json
{"host": "app01", "path": "/opt/jdk-xx/bin/java", "pids": [1234], "java.vendor": "Vendor Name", "java.version": "xx.x.x", "java.home": "/opt/jdk-xx"}
```

確認の手順は次のとおりです。

- 既知のJavaプロセスのPIDを`ps`で調べ、`pids`に出ているか見る。
- `java.vendor`がOracleかどうかで、IPAの注意喚起の対象かを切り分ける。
- `java.version`をIPAのページの対象一覧と突き合わせる。

複数台なら、SSHで各サーバーに流し、jsonlを1つに集めます。`jq -s`や表計算ソフトで集計できます。

## コンテナの場合

コンテナの中のJavaは、ホストの`/proc`から見ると別のパスになります。イメージごとに確認するほうが確実です。

```bash
docker run --rm --entrypoint java IMAGE_NAME -XshowSettings:properties -version 2>&1 | grep -E "java\.(vendor|version)"
```

`IMAGE_NAME`には自分のイメージ名を入れます。この方法は、`java`がイメージに入っていることが前提です。

## ハマりどころ

- 権限不足：他ユーザーのプロセスの`exe`は読めない。見えないことと無いことは別なので、私ならroot相当で実行する。
- 古いJava：`-XshowSettings:properties`が使えない極端に古い版では、`java -version`の出力だけで判断する必要がある。
- 同梱JRE：業務ソフトが独自のJREを同梱していることがある。`SEARCH_ROOTS`に、そのインストール先を足す。
- 見つけた後の入れ替え：業務システムは特定バージョンを前提にしていることがある。私なら、棚卸しの結果を保守担当と共有し、テストの後に更新する。

## まとめ

- 脆弱性の通知が出たら、まず「何がどこにあるか」を機械的に集める。
- 起動中のプロセスと、ディスク上のJavaの両方を見る。
- 配布元とバージョンは、スクリプトで事実だけを集め、判定は一次情報で行う。
- 対策は、IPAが示すとおり、Oracle社が提供する最新版への更新である。
