---
title: 認証・認可がバラバラな既存Webアプリを、OAuth 2.0とRBACで統一したときの進め方
emoji: 🔐
type: tech
topics:
  - security
  - oauth
  - typescript
  - nodejs
  - rbac
published: true
published_at: 2026-11-20 09:00
---

認証・認可の実装が機能ごとにばらばらな既存Webアプリは、先に「何があるか」を一覧にして「どこで判断するか」を1か所に決めると、統一まで迷わず進められます。私が関わった中堅IT企業向けWebアプリの案件では、OAuth 2.0・トークン管理・RBACに寄せて、認証・認可の処理を統一しました。この記事は、同じ状況の既存システムを引き継いだ、あるいは改修する立場のバックエンドエンジニア向けです。棚卸しの観点、設計の決め方、Node.js/TypeScriptの実装例、再テストの進め方をまとめます。

なお、この記事に出てくる実装コードは、方針を説明するための一般的な例です。案件の実コードではありません。

## 最初に見えていた問題：機能ごとに違う認証・権限の実装

案件は2022年4月から2023年2月まで続きました。体制はPM1名、エンジニア3名、運用担当1名の計5名です。私はバックエンドとセキュリティ開発を担当し、既存システムの調査、認証設計、API保護、権限管理、セキュリティテストを行いました。

課題は、機能ごとに認証・権限管理の実装がばらばらで、アクセス制御に一貫性がないことでした。その結果、不適切なデータアクセスへの対策も難しくなっていました。

この状態が危ない理由は、一般に次の3点です。

- 権限チェックが機能ごとに違うので、新機能のたびに抜けが入りやすい
- 「誰が何をできるか」を答えるには、コードを全部読むしかない
- 修正が1か所で済まないので、運用担当の確認コストが膨らむ

つまり問題は個々のバグより、判断の置き場所が散らばっていることです。ここを直さないと、穴を塞いでも別の機能に同じ穴が出ます。

## まず棚卸し：エンドポイントと権限チェックの一覧化

設計に入る前に、私ならまず現状の一覧を作ります。コードを書き換えるのはその後です。

### 一覧にする項目

エンドポイント単位で、次の列を埋めます。

- メソッドとパス
- 認証方式（セッション、独自トークン、固定キー、認証なしなど）
- 権限チェックの場所（ミドルウェア、ハンドラ内、SQLの条件、フロントのみ）
- 判断に使う情報（ロール名、ユーザーID、画面側のフラグなど）
- 扱うデータ（個人情報、他テナントのデータなど）
- 操作ログの有無

表は幅が広がるので、スプレッドシートに置くのが現実的です。

### 抜けを機械的に拾う

Expressなら、ルート定義を列挙するだけで骨格は作れます。次はルーターを走査して一覧を出す最小の例です。

```typescript:list-routes.ts
import type { Express } from "express";

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { name: string }[] };
  name?: string;
  handle?: { stack?: Layer[] };
};

export function listRoutes(app: Express): string[] {
  const out: string[] = [];
  const stack = ((app as unknown as { _router?: { stack: Layer[] } })._router?.stack) ?? [];
  const walk = (layers: Layer[], prefix = "") => {
    for (const l of layers) {
      if (l.route) {
        const methods = Object.keys(l.route.methods).join(",").toUpperCase();
        const mws = l.route.stack.map((s) => s.name).join(" > ");
        out.push(`${methods} ${prefix}${l.route.path} :: ${mws}`);
      } else if (l.handle?.stack) {
        walk(l.handle.stack, prefix);
      }
    }
  };
  walk(stack);
  return out;
}
```

ルートごとにミドルウェア名が並ぶので、認証ミドルウェアが付いていない行がすぐ分かります。サブルーターのマウントパスは取れないため、prefixは手で補う前提です。Expressの内部構造に依存するので、使い捨てのスクリプトとして扱ってください。

### 手で見るべきもの

機械で拾えるのは「ミドルウェアが付いているか」までです。ハンドラ内の `if (user.role === "admin")` や、SQLの `WHERE` に埋め込まれた条件は、grepと目視で拾います。私なら `role`、`isAdmin`、`user_id` といった語で検索し、結果を同じ一覧に足します。

## 方針の選択：OAuth 2.0・JWTのトークン管理とRBACに寄せた理由

一覧ができると、決めるべきことが絞れます。私は次の3つを先に決めます。

- 認証：誰であるかを確認する場所と方式
- 認可モデル：権限を何で表すか
- 判断の置き場所：どの層でチェックするか

### 認証はOAuth 2.0とトークンに寄せる

この案件では、認証にOAuth 2.0を採用し、トークン管理を整えました。私なら、機能ごとに違う認証を1つの発行元と1つの検証方法に集約するため、OAuth 2.0に寄せます。クライアントが増えても、検証側のコードは同じで済みます。

JWTを使う場合の注意は、次のとおりです。これは一般的な設計指針です。

