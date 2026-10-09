//! Native termination interception (ADR-0216 D5).
//!
//! The native layer is authoritative for desktop termination: OS window
//! closes (title-bar X, Alt+F4, WM close, Cmd+W on macOS) arrive here first,
//! are prevented, and the webview is asked to run the termination
//! coordinator. Only after the frontend approves does a one-shot token let
//! the close/exit proceed — so the interception can never recurse.
//!
//! Auxiliary windows (label != "main") close freely: they own no document
//! state (ADR-0211 D1).

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State, Window, WindowEvent, Wry};

const NATIVE_SHUTDOWN_KEY: &str = "app-setting:native-clean-shutdown";

/// The previous native process' shutdown result, captured before this process
/// arms itself as unclean. Unlike WebView localStorage, this state is committed
/// by the native SQLite store before the process is allowed to exit.
pub struct NativeShutdownState {
    previous_clean: Option<bool>,
    frontend_session: Mutex<Option<(String, Option<bool>)>>,
}

impl NativeShutdownState {
    pub fn begin(store: &varve_sync::DocumentStore) -> Result<Self, String> {
        let previous_clean = store
            .get_view_state(NATIVE_SHUTDOWN_KEY)
            .map_err(|error| format!("Could not read native shutdown state: {error}"))?
            .map(|value| value == "true");
        store
            .set_view_state(NATIVE_SHUTDOWN_KEY, "false")
            .map_err(|error| format!("Could not arm native shutdown state: {error}"))?;
        Ok(Self {
            previous_clean,
            frontend_session: Mutex::new(None),
        })
    }

    pub fn previous_clean_for_session(&self, session_id: &str) -> Option<bool> {
        let Ok(mut current) = self.frontend_session.lock() else {
            return Some(false);
        };
        let result = match current.as_ref() {
            Some((current_id, result)) if current_id == session_id => *result,
            Some(_) => Some(false),
            None => self.previous_clean,
        };
        *current = Some((session_id.to_string(), result));
        result
    }
}

pub fn write_clean_shutdown_state(
    store: &varve_sync::DocumentStore,
    clean: bool,
) -> Result<(), String> {
    store
        .set_view_state(NATIVE_SHUTDOWN_KEY, if clean { "true" } else { "false" })
        .map_err(|error| format!("Could not persist native shutdown state: {error}"))
}

/// One-shot close/exit authorization tokens, scoped per window label.
#[derive(Default)]
pub struct LifecycleGuard {
    /// Window labels authorized to close exactly once.
    approved_windows: Mutex<HashSet<String>>,
    /// App exit authorized exactly once.
    exit_approved: AtomicBool,
}

impl LifecycleGuard {
    pub fn new() -> Self {
        Self::default()
    }

    fn approve_window(&self, label: &str) {
        if let Ok(mut set) = self.approved_windows.lock() {
            set.insert(label.to_string());
        }
    }

    /// Consume the window's close authorization if present. One-shot.
    fn take_window(&self, label: &str) -> bool {
        self.approved_windows
            .lock()
            .map(|mut set| set.remove(label))
            .unwrap_or(false)
    }

    fn approve_exit(&self) {
        self.exit_approved.store(true, Ordering::SeqCst);
    }

    /// Consume the exit authorization if present. One-shot.
    fn take_exit(&self) -> bool {
        self.exit_approved.swap(false, Ordering::SeqCst)
    }
}

/// Window label whose close must flow through the coordinator.
const MAIN_WINDOW_LABEL: &str = "main";

pub fn handle_window_event(window: &Window<Wry>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let label = window.label();
        if label != MAIN_WINDOW_LABEL {
            return; // auxiliary windows close freely (ADR-0211 D1)
        }
        if window
            .app_handle()
            .try_state::<LifecycleGuard>()
            .is_some_and(|guard| guard.take_window(label))
        {
            return; // coordinator approved this close — allow it
        }
        // Prevent the OS close and ask the frontend coordinator.
        api.prevent_close();
        let _ = window.emit(
            "varve://close-requested",
            serde_json::json!({ "label": label }),
        );
    }
}

