# Album PE

**Album PE** は、共有アルバム用のランディングページ（LP）の作り方を解説しつつ、実際に写真を集めて共有できる Astro + Cloudflare Pages アプリケーションです。LPは公開されますが、アルバム・画像・APIは Cloudflare Access による認証が必要な利用者に限定されます。

> 写真を集める場所を、やさしく設計する。Album PE では、アルバムの作成、参加者の招待、写真の追加までを一連の体験として提供します。

## 概要

- フロントエンドは Astro（package.json によると Node.js >= 22 が前提）で実装されています。
- バックエンド的な機能（データベース、画像ストレージ、認証）は Cloudflare の D1、R2、Cloudflare Access、Pages Functions（Wrangler 経由）を用いる設計です。
- 本リポジトリには Pages 用のビルド出力（dist）と Functions（functions/）を組み合わせてデプロイする運用を想定した設定と手順が含まれます。

## できること

| 区分 | 内容 |
| --- | --- |
| LP | 共有アルバムLPの考え方を、目的・主導線・安心設計・利用後の体験という4ステップで解説します。 |
| アルバム | 認証済み利用者がタイトル・説明付きのアルバムを作成できます。 |
| 共有 | 作成者は参加者のメールアドレスを追加し、参加者ごとに「閲覧のみ」または「閲覧・写真追加」を設定できます。 |
| 写真 | JPEG、PNG、WebP、AVIF、GIF を複数追加できます（1枚あたりの上限は 10 MB）。 |
| 保護 | 画像は R2 の非公開バケットに保存され、表示のたびにアルバム権限を確認します。URL を知っているだけでは閲覧できません。 |
| 管理 | 作成者は参加者・写真・アルバムを削除できます。アルバム削除時は R2 の画像も削除されます。 |

## 画面構成

| URL | 用途 | 必要な認証 |
| --- | --- | --- |
| `/` | 共有アルバムLPの解説と開始導線 | 不要 |
| `/albums` | 自分が所有または参加しているアルバムの一覧・作成 | 必要 |
| `/albums/:id` | 写真の閲覧、アップロード、参加者管理、編集・削除 | 必要 |
| `/album/:id` | 旧 URL。`/albums/:id` へ恒久リダイレクト | 遷移先で認証が必要 |

## 前提（ローカルでの確認に必要な環境）

- Node.js 22 以上（package.json の engines 指定による）
- pnpm

## ローカルでの確認（手順）

リポジトリに含まれるスクリプトに従って実行します。

```bash
pnpm install
pnpm check
pnpm build
pnpm dev
```

- `pnpm dev` では LP をローカルで確認できます。
- D1・R2・Cloudflare Access を伴う共有アルバムの実動作は、Cloudflare バインディングを適切に設定したうえで `pnpm dlx wrangler pages dev dist` またはデプロイ環境で確認してください。Pages Functions のローカル実行では Wrangler 設定のバインディングが利用されます。[1]

## Cloudflare 初期設定（概要）

リポジトリ内の説明に従い、Cloudflare 上で以下のリソースを用意・設定します。詳細な手順と注意点はこのリポジトリ内の記述を参照してください。

1. D1 と R2 の作成
   - D1 データベースと R2 バケットを作成します。D1 作成時に出力される UUID を wrangler.toml の database_id に設定してください。
   - R2 バケットはデフォルトで公開されないため、Public Development URL は有効化しないことが明記されています。

   例（手順に示されているコマンド）:

   ```bash
   pnpm dlx wrangler login
   pnpm dlx wrangler d1 create album-pe-db
   pnpm dlx wrangler r2 bucket create album-pe-images
   ```

   wrangler.toml の例（リポジトリ内の記述）:

   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "album-pe-db"
   database_id = "ここにD1のUUIDを設定"
   migrations_dir = "db/migrations"

   [[r2_buckets]]
   binding = "R2_BUCKET"
   bucket_name = "album-pe-images"
   ```

2. データベースの初期化
   - D1 の移行ファイルを適用します。移行は適用済みファイルを記録し、未適用分のみを実行します。

   例:

   ```bash
   pnpm dlx wrangler d1 migrations apply DB --remote
   ```

   - `0001_shared_album_access.sql` などの移行ファイルは既存データの補正処理を行うケースが記述されています。

3. Cloudflare Access の設定
   - Cloudflare Access の JWT は `Cf-Access-Jwt-Assertion` ヘッダーで渡され、署名・Issuer・Audience を検証する設計です。
   - Zero Trust 上で、Pages のドメイン（または独自ドメイン）に対して次の 2 つの Self-hosted アプリケーションを作成することが案内されています。

     | Accessアプリケーション | 対象パス | 用途 |
     | --- | --- | --- |
     | Album app | `https://<site>/albums*` | アルバム画面を保護 |
     | Album API | `https://<site>/api/*` | ブラウザからの API・画像取得を保護 |

   - Pages プロジェクトの Settings → Variables and Secrets に `ACCESS_TEAM_DOMAIN`、`ACCESS_AUDS` などの変数を Production と Preview 両方で設定する手順が記載されています。

4. Pages プロジェクトと GitHub Actions の設定
   - Cloudflare Pages プロジェクト名（デフォルトでは `album-pe` を想定）と、必要に応じて GitHub Actions 用の Secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）を設定することが案内されています。
   - `main` ブランチへの push により静的検査・ビルドの後、Wrangler を通じて `dist` と `functions` を一緒にデプロイするフローが示されています。

## セキュリティ設計（要点）

| 項目 | 実装（リポジトリ内説明より） |
| --- | --- |
| 認証 | Cloudflare Access JWT の署名・Issuer・Audience を JWKS で検証します。 |
| CSRF 軽減 | 変更系 API は同一 Origin ヘッダーを要求します。 |
| 認可 | 所有者またはアルバム参加者のみが詳細・画像へアクセスできます。写真追加は所有者または `contributor` に制限。 |
| 画像配信 | R2 を公開せず、画像 ID からアルバム権限を検証してストリーミングします。 |
| 入力検証 | アルバム名・説明・招待メールを制限し、アップロード時はファイルサイズと画像シグネチャを確認します。 |
| ブラウザ対策 | CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` を返します。 |

注: R2 を Worker/Pages Function 経由で操作する場合、各操作に対する認可ロジックをアプリケーション側で定義する必要があることがリポジトリ内に明記されています。

## 開発コマンド

package.json に定義された主要なスクリプト（抜粋）:

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | LP のローカル確認を開始します。 |
| `pnpm check` | Astro のテンプレート・TypeScript 診断を実行します。 |
| `pnpm build` | Cloudflare Pages 向けの本番ビルドを作成します。 |
| `pnpm dlx wrangler pages dev dist` | D1/R2 バインディングを伴う Pages Functions をローカルで確認します。 |

## 画像素材

LP のヒーロー写真は Pexels の素材を使用しています（README 内に出典が明記されています）。

## 開発・保守状態

- このリポジトリはアーカイブされていません（最終更新: 2026-08-21）。

## 関連資料・参照

- Cloudflare Pages Functions bindings: https://developers.cloudflare.com/pages/functions/bindings/ [1]
- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/ [2]
- Cloudflare R2: Create new buckets: https://developers.cloudflare.com/r2/buckets/create-buckets/ [3]
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/ [4]
- Cloudflare Access: Validate JWTs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ [5]
- Cloudflare Pages: Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/ [6]
- Cloudflare Pages: Use Direct Upload with continuous integration: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/ [7]
- Cloudflare R2: Use R2 from Workers: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/ [8]

ホームページ: https://watanabe3tipapa.github.io/album-pe/
