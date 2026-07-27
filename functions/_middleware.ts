import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  // Cloudflare Access が処理する画面遷移系はスキップ（index, album など）
  // API エンドポイントのみトークン検証
  if (url.pathname.startsWith('/api/')) {
    const accessToken = request.headers.get('CF-Access-Token');
    if (!accessToken) {
      return new Response('Unauthorized', { status: 401 });
    }

    const jwt = accessToken;
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      return new Response('Invalid token', { status: 401 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(atob(parts[1]));
    } catch {
      return new Response('Invalid token', { status: 401 });
    }

    const email = payload.email as string | undefined;
    if (!email) {
      return new Response('Invalid token', { status: 401 });
    }

    context.data.user = { email, name: payload.name as string ?? email };
  }

  return context.next();
};