pub fn handle_run_event(app: &AppHandle<Wry>, event: RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = event {
        if app
            .try_state::<LifecycleGuard>()
            .is_some_and(|guard| guard.take_exit())
        {
            return; // coordinator approved the exit — allow it
        }
        api.prevent_exit();
        let _ = app.emit("varve://exit-requested", serde_json::json!({}));
    }
}

#[tauri::command]
pub fn approve_window_close(app: AppHandle<Wry>, label: String) -> Result<(), String> {
    let guard = app
        .try_state::<LifecycleGuard>()
        .ok_or_else(|| "Lifecycle guard is unavailable".to_string())?;
    guard.approve_window(&label);
    // The token is in place before close() runs; a CloseRequested that
    // arrives afterwards is consumed by handle_window_event and allowed.
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{label}' not found"))?;
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn native_previous_clean_shutdown(
    state: State<'_, NativeShutdownState>,
    session_id: String,
) -> Option<bool> {
    state.previous_clean_for_session(&session_id)
}

#[tauri::command]
pub fn set_native_shutdown_clean(
    store: State<'_, varve_sync::DocumentStore>,
    clean: bool,
) -> Result<(), String> {
    write_clean_shutdown_state(&store, clean)
}

#[tauri::command]
pub fn approve_exit(app: AppHandle<Wry>, clean_shutdown: bool) -> Result<(), String> {
    if clean_shutdown {
        let store = app
            .try_state::<varve_sync::DocumentStore>()
            .ok_or_else(|| "Native document store is unavailable".to_string())?;
        write_clean_shutdown_state(&store, true)?;
    }
    if let Some(guard) = app.try_state::<LifecycleGuard>() {
        guard.approve_exit();
    }
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_store() -> (varve_sync::DocumentStore, std::path::PathBuf) {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "varve-native-shutdown-{}-{}.sqlite3",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        (
            varve_sync::DocumentStore::new(&path).expect("temporary document store"),
            path,
        )
    }

    #[test]
    fn native_shutdown_state_distinguishes_clean_and_interrupted_processes() {
        let (store, path) = temporary_store();

        let first = NativeShutdownState::begin(&store).expect("first startup");
        assert!(
            first.previous_clean_for_session("first-page").is_none(),
            "a fresh profile has no prior native marker"
        );
        assert_eq!(
            store
                .get_view_state(NATIVE_SHUTDOWN_KEY)
                .expect("armed state"),
            Some("false".into())
        );

        let interrupted_restart = NativeShutdownState::begin(&store).expect("restart");
        assert!(
            interrupted_restart.previous_clean_for_session("interrupted-page") == Some(false),
            "a process that did not approve a clean exit remains recoverable"
        );

        write_clean_shutdown_state(&store, true).expect("commit clean exit");
        let clean_restart = NativeShutdownState::begin(&store).expect("clean restart");
        assert_eq!(clean_restart.previous_clean_for_session("clean-page"), Some(true));
        assert!(
            clean_restart.previous_clean_for_session("clean-page") == Some(true),
            "React remounts in one webview retain the same startup result"
        );
        assert!(
            clean_restart.previous_clean_for_session("reloaded-page") == Some(false),
            "a later webview session in the running native process is unclean"
        );
        assert_eq!(
            store
                .get_view_state(NATIVE_SHUTDOWN_KEY)
                .expect("re-armed state"),
            Some("false".into())
        );
        drop(store);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn window_token_is_one_shot_and_scoped() {
        let guard = LifecycleGuard::new();
        guard.approve_window("main");
        assert!(guard.take_window("main"));
        assert!(!guard.take_window("main"));
        assert!(!guard.take_window("other"));
    }

    #[test]
    fn window_tokens_are_per_label() {
        let guard = LifecycleGuard::new();
        guard.approve_window("main");
        guard.approve_window("panels");
        assert!(guard.take_window("panels"));
        assert!(guard.take_window("main"));
        assert!(!guard.take_window("panels"));
    }

    #[test]
    fn exit_token_is_one_shot() {
        let guard = LifecycleGuard::new();
        assert!(!guard.take_exit());
        guard.approve_exit();
        assert!(guard.take_exit());
        assert!(!guard.take_exit());
    }

    #[test]
    fn unknown_labels_are_never_approved() {
        let guard = LifecycleGuard::new();
        assert!(!guard.take_window("main"));
        assert!(!guard.take_exit());
    }
}
