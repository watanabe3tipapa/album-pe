PLAN.md

ユーザープロンプト1/3 - 2026/7/27 17:09:23:
Cloudflare pagesを利用して画像（アルバム）共有サイトを作りたい。できるなら技術スタックはAstroがいい。そしてGItHubにPushして内容が反映されるというものにしたい。
また特定者のみが利用できるように認証機能も設けたい。このサービスをプランニングしてください。

gpt-oss 120B:
**サービス概要**  
- **目的**：Cloudflare Pages でホストし、GitHub へ push すると自動デプロイされる、画像（アルバム）共有サイト。  
- **対象**：招待された特定ユーザーだけが閲覧・アップロードできるプライベートなギャラリー。  
- **主な要件**  
  1. フロントエンドは **Astro**（静的サイトジェネレータ）＋ React/Vue/Preact コンポーネントで構築。  
  2. ビルド・デプロイは **GitHub Actions** → **Cloudflare Pages** の CI/CD。  
  3. 画像ストレージは **Cloudflare R2**（S3 互換、低コスト）。  
  4. 認証は **Cloudflare Access**（Zero‑Trust）または外部 IdP（Google、GitHub）＋ JWT。  
  5. メタデータ（アルバム情報、ユーザー権限）は **Cloudflare D1**（SQLite）か **Supabase**（PostgreSQL）。  

---

## 1. アーキテクチャ図（テキスト）

```
GitHub repo
   │  (push)
   ▼
GitHub Actions
   │  (ビルド: astro build)
   ▼
Cloudflare Pages (static assets)
   │
   ├─ /dist/*.html, CSS, JS
   └─ /dist/assets/ → Cloudflare R2 (画像)
   
Cloudflare Access (or Auth Provider)
   │
   ▼
Edge Function (Pages Functions) → JWT verification
   │
   ▼
API Layer (Pages Functions)
   ├─ /api/upload   → R2 に画像保存
   └─ /api/albums   → D1 / Supabase にメタデータ保存
```

---

## 2. 技術スタック詳細

| 項目 | 技術 | 役割 |
|------|------|------|
| **フロントエンド** | Astro (SSR/SSG) + React (or Preact) | ページ生成、インタラクティブ UI（ドラッグ＆ドロップ、モーダル） |
| **ビルド/デプロイ** | GitHub Actions + Cloudflare Pages | push → 自動ビルド → グローバル CDN デプロイ |
| **画像保存** | Cloudflare R2 (S3 API) | オリジンに近い低遅延ストレージ、パブリック/プライベートバケット |
| **データベース** | Cloudflare D1 (SQLite) **or** Supabase (PostgreSQL) | アルバム・画像メタデータ、ユーザー権限 |
| **認証** | Cloudflare Access（Zero‑Trust） **or** OAuth2 (GitHub/Google) + JWT | 特定者だけのアクセス制御、トークン検証は Edge Function で行う |
| **バックエンド (API)** | Cloudflare Pages Functions (JavaScript/TypeScript) | `/api/*` エンドポイント、R2/D1 連携、認証ミドルウェア |
| **CI/CD** | GitHub Actions workflow (`node`, `npm run build`) | ビルドキャッシュ、プルリクエスト・マージ時にデプロイ |
| **開発ツール** | pnpm / npm, ESLint, Prettier, TypeScript | パッケージ管理とコード品質 |

---

## 3. ディレクトリ構成例

```
/ (repo root)
├─ .github/
│   └─ workflows/
│       └─ deploy.yml          # GitHub Actions
├─ public/                     # 静的ファイル (favicon, robots.txt)
├─ src/
│   ├─ components/             # React/Preact UI コンポーネント
│   ├─ pages/
│   │   ├─ index.astro         # ホーム／アルバム一覧
│   │   └─ album/[id].astro    # アルバム詳細
│   ├─ layouts/                # 共通レイアウト
│   └─ lib/
│       └─ api.ts              # fetch wrapper (auth header)
├─ functions/                  # Cloudflare Pages Functions
│   ├─ upload.ts               # 画像アップロード
│   └─ albums.ts               # メタデータ CRUD
├─ astro.config.mjs
├─ package.json
└─ tsconfig.json
```

---

## 4. CI/CD フロー（GitHub Actions）