- 検証時にアルゴリズムを固定する（トークンのヘッダーを信用しない）
- 発行者（iss）と受け手（aud）を必ず検証する
- アクセストークンの有効期限は短くする
- 失効が必要な操作では、短い有効期限と更新トークンの管理を組み合わせる

### 認可はRBACに寄せる

認可は、ロールベースアクセス制御（RBAC）を整えました。私なら、棚卸しで見つかったロール名の直書きなどを、ロールと権限の対応表に置き換えます。運用担当にとっても、「このロールにこの権限を付ける」という説明で済むのは大きな利点です。

ただし、RBACだけで足りないケースもあります。たとえば「自分の会社のデータだけ見られる」という条件は、ロールではなくデータの所有関係で決まります。私なら、RBACで操作の可否を決め、所有関係はクエリ条件で絞る二段構えにします。

### 判断をミドルウェアに集める

最も大事なのは、判断を1か所に集めることです。ハンドラは「この操作にはこの権限が要る」と宣言するだけにします。判断のロジックは共通のミドルウェアに持たせます。

## 実装：API認可・入力値検証・操作ログの整備

ここからは、方針を一般的なTypeScriptの例で示します。ライブラリには、JWT検証用に `jose`、入力検証に `zod` を使う想定です。

### トークン検証ミドルウェア

```typescript:auth.ts
import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL(process.env.JWKS_URL!));

export type AuthUser = { sub: string; roles: string[]; tenantId: string };

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.TOKEN_ISSUER!,
      audience: process.env.TOKEN_AUDIENCE!,
      algorithms: ["RS256"],
    });
    req.user = {
      sub: String(payload.sub),
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      tenantId: String(payload.tenant_id),
    };
    next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}
```

ポイントは3つあります。

- `algorithms` を固定し、`issuer` と `audience` も検証している
- 検証失敗の理由はクライアントに返さず、一律401にしている
- 環境変数は例であり、実際の値はコードに書かない

`roles` や `tenant_id` といったクレーム名は、発行側の設計に合わせて読み替えてください。

### ロールと権限の対応表

```typescript:permissions.ts
export const ROLE_PERMISSIONS = {
  admin: ["user:read", "user:write", "report:read", "report:write"],
  manager: ["user:read", "report:read", "report:write"],
  member: ["report:read"],
} as const;

export type Permission =
  (typeof ROLE_PERMISSIONS)[keyof typeof ROLE_PERMISSIONS][number];

export function hasPermission(roles: string[], perm: Permission): boolean {
  return roles.some((r) =>
    (ROLE_PERMISSIONS[r as keyof typeof ROLE_PERMISSIONS] as readonly string[] | undefined)?.includes(perm)
  );
}
```

対応表を1つのファイルに置くと、権限の変更はこの差分だけで確認できます。レビューもしやすくなります。未知のロールは権限なしとして扱います。許可リスト方式にしておくのが安全です。

### 認可ミドルウェアと操作ログ

```typescript:authorize.ts
import type { Request, Response, NextFunction } from "express";
import { hasPermission, type Permission } from "./permissions";
import { writeAuditLog } from "./audit";

export function requirePermission(perm: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const allowed = !!user && hasPermission(user.roles, perm);
    await writeAuditLog({
      actor: user?.sub ?? null,
      action: perm,
      method: req.method,
      path: req.path,
      allowed,
    });
    if (!allowed) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
```

```typescript:audit.ts
import { Pool } from "pg";

const pool = new Pool(); // 接続情報は環境変数から読む

export async function writeAuditLog(e: {
  actor: string | null;
  action: string;
  method: string;
  path: string;
  allowed: boolean;
}) {
  await pool.query(
    `INSERT INTO audit_log (actor, action, method, path, allowed, created_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [e.actor, e.action, e.method, e.path, e.allowed]
  );
}
```

許可と拒否の両方を記録するのがコツです。拒否の記録は、不正なアクセスの試行や設定ミスを見つける手がかりになります。ログにはトークンやパスワードなどの秘匿情報を入れないでください。

### 入力値検証とデータ所有の絞り込み

ルート側では、権限の宣言と入力検証を並べます。所有関係はSQLの条件で守ります。

```typescript:routes/reports.ts
import { Router } from "express";
import { z } from "zod";
import { Pool } from "pg";
import { authenticate } from "../auth";
import { requirePermission } from "../authorize";

const pool = new Pool();
export const router = Router();

const idParam = z.object({ id: z.string().uuid() });

