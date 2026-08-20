-- 既存の album-pe データベースを共有アルバム対応へ移行する。
-- 実行前に D1 のバックアップまたはエクスポートを取得すること。

CREATE TABLE IF NOT EXISTS album_members (
  album_id TEXT NOT NULL,
  member_email TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'contributor' CHECK(permission IN ('viewer', 'contributor')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (album_id, member_email),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_album_members_email ON album_members(member_email);

-- 旧実装が owner_id / uploaded_by にメールアドレスを保存していた場合、
-- 既に users テーブルに存在する同一メールのユーザーIDへ置き換える。
UPDATE albums
SET owner_id = (SELECT id FROM users WHERE users.email = albums.owner_id)
WHERE EXISTS (SELECT 1 FROM users WHERE users.email = albums.owner_id);

UPDATE images
SET uploaded_by = (SELECT id FROM users WHERE users.email = images.uploaded_by)
WHERE EXISTS (SELECT 1 FROM users WHERE users.email = images.uploaded_by);
