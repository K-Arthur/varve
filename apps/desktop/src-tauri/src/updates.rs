//! Native update capability detection.
//!
//! The frontend is not allowed to infer package authority from `linux` or
//! from a filename. This command reports only normalized capability metadata;
//! it never accepts an executable path and never performs installation.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePackagingContext {
    platform: &'static str,
    architecture: &'static str,
    package_type: &'static str,
    current_version: String,
    channel: &'static str,
    update_authority: &'static str,
    install_location: &'static str,
    runtime_supported: bool,
    build_label: String,
}

#[tauri::command]
pub fn update_packaging_context(app: AppHandle) -> UpdatePackagingContext {
    let version = app.package_info().version.to_string();
    let architecture = architecture();
    let channel = channel();
    let (platform, package_type, authority, location, supported) = detect_runtime();
    let build_label = format!("{architecture} {}", package_label(package_type));
    UpdatePackagingContext {
        platform,
        architecture,
        package_type,
        current_version: version,
        channel,
        update_authority: authority,
        install_location: location,
        runtime_supported: supported,
        build_label,
    }
}

fn architecture() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "x86" => "i686",
        "arm" => "armv7",
        _ => "unknown",
    }
}

fn channel() -> &'static str {
    let configured = option_env!("VARVE_UPDATE_CHANNEL")
        .map(str::to_owned)
        .or_else(|| std::env::var("VARVE_UPDATE_CHANNEL").ok());
    match configured.as_deref() {
        Some("beta") => "beta",
        Some("nightly") => "nightly",
        _ => "stable",
    }
}

#[cfg(target_os = "linux")]
fn detect_runtime() -> (&'static str, &'static str, &'static str, &'static str, bool) {
    if cfg!(debug_assertions) {
        return ("linux", "unknown", "development-build", "unknown", false);
    }

    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        let path = PathBuf::from(appimage);
        let (location, supported) = appimage_capability(&path);
        return ("linux", "appimage", "self-managed", location, supported);
    }

    // A release executable installed under the conventional system prefixes is
    // treated as package-manager managed. An extracted/manual binary outside
    // those prefixes remains manual-only; neither path gets self-replacement.
    let package_managed = std::env::current_exe()
        .ok()
        .map(|path| path.starts_with("/usr/") || path.starts_with("/opt/"))
        .unwrap_or(false);
    if package_managed {
        (
            "linux",
            "unknown",
            "package-manager-managed",
            "unknown",
            false,
        )
    } else {
        ("linux", "unknown", "manual-only", "unknown", false)
    }
}

#[cfg(target_os = "windows")]
fn detect_runtime() -> (&'static str, &'static str, &'static str, &'static str, bool) {
    if cfg!(debug_assertions) {
        return ("windows", "unknown", "development-build", "unknown", false);
    }
    ("windows", "nsis", "self-managed", "unknown", true)
}

#[cfg(target_os = "macos")]
fn detect_runtime() -> (&'static str, &'static str, &'static str, &'static str, bool) {
    if cfg!(debug_assertions) {
        return ("darwin", "unknown", "development-build", "unknown", false);
    }
    let Some(executable) = std::env::current_exe().ok() else {
        return ("darwin", "dmg-app", "manual-only", "unknown", false);
    };
    let app_bundle = executable
        .ancestors()
        .find(|candidate| candidate.extension().is_some_and(|ext| ext == "app"));
    let Some(app_bundle) = app_bundle else {
        return ("darwin", "dmg-app", "manual-only", "unknown", false);
    };
    let location = if directory_writable(app_bundle) {
        "writable"
    } else {
        "not-writable"
    };
    let authority = if location == "writable" {
        "self-managed"
    } else {
        "manual-only"
    };
    (
        "darwin",
        "dmg-app",
        authority,
        location,
        location == "writable",
    )
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn detect_runtime() -> (&'static str, &'static str, &'static str, &'static str, bool) {
    ("unknown", "unknown", "unsupported", "unknown", false)
}

fn package_label(package_type: &str) -> &'static str {
    match package_type {
        "appimage" => "AppImage",
        "deb" => "DEB",
        "rpm" => "RPM",
        "nsis" => "NSIS",
        "dmg-app" => "macOS app",
        _ => "build",
    }
}

fn appimage_capability(path: &Path) -> (&'static str, bool) {
    let Some(parent) = path.parent() else {
        return ("unknown", false);
    };
    let valid_file = path.is_file()
        && std::fs::metadata(path)
            .map(|m| m.len() > 0)
            .unwrap_or(false);
    let location = if directory_writable(parent) {
        "writable"
    } else {
        "not-writable"
    };
    (location, valid_file && location == "writable")
}

fn directory_writable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if metadata.permissions().readonly() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return metadata.permissions().mode() & 0o222 != 0;
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{appimage_capability, package_label};
    use std::fs;

    #[test]
    fn package_labels_are_not_os_labels() {
        assert_eq!(package_label("appimage"), "AppImage");
        assert_eq!(package_label("unknown"), "build");
    }

    #[test]
    fn appimage_requires_a_non_empty_file_and_writable_parent() {
        let root = std::env::temp_dir().join(format!("varve-updater-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create updater test directory");
        let appimage = root.join("Varve.AppImage");
        fs::write(&appimage, b"binary").expect("write updater test artifact");
        assert_eq!(appimage_capability(&appimage), ("writable", true));

        fs::write(&appimage, []).expect("truncate updater test artifact");
        assert_eq!(appimage_capability(&appimage), ("writable", false));
        fs::write(&appimage, b"binary").expect("restore updater test artifact");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o555))
                .expect("make updater test directory read-only");
            assert_eq!(appimage_capability(&appimage), ("not-writable", false));
            fs::set_permissions(&root, fs::Permissions::from_mode(0o755))
                .expect("restore updater test directory");
        }
        fs::remove_dir_all(&root).expect("remove updater test directory");
    }
}