```yaml
name: Deploy to Cloudflare Pages
on:
  push:
    branches: [ main ]          # main に push すればデプロイ
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - name: Install deps
        run: pnpm install
      - name: Build
        run: pnpm run build   # astro build → ./dist
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v2
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          projectName: your-project-name
          directory: ./dist
```

- `CF_API_TOKEN`・`CF_ACCOUNT_ID` を GitHub Secrets に保存。  
- ビルド中に環境変数 `VITE_R2_BUCKET` 等を注入して、R2 エンドポイントをフロント側で使用可能に。

---

## 5. 認証設計

### 5‑1. Cloudflare Access（推奨）

1. **Identity Provider** に GitHub、Google、Azure AD などを紐付け。  
2. **Access Policy** を「メールアドレスが whitelist にあるユーザー」だけに限定。  
3. アクセス時、CF‑Access‑Token が発行され、Edge Function で `request.headers.get('CF-Access-Token')` を検証。  
4. トークンが有効なら API にリクエストを通す。

*メリット*：Zero‑Trust、セットアップだけで SSO が完了。R2/D1 への直接アクセスを制限できる。

### 5‑2. カスタム OAuth + JWT（代替）

1. `/login` ページで GitHub OAuth フロー開始。  
2. コールバックで取得した GitHub アカウント情報を内部データベースに照合し、**ホワイトリスト** に入っていれば JWT を発行。  
3. JWT は HTTP‑Only Cookie または `Authorization: Bearer <token>` として送信。  
4. Pages Functions のミドルウェアで `jwt.verify` → ユーザー ID 取得 → 権限チェック。

---

## 6. 画像アップロード API（Pages Function）

```ts
// functions/upload.ts
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import { R2Bucket } from '@cloudflare/workers-types';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  // 1. 認証チェック (Access Token or JWT)
  const auth = request.headers.get('Authorization') ?? request.headers.get('CF-Access-Token');
  if (!auth || !(await verifyAuth(auth))) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. multipart/form-data から画像取得
  const form = await request.formData();
  const file = form.get('file') as File;
  if (!file?.type.startsWith('image/')) {
    return new Response('Invalid file', { status: 400 });
  }

  // 3. R2 に保存 (bucket name は env.R2_BUCKET)
  const objectKey = `${crypto.randomUUID()}_${file.name}`;
  await env.R2_BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploadedBy: authUserId },
  });

  // 4. メタデータを D1 / Supabase に記録
  await saveImageMeta({ id: objectKey, albumId: form.get('albumId'), ... });

  return new Response(JSON.stringify({ key: objectKey }), { status: 201 });
};

async function verifyAuth(token: string): Promise<boolean> {
  // Cloudflare Access の場合は token introspection エンドポイントへリクエスト
  // JWT の場合は jose.verify(token, PUBLIC_KEY) で検証
  return true; // 実装は省略
}
```

- **サイズ制限**は `MAX_UPLOAD_SIZE=10MB` など環境変数で管理。  
- **CORS**は `Access-Control-Allow-Origin: *`（またはホワイトリスト）で設定。

---

## 7. アルバム管理 API（例）

| エンドポイント | メソッド | 認可 | 主な処理 |
|----------------|----------|------|----------|
| `/api/albums` | GET | 認証必須 | ユーザーが所有するアルバム一覧 |
| `/api/albums` | POST | 認証必須 | 新規アルバム作成（名称、説明） |
| `/api/albums/:id` | GET | 認証＋権限 | アルバム詳細、画像メタデータ取得 |
| `/api/albums/:id` | DELETE | 認証＋オーナー | アルバムと紐付く画像を R2 から削除 |

※実装は Pages Functions の `onRequest` ハンドラで、D1 の SQL (`SELECT * FROM albums WHERE owner = ?`) か Supabase のクエリを使用。

---

## 8. フロントエンド UI フロー

1. **ログインページ**  
   - Cloudflare Access → 自動リダイレクト、または「GitHub でサインイン」ボタン（OAuth）。  
2. **ホーム**（`/`）  
   - ユーザーのアルバムカード一覧。  
   - 「アルバム作成」ボタン → モーダルでタイトル入力。  
3. **アルバム詳細**（`/album/[id]`）  
   - グリッド表示で画像サムネイル。  
   - 「画像アップロード」ドラッグ＆ドロップエリア → `fetch('/api/upload', { method:'POST', body: formData })`。  
   - 画像クリックで拡大ビュー（Lightbox）。  
