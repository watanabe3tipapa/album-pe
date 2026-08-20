/// <reference types="astro/client" />

// Cloudflare PagesではDB/R2バインディングが実行時に注入される。
// アプリ側のFunctionsでは境界で検証するため、Astroの画面層では未知の値として扱う。
declare namespace App {
  interface Locals {
    runtime: {
      env: {
        DB: unknown;
        R2_BUCKET: unknown;
      };
    };
  }
}
