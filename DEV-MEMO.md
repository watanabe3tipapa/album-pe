# DEV-MEMO

## サービス概要
Cloudflare Pages + Astro で構築する、特定ユーザー限定のプライベート画像（アルバム）共有サイト。
GitHub push → 自動デプロイ。

## 技術スタック
- フロントエンド: Astro (SSR) + React
- ホスティング: Cloudflare Pages
- 画像ストレージ: Cloudflare R2
- データベース: Cloudflare D1 (SQLite)
- 認証: Cloudflare Access (Zero-Trust)
- API: Cloudflare Pages Functions (TypeScript)
- CI/CD: GitHub Actions

## 実装TODO

### Phase 0: プロジェクト初期化
- [x] DEV-MEMO.md 作成
- [x] `npm create astro@latest` (basics template, pnpm)
- [x] SSR mode に設定 (`output: 'server'`, `adapter: @astrojs/cloudflare`)
- [x] `functions/` ディレクトリ作成
- [x] `wrangler.toml` で R2 / D1 バインディング設定
- [ ] Cloudflare Pages プロジェクト作成・連携（手動）
- [ ] Cloudflare R2 バケット作成（手動: `album-pe-images`）
- [ ] Cloudflare D1 DB作成（手動: `album-pe-db`）

### Phase 1: 認証 (Cloudflare Access)
- [x] Pages Functions ミドルウェア実装 (`functions/_middleware.ts`)
- [ ] Cloudflare Zero Trust ダッシュボード設定（手動）
- [ ] Access ポリシー作成（特定メールアドレス制限）（手動）

### Phase 2: DB / Storage
- [ ] `wrangler d1 create album-pe-db`（手動）
- [x] D1 スキーマ定義 (`db/schema.sql`: users, albums, images)
- [ ] D1 初期マイグレーション（手動）
- [ ] R2 バケット作成（手動: `album-pe-images`）

### Phase 3: API (Pages Functions)
- [x] `/api/albums` CRUD (`functions/api/albums.ts`)
- [x] `/api/upload` 画像アップロード (`functions/api/upload.ts`)
- [x] 認証ミドルウェア (`functions/_middleware.ts`)
- [x] 画像配信 (`functions/api/image/[key].ts`)

### Phase 4: フロントエンド
- [x] ホーム/アルバム一覧 (`src/pages/index.astro`)
- [x] アルバム詳細/画像グリッド/アップロードUI (`src/pages/album/[id].astro`)
- [ ] Lightbox 拡大表示
- [ ] スタイル調整・UX改善

### Phase 5: CI/CD
- [x] `.github/workflows/deploy.yml`
- [ ] D1 マイグレーション自動化
- [ ] Secrets 設定（手動）

### Phase 6: セキュリティ・運用
- [ ] R2 プライベート設定（手動）
- [x] アップロードバリデーション (MIME, サイズ制限)
- [ ] CORS / CSRF 対策
