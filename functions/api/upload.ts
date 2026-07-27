import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
}

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const user = context.data.user;

  // 1. 認証チェック
  if (!user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. multipart/form-data 解析
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return new Response('Content-Type must be multipart/form-data', { status: 400 });
  }

  const form = await request.formData();
  const file = form.get('file') as File | null;
  const albumId = form.get('albumId') as string | null;

  if (!file || !albumId) {
    return new Response('Missing file or albumId', { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return new Response(`Unsupported file type: ${file.type}`, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return new Response('File too large (max 10MB)', { status: 400 });
  }

  // 3. アルバムの存在確認
  const album = await env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(albumId).first();
  if (!album) {
    return new Response('Album not found', { status: 404 });
  }

  // 4. R2 に保存
  const storageKey = `${crypto.randomUUID()}_${file.name}`;
  const arrayBuffer = await file.arrayBuffer();
  await env.R2_BUCKET.put(storageKey, arrayBuffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      uploadedBy: user.email,
      albumId,
      filename: file.name,
    },
  });

  // 5. メタデータを D1 に記録
  const imageId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO images (id, album_id, storage_key, filename, mime_type, file_size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    imageId,
    albumId,
    storageKey,
    file.name,
    file.type,
    file.size,
    user.email,
  ).run();

  return Response.json({
    id: imageId,
    storageKey,
    filename: file.name,
    mimeType: file.type,
    fileSize: file.size,
  }, { status: 201 });
};