4. **設定**  
   - アカウント情報、招待リンク生成（管理者のみ）。  

---

## 9. セキュリティ・運用ポイント

| 項目 | 推奨対策 |
|------|----------|
| **認証トークン** | HTTP‑Only、Secure Cookie を使用。JWT は短い有効期限（10 min）＋リフレッシュトークン。 |
| **画像アクセス** | R2 バケットは **プライベート** に設定し、Cloudflare Workers の署名URLで限定配信。 |
| **CSRF** | POST API では `SameSite=Strict` Cookie と `X-CSRF-Token` ヘッダーを検証。 |
| **入力検証** | アップロード時は MIME と拡張子を両方チェック、サイズ上限を設ける。 |
| **バックアップ** | R2 のオブジェクトは自動バージョニング（有効化）＋週次 D1 スナップショット。 |
| **モニタリング** | Cloudflare Analytics の「Requests」/「Errors」→アラート設定（例: 5xx が 5 分間に 10 件超）。 |
| **スケーラビリティ** | 静的資産は CDN 配信、R2 はエッジロケーションに自動配置。負荷が増えても Workers の自動スケールで対応可。 |

---

## 10. 実装スケジュール（例）

| フェーズ | 期間 | 主なマイルストーン |
|----------|------|-------------------|
| **0‑1 週間** | プロジェクトセットアップ | GitHub リポジトリ作成、Cloudflare Pages & R2 バケット作成、Access ポリシー設定 |
| **1‑2 週間** | フロント・バックエンド基盤 | Astro プロジェクト構築、Pages Functions の雛形、CI/CD ワークフロー実装 |
| **2‑4 週間** | 認証実装 | Cloudflare Access SSO 設定、または OAuth+JWT 実装・テスト |
| **4‑6 週間** | アルバム・画像 API | R2 アップロード、D1 メタデータ保存、権限チェック |
| **6‑8 週間** | UI 完成 | アルバム一覧、画像ギャラリー、アップロード UI、エラーハンドリング |
| **8‑9 週間** | テスト・セキュリティ | ペネトレーションテスト、CORS/CSRF 確認、バックアップ検証 |
| **9‑10 週間** | デプロイ・ドキュメント | 本番環境デプロイ、README/運用手順書作成、招待リンク配布 |

---

**まとめ**  
- **Astro** が静的ページ生成とインタラクティブ UI をシームレスに提供し、**Cloudflare Pages** がグローバル CDN + Edge Functions でサーバーレス API を実装します。  
- **R2** と **D1**（または Supabase）で画像とメタデータを永続化し、**Cloudflare Access** で Zero‑Trust 認証を実現すれば、特定者のみが安全に利用できるプライベートギャラリーが完成します。  
- GitHub に push すれば自動デプロイが走るため、開発フローはシンプルかつ高速です。

--------------------

ユーザープロンプト2/3 - 2026/7/27 17:10:07:
無料枠で使えますか？

gpt-oss 120B:
はい、上記の構成は Cloudflare の無料プランでもすべて利用できます。

| コンポーネント | 無料枠の内容 | 注記 |
|----------------|-------------|------|
| **Cloudflare Pages** | ビルドの月間 500 ビルド分、静的サイトは無制限の帯域 | Astro のビルドは数分で完了するため問題ありません |
| **Cloudflare R2** | ストレージ 10 GB、アウトバウンド転送 1 TB/月 | 画像アルバムが数百枚程度（数百 MB）であれば十分です |
| **Cloudflare D1** | データベース 1 GB、クエリは月間 250 k 回まで | アルバムや画像メタデータは数 MB に収まります |
| **Cloudflare Access** | 基本的な Zero‑Trust 認証は無料プランに含まれ、ユーザー数に制限はありません | 招待した特定ユーザーのみがアクセス可能です |
| **GitHub Actions** | 毎月 2 000 分の無料実行時間 | ビルドは数分なので、数回のデプロイで余裕があります |

※利用量が上記上限を超えると従量課金に切り替わりますが、個人や小規模チームが「数十〜数百枚」の画像を共有する程度であれば、無料枠の範囲内で継続的に運用できます。

--------------------

ユーザープロンプト3/3 - 2026/7/27 17:10:27:
OK

gpt-oss 120B:
Glad to hear it! If you need any more details while setting it up, just let me know.
