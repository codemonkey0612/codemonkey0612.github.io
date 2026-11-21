---
title: ライブ配信の運営作業を約50%削減した案件から考える、WebRTC配信で最初に決めたい4つのこと
emoji: 🎥
type: tech
topics:
  - webrtc
  - nodejs
  - aws
  - ffmpeg
published: true
published_at: 2026-11-22 09:00
---

教育・研修事業者向けのライブ配信基盤を作った案件では、配信準備から参加者管理までの運営作業時間を約50%削減できました。この記事では、その案件を振り返りながら、WebRTC配信の設計で最初に決めたい4つのことを整理します。案件で実際に行ったことと、私が一般論として勧める内容は分けて書きます。端末や通信環境がばらばらな視聴者に向けて、配信基盤を作る方が対象です。

## 案件の状況：端末も通信環境もばらばらな視聴者と、運営の手作業

案件の概要は次のとおりです。

- 期間：2020年6月〜2021年1月
- 体制：5名（PM1名・エンジニア2名・配信担当2名）
- 私の役割：フルスタックエンジニア（システム設計、会員管理、配信画面、動画処理、API開発、AWS構築、テスト）
- 課題：端末や通信環境によって視聴品質がばらつく中で、安定した配信と簡単な参加手続きを両立すること
- 技術スタック：React、Node.js、WebRTC、WebSocket、FFmpeg、AWS、MySQL

この案件でやったことは、WebRTCによる配信、参加者認証、録画管理、動画変換、視聴ページの実装と、複数端末での動作検証です。結果として、配信準備から参加者管理までの運営作業時間を約50%削減しました。

以降は、この経験を踏まえて「設計の最初に何を決めるか」を書きます。実装の細部は案件固有の情報なので、コードは一般的な例です。

## 決めること1：配信技術とその前提

WebRTCを選ぶ主な理由は、ブラウザだけで低遅延の双方向通信ができる点です。研修では質疑応答や発言が発生します。そのため、遅延の小ささが体験に直結します。

一方で、WebRTCは「つなげば動く」技術ではありません。決めておく前提が3つあります。

- 配信者1人に対して視聴者が何人か（同時接続の上限）
- 視聴者は発言するか、視聴のみか
- 録画は必須か

私なら、最初にこの3点を数字で固めます。視聴者が数人なら配信者から全員へ直接つなぐ構成でも成立します。視聴者が増えるなら、中継サーバー（SFU）を挟む構成を検討します。配信者の上り帯域が人数に比例して増えるためです。

### 接続できない環境への備え

