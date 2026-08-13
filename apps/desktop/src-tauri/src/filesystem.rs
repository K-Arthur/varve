//! The desktop filesystem boundary.
//!
//! This module is the one place where Varve decides where application-owned
//! data lives.  Callers keep the returned values as `PathBuf`s and only turn
//! them into display text at the UI/diagnostics boundary.

use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Stable logical categories used by the application storage policy.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FsErrorKind {
    NotFound,
    AlreadyExists,
    NotAFile,
    NotADirectory,
    PermissionDenied,
    ReadOnly,
    DiskFull,
    InvalidPath,
    InvalidFilename,
    PathTooLong,
    TraversalBlocked,
    NetworkUnavailable,
    VolumeDisconnected,
    IoError,
}

/// Native error details retained for diagnostics without making callers parse
/// platform-specific English messages.
#[derive(Debug, Clone, Serialize)]
pub struct FsError {
    pub kind: FsErrorKind,
    pub message: String,
}

impl FsError {
    pub fn new(kind: FsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn from_io(operation: &str, path: &Path, error: &io::Error) -> Self {
        let kind = match error.kind() {
            io::ErrorKind::NotFound => FsErrorKind::NotFound,
            io::ErrorKind::AlreadyExists => FsErrorKind::AlreadyExists,
            io::ErrorKind::PermissionDenied => FsErrorKind::PermissionDenied,
            io::ErrorKind::InvalidInput | io::ErrorKind::InvalidFilename => {
                FsErrorKind::InvalidPath
            }
            io::ErrorKind::ReadOnlyFilesystem => FsErrorKind::ReadOnly,
            io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => FsErrorKind::DiskFull,
            io::ErrorKind::FileTooLarge => FsErrorKind::PathTooLong,
            _ => FsErrorKind::IoError,
        };
        Self::new(kind, format!("{operation} {}: {error}", display_path(path)))
    }
}

/// All mutable locations owned by Varve.  The roots come from Tauri's current
/// platform resolver; the child paths are policy, not OS-specific guesses.
#[derive(Debug, Clone)]
pub struct AppDirectories {
    pub data: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
    pub state: PathBuf,
    #[allow(dead_code)]
    pub temporary: PathBuf,
    #[allow(dead_code)]
    pub resources: PathBuf,
    pub fonts: PathBuf,
    pub models: PathBuf,
    pub recovery: PathBuf,
    pub crash_reports: PathBuf,
    pub logs: PathBuf,
    pub thumbnails: PathBuf,
    pub staging: PathBuf,
}

impl AppDirectories {
    pub fn resolve(app: &AppHandle) -> Result<Self, FsError> {
        let path = app.path();
        let data = resolve(path.app_data_dir(), "application data")?;
        let config = resolve(path.app_config_dir(), "configuration")?;
        let cache = resolve(path.app_cache_dir(), "cache")?;
        let state = resolve(path.app_local_data_dir(), "application state")?;
        let temporary = resolve(path.temp_dir(), "temporary storage")?.join("varve");
        let resources = resolve(path.resource_dir(), "packaged resources")?;

        Ok(Self {
            fonts: data.join("fonts"),
            models: data.join("models"),
            recovery: state.join("recovery"),
            crash_reports: state.join("crash-reports"),
            logs: resolve(path.app_log_dir(), "logs")?,
            thumbnails: cache.join("thumbnails"),
            staging: cache.join("staging"),
            data,
            config,
            cache,
            state,
            temporary,
            resources,
        })
    }