router.get(
  "/reports/:id",
  authenticate,
  requirePermission("report:read"),
  async (req, res) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: "bad_request" });

    const { rows } = await pool.query(
      "SELECT id, title, body FROM reports WHERE id = $1 AND tenant_id = $2",
      [parsed.data.id, req.user!.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  }
);
```

ここで見てほしいのは次の点です。

- 他テナントのIDを指定されても、`tenant_id` の条件で0件になる
- その場合は403ではなく404を返し、存在の有無を漏らさない
- SQLはプレースホルダを使い、文字列連結をしない

「ロールがあるから見られる」と「そのデータが自分のものである」は別のチェックです。この2つを混ぜると、不適切なデータアクセスの原因になります。

## OWASPを手がかりにした脆弱性の調査と再テスト

案件では、脆弱性につながる処理を調べて修正し、再テストしました。調査の手がかりにはOWASPを使いました。ここから先は、私ならこう進めるという一般的な手順です。

### 調査の観点

OWASPの資料は、観点の抜けを防ぐチェックリストとして使えます。認証・認可まわりでは次を確認します。

- URLのIDを書き換えると、他人のデータが見えないか（IDOR）
- 一般ユーザーが管理用のAPIを直接呼べないか
- HTTPメソッドを変えると、チェックをすり抜けないか
- トークンの有効期限切れ、署名改ざん、受け手違いを拒否できているか
- 入力値に想定外の型や長さを入れても、安全に失敗するか

棚卸しの一覧と突き合わせると、観点ごとに対象のエンドポイントを割り当てられます。

### 再テストの組み立て

修正したら、同じ観点でもう一度試します。私なら、権限の対応表から自動テストを生成する形にします。

```typescript:authz.test.ts
import request from "supertest";
import { app } from "../app";
import { tokenFor } from "./helpers"; // テスト用の署名鍵でトークンを作る

const cases = [
  { role: "member", method: "get", path: "/reports/00000000-0000-4000-8000-000000000001", status: 200 },
  { role: "member", method: "delete", path: "/users/00000000-0000-4000-8000-000000000002", status: 403 },
  { role: "admin", method: "delete", path: "/users/00000000-0000-4000-8000-000000000002", status: 204 },
];

describe("authorization matrix", () => {
  test.each(cases)("$role $method $path -> $status", async (c) => {
    const token = await tokenFor(c.role);
    const res = await (request(app) as any)[c.method](c.path).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(c.status);
  });

  test("no token -> 401", async () => {
    const res = await request(app).get("/reports/00000000-0000-4000-8000-000000000001");
    expect(res.status).toBe(401);
  });
});
```

ロールごと、エンドポイントごとに期待するステータスを並べたマトリクスです。権限を変えたときに、どこが変わったかをテストの差分で確認できます。テスト用のDBやシードデータは別途用意してください。

### 手動の確認も残す

自動テストでは、「他テナントのデータが見えない」といった所有関係の抜けを拾いにくい場合があります。私なら、2つのテナントのテストユーザーで、IDを入れ替えて叩く手動確認も加えます。修正後に再度同じ手順を回し、結果を一覧に記録します。

## 結果：認証・認可の統一とアクセス管理の運用負担の軽減

この案件の結果は、認証・認可の処理を統一し、アクセス管理の運用負担を軽減できたことです。あわせて、安全に運用を続けられる基盤を整えました。数値としての削減量は、案件の記録にないので書きません。

運用面で効くのは、一般に次の点だと考えています。

- 権限の確認が、対応表と認可ミドルウェアの確認で済む
- 変更の影響範囲が、権限単位で追える
- 操作ログから、誰がいつ何をしたかを後から確認できる

## 同じ状況の人が最初にやること

最初の1週間で、私なら次の順に進めます。

- エンドポイントと権限チェックの場所を一覧にする
- 認証方式がいくつあるかを数える
- 個人情報や他テナントのデータを扱うAPIに、優先度を付ける
- ロールの種類と、実際の使われ方を洗い出す
- 認証・認可・所有関係のチェックを、それぞれどの層に置くか決める
- 現状の挙動を再現するテストを先に書いてから、置き換える

置き換えは、優先度の高いAPIから段階的に行います。全機能を一度に切り替えると、不具合の原因を切り分けにくくなります。

### 落とし穴

- フロントエンドでの表示制御だけを権限チェックと見なしてしまう
- JWTのクレームを検証せずに信用する
- ロールの対応表と、実際のSQL条件がずれる
- 拒否のログを残さず、試行に気づけない
- 一覧を作らずに実装を始め、抜けが残る

## まとめ

ばらばらな認証・認可を統一する近道は、実装の前に棚卸しをして、判断の置き場所を決めることです。この案件では、OAuth 2.0とトークン管理、RBAC、入力値検証、API認可、操作ログを整えました。さらにOWASPを手がかりに脆弱性を調べて、修正後に再テストしました。まずはエンドポイントの一覧を作るところから始めてください。

---

私は「不具合調査・コードレビュー・セキュリティ診断」をお仕事としてお受けしています。既存システムの認証・認可の棚卸しや、権限まわりの脆弱性調査と再テストは、まさにこの記事で扱った内容です。
→ [不具合調査・コードレビュー・セキュリティ診断について](https://shanaiai.com/services/quality/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