企業や学校のネットワークでは、直接の通信が通らないことがあります。STUNだけでなくTURNサーバーも設定しておくのが一般的です。iceServersを指定しない場合は、ブラウザ既定の挙動に依存し、NAT越えが期待できません。[MDNのRTCPeerConnectionの説明](https://github.com/mdn/content/blob/main/files/en-us/web/api/rtcpeerconnection/rtcpeerconnection/index.md)でも、サーバーなしの接続はローカルのピアに限られると説明されています。

```javascript:viewer.js
// TURNの認証情報は固定値を埋め込まず、認証済みユーザーにAPIで都度発行する
const { urls, username, credential } = await fetch("/api/ice-config", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

const pc = new RTCPeerConnection({
  iceServers: [{ urls, username, credential }],
});
```

ポイントは、TURNの資格情報をクライアントに固定で持たせないことです。ログイン済みの参加者にだけ、有効期限付きで発行する形を私なら選びます。

## 決めること2：画質の方針（固定するか、適応させるか）

視聴品質のばらつきには、全員を同じ品質に揃えようとせず、劣化の仕方を先に決めるのが有効です。たとえば「映像が乱れても音声は止めない」という優先順位を決めます。研修では、音声が途切れる方が致命的だからです。

配信側では、送信ビットレートの上限を設定できます。

```javascript:publisher.js
async function limitVideoBitrate(pc, maxBitrate) {
  const sender = pc.getSenders().find((s) => s.track?.kind === "video");
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = maxBitrate; // bps
  await sender.setParameters(params);
}

await limitVideoBitrate(pc, 1_500_000);
```

上限値は教材の種類で変わります。スライド中心なら低くても読めます。実技の映像なら高めが必要です。数値は検証して決めるものなので、ここでは例として1.5Mbpsを置いています。

## 決めること3：認証・録画・変換をどこまで自動化するか

この案件では、参加者認証、録画管理、動画変換を実装しました。運営作業の削減に効くのは、人が手でやっていた繰り返し作業を、システム側に寄せることだと考えています。私なら、次の3つを自動化の対象にします。

### 参加者認証

URLを共有するだけの運用は簡単ですが、誰が参加したかを管理できません。ログイン済みの会員だけがシグナリングに接続できるようにします。WebSocketの接続時にトークンを検証する例です。

```javascript:signaling.js
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";

const wss = new WebSocketServer({ noServer: true });

export function attach(server) {
  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      const user = jwt.verify(token, process.env.JWT_SECRET);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.user = user;
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });
}
```

upgradeの段階で検証し、不正なら接続を確立させません。入室時刻や退室時刻をDBに記録すれば、出欠の確認も自動化できます。なお、トークンをクエリに載せるとアクセスログに残ることがあります。ログの扱いには注意が必要です。短い有効期限にするのが無難です。

### 録画管理

録画ファイルは、配信と紐づくメタデータで管理します。最低限、次の項目が要ります。

- 配信ID、開始時刻、終了時刻
- 保存先（AWSならS3のキー）
- 変換の状態（待機・処理中・完了・失敗）

状態を持たせると、失敗した変換だけを再実行できます。運営が「どの録画が見られる状態か」を目視で確認する作業も減ります。

### 動画変換

録画はブラウザ由来のWebMなどで残ることが多いです。そのままでは再生できない端末があるため、配信後にMP4へ変換するのが一般的です。FFmpegの例です。

```bash
ffmpeg -i input.webm \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  output.mp4
```

- libx264とaacは、幅広い端末で再生できる組み合わせである
- crfは小さいほど高画質で、容量が増える
- faststartは、再生開始前に必要な情報を先頭に置き、ブラウザでの再生開始を早める

これをNode.jsから子プロセスで呼び、終了コードで状態を更新します。失敗時にログを残すところまで作っておくと、運営が原因を調べる手間が減ります。

## 決めること4：検証の範囲を先に決める

この案件では、複数端末で動作を検証しました。WebRTCは、OS、ブラウザ、ネットワークの組み合わせで挙動が変わります。そのため、検証の範囲を設計の最初に決めることを勧めます。

私ならこう進めます。

- 対象のOSとブラウザの一覧を、顧客と合意して固定する
- 実機を使い、会場や自宅を想定した回線でも試す
- 帯域制限や遅延を人工的に与えて、劣化時の挙動を見る
- 数値で見られるように、統計情報を取る

統計情報は`getStats()`で取れます。

```javascript:stats.js
async function logInboundVideo(pc) {
  const report = await pc.getStats();
  report.forEach((s) => {
    if (s.type === "inbound-rtp" && s.kind === "video") {
      console.log({
        packetsLost: s.packetsLost,
        jitter: s.jitter,
        framesDecoded: s.framesDecoded,
      });
    }
  });
}

setInterval(() => logInboundVideo(pc), 5000);
```

数秒ごとに記録しておけば、「映像が悪い」という報告を、パケット損失などの数値と突き合わせられます。サポートの切り分けが速くなります。

## 結果：運営作業時間を約50%削減

案件の結果は、配信準備から参加者管理までの運営作業時間の約50%削減です。内訳や削減の要因別の数字は、ここでは示しません。

私の見方として、手作業が減るのは、認証、録画、変換が配信と一つの流れでつながったときです。個々の機能が優れているだけでは、運営の手間は大きく減りません。

## 同じ課題に直面したら最初にやること

ここからは案件の事実ではなく、私が勧める手順です。

たとえば、視聴者が数十人規模の研修配信を作るとします。私なら、実装の前に次の5つを1枚にまとめます。

- 同時接続数の上限と、発言の有無
- 対応する端末とブラウザの一覧
- 音声優先か映像優先かという劣化時の方針
- 参加者の入室から録画公開までの流れ（誰が何を手で行うか）
- 検証に使う回線条件と、合格の基準

特に4つ目が重要です。手作業が残る箇所を洗い出すと、自動化の優先順位が決まります。

## よくある落とし穴

- TURNを用意せず、特定のネットワークだけ接続できない
- 録画の状態を持たず、変換失敗に気づけない
- 検証が開発者の環境だけで終わる
- 認証用トークンの有効期限が長すぎる

## まとめ

WebRTC配信で最初に決めたいのは、次の4つです。

- 配信規模と構成の前提（直接接続か中継か）
- 劣化時の画質・音質の方針
- 認証・録画・変換の自動化範囲
- 検証する端末と回線の範囲

実装に入る前にこの4点を固めると、運営の手作業が減り、視聴品質のばらつきにも対応しやすくなります。

---

私は「Web・業務システム／アプリ開発」をお仕事としてお受けしています。ライブ配信のように認証・録画・動画処理を一体で設計する案件で、今回の整理がお役に立てば幸いです。
→ [Web・業務システム／アプリ開発について](https://shanaiai.com/services/system/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
