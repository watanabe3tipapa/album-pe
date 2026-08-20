import type { AuthenticatedUser } from './auth';

export interface AlbumRecord {
  id: string;
  title: string;
  description: string;
  cover_image_key: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export type AlbumPermission = 'viewer' | 'contributor';

export interface AlbumAccess {
  album: AlbumRecord;
  isOwner: boolean;
  permission: 'owner' | AlbumPermission;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 320) return null;

  // Cloudflare Access validates identity. This validation only prevents malformed invitations.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function textField(value: unknown, maxLength: number, required = false): string | null {
  if (typeof value !== 'string') return required ? null : '';
  const text = value.trim();
  if ((required && text.length === 0) || text.length > maxLength) return null;
  return text;
}

export async function findAlbum(
  db: any,
  albumId: string,
): Promise<AlbumRecord | null> {
  return db.prepare(
    `SELECT id, title, description, cover_image_key, owner_id, created_at, updated_at
     FROM albums WHERE id = ?`,
  ).bind(albumId).first() as Promise<AlbumRecord | null>;
}

export async function getAlbumAccess(
  db: any,
  albumId: string,
  user: AuthenticatedUser,
): Promise<AlbumAccess | null> {
  const album = await findAlbum(db, albumId);
  if (!album) return null;

  if (album.owner_id === user.id) {
    return { album, isOwner: true, permission: 'owner' };
  }

  // 旧実装がメールアドレスを所有者IDとして保存していたデータを、
  // 認証済みの同一メール本人が最初にアクセスした時点で補正する。
  if (album.owner_id === user.email) {
    await db.prepare(
      "UPDATE albums SET owner_id = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(user.id, album.id).run();

    return {
      album: { ...album, owner_id: user.id },
      isOwner: true,
      permission: 'owner',
    };
  }

  const membership = await db.prepare(
    `SELECT permission FROM album_members
     WHERE album_id = ? AND member_email = ? LIMIT 1`,
  ).bind(albumId, user.email).first() as { permission: AlbumPermission } | null;

  if (!membership) return null;
  return { album, isOwner: false, permission: membership.permission };
}

export function canContribute(access: AlbumAccess): boolean {
  return access.isOwner || access.permission === 'contributor';
}

export function imageResponseHeaders(
  mimeType: string,
  filename: string,
): Headers {
  const headers = new Headers({
    'Content-Type': mimeType,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  const safeFilename = filename.replace(/[\\"\r\n]/g, '_');
  headers.set('Content-Disposition', `inline; filename="${safeFilename}"`);
  return headers;
}
