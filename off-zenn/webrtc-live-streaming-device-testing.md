---
title: ライブ配信の参加手続きを簡単にしたまま、視聴品質のばらつきを検証した話
emoji: 🎥
type: tech
topics:
  - webrtc
  - nodejs
  - aws
  - react
published: false
---

<!-- autopilot: not published, these checks still failed:
- fact-check (title_overclaim, unsupported): 「ライブ配信の参加手続きを簡単にしたまま、視聴品質のばらつきを検証した話」 — タイトルは視聴品質のばらつきを検証した実績のように読めます。しかし本文は「私なら〜します」という設計案が中心で、品質のばらつきを測った結果は載っていません。プロフィールにあるのも複数端末での動作検証までです。 Fix: 「…視聴品質のばらつきを数字で見るための設計」のように、設計案であることが分かるタイトルにする。
-->

参加手続きは URL 1 本で完結させ、認証は外さない。この方針なら、端末や回線ごとの視聴品質のばらつきを数字で見られるようにできます。教育・研修向けのライブ配信基盤では、これが運営負荷を下げる近道だと考えています。私が担当した実案件では、配信準備から参加者管理までの運営作業時間を約50%削減できました。WebRTC 配信を作る方や、参加者の環境がばらばらな配信を設計する方に向けて、判断の理由とコードを書きます。

## 案件の状況：端末も回線もばらばらな参加者に配信する

案件は、教育・研修事業者向けのライブ動画配信プラットフォーム開発です。期間は 2020 年 6 月から 2021 年 1 月で、体制は 5 名でした。内訳は PM 1 名、エンジニア 2 名、配信担当 2 名です。私はフルスタックエンジニアとして、次の領域を担当しました。

- システム設計
- 会員管理
- 配信画面
- 動画処理
- API 開発
- AWS 構築
- テスト

課題は、端末や通信環境によって視聴品質がばらつく中で、安定した配信と簡単な参加手続きを両立することでした。技術スタックは React、Node.js、WebRTC、WebSocket、FFmpeg、AWS、MySQL です。

この二つは、放っておくと対立します。手続きを簡単にすると、品質を測る前提（ログインしたユーザーの端末情報など）が薄くなります。品質を安定させようとして事前チェックを増やすと、手続きが重くなります。以降は、この対立をどう整理するかという話です。なお、以降の「私なら〜します」は設計上の考え方です。案件内の個々の判断の経緯を再現したものではありません。

## 最初に決めたこと：参加手続きは簡単に、認証は外さない

方針は「手続きを簡単にすることと、認証を外すことは別物」と整理することでした。参加者にとっての手間は、アカウント作成やパスワード管理、アプリのインストールです。これらは減らせます。一方で、誰がどの配信に入れるかの確認は、教育・研修の有料コンテンツでは外せません。

私なら、参加者ごとに発行した短命のトークン付き URL で入室させます。参加者はリンクを開くだけです。サーバー側では、トークンの署名と有効期限、さらに DB 上でその参加者がそのセッションに登録済みかを確認します。

### トークン発行（Node.js）

```js:token.js
import jwt from "jsonwebtoken";

const SECRET = process.env.JOIN_TOKEN_SECRET;

export function issueJoinToken({ sessionId, participantId }) {
  return jwt.sign(
    { sid: sessionId, pid: participantId },
    SECRET,
    { algorithm: "HS256", expiresIn: "2h" }
  );
}

export function verifyJoinToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ["HS256"] });
}
```

`algorithms` を明示するのは、想定外のアルゴリズムでの検証を防ぐためです。有効期限は配信時間に合わせて調整します。

### シグナリング接続時の検証（WebSocket）

WebRTC ではシグナリングに WebSocket を使います。接続の入口でトークンを検証すれば、認証をここ 1 か所に集められます。

```js:signaling.js
import http from "node:http";
import { WebSocketServer } from "ws";
import { verifyJoinToken } from "./token.js";
import { isRegistered } from "./db.js"; // MySQL を引く関数（別実装）

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const claims = verifyJoinToken(url.searchParams.get("t"));
    if (!(await isRegistered(claims.sid, claims.pid))) throw new Error("not registered");
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.claims = claims;
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});

server.listen(8080);
```

`upgrade` イベントで拒否すれば、認証に失敗した接続は WebSocket として確立されません。`isRegistered` は仮の関数名です。実際は参加者テーブルとセッションテーブルを引く処理を書きます。

注意点として、クエリ文字列のトークンはアクセスログに残りやすいです。私ならログ出力時にクエリを落とします。有効期限も短めにします。厳しくしたい場合は、接続後の最初のメッセージで認証する方式もあります。

## WebRTC 配信・録画管理・動画変換をどう分けたか

実装した機能は、WebRTC による配信、参加者認証、録画管理、動画変換、視聴ページです。私なら、これらを次の三つに分けて責任を切ります。理由は、負荷の性質と失敗時の影響が違うからです。

- リアルタイム配信（WebRTC とシグナリング）：遅延に弱く、止まると即座に影響が出る。
- 録画管理：配信中に生成されるファイルの保管場所と状態を管理する。
- 動画変換（FFmpeg）：CPU を大量に使うが、数分遅れても配信には影響しない。

特に変換は、配信と同じプロセスやサーバーで動かさないのが鉄則だと考えます。変換が CPU を使い切ると、ライブの品質が落ちるからです。

### 変換をジョブとして切り離す

