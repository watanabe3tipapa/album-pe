import {
  apiError,
  isAuthenticatedUser,
} from '../lib/auth';
import { canContribute, getAlbumAccess } from '../lib/albums';

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 255;

type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif';

function detectedImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/)) {
    return 'image/gif';
  }
  if (bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'avif') {
    return 'image/avif';
  }
  return null;
}

function safeFilename(value: string): string {
  const filename = value.replace(/[\\/\u0000-\u001f]/g, '_').trim();
  return (filename || 'photo').slice(0, MAX_FILENAME_LENGTH);
}

export const onRequestPost = async (context: any) => {
  const { request, env } = context;
  const user = context.data.user;
  if (!user || !isAuthenticatedUser(user)) return apiError('Authentication is required', 401);

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return apiError('Content-Type must be multipart/form-data', 415);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('The upload form could not be read', 400);
  }

  const file = form.get('file');
  const albumId = form.get('albumId');
  if (!(file instanceof File) || typeof albumId !== 'string') {
    return apiError('A photo file and album ID are required', 400);
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(albumId)) return apiError('Invalid album ID', 400);
  if (file.size === 0 || file.size > MAX_UPLOAD_SIZE) {
    return apiError('Photo size must be between 1 byte and 10 MB', 400);
  }

  const access = await getAlbumAccess(env.DB, albumId, user);
  if (!access) return apiError('Album not found', 404);
  if (!canContribute(access)) return apiError('You do not have permission to add photos to this album', 403);

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const mimeType = detectedImageType(bytes);
  if (!mimeType) {
    return apiError('Only JPEG, PNG, WebP, AVIF, and GIF image files are supported', 400);
  }

  const imageId = crypto.randomUUID();
  const storageKey = `albums/${albumId}/${imageId}`;
  const filename = safeFilename(file.name);

  await env.R2_BUCKET.put(storageKey, arrayBuffer, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      uploadedBy: user.id,
      albumId,
      filename,
    },
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO images (id, album_id, storage_key, filename, mime_type, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(imageId, albumId, storageKey, filename, mimeType, file.size, user.id),
      env.DB.prepare(
        `UPDATE albums
         SET cover_image_key = COALESCE(cover_image_key, ?), updated_at = datetime('now')
         WHERE id = ?`,
      ).bind(storageKey, albumId),
    ]);
  } catch {
    await env.R2_BUCKET.delete(storageKey);
    return apiError('The photo metadata could not be saved', 500);
  }

  return Response.json({
    image: {
      id: imageId,
      filename,
      mimeType,
      fileSize: file.size,
      url: `/api/image/${imageId}`,
    },
  }, { status: 201 });
};
