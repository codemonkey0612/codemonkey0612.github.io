---
title: PHP更新したのに古いまま？php-fpmの再起動漏れをシェルで検出する
tags:
  - PHP
  - セキュリティ
  - Linux
  - php-fpm
  - Bash
private: false
ignorePublish: true
zenn: off-zenn/php-security-release-nov-2026-check.md
published_at: 2026-11-24 09:00
---

パッケージを更新しても、動いているphp-fpmが古いバイナリのままという状況は起こり得ます。この記事では、更新後の版と稼働中プロセスの状態をシェルスクリプトで突き合わせ、再起動漏れを検出する方法を紹介します。

## 背景

2026年11月19日にPHPのセキュリティリリースが出ています。[PHP 8.5.13のリリースアナウンス](https://www.php.net/releases/8_5_13.php)には、セキュリティリリースであり8.5系の全ユーザーに更新を勧める旨が書かれています。[IPAの注意喚起](https://www.ipa.go.jp/security/security-alert/2026/alert20261120.html)によると、同日に8.2.36、8.3.37、8.4.28、8.5.13が公開されました。

更新作業そのものは`apt`や`dnf`で終わります。ただし「更新した」と「反映された」は別です。私は、版番号の確認と稼働プロセスの確認をセットで自動化しておくのがよいと考えます。

## 前提環境

- Linux（systemdが動くディストリビューション）
- php-fpmでPHPを動かしている
- bash 4以上、rootまたはsudo権限
- 脆弱性の深刻度や発動条件は、この記事では扱わない。公式情報で確認すること

## 方針

確認する項目は次の三つです。

- インストール済みの`php-fpm`の版が、系統ごとの修正版以上か
- 稼働中のmasterプロセスが、削除済みのバイナリを実行していないか
- masterプロセスの起動時刻が、バイナリの更新時刻より前でないか

Linuxでは、実行中のファイルが差し替えられると`/proc/PID/exe`のリンク先に`(deleted)`が付きます。これを手がかりにします。

## スクリプト

```bash:check-php-fpm.sh
#!/usr/bin/env bash
set -euo pipefail

# 系統ごとの最低ライン（2026-11-19公開の修正版）
fixed_for() {
  case "$1" in
    8.2) echo "8.2.36" ;;
    8.3) echo "8.3.37" ;;
    8.4) echo "8.4.28" ;;
    8.5) echo "8.5.13" ;;
    *)   echo "" ;;
  esac
}

# 引数: php-fpmのパス（省略時はPATH上のもの）
bin="${1:-$(command -v php-fpm || true)}"
[ -x "$bin" ] || { echo "php-fpm not found"; exit 2; }

ver="$("$bin" -v | head -n1 | awk '{print $2}')"
minor="${ver%.*}"
need="$(fixed_for "$minor")"
status=0

echo "installed: $ver"
if [ -z "$need" ]; then
  echo "NG: ${minor}系は対象表にありません。サポート状況を確認してください"
  status=1
else
  oldest="$(printf '%s\n%s\n' "$ver" "$need" | sort -V | head -n1)"
  if [ "$oldest" = "$need" ]; then
    echo "OK: $ver >= $need"
  else
    echo "NG: $ver < $need"
    status=1
  fi
fi

# 稼働中masterプロセスの確認
pids="$(pgrep -f 'php-fpm: master process' || true)"
if [ -z "$pids" ]; then
  echo "NG: php-fpmのmasterプロセスが見つかりません"
  exit 1
fi

bin_mtime="$(stat -c %Y "$(readlink -f "$bin")")"
for pid in $pids; do
  exe="$(sudo readlink "/proc/$pid/exe")"
  start="$(date -d "$(ps -o lstart= -p "$pid")" +%s)"
  if [[ "$exe" == *"(deleted)"* ]]; then
    echo "NG: pid=$pid は削除済みバイナリで稼働中。再起動が必要です"
    status=1
  elif [ "$start" -lt "$bin_mtime" ]; then
    echo "NG: pid=$pid はバイナリ更新より前に起動しています"
    status=1
  else
    echo "OK: pid=$pid"
  fi
done

exit "$status"
```

### 各部分の役割

- `fixed_for`は、系統から最低ラインの版を返す。次の修正版が出たらここだけ直す
- `sort -V`は版番号を自然順に並べる。先頭が`need`なら、導入済みの版は`need`以上
- `/proc/PID/exe`の`(deleted)`は、更新前のバイナリで動き続けている印
- 起動時刻とバイナリの更新時刻の比較は、`(deleted)`にならない配置方法への保険

## 動作確認

```bash
chmod +x check-php-fpm.sh
./check-php-fpm.sh /usr/sbin/php8.3-fpm
```

パッケージ更新直後に実行すると、再起動前は`NG`が出るはずです。再起動してから再実行します。

```bash
sudo systemctl restart php8.3-fpm
./check-php-fpm.sh /usr/sbin/php8.3-fpm
```

すべて`OK`なら終了コードは0です。ユニット名とパスはディストリビューションで異なるため、読み替えてください。

## 落とし穴

### reloadとrestartの違い

`reload`は設定の再読み込みが主目的です。実行ファイルの入れ替えを確実に反映したいなら、私は`restart`を選びます。止まる時間が気になる場合は、低負荷の時間帯に実施します。

### CLIの版とFPMの版は別物

`php -v`はCLIの版です。Webで動くのはphp-fpmやApacheモジュールなので、ここで見る対象も別です。複数の版を併存させている環境では特に注意してください。

### 共有サーバーでは確認できない

レンタルサーバーでは`/proc`を見られません。その場合は事業者のお知らせと、管理画面で選んだ版を確認するのが現実的です。

### 本番の前にテスト環境で

パッチ版は互換性が高いのが一般的です。それでも、私ならステージングで先に流して、このスクリプトも同じ手順で試します。

## CIや定期実行に組み込む

終了コードを返す作りにしたので、cronや監視の定期チェックに載せられます。たとえば更新当日の夜にだけ実行し、失敗したらチャットへ通知する、といった使い方です。通知先はここでは省略します。

## まとめ

- 更新後は、版番号とプロセスの状態を両方確認する
- `/proc/PID/exe`の`(deleted)`で、再起動漏れを機械的に検出できる
- 修正版の対応表は、リリースのたびに一か所だけ直す
- 本番反映の前に、テスト環境で手順ごと確認する