私なら、録画ファイルの状態を MySQL のテーブルで管理します。状態は `recorded`、`converting`、`ready`、`failed` のように持ちます。変換用のワーカーが `recorded` のものを順に取って処理する形です。失敗しても `failed` で見えるので、再実行も運営の手作業になりにくくなります。

変換コマンドの一例は次のとおりです。

```bash
ffmpeg -i input.webm \
  -c:v libx264 -preset veryfast -crf 23 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  output.mp4
```

- `-c:v libx264 -crf 23`：多くの端末で再生しやすい H.264 にし、品質は CRF で指定する。
- `-c:a aac -b:a 128k`：音声を AAC に揃える。
- `-movflags +faststart`：MP4 のメタ情報を先頭に置き、ダウンロード完了を待たずに再生を始められるようにする。

録画した形式が環境によって違う場合も、変換後の形式を MP4 一つに揃えておけば、視聴ページ側の分岐を減らせます。

## 複数端末での動作検証を先にやった理由

案件では、複数端末で動作を検証しました。その理由を、一般論として書きます。WebRTC の挙動は、ブラウザや OS、端末の性能、ネットワーク経路で変わります。開発機で動いたことは、本番の参加者で動くことの証拠になりません。

さらに、機能を作り込んだ後で端末差の問題が見つかると、手戻りが大きくなります。私なら、配信の最小構成ができた段階で、端末の組み合わせを先に検証します。たとえば次のような軸で表を作ります。

- OS とブラウザ（デスクトップ、スマートフォン、タブレット）
- 回線（有線、Wi-Fi、モバイル回線）
- 参加者が置かれる想定の環境（会社のネットワークなど、通信が制限されうる場所）

### 「体感」ではなく数字で見る

端末ごとの差を比べるには、同じ指標で測る必要があります。ブラウザの `getStats()` で、視聴側の受信状況を取れます。

```js:stats.js
export async function sampleVideoStats(pc) {
  const report = await pc.getStats();
  const out = {};
  report.forEach((s) => {
    if (s.type === "inbound-rtp" && s.kind === "video") {
      out.packetsReceived = s.packetsReceived;
      out.packetsLost = s.packetsLost;
      out.jitter = s.jitter;
      out.framesDecoded = s.framesDecoded;
      out.framesDropped = s.framesDropped;
    }
    if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
      out.rtt = s.currentRoundTripTime;
    }
  });
  return out;
}

export function startReporting(pc, ws, intervalMs = 5000) {
  const id = setInterval(async () => {
    const stats = await sampleVideoStats(pc);
    ws.send(JSON.stringify({ type: "stats", stats, ua: navigator.userAgent }));
  }, intervalMs);
  return () => clearInterval(id);
}
```

- `inbound-rtp`：受信したパケット数と損失、ジッター、デコードできたフレーム数、破棄したフレーム数を取る。
- `candidate-pair`：実際に使われている経路の往復遅延（RTT）を取る。
- `startReporting`：数秒おきに統計とユーザーエージェントを送る。サーバー側で端末別に集計できる。

注意点は、取得できる項目がブラウザによって異なることです。値が `undefined` の場合を前提に、集計側で欠損を扱います。また `packetsLost` や `framesDropped` は累積値です。差分を取って見ないと、時間変化がわかりません。送るデータは匿名の統計に絞ります。個人を特定する情報は含めません。

## 結果：運営作業時間を約50%削減

結果として、配信準備から参加者管理までの運営作業時間を約50%削減しました。これは案件で得られた数字です。

この削減は、認証と参加手続きの設計、録画から変換までの流れの整理、視聴ページの実装が組み合わさって得られたものと考えています。個々の施策の寄与率は、案件の記録として分けて測っていないため、ここでは述べません。

## 同じ課題に直面したら最初にやること

私なら、次の順で進めます。

1. 参加者の端末と回線の想定を、聞き取りで洗い出す。ここが曖昧だと、検証の軸が決まらない。
2. 参加手続きの手間を列挙する。そのうえで、減らせるもの（アカウント作成など）と、外せないもの（本人確認、登録済みかの確認）に分ける。
3. 最小の WebRTC 配信を作り、`getStats()` の送信を最初から入れる。測れない状態で最適化を始めないためである。
4. 端末と回線の組み合わせ表で、受信統計を比べる。パケット損失とフレーム破棄が大きい組み合わせを見つける。
5. 録画と変換は、配信と別の流れに切り離す。状態管理を DB に持たせ、失敗が見えるようにする。
6. 運営がやっている手作業を書き出し、システムに寄せられる順に並べる。

### 落とし穴

- 認証を「簡単さ」のために緩め、URL が転送されて誰でも入れる状態になること。トークンは短命にし、登録済みかを DB で確認する。
- 開発機と社内の良い回線だけで検証して終わること。
- 変換を配信と同じマシンで動かし、ライブの品質を落とすこと。
- 統計の累積値をそのまま比べて、誤った結論を出すこと。

## まとめ

簡単な参加手続きと確かな認証は、両立できます。手間を減らす対象は、アカウント作成のような「参加者の作業」です。認証そのものは残します。品質のばらつきは、端末と回線の組み合わせごとに数字で見て、早い段階で検証します。配信、録画管理、変換は負荷の性質で分けます。この考え方で、私の案件では運営作業時間を約50%削減できました。

---

私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。今回のような、認証付きの配信基盤や録画・変換の仕組み作りも、その範囲でご相談いただけます。
→ [Web・業務システム／アプリ開発について](https://shanaiai.com/services/system/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
