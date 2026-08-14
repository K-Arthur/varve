//! Bounded application-owned diagnostics log.
//!
//! All Varve diagnostics go to the Tauri-resolved app log directory — never
//! the current working directory. The log is a single file, rotated at a
//! fixed size with a small number of kept generations, so it cannot grow
//! without bound. Paths are redacted before they reach the log; the log is
//! display/diagnostics text, never filesystem identity.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

const LOG_FILE: &str = "varve.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const KEPT_GENERATIONS: u64 = 2;

/// Prepare the app-owned log directory. Safe to call once at startup; the
/// directory creation failure is non-fatal (logging degrades to nothing).
pub fn init(dir: &Path) {
    if std::fs::create_dir_all(dir).is_ok() {
        let _ = LOG_DIR.set(dir.to_owned());
    }
}

/// Append one line to the bounded log. Best effort: a failed write is
/// deliberately not surfaced to the caller (logging must never take down an
/// otherwise working save).
pub fn log_line(category: &str, message: &str) {
    let Some(dir) = LOG_DIR.get() else {
        return;
    };
    let path = dir.join(LOG_FILE);
    let timestamp = chrono::Utc::now().to_rfc3339();
    let line = format!("[{timestamp}] [{category}] {message}\n");
    rotate_if_needed(&path);
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Rotate the log before appending when it exceeds the bound. Renames
/// `varve.log` → `varve.1.log` → `varve.2.log`, dropping the oldest.
/// Generation files are identified by our own naming scheme, so rotation
/// never deletes files Varve cannot prove it owns.
fn rotate_if_needed(path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() < MAX_LOG_BYTES {
        return;
    }
    for generation in (1..KEPT_GENERATIONS).rev() {
        let current = path.with_extension(format!("{generation}.log"));
        let next = path.with_extension(format!("{}.log", generation + 1));
        if current.exists() {
            let _ = std::fs::rename(&current, &next);
        }
    }
    let first = path.with_extension("1.log");
    let _ = std::fs::rename(path, &first);
}

/// Replace known private path roots with placeholders for diagnostics. This
/// is best-effort redaction for logs and display text; it is never used for
/// filesystem identity or security decisions. It recognizes POSIX, Windows
/// drive, and UNC forms so a Windows log line never leaks `C:\Users\Name`.
pub fn redact_for_log(text: &str) -> String {
    let mut out = text.to_owned();
    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .and_then(|path| path.to_str().map(str::to_owned))
    {
        out = out.replace(&home, "<HOME>");
    }
    if let Some(dir) = LOG_DIR.get().and_then(|path| path.to_str().map(str::to_owned)) {
        out = out.replace(&dir, "<APP_LOG>");
    }
    let temp = std::env::temp_dir();
    if let Some(temp_text) = temp.to_str() {
        out = out.replace(temp_text, "<TEMP>");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{KEPT_GENERATIONS, MAX_LOG_BYTES, rotate_if_needed};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_log_dir() -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "varve_log_test_{}_{}",
            std::process::id(),
            n
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp log dir");
        dir
    }

    #[test]
    fn rotation_keeps_bounded_generations_and_never_removes_the_active_file() {
        let dir = temp_log_dir();
        let active = dir.join("varve.log");
        std::fs::write(&active, vec![b'x'; (MAX_LOG_BYTES + 16) as usize]).expect("seed log");

        rotate_if_needed(&active);

        assert!(!active.exists(), "oversized active log must be rotated away");
        assert!(dir.join("varve.1.log").exists(), "first generation kept");
        assert_eq!(dir.join("varve.1.log").metadata().unwrap().len(), MAX_LOG_BYTES + 16);
        assert!(!dir.join("varve.3.log").exists(), "generation beyond bound must not exist");
        assert_eq!(KEPT_GENERATIONS, 2);
    }

    #[test]
    fn redaction_covers_posix_windows_and_temp_forms() {
        // The fixture is built from the real environment so assertions hold
        // on any machine: redaction must replace the actual HOME and temp
        // roots wherever they appear.
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .expect("home set in test environment")
            .to_string_lossy()
            .into_owned();
        let temp = std::env::temp_dir().to_string_lossy().into_owned();
        let input = format!(r"opened {home}/docs/x.varve (staging in {temp})");
        let redacted = super::redact_for_log(&input);
        assert!(!redacted.contains(&home), "home leaked: {redacted}");
        assert!(redacted.contains("<HOME>"), "home placeholder missing: {redacted}");
        assert!(redacted.contains("<TEMP>"), "temp placeholder missing: {redacted}");

        // The Windows spelling of the user profile is only the native form on
        // Windows; there it must be replaced just like the POSIX spelling.
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = profile.to_string_lossy().into_owned();
            let windows_input = format!(r"panic at {profile}\Temp\y.varve");
            let windows_redacted = super::redact_for_log(&windows_input);
            assert!(
                !windows_redacted.contains(&profile),
                "windows profile leaked: {windows_redacted}"
            );
            assert!(
                windows_redacted.contains("<HOME>"),
                "windows placeholder missing: {windows_redacted}"
            );
        }
    }
}
