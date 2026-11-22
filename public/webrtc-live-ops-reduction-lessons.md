---
title: coturnのTURN認証情報を期限付きで都度発行し、固定値より漏えい時の被害を抑える
tags:
  - WebRTC
  - coTurn
  - Node.js
  - turn
private: false
updated_at: '2026-11-22T09:00:12+09:00'
id: 50c27c11ccf08db3165a
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
WebRTC配信でTURNサーバーに固定のユーザー名とパスワードを書くと、フロントのコードから抜かれて第三者の中継に使われるおそれがあります。この記事では、coturnの共有シークレット方式で、期限付きの認証情報をAPIから都度発行する方法を、動くコードで示します。

## 前提

- TURNサーバーはcoturnを使う
- APIはNode.js（ESM）とExpressで書く
- 認証済みユーザーを判定するミドルウェア `requireAuth` は既にある前提である
- 私は教育・研修事業者向けのライブ配信基盤（WebRTC、Node.js、AWS）の開発に携わった。ただし、以下の設定値とコードは一般的な例である

なお、今回は検索ツールが使えず公式ドキュメントのURLを確認できませんでした。そのため出典リンクは付けていません。バージョン依存の挙動は、お使いの版の公式ドキュメントで確認してください。

## 仕組み

coturnには、共有シークレットから一時的な認証情報を計算で作る方式があります。アプリ側とcoturnが同じシークレットを持ちます。通信のたびにDBへ問い合わせる必要はありません。

- ユーザー名は「有効期限のUNIX秒:任意のID」にする
- パスワードは、そのユーザー名をシークレットでHMAC-SHA1し、Base64にした値である
- coturnはユーザー名の期限を見て、過ぎていれば拒否する

つまり、期限切れの認証情報は自然に使えなくなります。

## 手順1：coturnの設定

```ini:turnserver.conf
listening-port=3478
tls-listening-port=5349
realm=turn.example.com
use-auth-secret
static-auth-secret=ここに十分長いランダム文字列
fingerprint
no-cli
# 内部ネットワークへの中継を禁止する
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

- `use-auth-secret` と `static-auth-secret` が共有シークレット方式の有効化である
- `denied-peer-ip` は、TURNを踏み台にした内部ネットワークへのアクセスを防ぐ
- シークレットは設定ファイルへ直書きせず、デプロイ時に秘匿情報の管理機構から注入するのが無難である

## 手順2：発行APIを作る

```javascript:ice-config.js
import crypto from "node:crypto";
import express from "express";

const TTL_SECONDS = 600;
const router = express.Router();

export function makeTurnCredential(userId, secret, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");
  return { username, credential };
}

router.get("/api/ice-config", requireAuth, (req, res) => {
  const secret = process.env.TURN_SECRET;
  const { username, credential } = makeTurnCredential(req.user.id, secret);
  res.set("Cache-Control", "no-store");
  res.json({
    ttl: TTL_SECONDS,
    iceServers: [
      { urls: "stun:turn.example.com:3478" },
      {
        urls: [
          "turn:turn.example.com:3478?transport=udp",
          "turns:turn.example.com:5349?transport=tcp",
        ],
        username,
        credential,
      },
    ],
  });
});

export default router;
```

- `makeTurnCredential` は、期限付きユーザー名とHMACを返す純粋関数であり、テストしやすくしてある
- ユーザー名にユーザーIDを入れると、coturnのログから誰の通信かを追える
- `Cache-Control: no-store` で、中間キャッシュに認証情報が残るのを避ける
- `turns:` を入れると、UDPが塞がれた環境でもTLS経由で通る可能性が上がる

## 手順3：クライアントで使う

```javascript:viewer.js
const config = await fetch("/api/ice-config", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

const pc = new RTCPeerConnection({ iceServers: config.iceServers });
```

配信の入室ごとに取得し直します。長時間の配信では、期限の前に再取得して `pc.setConfiguration()` で差し替える設計も検討してください。既存の通信は期限後も続くことがありますが、再接続時は新しい認証情報が必要です。

## 動作確認

### 単体テスト

HMACは、固定の入力に対して同じ出力になります。時刻を固定して確認します。

```javascript:ice-config.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { makeTurnCredential } from "./ice-config.js";

test("期限付きユーザー名が作られる", () => {
  const r = makeTurnCredential("u1", "secret", 1_000_000);
  assert.equal(r.username, "1600:u1");
  assert.equal(r.credential.length, 28);
});
```

1,000,000ミリ秒は1000秒です。TTLの600秒を足して1600になります。SHA-1のBase64は28文字です。

### 実際にTURN経由になるかの確認

STUNやホスト候補で通ってしまうと、TURNの設定ミスに気づけません。テスト時だけ中継を強制します。

```javascript:relay-check.js
const pc = new RTCPeerConnection({
  iceServers: config.iceServers,
  iceTransportPolicy: "relay",
});
pc.onicecandidate = (e) => {
  if (e.candidate) console.log(e.candidate.type, e.candidate.protocol);
};
pc.createDataChannel("probe");
await pc.setLocalDescription(await pc.createOffer());
```

`relay` の候補が出れば、認証と中継は成功しています。出なければ、シークレットの不一致か期限切れが疑わしいです。

## 落とし穴

- サーバー間の時計のずれ：APIとcoturnの時刻が大きくずれると、発行直後でも期限切れ扱いになる。NTPで合わせる
- TTLが短すぎる：接続確立に時間がかかる回線で失敗する。私なら配信の想定時間と再接続を考え、数分から数十分で始める
- シークレットのローテーション：切り替え時に旧シークレットで発行した認証情報が無効になる。TTLが切れる時間を見込んで入れ替える
- 発行APIの無防備な公開：認証なしだと、誰でも認証情報を量産できる。私なら、ユーザー単位のレート制限も付ける
- 帯域の悪用：期限があっても、有効期間内は中継を使える。coturn側の `user-quota` や総帯域の上限も検討する

## まとめ

TURNの認証情報は、固定値ではなく共有シークレットから期限付きで発行すると、固定値より漏えい時の被害を抑えやすくなります。ただし、シークレット管理や時刻同期といった運用負荷はあります。コードは数十行で済みます。

- coturnは `use-auth-secret` で有効化する
- ユーザー名に期限を入れ、HMAC-SHA1をBase64にしたものをパスワードにする
- 動作確認は `iceTransportPolicy: "relay"` で中継だけを強制する
- 時計のずれとシークレットの入れ替えを運用で押さえる
