# Album PE

**Album PE** は、共有アルバム用のLPの作り方を解説しながら、実際に写真を集めて共有できる Astro + Cloudflare Pages アプリケーションです。公開されるのはLPだけで、アルバム・画像・APIは Cloudflare Access で認証された利用者に限定します。

> 写真を集める場所を、やさしく設計する。Album PEでは、アルバムを作成し、参加者を招待し、写真を追加するまでを一つの体験として提供します。

## できること

| 区分 | 内容 |
| --- | --- |
| LP | 共有アルバムLPの考え方を、目的・主導線・安心設計・利用後の体験という4ステップで解説します。 |
| アルバム | 認証済み利用者がタイトル・説明付きのアルバムを作成できます。 |
| 共有 | 作成者はメールアドレスを追加し、参加者ごとに「閲覧のみ」または「閲覧・写真追加」を設定できます。 |
| 写真 | JPEG、PNG、WebP、AVIF、GIFを複数追加できます。1枚あたりの上限は10 MBです。 |
| 保護 | 画像はR2の非公開バケットに保存され、表示のたびにアルバム権限を確認します。URLを知っているだけでは閲覧できません。 |
| 管理 | 作成者は参加者・写真・アルバムを削除できます。アルバム削除時はR2の画像も削除します。 |

## 画面構成

| URL | 用途 | 必要な認証 |
| --- | --- | --- |
| `/` | 共有アルバムLPの解説と開始導線 | 不要 |
| `/albums` | 自分が所有または参加しているアルバムの一覧・作成 | 必要 |
| `/albums/:id` | 写真の閲覧、アップロード、参加者管理、編集・削除 | 必要 |
| `/album/:id` | 旧URL。`/albums/:id` へ恒久リダイレクト | 遷移先で必要 |

## ローカルでの確認

Node.js 22 以上と pnpm を前提としています。

```bash
pnpm install
pnpm check
pnpm build
pnpm dev
```

`pnpm dev` ではLPを確認できます。D1・R2・Cloudflare Access を伴う共有アルバムの実動作は、次節の設定後に `wrangler pages dev dist` またはデプロイ環境で確認してください。Pages Functions のローカル実行では Wrangler 設定のバインディングが利用されます。[1]

## Cloudflare 初期設定

### 1. D1 と R2 を作成する

D1データベースとR2バケットを作成します。D1の作成コマンドは、設定に貼り付けるUUIDを出力します。[2] R2バケットはデフォルトで公開されないため、**Public Development URL は有効化しないでください**。[3]

```bash
pnpm dlx wrangler login
pnpm dlx wrangler d1 create album-pe-db
pnpm dlx wrangler r2 bucket create album-pe-images
```

作成後、`wrangler.toml` の `database_id` にD1作成結果のUUIDを設定します。リポジトリに含まれるゼロUUIDはローカル準備用のプレースホルダーであり、本番には使用できません。

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

### 2. データベースを初期化する

初回・既存環境のどちらでも、バージョン管理された移行ファイルを適用します。D1の移行は適用済みのファイルを記録し、未適用分のみを実行します。[4]

```bash
pnpm dlx wrangler d1 migrations apply DB --remote
```

既に旧版を運用している場合は、事前にD1をエクスポートしてから実行してください。`0001_shared_album_access.sql` は旧実装でメールアドレスとして保存された所有者・投稿者IDを、対応するユーザーIDへ補正します。

### 3. Cloudflare Access を設定する

Cloudflare Access のJWTは `Cf-Access-Jwt-Assertion` ヘッダーで渡されます。アプリケーションは署名、Issuer、Audienceを検証するため、デコードしたペイロードだけを信頼することはありません。[5]

Cloudflare Zero Trust で、同じ許可ポリシーを持つ次の2つの Self-hosted アプリケーションを作成してください。`<site>` はPagesのドメインまたは独自ドメインに置き換えます。

| Accessアプリケーション | 対象パス | 用途 |
| --- | --- | --- |
| Album app | `https://<site>/albums*` | アルバム画面を保護します。 |
| Album API | `https://<site>/api/*` | ブラウザからのAPI・画像取得を保護します。 |

