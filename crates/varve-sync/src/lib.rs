#![forbid(unsafe_code)]

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, Transaction};

const SCHEMA_VERSION: i64 = 2;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Persistent storage for Strata documents.
/// Row type for file entries (mirrors TS FileEntry).
#[derive(Debug, Clone)]
pub struct FileRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub project_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub opened_at: String,
    pub size: i64,
    pub pinned: bool,
    pub trashed_at: Option<String>,
    pub file_path: Option<String>,
    pub ordering: String,
    pub content_hash: String,
    /// Epoch ms when favorited; None when not in Favorites.
    pub favorited_at: Option<i64>,
}

/// Row type for project entries.
#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: bool,
    pub trashed_at: Option<String>,
}

/// Row type for recent-file entries (mirrors TS RecentFileRecord).
#[derive(Debug, Clone)]
pub struct RecentRow {
    pub id: String,
    pub name: String,
    pub last_opened_at: i64,
    pub opened_count: i64,
    pub pinned: bool,
    pub hidden: bool,
    pub workspace_relevance: String,
    pub user_workspace_tag: Option<String>,
    pub encrypted: bool,
    pub missing: bool,
    pub version: i64,
    pub source_workspace_id: Option<String>,
    pub content_hash: Option<String>,
}

pub struct DocumentStore {
    conn: Mutex<Connection>,
}