    /// Create only application-owned roots. Resources are intentionally never
    /// created or written by this service.
    pub fn ensure_mutable_roots(&self) -> Result<(), FsError> {
        for root in [
            &self.data,
            &self.config,
            &self.cache,
            &self.state,
            &self.fonts,
            &self.models,
            &self.recovery,
            &self.crash_reports,
            &self.logs,
            &self.thumbnails,
            &self.staging,
        ] {
            std::fs::create_dir_all(root)
                .map_err(|error| FsError::from_io("create directory", root, &error))?;
        }
        Ok(())
    }
}

fn resolve(result: Result<PathBuf, tauri::Error>, label: &str) -> Result<PathBuf, FsError> {
    result.map_err(|error| FsError::new(FsErrorKind::InvalidPath, format!("resolve {label}: {error}")))
}

/// Storage keys are generated identifiers, not paths.  Keeping this check at
/// the boundary prevents model/cache commands from turning `join` into an
/// arbitrary filesystem operation.
pub fn validate_storage_key(value: &str) -> Result<(), FsError> {
    if value.is_empty() || value.len() > 160 || value == "." || value == ".." {
        return Err(FsError::new(FsErrorKind::InvalidFilename, "invalid storage key"));
    }
    if value.contains('/')
        || value.contains('\\')
        || value.contains('\0')
        || value.chars().any(|character| character.is_control())
    {
        return Err(FsError::new(FsErrorKind::TraversalBlocked, "storage key is not a filename"));
    }
    Ok(())
}

/// Validate a document/export logical relative path without asking the host
/// `Path` parser to interpret Windows syntax on Unix (or vice versa).
pub fn validate_portable_relative_path(value: &str) -> Result<Vec<&str>, FsError> {
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || (value.len() >= 2 && value.as_bytes()[1] == b':')
        || value.contains('\\')
        || value.contains('\0')
    {
        return Err(FsError::new(
            FsErrorKind::InvalidPath,
            "path is not a portable relative path",
        ));
    }
    let components = value.split('/').collect::<Vec<_>>();
    if components
        .iter()
        .any(|component| component.is_empty() || *component == "." || *component == "..")
    {
        return Err(FsError::new(
            FsErrorKind::TraversalBlocked,
            "portable path contains an invalid component",
        ));
    }
    Ok(components)
}

/// Generate a cross-platform filename for data Varve creates itself.  User
/// selected filenames are never passed through this function.
pub fn generated_filename(stem: &str, extension: &str) -> String {
    let mut value = stem
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>();
    while value.ends_with('.') || value.ends_with(' ') {
        value.pop();
    }
    if value.is_empty() || value == "." || value == ".." {
        value = "untitled".to_owned();
    }
    let reserved = value
        .split_once('.')
        .map(|(base, _)| base)
        .unwrap_or(&value)
        .to_ascii_uppercase();
    if matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (reserved.len() == 4
            && (reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.as_bytes()[3].is_ascii_digit())
    {
        value.insert(0, '_');
    }
    let extension = extension.trim_start_matches('.');
    if extension.is_empty() {
        value
    } else {
        format!("{value}.{extension}")
    }
}

/// Diagnostics-only path rendering.  It is intentionally lossy and must not
/// be used for filesystem identity or security checks.
pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{generated_filename, validate_storage_key};

    #[test]
    fn generated_names_handle_windows_reserved_names_and_suffixes() {
        assert_eq!(generated_filename("CON", "json"), "_CON.json");
        assert_eq!(generated_filename("name. ", ".varve"), "name.varve");
        assert_eq!(generated_filename("design:final", "png"), "design_final.png");
        assert_eq!(generated_filename("设计 🎨", "varve"), "设计 🎨.varve");
    }

    #[test]
    fn generated_names_have_a_safe_fallback() {
        assert_eq!(generated_filename("..", "tmp"), "untitled.tmp");
        assert_eq!(generated_filename("***", ""), "___");
    }

    #[test]
    fn storage_keys_are_not_paths() {
        assert!(validate_storage_key("model-id").is_ok());
        assert!(validate_storage_key("../outside").is_err());
        assert!(validate_storage_key(r"..\outside").is_err());
        assert!(validate_storage_key("C:relative").is_ok());
    }

    #[test]
    fn portable_relative_paths_reject_host_absolute_and_traversal_forms() {
        for value in [
            "../secret",
            r"..\secret",
            "/absolute/file",
            r"C:\absolute\file",
            r"\\server\share\file",
            r"\\?\C:\path\file",
            "file:///etc/passwd",
        ] {
            assert!(validate_portable_relative_path(value).is_err(), "accepted {value:?}");
        }
        assert!(validate_portable_relative_path("assets/%2e%2e/file.png").is_ok());
        assert!(validate_portable_relative_path("assets/设计/file.png").is_ok());
    }
}
