import {
  apiError,
  isAuthenticatedUser,
} from '../../lib/auth';
import { getAlbumAccess, imageResponseHeaders } from '../../lib/albums';

interface ImageRecord {
  id: string;
  album_id: string;
  storage_key: string;
  filename: string;
  mime_type: string;
}

export const onRequest = async (context: any) => {
  const { request, env, params } = context;
  const user = context.data.user;
  if (!user || !isAuthenticatedUser(user)) return apiError('Authentication is required', 401);

  const imageId = params.key;
  if (!/^[0-9a-fA-F-]{36}$/.test(imageId)) return apiError('Not found', 404);

  const image = await env.DB.prepare(
    'SELECT id, album_id, storage_key, filename, mime_type FROM images WHERE id = ?',
  ).bind(imageId).first() as ImageRecord | null;
  if (!image) return apiError('Not found', 404);

  const access = await getAlbumAccess(env.DB, image.album_id, user);
  if (!access) return apiError('Not found', 404);

  if (request.method === 'GET') {
    const object = await env.R2_BUCKET.get(image.storage_key);
    if (!object) return apiError('Photo object was not found', 404);

    const headers = imageResponseHeaders(image.mime_type, image.filename);
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', image.mime_type);
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(object.body, { headers });
  }

  if (request.method === 'DELETE') {
    if (!access.isOwner) return apiError('Only the album owner can delete photos', 403);

    try {
      await env.R2_BUCKET.delete(image.storage_key);
    } catch {
      return apiError('The photo could not be removed from storage', 502);
    }

    const nextCover = await env.DB.prepare(
      `SELECT storage_key FROM images
       WHERE album_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(image.album_id, image.id).first() as { storage_key: string } | null;

    await env.DB.batch([
      env.DB.prepare('DELETE FROM images WHERE id = ?').bind(image.id),
      env.DB.prepare(
        `UPDATE albums
         SET cover_image_key = CASE WHEN cover_image_key = ? THEN ? ELSE cover_image_key END,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).bind(image.storage_key, nextCover?.storage_key ?? null, image.album_id),
    ]);

    return new Response(null, { status: 204 });
  }

  return apiError('Method not allowed', 405);
};
