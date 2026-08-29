//! Privacy-first native crash capture and report filesystem (see
//! `docs/crash-reporting/README.md`).
//!
//! Two responsibilities:
//!
//! 1. A panic hook that writes a minimal emergency record when a native
//!    thread panics and the process is about to die. The record is a tiny
//!    JSON envelope written atomically to `<app_data>/crash-reports/`; the
//!    webview picks it up on the next launch, redacts it (a second time),
//!    queues it, and honors the consent gate before anything could leave
//!    the device. If the webview is dead, nothing else happens — the
//!    record just waits.
//!
//! 2. A sandboxed report filesystem (`crash_write_report` etc.) used by the
//!    frontend queue on desktop: restrictive permissions, atomic writes,
//!    random opaque filenames, and path-traversal guards.
//!
//! Constraints honored here: no large allocations in the panic path, no
//! locks that are likely held, no network, no panics inside the hook (a
//! panicking panic hook aborts the process), bounded record size, and
//! failure-safe disk access (a full disk or missing dir just drops the
//! record — the process is dying anyway).

use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Subdirectory of the app data dir that holds crash reports.
const EMERGENCY_PREFIX: &str = "emergency-";
const MAX_REPORT_BYTES: u64 = 300 * 1024;
const MAX_REPORT_NAME_LEN: usize = 96;

static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Installs the process panic hook and creates the report directory.
/// Must be called once, from `setup`, after the Tauri directory resolver has
/// supplied the app-owned crash root.
pub fn install(report_dir: &Path) {
    let dir = report_dir.to_owned();
    let _ = fs::create_dir_all(&dir);
    // Restrictive permissions on the report directory itself (unix).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let _ = CRASH_DIR.set(dir);
    std::panic::set_hook(Box::new(write_emergency_record));
}

/// Minimal sanitization for the panic payload. Removes the parts of
/// `std::panic::Location` that can carry filesystem layout (the full path
/// of a source file); the basename and line/column survive for triage.
fn sanitize_panic_payload(payload: &str) -> String {
    let mut out = String::with_capacity(payload.len().min(512));
    let mut rest = payload;
    while !rest.is_empty() {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let (token, tail) = rest.split_at(end);
        if looks_like_absolute_native_path(token) {
            out.push_str(&redact_native_path_token(token));
        } else {
            out.push_str(token);
        }
        rest = tail;
        if let Some(character) = rest.chars().next() {
            out.push(character);
            rest = &rest[character.len_utf8()..];
        }
    }
    out
}

fn looks_like_absolute_native_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with('/')
        || value.starts_with("\\\\")
        || (bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'/' || bytes[2] == b'\\'))
}

fn redact_native_path_token(value: &str) -> String {
    let trimmed = value.trim_end_matches(|character| character == ')' || character == ',');
    let basename = trimmed
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or(trimmed);
    if basename.is_empty() {
        "<path>".to_owned()
    } else {
        format!("…/{basename}")
    }
}

fn write_emergency_record(info: &std::panic::PanicHookInfo<'_>) {
    // Resolve the dir once; if installation failed there is nowhere to
    // write and nothing more to do.
    let Some(dir) = CRASH_DIR.get() else {
        return;
    };
    let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
        sanitize_panic_payload(s)
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        sanitize_panic_payload(s)
    } else {
        "unknown panic payload".to_string()
    };
    let (file, line) = match info.location() {
        Some(loc) => (
            loc.file()
                .rsplit(|character| character == '/' || character == '\\')
                .next()
                .unwrap_or(loc.file()),
            loc.line(),
        ),
        None => ("unknown", 0u32),
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let thread = std::thread::current();
    let thread_name = thread.name().unwrap_or("unnamed").to_string();
    let record = json!({
        "schemaVersion": 1,
        "reportId": format!("r-emergency-{now_ms}-{}", std::process::id()),
        "sessionId": format!("s-emergency-{}", std::process::id()),
        "createdAt": now_ms,
        "kind": "emergency-record",
        "crash": {
            "type": "rust-panic",
            "category": "native-panic",
            "subsystem": "native",
            "message": payload,
            "threadCategory": "native",
            "reason": format!("panicked at {file}:{line}"),
        },
        "release": {
            "appVersion": env!("CARGO_PKG_VERSION"),
            "buildChannel": "production",
            "releaseId": env!("CARGO_PKG_VERSION"),
            "documentSchemaVersion": 0,
        },
        "runtime": {
            "runtime": "tauri",
            "osFamily": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "memoryPressure": "unknown",
            "rendererBackend": "unknown",
        },
        "threadName": thread_name,
    });

    // Bounded, atomic, failure-safe: any error here is ignored — the
    // process is about to abort.
    let name = format!("{EMERGENCY_PREFIX}{now_ms}-{}.json", std::process::id());
    let target = dir.join(&name);
    let temp = dir.join(format!(".{name}.tmp"));
    let mut out = match fs::File::create(&temp) {
        Ok(f) => f,
        Err(_) => return,
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = out.set_permissions(fs::Permissions::from_mode(0o600));
    }
    if out.write_all(record.to_string().as_bytes()).is_err() {
        let _ = fs::remove_file(&temp);
        return;
    }
    if out.sync_all().is_err() {
        let _ = fs::remove_file(&temp);
        return;
    }
    drop(out);
    if fs::rename(&temp, &target).is_err() {
        let _ = fs::remove_file(&temp);
    }
}