両アプリケーションで、利用を許可するメールアドレス、メールドメイン、またはIdPグループを設定してください。次に、Pagesプロジェクトの **Settings → Variables and Secrets** で以下の値をProductionとPreviewの両方に設定します。

| 変数 | 値 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `https://<your-team>.cloudflareaccess.com` |
| `ACCESS_AUDS` | `Album app` と `Album API` の Audience (AUD) Tag をカンマ区切りで連結した値 |

Audience Tag はZero Trustの各アプリケーション設定から取得します。JWT検証では、AccessのチームドメインとAudienceを必ず指定することが推奨されています。[5]

> Accessの許可ポリシーは「サイトにログインできる人」を決め、アルバムの参加者管理は「ログイン済みの人のうち、どのアルバムに入れるか」を決めます。参加者を追加する際は、両方に同じメールアドレスを設定してください。

### 4. Pages プロジェクトと GitHub Actions を設定する

Cloudflare Pagesプロジェクトを `album-pe` という名前で作成してください。異なる名前を使う場合はGitHubリポジトリの **Settings → Secrets and variables → Actions → Variables** に `CLOUDFLARE_PAGES_PROJECT_NAME` を設定します。

GitHub Actionsを利用する場合は、以下のRepository secretsを追加します。

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Account レベルの **Cloudflare Pages: Edit** 権限を持つAPIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

`main` へのpush時に、ワークフローは静的検査・ビルドを通した後、Wranglerから `dist` と `functions` を一緒にデプロイします。Wranglerでリポジトリ直下からPagesをデプロイすると、`functions/` ディレクトリも検出・アップロードされます。[6] GitHub ActionsでのDirect Uploadには、Account IDとAPI TokenをSecretsに登録します。[7]

## セキュリティ設計

| 項目 | 実装 |
| --- | --- |
| 認証 | Cloudflare Access JWTの署名・Issuer・AudienceをJWKSで検証します。 |
| CSRF軽減 | 変更系APIは同一Originヘッダーを要求します。 |
| 認可 | 所有者またはアルバム参加者だけが詳細・画像へアクセスできます。写真追加は所有者または `contributor` に限ります。 |
| 画像配信 | R2を公開せず、画像IDからアルバム権限を検証してストリーミングします。 |
| 入力 | アルバム名・説明・招待メールを制限し、アップロード時はファイルサイズと画像シグネチャを確認します。 |
| ブラウザ | CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` を返します。 |

R2をWorker/Pages Function経由で操作する場合、アプリケーション側で各操作の認可ロジックを定義する必要があります。本リポジトリではその検証を画像取得・追加・削除のすべてで行います。[8]

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | LPのローカル確認を開始します。 |
| `pnpm check` | Astroのテンプレート・TypeScript診断を実行します。 |
| `pnpm build` | Cloudflare Pages向けの本番ビルドを作成します。 |
| `pnpm dlx wrangler pages dev dist` | D1/R2バインディングを伴うPages Functionsをローカルで確認します。 |

## 画像素材

LPのヒーロー写真は [Pexels](https://www.pexels.com/) の素材を使用しています。

## References

[1]: https://developers.cloudflare.com/pages/functions/bindings/ "Cloudflare Pages Functions bindings"
[2]: https://developers.cloudflare.com/d1/wrangler-commands/ "Cloudflare D1 Wrangler commands"
[3]: https://developers.cloudflare.com/r2/buckets/create-buckets/ "Cloudflare R2: Create new buckets"
[4]: https://developers.cloudflare.com/d1/reference/migrations/ "Cloudflare D1 migrations"
[5]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ "Cloudflare Access: Validate JWTs"
[6]: https://developers.cloudflare.com/pages/get-started/direct-upload/ "Cloudflare Pages: Direct Upload"
[7]: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/ "Cloudflare Pages: Use Direct Upload with continuous integration"
[8]: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/ "Cloudflare R2: Use R2 from Workers"
