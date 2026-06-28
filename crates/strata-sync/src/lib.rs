//! Strata sync: local SQLite persistence + Yjs CRDT sync.
//!
//! Research basis: the "Local-First Software" essay (Kleppmann et al., 2019)
//! and Yjs document persistence patterns. The document lives in local SQLite;
//! CRDT ops queue offline and reconcile at page granularity on reconnect
//! (Strata plan §3.2). Minimal open/save lands in task 0.10; CRDT in Phase 2.
//!
//! Phase 1 Pre-flight task P2: `DocumentStore` with `save_document()`,
//! `load_document()`, and `list_documents()` over `rusqlite` (bundled so no
//! system SQLite required — cross-platform by default).

#![forbid(unsafe_code)]

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// Persistent storage for Strata documents.
///
/// Thread-safe (Mutex<Connection>) so Tauri commands can share it via managed
/// state. Uses a simple `documents` table keyed by document ID.
pub struct DocumentStore {
    conn: Mutex<Connection>,
}

impl DocumentStore {
    /// Open (or create) the SQLite database at `path` and initialize the schema.
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )?;
        Ok(DocumentStore {
            conn: Mutex::new(conn),
        })
    }

    /// Persist a document. Upserts on conflict.
    pub fn save_document(&self, id: &str, data: &str) -> Result<(), rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO documents (id, data, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            rusqlite::params![id, data, now],
        )?;
        Ok(())
    }

    /// Load a document by ID. Returns `None` if not found.
    pub fn load_document(&self, id: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data FROM documents WHERE id = ?1")?;
        let mut rows = stmt.query(rusqlite::params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    /// List all stored document IDs.
    pub fn list_documents(&self) -> Result<Vec<String>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM documents ORDER BY id")?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_store() -> DocumentStore {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir();
        let path = dir.join(format!("strata_sync_test_{}_{}.db", std::process::id(), n));
        // Remove any leftover from a previous interrupted run.
        let _ = std::fs::remove_file(&path);
        DocumentStore::new(&path).expect("create temp store")
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
    fn load_missing_returns_none() {
        let store = temp_store();
        let loaded = store.load_document("nonexistent").expect("load");
        assert_eq!(loaded, None);
    }

    #[test]
    fn upsert_overwrites_existing() {
        let store = temp_store();
        store.save_document("doc-2", r#"{"v":1}"#).expect("save v1");
        store.save_document("doc-2", r#"{"v":2}"#).expect("save v2");
        let loaded = store.load_document("doc-2").expect("load");
        assert_eq!(loaded, Some(r#"{"v":2}"#.to_string()));
    }

    #[test]
    fn list_documents() {
        let store = temp_store();
        store.save_document("a", r#"{}"#).expect("save a");
        store.save_document("b", r#"{}"#).expect("save b");
        let list = store.list_documents().expect("list");
        assert_eq!(list, vec!["a".to_string(), "b".to_string()]);
    }
}