impl DocumentStore {
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        Self::migrate(&mut conn)?;
        Ok(DocumentStore {
            conn: Mutex::new(conn),
        })
    }

    /// Lock the shared connection, recovering from poisoning rather than
    /// propagating it.
    ///
    /// A panic in unrelated calling code that happens to occur while this
    /// lock is held (e.g. a type-conversion panic mapping a row) does not
    /// leave the `rusqlite::Connection` itself in an unsound Rust-level
    /// state — no method here does partial, uncommitted mutation of `conn`
    /// across a panic boundary. Every accessor in this file used to call
    /// `self.conn.lock().unwrap()` directly, which meant the *first* panic
    /// anywhere poisoned the mutex and every subsequent save/load/list/etc.
    /// call — for the remainder of the process — panicked too, permanently
    /// losing persistence for an open editing session. Recovering the guard
    /// here is the standard, safe idiom for that failure mode.
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn migrate(conn: &mut Connection) -> Result<(), rusqlite::Error> {
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }

        let transaction = conn.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'strata',
                project_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                opened_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
                size INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                trashed_at TEXT,
                file_path TEXT,
                ordering TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL DEFAULT '',
                favorited_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                trashed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS thumbnails (
                hash TEXT PRIMARY KEY,
                data_url TEXT NOT NULL,
                width INTEGER NOT NULL DEFAULT 256,
                height INTEGER NOT NULL DEFAULT 192,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS view_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS recent_files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                last_opened_at INTEGER NOT NULL,
                opened_count INTEGER NOT NULL DEFAULT 1,
                pinned INTEGER NOT NULL DEFAULT 0,
                hidden INTEGER NOT NULL DEFAULT 0,
                workspace_relevance TEXT NOT NULL DEFAULT '[]',
                user_workspace_tag TEXT,
                encrypted INTEGER NOT NULL DEFAULT 0,
                missing INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                source_workspace_id TEXT,
                content_hash TEXT
            );",
        )?;

        // Databases created before this migration may not have the column even
        // though newly created databases include it in the table definition.
        let has_favorited_at = {
            let mut columns = transaction.prepare("PRAGMA table_info(files)")?;
            let names = columns.query_map([], |row| row.get::<_, String>(1))?;
            names
                .collect::<Result<Vec<_>, _>>()?
                .iter()
                .any(|name| name == "favorited_at")
        };
        if !has_favorited_at {
            transaction.execute("ALTER TABLE files ADD COLUMN favorited_at INTEGER", [])?;
        }

        transaction.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                name, kind,
                content='files',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
                INSERT INTO files_fts(rowid, name, kind) VALUES (new.rowid, new.name, new.kind);
            END;
            CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
                INSERT INTO files_fts(files_fts, rowid, name, kind) VALUES('delete', old.rowid, old.name, old.kind);
            END;
            CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
                INSERT INTO files_fts(files_fts, rowid, name, kind) VALUES('delete', old.rowid, old.name, old.kind);
                INSERT INTO files_fts(rowid, name, kind) VALUES (new.rowid, new.name, new.kind);
            END;
            INSERT INTO files_fts(files_fts) VALUES('rebuild');",
        )?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()
    }

    // ── Documents ──────────────────────────────────────────────────────────

    pub fn save_document(&self, id: &str, data: &str) -> Result<(), rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn();
        conn.execute(
            "INSERT INTO documents (id, data, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            rusqlite::params![id, data, now],
        )?;
        Ok(())
    }

    /// Atomically persists document content and its file metadata.
    ///
    /// The file identifier is also used as the document identifier, matching
    /// the store's existing one-file-per-document model.
    pub fn save_document_with_file(
        &self,
        data: &str,
        file: &FileRow,
    ) -> Result<(), rusqlite::Error> {
        let mut conn = self.conn();
        let transaction = conn.transaction()?;
        transaction.execute(
            "INSERT INTO documents (id, data, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            rusqlite::params![file.id, data, file.updated_at],
        )?;
        Self::upsert_file_in_transaction(&transaction, file)?;
        transaction.commit()
    }

    pub fn load_document(&self, id: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT data FROM documents WHERE id = ?1")?;
        let mut rows = stmt.query(rusqlite::params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn list_documents(&self) -> Result<Vec<String>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT id FROM documents ORDER BY id")?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    // ── Files ──────────────────────────────────────────────────────────────

    fn row_to_file(row: &rusqlite::Row) -> rusqlite::Result<FileRow> {
        Ok(FileRow {
            id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            project_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            opened_at: row.get(6)?,
            size: row.get(7)?,
            pinned: row.get::<_, i64>(8)? != 0,
            trashed_at: row.get(9)?,
            file_path: row.get(10)?,
            ordering: row.get(11)?,
            content_hash: row.get(12)?,
            favorited_at: row.get(13)?,
        })
    }

    pub fn list_files(&self) -> Result<Vec<FileRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, project_id, created_at, updated_at, opened_at, size, pinned, trashed_at, file_path, ordering, content_hash, favorited_at
             FROM files WHERE trashed_at IS NULL ORDER BY ordering ASC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_file)?;
        rows.collect()
    }

    pub fn list_trashed_files(&self) -> Result<Vec<FileRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, project_id, created_at, updated_at, opened_at, size, pinned, trashed_at, file_path, ordering, content_hash, favorited_at
             FROM files WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_file)?;
        rows.collect()
    }

    pub fn get_file(&self, id: &str) -> Result<Option<FileRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, project_id, created_at, updated_at, opened_at, size, pinned, trashed_at, file_path, ordering, content_hash, favorited_at
             FROM files WHERE id = ?1",
        )?;
        let mut rows = stmt.query(rusqlite::params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::row_to_file(row)?)),
            None => Ok(None),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_file(
        &self,
        id: &str,
        name: &str,
        kind: &str,
        project_id: Option<&str>,
        created_at: &str,
        updated_at: &str,
        opened_at: &str,
        size: i64,
        pinned: bool,
        trashed_at: Option<&str>,
        file_path: Option<&str>,
        ordering: &str,
        content_hash: &str,
        favorited_at: Option<i64>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO files (id, name, kind, project_id, created_at, updated_at, opened_at, size, pinned, trashed_at, file_path, ordering, content_hash, favorited_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                kind = excluded.kind,
                project_id = excluded.project_id,
                updated_at = excluded.updated_at,
                opened_at = excluded.opened_at,
                size = excluded.size,
                pinned = excluded.pinned,
                trashed_at = excluded.trashed_at,
                file_path = excluded.file_path,
                ordering = excluded.ordering,
                content_hash = excluded.content_hash,
                favorited_at = excluded.favorited_at",
            rusqlite::params![
                id, name, kind, project_id, created_at, updated_at, opened_at, size,
                pinned as i64, trashed_at, file_path, ordering, content_hash, favorited_at
            ],
        )?;
        Ok(())
    }

    fn upsert_file_in_transaction(
        transaction: &Transaction<'_>,
        file: &FileRow,
    ) -> Result<(), rusqlite::Error> {
        transaction.execute(
            "INSERT INTO files (id, name, kind, project_id, created_at, updated_at, opened_at, size, pinned, trashed_at, file_path, ordering, content_hash, favorited_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                kind = excluded.kind,
                project_id = excluded.project_id,
                updated_at = excluded.updated_at,
                opened_at = excluded.opened_at,
                size = excluded.size,
                pinned = excluded.pinned,
                trashed_at = excluded.trashed_at,
                file_path = excluded.file_path,
                ordering = excluded.ordering,
                content_hash = excluded.content_hash,
                favorited_at = excluded.favorited_at",
            rusqlite::params![
                file.id,
                file.name,
                file.kind,
                file.project_id,
                file.created_at,
                file.updated_at,
                file.opened_at,
                file.size,
                file.pinned as i64,
                file.trashed_at,
                file.file_path,
                file.ordering,
                file.content_hash,
                file.favorited_at
            ],
        )?;
        Ok(())
    }

    pub fn touch_file(&self, id: &str, opened_at: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET opened_at = ?2 WHERE id = ?1",
            rusqlite::params![id, opened_at],
        )?;
        Ok(())
    }

    pub fn rename_file(&self, id: &str, name: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET name = ?2 WHERE id = ?1",
            rusqlite::params![id, name],
        )?;
        Ok(())
    }

    pub fn set_file_pinned(&self, id: &str, pinned: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET pinned = ?2 WHERE id = ?1",
            rusqlite::params![id, pinned as i64],
        )?;
        Ok(())
    }

    pub fn set_file_favorited(
        &self,
        id: &str,
        favorited_at: Option<i64>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET favorited_at = ?2 WHERE id = ?1",
            rusqlite::params![id, favorited_at],
        )?;
        Ok(())
    }

    pub fn move_file_to_project(
        &self,
        id: &str,
        project_id: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET project_id = ?2 WHERE id = ?1",
            rusqlite::params![id, project_id],
        )?;
        Ok(())
    }

    pub fn trash_file(&self, id: &str, trashed_at: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET trashed_at = ?2 WHERE id = ?1",
            rusqlite::params![id, trashed_at],
        )?;
        Ok(())
    }

    pub fn restore_file(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET trashed_at = NULL WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub fn purge_file(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute("DELETE FROM documents WHERE id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM files WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn search_files(&self, query: &str) -> Result<Vec<FileRow>, rusqlite::Error> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.name, f.kind, f.project_id, f.created_at, f.updated_at, f.opened_at, f.size, f.pinned, f.trashed_at, f.file_path, f.ordering, f.content_hash, f.favorited_at
             FROM files f
             JOIN files_fts ft ON f.rowid = ft.rowid
             WHERE files_fts MATCH ?1 AND f.trashed_at IS NULL
             ORDER BY rank
             LIMIT 100",
        )?;
        let rows = stmt.query_map(rusqlite::params![query], Self::row_to_file)?;
        rows.collect()
    }

    pub fn reorder_file(&self, id: &str, order: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET ordering = ?2 WHERE id = ?1",
            rusqlite::params![id, order],
        )?;
        Ok(())
    }

    // ── Projects ──────────────────────────────────────────────────────────

    fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<ProjectRow> {
        Ok(ProjectRow {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            pinned: row.get::<_, i64>(5)? != 0,
            trashed_at: row.get(6)?,
        })
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, color, created_at, updated_at, pinned, trashed_at
             FROM projects WHERE trashed_at IS NULL ORDER BY pinned DESC, name ASC",
        )?;
        let rows = stmt.query_map([], Self::row_to_project)?;
        rows.collect()
    }

    pub fn create_project(
        &self,
        id: &str,
        name: &str,
        color: Option<&str>,
        now: &str,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO projects (id, name, color, created_at, updated_at, pinned, trashed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL)",
            rusqlite::params![id, name, color, now, now],
        )?;
        Ok(())
    }

    pub fn rename_project(&self, id: &str, name: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE projects SET name = ?2, updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id, name],
        )?;
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET project_id = NULL WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn set_project_pinned(&self, id: &str, pinned: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE projects SET pinned = ?2 WHERE id = ?1",
            rusqlite::params![id, pinned as i64],
        )?;
        Ok(())
    }

    // ── Thumbnails ────────────────────────────────────────────────────────

    pub fn get_thumbnail(&self, hash: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT data_url FROM thumbnails WHERE hash = ?1")?;
        let mut rows = stmt.query(rusqlite::params![hash])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn put_thumbnail(
        &self,
        hash: &str,
        data_url: &str,
        width: i64,
        height: i64,
        now: &str,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO thumbnails (hash, data_url, width, height, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(hash) DO UPDATE SET data_url = excluded.data_url, created_at = excluded.created_at",
            rusqlite::params![hash, data_url, width, height, now],
        )?;
        Ok(())
    }

    pub fn delete_thumbnail(&self, hash: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM thumbnails WHERE hash = ?1",
            rusqlite::params![hash],
        )?;
        Ok(())
    }

    pub fn evict_thumbnails(&self, keep_count: i64) -> Result<i64, rusqlite::Error> {
        let conn = self.conn();
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM thumbnails", [], |r| r.get(0))?;
        if total <= keep_count {
            return Ok(0);
        }
        let to_delete = total - keep_count;
        conn.execute(
            "DELETE FROM thumbnails WHERE hash IN (
                SELECT hash FROM thumbnails ORDER BY created_at ASC LIMIT ?1
            )",
            rusqlite::params![to_delete],
        )?;
        Ok(to_delete)
    }

    // ── View State ────────────────────────────────────────────────────────

    pub fn get_view_state(&self, key: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT value FROM view_state WHERE key = ?1")?;
        let mut rows = stmt.query(rusqlite::params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_view_state(&self, key: &str, value: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO view_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    // ── Recent files ──────────────────────────────────────────────────────────

    fn recent_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecentRow> {
        Ok(RecentRow {
            id: row.get("id")?,
            name: row.get("name")?,
            last_opened_at: row.get("last_opened_at")?,
            opened_count: row.get("opened_count")?,
            pinned: row.get("pinned")?,
            hidden: row.get("hidden")?,
            workspace_relevance: row.get("workspace_relevance")?,
            user_workspace_tag: row.get("user_workspace_tag")?,
            encrypted: row.get("encrypted")?,
            missing: row.get("missing")?,
            version: row.get("version")?,
            source_workspace_id: row.get("source_workspace_id")?,
            content_hash: row.get("content_hash")?,
        })
    }

    /// Record an open. A re-open clears the missing state; a successful read
    /// is the strongest evidence the file is reachable again.
    pub fn touch_recent_file(
        &self,
        id: &str,
        name: &str,
        source_workspace_id: Option<&str>,
        content_hash: Option<&str>,
    ) -> Result<RecentRow, rusqlite::Error> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let conn = self.conn();
        conn.execute(
            "INSERT INTO recent_files
                (id, name, last_opened_at, opened_count, pinned, hidden,
                 workspace_relevance, user_workspace_tag, encrypted, missing,
                 version, source_workspace_id, content_hash)
             VALUES (?1, ?2, ?3, 1, 0, 0, '[]', NULL, 0, 0, 1, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                last_opened_at = excluded.last_opened_at,
                opened_count = opened_count + 1,
                missing = 0,
                source_workspace_id = excluded.source_workspace_id,
                content_hash = excluded.content_hash",
            rusqlite::params![id, name, now_ms, source_workspace_id, content_hash],
        )?;
        let mut stmt = conn.prepare("SELECT * FROM recent_files WHERE id = ?1")?;
        let mut rows = stmt.query(rusqlite::params![id])?;
        rows.next()?
            .map(|row| Self::recent_from_row(row))
            .transpose()
            .and_then(|row| row.ok_or(rusqlite::Error::QueryReturnedNoRows))
    }

    /// Most-recent-first, newest opens first. The frontend filters hidden and
    /// missing entries for display; the store keeps them so a temporarily
    /// unavailable network/removable file is never silently forgotten.
    pub fn list_recent_files(&self, limit: i64) -> Result<Vec<RecentRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM recent_files ORDER BY last_opened_at DESC LIMIT ?1")?;
        let rows = stmt.query_map(rusqlite::params![limit], Self::recent_from_row)?;
        rows.collect()
    }

    /// Apply a frontend-approved patch. Only the fields users may override are
    /// writable here; identity fields (id, counts, timestamps) are not.
    pub fn patch_recent_file(
        &self,
        id: &str,
        pinned: Option<bool>,
        hidden: Option<bool>,
        user_workspace_tag: Option<Option<String>>,
        name: Option<String>,
        missing: Option<bool>,
    ) -> Result<(), rusqlite::Error> {
        let mut conn = self.conn();
        let transaction = conn.transaction()?;
        let current = {
            let mut stmt = transaction.prepare("SELECT * FROM recent_files WHERE id = ?1")?;
            let mut rows = stmt.query(rusqlite::params![id])?;
            let Some(row) = rows.next()? else {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            };
            Self::recent_from_row(row)?
        };
        let pinned = pinned.unwrap_or(current.pinned);
        let hidden = hidden.unwrap_or(current.hidden);
        let user_workspace_tag = match user_workspace_tag {
            Some(value) => value,
            None => current.user_workspace_tag,
        };
        let name = name.unwrap_or(current.name);
        let missing = missing.unwrap_or(current.missing);
        transaction.execute(
            "UPDATE recent_files SET
                pinned = ?2, hidden = ?3, user_workspace_tag = ?4, name = ?5, missing = ?6
             WHERE id = ?1",
            rusqlite::params![id, pinned, hidden, user_workspace_tag, name, missing],
        )?;
        transaction.commit()
    }

    pub fn remove_recent_file(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM recent_files WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub fn clear_recent_history(&self) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute("DELETE FROM recent_files", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_db_path() -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir();
        let path = dir.join(format!("varve_sync_test_{}_{}.db", std::process::id(), n));
        let _ = std::fs::remove_file(&path);
        path
    }

    fn temp_store() -> DocumentStore {
        DocumentStore::new(&temp_db_path()).expect("create temp store")
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    fn file_row(id: &str, name: &str) -> FileRow {
        let timestamp = now();
        FileRow {
            id: id.to_string(),
            name: name.to_string(),
            kind: "strata".to_string(),
            project_id: None,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            opened_at: timestamp,
            size: 2,
            pinned: false,
            trashed_at: None,
            file_path: None,
            ordering: String::new(),
            content_hash: "hash".to_string(),
            favorited_at: None,
        }
    }

    #[test]
    fn save_and_load_round_trip() {
        let store = temp_store();
        store
            .save_document("doc-1", r#"{"name":"test"}"#)
            .expect("save");
        let loaded = store.load_document("doc-1").expect("load");
        assert_eq!(loaded, Some(r#"{"name":"test"}"#.to_string()));
    }

    #[test]
    fn save_document_with_file_is_atomic() {
        let store = temp_store();
        let file = file_row("atomic", "Atomic Design");
        store
            .save_document_with_file("{}", &file)
            .expect("atomic save");

        assert_eq!(
            store.load_document("atomic").expect("load"),
            Some("{}".into())
        );
        assert_eq!(
            store
                .get_file("atomic")
                .expect("get file")
                .expect("file")
                .name,
            "Atomic Design"
        );
    }

    #[test]
    fn save_document_with_file_rolls_back_both_rows_on_failure() {
        let store = temp_store();
        {
            let conn = store.conn();
            conn.execute_batch(
                "CREATE TRIGGER reject_file BEFORE INSERT ON files
                 WHEN new.id = 'rejected'
                 BEGIN
                    SELECT RAISE(ABORT, 'rejected for test');
                 END;",
            )
            .expect("install rejection trigger");
        }
        let file = file_row("rejected", "Rejected Design");

        assert!(store.save_document_with_file("{}", &file).is_err());
        assert!(store.load_document("rejected").expect("load").is_none());
        assert!(store.get_file("rejected").expect("get file").is_none());
    }

    #[test]
    fn load_missing_returns_none() {
        let store = temp_store();
        let loaded = store.load_document("nonexistent").expect("load");
        assert_eq!(loaded, None);
    }

    #[test]
    fn upsert_file_round_trip() {
        let store = temp_store();
        let t = now();
        store
            .upsert_file(
                "f1",
                "Test Design",
                "strata",
                None,
                &t,
                &t,
                &t,
                1024,
                false,
                None,
                None,
                "",
                "abc123",
                None,
            )
            .expect("upsert");
        let files = store.list_files().expect("list");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "Test Design");
        assert_eq!(files[0].kind, "strata");
        assert!(!files[0].pinned);
        assert!(files[0].favorited_at.is_none());
    }

    #[test]
    fn set_file_favorited_round_trip() {
        let store = temp_store();
        let t = now();
        store
            .upsert_file(
                "fav1", "Starred", "strata", None, &t, &t, &t, 0, false, None, None, "", "", None,
            )
            .expect("upsert");
        store
            .set_file_favorited("fav1", Some(1_700_000_000_000))
            .expect("favorite");
        let got = store.get_file("fav1").expect("get").expect("exists");
        assert_eq!(got.favorited_at, Some(1_700_000_000_000));
        store.set_file_favorited("fav1", None).expect("unfavorite");
        let got = store.get_file("fav1").expect("get").expect("exists");
        assert!(got.favorited_at.is_none());
    }

    #[test]
    fn trash_and_restore_file() {
        let store = temp_store();
        let t = now();
        store
            .upsert_file(
                "f2",
                "To Delete",
                "strata",
                None,
                &t,
                &t,
                &t,
                0,
                false,
                None,
                None,
                "",
                "",
                None,
            )
            .expect("upsert");
        let trash_t = now();
        store.trash_file("f2", &trash_t).expect("trash");
        assert_eq!(store.list_files().expect("list").len(), 0);
        assert_eq!(store.list_trashed_files().expect("list").len(), 1);
        store.restore_file("f2").expect("restore");
        assert_eq!(store.list_files().expect("list").len(), 1);
    }

    #[test]
    fn purge_removes_document_and_file() {
        let store = temp_store();
        let t = now();
        store.save_document("f3", "{}").expect("save doc");
        store
            .upsert_file(
                "f3", "Purge Me", "strata", None, &t, &t, &t, 0, false, None, None, "", "", None,
            )
            .expect("upsert");
        store.purge_file("f3").expect("purge");
        assert!(store.load_document("f3").expect("load").is_none());
        assert!(store.get_file("f3").expect("get").is_none());
    }

    #[test]
    fn projects_crud() {
        let store = temp_store();
        let t = now();
        store
            .create_project("p1", "My Project", None, &t)
            .expect("create");
        let projects = store.list_projects().expect("list");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "My Project");

        store.rename_project("p1", "Renamed").expect("rename");
        assert_eq!(store.list_projects().expect("list")[0].name, "Renamed");

        store.set_project_pinned("p1", true).expect("pin");
        assert!(store.list_projects().expect("list")[0].pinned);

        store.delete_project("p1").expect("delete");
        assert_eq!(store.list_projects().expect("list").len(), 0);
    }

    #[test]
    fn thumbnails_crud() {
        let store = temp_store();
        let t = now();
        store
            .put_thumbnail("hash1", "data:image/png;base64,test", 256, 192, &t)
            .expect("put");
        let data = store.get_thumbnail("hash1").expect("get");
        assert_eq!(data, Some("data:image/png;base64,test".to_string()));

        assert_eq!(store.get_thumbnail("nonexistent").expect("get"), None);
    }

    #[test]
    fn view_state_kv() {
        let store = temp_store();
        store.set_view_state("sidebar", "collapsed").expect("set");
        let val = store.get_view_state("sidebar").expect("get");
        assert_eq!(val, Some("collapsed".to_string()));

        assert_eq!(store.get_view_state("missing").expect("get"), None);
    }

    #[test]
    fn search_files_by_name() {
        let store = temp_store();
        let t = now();
        store
            .upsert_file(
                "f1", "Alpha", "strata", None, &t, &t, &t, 100, false, None, None, "", "hash1",
                None,
            )
            .expect("upsert");
        store
            .upsert_file(
                "f2", "Beta", "strata", None, &t, &t, &t, 200, false, None, None, "", "hash2", None,
            )
            .expect("upsert");
        store
            .upsert_file(
                "f3", "Gamma", "strata", None, &t, &t, &t, 300, false, None, None, "", "hash3",
                None,
            )
            .expect("upsert");
        let results = store.search_files("alpha").expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Alpha");
        let empty = store.search_files("nonexistent").expect("search");
        assert!(empty.is_empty());
    }

    #[test]
    fn legacy_database_migrates_and_populates_search_once() {
        let path = temp_db_path();
        let legacy = Connection::open(&path).expect("open legacy database");
        legacy
            .execute_batch(
                "CREATE TABLE documents (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE files (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'strata',
                    project_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    opened_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
                    size INTEGER NOT NULL DEFAULT 0,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    trashed_at TEXT,
                    file_path TEXT,
                    ordering TEXT NOT NULL DEFAULT '',
                    content_hash TEXT NOT NULL DEFAULT ''
                );
                INSERT INTO files (
                    id, name, kind, created_at, updated_at, opened_at
                ) VALUES (
                    'legacy', 'Legacy Searchable', 'strata', 'now', 'now', 'now'
                );",
            )
            .expect("create legacy schema");
        drop(legacy);

        let store = DocumentStore::new(&path).expect("migrate legacy database");
        let result = store.search_files("legacy").expect("search migrated index");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "legacy");
        assert!(result[0].favorited_at.is_none());
        let version: i64 = store
            .conn
            .lock()
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read schema version");
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn reopening_current_database_does_not_write_or_rebuild_search() {
        let path = temp_db_path();
        {
            let store = DocumentStore::new(&path).expect("create database");
            let file = file_row("stable", "Stable Search Index");
            store
                .save_document_with_file("{}", &file)
                .expect("seed database");
        }

        // SQLite increments data_version when another connection commits. A
        // rebuild on open would therefore make this observer's value change.
        let observer = Connection::open(&path).expect("open observer");
        let before: i64 = observer
            .pragma_query_value(None, "data_version", |row| row.get(0))
            .expect("read data version");
        let reopened = DocumentStore::new(&path).expect("reopen database");
        let after: i64 = observer
            .pragma_query_value(None, "data_version", |row| row.get(0))
            .expect("read data version");

        assert_eq!(after, before, "reopen unexpectedly wrote to the database");
        let result = reopened
            .search_files("stable")
            .expect("search after reopen");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "stable");
    }

    #[test]
    fn reorder_file() {
        let store = temp_store();
        let t = now();
        store
            .upsert_file(
                "f1", "First", "strata", None, &t, &t, &t, 0, false, None, None, "a0", "hash1",
                None,
            )
            .expect("upsert");
        store.reorder_file("f1", "z0").expect("reorder");
        let files = store.list_files().expect("list");
        let f = files.iter().find(|f| f.id == "f1").expect("find");
        assert_eq!(f.ordering, "z0");
    }

    /// Regression test for the Mutex-poisoning defect fixed alongside this
    /// test: previously, every accessor called `self.conn.lock().unwrap()`,
    /// so a single panic anywhere while the lock was held permanently broke
    /// every subsequent DocumentStore call for the process's lifetime. This
    /// deliberately poisons the mutex the same way a real panic would, then
    /// asserts a normal call still succeeds afterward instead of panicking.
    #[test]
    fn survives_a_poisoned_connection_mutex() {
        let store = std::sync::Arc::new(temp_store());
        let poison_store = store.clone();
        let _ = std::thread::spawn(move || {
            let _conn = poison_store.conn();
            panic!("deliberately poisoning the connection mutex for the test above");
        })
        .join();

        // The mutex is now poisoned. Before the fix, this next call would
        // itself panic via `.lock().unwrap()`.
        let t = now();
        store
            .upsert_file(
                "post-poison",
                "Survives Poisoning",
                "strata",
                None,
                &t,
                &t,
                &t,
                0,
                false,
                None,
                None,
                "a0",
                "hash1",
                None,
            )
            .expect("store must remain usable after a poisoned lock is recovered");
        let files = store
            .list_files()
            .expect("list_files must not panic post-poison");
        assert!(files.iter().any(|f| f.id == "post-poison"));
    }

    #[test]
    fn recent_files_record_opens_and_patch_updates_visibility_state() {
        let store = temp_store();
        let first = store
            .touch_recent_file("doc-1", "Design.varve", Some("design"), Some("hash-1"))
            .expect("first open");
        assert_eq!(first.opened_count, 1);
        assert!(!first.missing);
        assert_eq!(first.source_workspace_id.as_deref(), Some("design"));

        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = store
            .touch_recent_file("doc-1", "Design.varve", None, Some("hash-2"))
            .expect("second open");
        assert_eq!(second.opened_count, 2);
        assert_eq!(second.content_hash.as_deref(), Some("hash-2"));

        store
            .patch_recent_file("doc-1", None, Some(true), Some(None), None, Some(true))
            .expect("patch hidden + missing");
        let listed = store.list_recent_files(50).expect("list");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].hidden);
        assert!(listed[0].missing);
        assert_eq!(listed[0].user_workspace_tag, None);

        store
            .patch_recent_file(
                "doc-1",
                None,
                None,
                Some(Some("logo".to_string())),
                None,
                None,
            )
            .expect("set workspace tag");
        let tagged = store.list_recent_files(50).expect("list again");
        assert_eq!(tagged[0].user_workspace_tag.as_deref(), Some("logo"));

        store.remove_recent_file("doc-1").expect("remove");
        assert!(store
            .list_recent_files(50)
            .expect("list after remove")
            .is_empty());
    }

    #[test]
    fn recent_files_are_sorted_newest_first_and_bounded() {
        let store = temp_store();
        store
            .touch_recent_file("a", "A.varve", None, None)
            .expect("a");
        std::thread::sleep(std::time::Duration::from_millis(2));
        store
            .touch_recent_file("b", "B.varve", None, None)
            .expect("b");
        std::thread::sleep(std::time::Duration::from_millis(2));
        store
            .touch_recent_file("c", "C.varve", None, None)
            .expect("c");

        let listed = store.list_recent_files(2).expect("bounded list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "c");
        assert_eq!(listed[1].id, "b");

        store.clear_recent_history().expect("clear");
        assert!(store
            .list_recent_files(50)
            .expect("list after clear")
            .is_empty());
    }

    #[test]
    fn v1_databases_gain_the_recent_files_table_on_open() {
        // Simulate a database created before the recents schema: v1 tables
        // only, user_version = 1. Opening it must migrate in place without
        // touching existing rows.
        let path = temp_db_path();
        {
            let conn = rusqlite::Connection::open(&path).expect("open v1 db");
            conn.execute_batch(
                "CREATE TABLE files (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'strata',
                    project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    opened_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z', size INTEGER NOT NULL DEFAULT 0,
                    pinned INTEGER NOT NULL DEFAULT 0, trashed_at TEXT, file_path TEXT,
                    ordering TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT ''
                );
                INSERT INTO files (id, name, created_at, updated_at) VALUES ('legacy-1', 'Old.varve', 't', 't');
                PRAGMA user_version = 1;",
            )
            .expect("seed v1 schema");
        }
        let store = DocumentStore::new(&path).expect("open v1 store");
        let rows = store.list_files().expect("list pre-migration rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "legacy-1");
        store
            .touch_recent_file("legacy-1", "Old.varve", None, None)
            .expect("recents usable after migration");
        assert_eq!(store.list_recent_files(50).expect("list recents").len(), 1);
    }
}
