import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const key = params.key as string;

  const object = await env.R2_BUCKET.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
};
