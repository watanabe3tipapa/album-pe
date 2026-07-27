import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // GET /api/albums — 全アルバム一覧
  if (method === 'GET' && url.pathname === '/api/albums') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM albums ORDER BY created_at DESC'
    ).all();
    return Response.json(results);
  }

  // POST /api/albums — 新規アルバム作成
  if (method === 'POST' && url.pathname === '/api/albums') {
    const body: { title: string; description?: string } = await request.json();
    if (!body.title) {
      return new Response('Missing title', { status: 400 });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO albums (id, title, description, owner_id) VALUES (?, ?, ?, ?)'
    ).bind(id, body.title, body.description ?? '', context.data.user?.email ?? '').run();

    const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    return Response.json(album, { status: 201 });
  }

  // GET /api/albums/:id — アルバム詳細
  const match = url.pathname.match(/^\/api\/albums\/(.+)$/);
  if (method === 'GET' && match) {
    const albumId = match[1];
    const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(albumId).first();
    if (!album) {
      return new Response('Not found', { status: 404 });
    }

    const { results: images } = await env.DB.prepare(
      'SELECT * FROM images WHERE album_id = ? ORDER BY created_at DESC'
    ).bind(albumId).all();

    return Response.json({ ...album, images });
  }

  // DELETE /api/albums/:id — アルバム削除
  if (method === 'DELETE' && match) {
    const albumId = match[1];
    const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(albumId).first();
    if (!album) {
      return new Response('Not found', { status: 404 });
    }

    // TODO: R2 の画像も削除
    await env.DB.prepare('DELETE FROM images WHERE album_id = ?').bind(albumId).run();
    await env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(albumId).run();

    return new Response(null, { status: 204 });
  }

  return new Response('Not found', { status: 404 });
};
