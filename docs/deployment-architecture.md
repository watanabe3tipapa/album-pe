# 公開構成: GitHub Pages と Cloudflare

## 役割分担

| 公開先 | 役割 | 公開範囲 | 共有アルバム機能 |
| --- | --- | --- | --- |
| GitHub Pages | LPの公開、使い方の解説、Cloudflareアプリへの導線 | 誰でも閲覧できる静的HTML・CSS・画像 | 実行しない。CTAはCloudflareのアプリURLへ遷移する。 |
| Cloudflare Pages | 共有アルバムの本番アプリ | Cloudflare Accessで認証された利用者 | D1、R2、Pages Functions、Cloudflare Accessを使用して実行する。 |

## URL設計

GitHub PagesのLPは `https://watanabe3tipapa.github.io/album-pe/` で提供する。プロジェクトページではリポジトリ名がベースパスになるため、静的ビルド時には `/album-pe` をAstroの `base` に設定する。

Cloudflare Pagesは `https://<project>.pages.dev/` または独自ドメインで共有アルバムを提供する。GitHub PagesのCTAはビルド変数 `PUBLIC_ALBUM_APP_URL` が設定されている場合にこのURLを使う。未設定の場合、LPはCloudflareアプリの準備中であることを案内する。

## 認証とデータの境界

GitHub Pagesには、写真・アルバムメタデータ・Cloudflareの環境変数・アクセストークンを配置しない。Cloudflare側では `/albums*` と `/api/*` をCloudflare Accessで保護し、Pages FunctionsがJWTとアルバム権限を検証してからD1およびR2にアクセスする。

> GitHub PagesはLPの配布先、Cloudflare Pagesは認証・保存・共有を扱うアプリの実行先である。この分離により、LPを公開したまま共有写真を非公開に保つ。
