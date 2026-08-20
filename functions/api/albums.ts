import {
  apiError,
  isAuthenticatedUser,
} from '../lib/auth';
import {
  canContribute,
  getAlbumAccess,
  normalizeEmail,
  textField,
} from '../lib/albums';

const ALBUM_ID_PATTERN = '[0-9a-fA-F-]{36}';

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return apiError('Content-Type must be application/json', 415);
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return apiError('Request body must be an object', 400);
    }
    return body as Record<string, unknown>;
  } catch {
    return apiError('Request body must be valid JSON', 400);
  }
}

function isResponse(value: Record<string, unknown> | Response): value is Response {
  return value instanceof Response;
}

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const user = context.data.user;
  if (!user || !isAuthenticatedUser(user)) {
    return apiError('Authentication is required', 401);
  }

  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/albums') {
    const { results } = await env.DB.prepare(
      `SELECT
         a.id, a.title, a.description, a.cover_image_key, a.owner_id, a.created_at, a.updated_at,
         CASE WHEN a.owner_id = ? THEN 1 ELSE 0 END AS is_owner,
         COALESCE(am.permission, 'owner') AS permission,
         (SELECT COUNT(*) FROM images i WHERE i.album_id = a.id) AS image_count,
         (SELECT id FROM images i WHERE i.storage_key = a.cover_image_key LIMIT 1) AS cover_image_id
       FROM albums a
       LEFT JOIN album_members am ON am.album_id = a.id AND am.member_email = ?
       WHERE a.owner_id = ? OR am.member_email = ?
       ORDER BY a.updated_at DESC`,
    ).bind(user.id, user.email, user.id, user.email).all();

    return Response.json({ albums: results });
  }

  if (method === 'POST' && pathname === '/api/albums') {
    const body = await readJson(request);
    if (isResponse(body)) return body;

    const title = textField(body.title, 120, true);
    const description = textField(body.description, 1000);
    if (!title || description === null) {
      return apiError('Title is required (max 120 characters) and description must be at most 1000 characters', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO albums (id, title, description, owner_id) VALUES (?, ?, ?, ?)',
    ).bind(id, title, description, user.id).run();

    const album = await env.DB.prepare(
      `SELECT id, title, description, cover_image_key, owner_id, created_at, updated_at
       FROM albums WHERE id = ?`,
    ).bind(id).first();

    return Response.json({ album, isOwner: true, permission: 'owner' }, { status: 201 });
  }

  const memberPath = new RegExp(`^/api/albums/(${ALBUM_ID_PATTERN})/members$`).exec(pathname);
  if (memberPath) {
    const albumId = memberPath[1];
    const access = await getAlbumAccess(env.DB, albumId, user);
    if (!access) return apiError('Album not found', 404);
    if (!access.isOwner) return apiError('Only the album owner can manage participants', 403);

    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT member_email, permission, created_at
         FROM album_members WHERE album_id = ? ORDER BY created_at ASC`,
      ).bind(albumId).all();
      return Response.json({ members: results });
    }

    if (method === 'POST') {
      const body = await readJson(request);
      if (isResponse(body)) return body;

      const email = normalizeEmail(body.email);
      const permission = body.permission === 'viewer' ? 'viewer' : 'contributor';
      if (!email) return apiError('A valid participant email address is required', 400);
      if (email === user.email) return apiError('The owner does not need to be added as a participant', 400);

      await env.DB.prepare(
        `INSERT INTO album_members (album_id, member_email, permission)
         VALUES (?, ?, ?)
         ON CONFLICT(album_id, member_email) DO UPDATE SET permission = excluded.permission`,
      ).bind(albumId, email, permission).run();

      return Response.json({ email, permission }, { status: 201 });
    }

    if (method === 'DELETE') {
      const email = normalizeEmail(url.searchParams.get('email'));
      if (!email) return apiError('A valid participant email address is required', 400);

      await env.DB.prepare(
        'DELETE FROM album_members WHERE album_id = ? AND member_email = ?',
      ).bind(albumId, email).run();
      return new Response(null, { status: 204 });
    }

    return apiError('Method not allowed', 405);
  }

  const albumPath = new RegExp(`^/api/albums/(${ALBUM_ID_PATTERN})$`).exec(pathname);
  if (!albumPath) return apiError('Not found', 404);

  const albumId = albumPath[1];
  const access = await getAlbumAccess(env.DB, albumId, user);
  if (!access) return apiError('Album not found', 404);

  if (method === 'GET') {
    const { results: images } = await env.DB.prepare(
      `SELECT id, storage_key, filename, mime_type, file_size, width, height, uploaded_by, created_at
       FROM images WHERE album_id = ? ORDER BY created_at DESC`,
    ).bind(albumId).all();

    return Response.json({
      album: access.album,
      images,
      isOwner: access.isOwner,
      canUpload: canContribute(access),
      permission: access.permission,
    });
  }

  if (method === 'PATCH') {
    if (!access.isOwner) return apiError('Only the album owner can update this album', 403);

    const body = await readJson(request);
    if (isResponse(body)) return body;
    const title = textField(body.title, 120, true);
    const description = textField(body.description, 1000);
    if (!title || description === null) {
      return apiError('Title is required (max 120 characters) and description must be at most 1000 characters', 400);
    }

    await env.DB.prepare(
      `UPDATE albums SET title = ?, description = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(title, description, albumId).run();

    return Response.json({ title, description });
  }

  if (method === 'DELETE') {
    if (!access.isOwner) return apiError('Only the album owner can delete this album', 403);

    const imageRows = await env.DB.prepare(
      'SELECT storage_key FROM images WHERE album_id = ?',
    ).bind(albumId).all() as { results?: Array<{ storage_key: string }> };
    const images = imageRows.results ?? [];

    try {
      await Promise.all(images.map((image) => env.R2_BUCKET.delete(image.storage_key)));
    } catch {
      return apiError('Images could not be removed from storage', 502);
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM album_members WHERE album_id = ?').bind(albumId),
      env.DB.prepare('DELETE FROM images WHERE album_id = ?').bind(albumId),
      env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(albumId),
    ]);

    return new Response(null, { status: 204 });
  }

  return apiError('Method not allowed', 405);
};
