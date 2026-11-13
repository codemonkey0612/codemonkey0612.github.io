---
title: PHP2shell対応：複数サーバーとDockerイメージのPHP版数を一括判定するスクリプト
tags:
  - PHP
  - Security
  - Docker
  - Python
  - 脆弱性
private: false
ignorePublish: true
zenn: articles/php2shell-ipa-alert-php-check.md
status: failed
---

<!-- autopilot: not posted to Qiita, these checks still failed:
- textlint (line 50): docker => Docker
- fact-check (technical, contradicted): 「更新後に `stale_check.sh` を流し、出力が空になれば再起動漏れはない。」 — exeのリンク先しか見ないため、mod_phpのlibphpやphp-fpmが読み込む共有ライブラリが古いままでも出力は空になります。「漏れがない」とは言い切れません。また、コンテナ内のプロセスは対象外です。 Fix: 「出力が空なら、実行ファイル置換による再起動漏れは検出されない」と限定し、`php-fpm -v` や needrestart も併用するよう書いてください。
-->

## 解決したい問題

PHP2shell（CVE-2026-109618、CVE-2026-109619）の修正版が出ましたが、サーバーやコンテナが多いと「どこが未更新か」を把握するだけで手間がかかります。パッケージを更新しても、動いているプロセスが古いままという落とし穴もあります。

この記事では、版数の一括判定、バックポートの確認、再起動漏れの検出を、手元で動くコードにまとめます。

## 前提

- 修正版は8.2.35、8.3.36、8.4.27、8.5.12である。出典は[IPAの注意喚起](https://www.ipa.go.jp/security/security-alert/2026/alert20261022.html)である。
- 8.1以前は公式の修正版がない。ディストリビューションなどのバックポートの確認が必要である。
- 最新の情報はIPAのページで確認すること。
- 判定スクリプトはPython 3.9以上を想定している。標準ライブラリだけで動く。
- 対象サーバーにはSSHで入れる前提である。

## 手順1：版数を集める

ホストごとに `PHP_VERSION` を取得し、タブ区切りで保存します。Dockerイメージも同じ要領です。

```bash:collect.sh
#!/usr/bin/env bash
set -u
: > versions.tsv

# サーバー：hosts.txt に1行1ホスト
while read -r host; do
  v=$(ssh -n -o ConnectTimeout=5 "$host" "php -r 'echo PHP_VERSION;'" 2>/dev/null)
  printf '%s\t%s\n' "$host" "${v:-NONE}" >> versions.tsv
done < hosts.txt

# イメージ：images.txt に1行1イメージ
while read -r img; do
  v=$(docker run --rm --entrypoint php "$img" -r 'echo PHP_VERSION;' 2>/dev/null < /dev/null)
  printf '%s\t%s\n' "$img" "${v:-NONE}" >> versions.tsv
done < images.txt
```

ループ内のコマンドが標準入力を読むと、hosts.txtの残りを消費して最初の1行しか処理されないことがあります。そのため、sshには `-n` を付け、dockerには `< /dev/null` を指定しています。

PHPが入っていないイメージは `NONE` になります。ここで取れるのはCLIの版数です。php-fpmやApacheモジュールが別パッケージの場合は、そちらも `php-fpm -v` などで確認してください。

## 手順2：修正版と比較する

次のスクリプトは、各行の版数を5種類（OK、UPDATE、CHECK、NO_OFFICIAL_FIX、UNKNOWN）に分類します。

```python:php_check.py
import re
import sys

# マイナー版ごとの最低修正パッチ版
FIXED = {(8, 2): 35, (8, 3): 36, (8, 4): 27, (8, 5): 12}


def judge(version: str) -> str:
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", version)
    if not m:
        return "UNKNOWN"
    major, minor, patch = map(int, m.groups())
    key = (major, minor)
    if key in FIXED:
        return "OK" if patch >= FIXED[key] else "UPDATE"
    if key > (8, 5):
        return "CHECK"  # 新しい系列。公式情報を確認する
    return "NO_OFFICIAL_FIX"  # 8.1以前。バックポートを確認する


def main(path: str) -> int:
    ng = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            name, _, ver = line.rstrip("\n").partition("\t")
            result = judge(ver)
            print(f"{result:16} {name:30} {ver}")
            if result not in ("OK",) and ver != "NONE":
                ng += 1
    return 1 if ng else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

`FIXED` は「そのマイナー版で必要な最小パッチ版」です。`8.4.27` 以上なら `OK`、未満なら `UPDATE` と判定します。未対応の系列は `NO_OFFICIAL_FIX` として残します。終了コードが1になるので、CIや定期ジョブにも組み込めます。

実行例は次のとおりです。

```bash
bash collect.sh
python3 php_check.py versions.tsv
```

## 手順3：バックポートかどうかを確認する

OSのPHPは、版数が上がらないまま修正だけ取り込まれることがあります。`NO_OFFICIAL_FIX` や `UPDATE` と判定されても、直ちに未対策とは限りません。パッケージの変更履歴でCVE番号を探します。

```bash
# Debian / Ubuntu 系
apt-get changelog php8.1-cli | grep -E 'CVE-2026-10961[89]'

# RHEL 系
rpm -q --changelog php-cli | grep -E 'CVE-2026-10961[89]'
```

両方のCVEが出てくれば、ベンダーが取り込んでいる可能性が高いです。ただし変更履歴の書き方はパッケージ次第です。確証が持てなければ、ベンダーのセキュリティ情報も確認してください。

## 手順4：再起動漏れを検出する

パッケージを入れ替えても、動作中のphp-fpmは古いバイナリを使い続けます。Linuxでは、置き換えられた実行ファイルが `(deleted)` と表示されます。

```bash:stale_check.sh
#!/usr/bin/env bash
for pid in $(pgrep -f 'php-fpm|apache2|httpd'); do
  exe=$(readlink "/proc/$pid/exe" 2>/dev/null)
  case "$exe" in
    *"(deleted)"*) echo "STALE pid=$pid $exe" ;;
  esac
done
```

`STALE` が出たら、サービスを再起動して再実行します。root権限での実行が必要です。実行中の版数そのものを知りたい場合は、FPMなら `php-fpm -v` の結果とあわせて見てください。

## 動作確認

- `php_check.py` に、わざと古い版数を書いた `versions.tsv` を渡し、`UPDATE` になることを確認する。
- たとえば `host-a	8.3.35` という行は `UPDATE`、`host-b	8.3.36` は `OK` になるはずである。
- 更新後に `stale_check.sh` を流し、出力が空になれば再起動漏れはない。

## 落とし穴

- 暫定対策の設定変更は、更新の代わりにならない。IPAは更新や移行までの暫定対策とアクセス制限の検討を求めている。
- CLIとFPMで別のPHPが入っている環境がある。CLIだけ更新済みで、Webが古いままの例は珍しくない。
- `docker run` で調べられるのはイメージ内の版数である。稼働中のコンテナが古いイメージのままかは別に確認する。`docker ps` のイメージIDと照合すること。
- 更新前に侵入されていた可能性は残る。更新後もログの保全と調査は続けること。

## まとめ

- 版数は `PHP_VERSION` をホストとイメージから機械的に集め、修正版と比較すると漏れが減る。
- 8.1以前は、バックポートの有無を変更履歴とベンダー情報で確認する。
- 更新後は `/proc/PID/exe` の `(deleted)` で、再起動漏れを検出できる。
- 判定表の数値は、今後の更新で変わる可能性がある。必ずIPAなどの一次情報で最新を確認すること。
