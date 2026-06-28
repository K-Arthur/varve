//! Strata sync: local SQLite persistence + Yjs CRDT sync.
//!
//! Research basis: the "Local-First Software" essay (Kleppmann et al., 2019)
//! and Yjs document persistence patterns. The document lives in local SQLite;
//! CRDT ops queue offline and reconcile at page granularity on reconnect
//! (Strata plan §3.2). Minimal open/save lands in task 0.10; CRDT in Phase 2.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
