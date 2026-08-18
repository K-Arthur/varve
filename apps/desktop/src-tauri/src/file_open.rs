//! OS "Open With" intake for `.varve` / `.strata` file associations.
//!
//! The associations in `tauri.conf.json` used to declare MIME types the app
//! never acted on: double-clicking a document launched the app and opened
//! nothing (current-state audit 2026-08-17).
//!
//! Two intake paths exist, funnelled into one managed queue the frontend
//! drains over IPC:
//!   - `argv[1..]` on Windows/Linux: the shell passes the opened path to a
//!     freshly launched process, which opens the file in that instance.
//!     (No single-instance plugin: each double-click is its own window.)
//!   - `RunEvent::Opened` on macOS/iOS/Android: LaunchServices delivers
//!     `file://` URLs, usually to the already-running instance.
//!
//! Why a queue instead of an event alone: on macOS the `Opened` event can
//! fire before the webview's JS listener exists, and the event is not
//! replayed. The queue is the durable channel, and the `varve:file-open`
//! event is only the live wake-up for when the webview is already up.

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// Pending document paths the frontend has not drained yet.
pub struct PendingFileOpens(pub Mutex<Vec<String>>);

impl Default for PendingFileOpens {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

fn is_document_path(path: &str) -> bool {
    let file = Path::new(path);
    let document_extension = file
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("varve") || extension.eq_ignore_ascii_case("strata")
        })
        .unwrap_or(false);
    document_extension && file.is_file()
}

/// Queue a document path unless it is already pending. Returns true when the
/// path was newly queued (the event should be emitted).
fn queue_path(state: &PendingFileOpens, path: &str) -> bool {
    if !is_document_path(path) {
        return false;
    }
    state
        .0
        .lock()
        .map(|mut pending| {
            if pending.iter().any(|existing| existing == path) {
                false
            } else {
                pending.push(path.to_string());
                true
            }
        })
        .unwrap_or(false)
}

fn push_open(app: &AppHandle, state: &PendingFileOpens, path: String) {
    if queue_path(state, &path) {
        let _ = app.emit("varve:file-open", vec![path]);
    }
}

/// Collect document paths passed as `argv[1..]` (Windows/Linux open-with).
/// Runs at startup, before the webview exists, so the emit is lost by design;
/// the frontend drains the queue after mount.
pub fn register_startup_args(app: &AppHandle) {
    let state = app.state::<PendingFileOpens>();
    for argument in std::env::args_os().skip(1) {
        if let Ok(path) = argument.into_string() {
            push_open(app, &state, path);
        }
    }
}

/// macOS/iOS/Android LaunchServices "Open With" requests arrive as URLs and
/// may target a running instance.
pub fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    {
        if let RunEvent::Opened { urls } = event {
            let state = app.state::<PendingFileOpens>();
            for url in urls {
                if url.scheme() == "file" {
                    if let Ok(path) = url.to_file_path() {
                        push_open(app, &state, path.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    let _ = (app, event);
}

/// Drain the pending-open queue exactly once. The frontend calls this after
/// mount (startup case) and after every `varve:file-open` event, and dedupes
/// by path, so the same file can never open twice.
fn drain_pending(state: &PendingFileOpens) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[tauri::command]
pub fn take_pending_open_files(state: State<'_, PendingFileOpens>) -> Vec<String> {
    drain_pending(state.inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_document(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("varve-file-open-test-{name}"));
        std::fs::write(&path, b"{\"varve\":1}").expect("write temp document");
        path
    }

    #[test]
    fn accepts_existing_document_paths_only() {
        // Case-insensitive extensions are accepted.
        let path = temp_document("sample.VARVE");
        assert!(is_document_path(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);

        let path = temp_document("legacy.strata");
        assert!(is_document_path(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);

        // Wrong extension (even an existing file) is rejected.
        let path = temp_document("notes.txt");
        assert!(!is_document_path(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);

        // Non-existent document path is rejected.
        assert!(!is_document_path("/definitely/not/here/anywhere.varve"));
    }

    #[test]
    fn queues_each_path_once() {
        let state = PendingFileOpens::default();
        let path = temp_document("dedupe.varve");
        let path_string = path.to_string_lossy().into_owned();

        assert!(queue_path(&state, &path_string), "first push queues");
        assert!(
            !queue_path(&state, &path_string),
            "same path must not double-queue"
        );
        assert_eq!(
            drain_pending(&state),
            vec![path_string.clone()],
            "drain returns each pending path once"
        );
        assert!(
            queue_path(&state, &path_string),
            "after a drain the path can queue again"
        );
        let _ = std::fs::remove_file(&path);

        // A non-document path never reaches the queue.
        assert!(!queue_path(&state, "/tmp/whatever.varve"));
        assert_eq!(drain_pending(&state).len(), 1, "only the document was queued");
    }
}