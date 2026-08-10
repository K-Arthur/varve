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

use tauri::{AppHandle, Emitter, Manager, RunEvent, Wry, Window, WindowEvent};

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
pub fn approve_exit(app: AppHandle<Wry>) {
    if let Some(guard) = app.try_state::<LifecycleGuard>() {
        guard.approve_exit();
    }
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

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