/// Validates an untrusted report filename: opaque random ids only, no path
/// separators, no traversal, bounded length.
fn sanitize_report_name(name: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > MAX_REPORT_NAME_LEN {
        return Err("invalid report name".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.starts_with('.') {
        return Err("invalid report name".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("invalid report name".to_string());
    }
    Ok(name.to_string())
}

fn report_dir() -> Result<PathBuf, String> {
    CRASH_DIR
        .get()
        .cloned()
        .ok_or_else(|| "crash reporting not initialized".to_string())
}

/// Writes a report atomically with restrictive permissions.
#[tauri::command]
pub fn crash_write_report(name: String, content: String) -> Result<(), String> {
    let name = sanitize_report_name(&name)?;
    if content.len() as u64 > MAX_REPORT_BYTES {
        return Err("report exceeds size limit".to_string());
    }
    let dir = report_dir()?;
    let target = dir.join(&name);
    if target.exists() {
        return Err("report already exists".to_string());
    }
    let temp = dir.join(format!(".{name}.tmp"));
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&temp, &target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn crash_list_reports() -> Result<Vec<String>, String> {
    let dir = report_dir()?;
    let mut names: Vec<String> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") && !name.starts_with('.') {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn crash_read_report(name: String) -> Result<String, String> {
    let name = sanitize_report_name(&name)?;
    let dir = report_dir()?;
    let path = dir.join(&name);
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_REPORT_BYTES {
        return Err("report exceeds size limit".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn crash_delete_report(name: String) -> Result<(), String> {
    let name = sanitize_report_name(&name)?;
    let dir = report_dir()?;
    let path = dir.join(&name);
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_report_name_rejects_traversal() {
        assert!(sanitize_report_name("a/b.json").is_err());
        assert!(sanitize_report_name("..\\x.json").is_err());
        assert!(sanitize_report_name("../../etc/passwd").is_err());
        assert!(sanitize_report_name(".hidden.json").is_err());
        assert!(sanitize_report_name("a b.json").is_err());
        assert!(sanitize_report_name("x".repeat(97).as_str()).is_err());
        assert!(sanitize_report_name("r-abc123.json").is_ok());
        assert!(sanitize_report_name("emergency-1754300000000-1234.json").is_ok());
    }

    #[test]
    fn sanitize_panic_payload_strips_paths() {
        let input = "called `Option::unwrap()` on a `None` value at /home/alice/dev/varve/crates/varve-core/src/lib.rs:42:13";
        let out = sanitize_panic_payload(input);
        assert!(!out.contains("/home/alice"));
        assert!(out.contains("lib.rs"));
    }

    #[test]
    fn sanitize_panic_payload_strips_windows_drive_unc_and_extended_paths() {
        for input in [
            r"panic at C:\Users\Alice\Documents\client\main.rs:12:4",
            r"panic at D:\Projects\设计\main.rs:12:4",
            r"panic at \\server\share\Alice\main.rs:12:4",
            r"panic at \\?\C:\Users\Alice\Temp\main.rs:12:4",
        ] {
            let out = sanitize_panic_payload(input);
            assert!(!out.contains("Alice"), "private component leaked: {out}");
            assert!(!out.contains("C:\\"), "drive path leaked: {out}");
            assert!(out.contains("main.rs"), "useful basename was lost: {out}");
        }
    }
}
