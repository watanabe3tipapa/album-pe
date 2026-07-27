/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

declare namespace App {
  interface Locals {
    runtime: {
      env: {
        DB: D1Database;
        R2_BUCKET: R2Bucket;
      };
    };
  }
}
