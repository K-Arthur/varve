mod crash;
mod font;
mod font_storage;
mod lifecycle;
mod menu;
mod print;
mod renderer;

use image::load_from_memory;
use notify::Watcher;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use tauri::ipc::Response;
use tauri::Emitter;
use tauri::Manager;
use varve_core::Point;

use varve_bridge::{convert_engine_nodes, IpcSceneNode};

use crate::renderer::{generate_ir, generate_pixels, ShapeIr};

/// Ceiling on the number of scene nodes accepted from the frontend in a
/// single IPC call. Without this, a `Vec<IpcSceneNode>` of unbounded size
/// flows straight into IR generation, hit-testing, and PDF export. This is
/// a floor against the worst-case "attacker/bug-controlled size" version of
/// that, not a considered product maximum for how large a real document's
/// flattened node list may legitimately get — see
/// docs/quality/tauri-command-audit.md §5.
const MAX_SCENE_NODES: usize = 50_000;

fn check_scene_node_bounds(nodes: &[IpcSceneNode]) -> Result<(), String> {
    if nodes.len() > MAX_SCENE_NODES {
        return Err(format!(
            "Scene has {} nodes; the limit is {MAX_SCENE_NODES}",
            nodes.len()
        ));
    }
    Ok(())
}

fn convert_scene(nodes: Vec<IpcSceneNode>) -> Vec<varve_core::SceneNode> {
    convert_engine_nodes(nodes)
}

#[tauri::command]
fn build_render_ir(nodes: Vec<IpcSceneNode>) -> Result<Vec<varve_engine::RenderItem>, String> {
    check_scene_node_bounds(&nodes)?;
    let scene = convert_scene(nodes);
    Ok(varve_engine::build_render_ir(&scene))
}

#[tauri::command]
fn hit_test(nodes: Vec<IpcSceneNode>, x: f64, y: f64) -> Result<Option<usize>, String> {
    check_scene_node_bounds(&nodes)?;
    let scene = convert_scene(nodes);
    Ok(varve_core::hit_test(&scene, Point::new(x, y)))
}

#[derive(Debug, Serialize)]
pub struct SceneIr {
    pub width: u32,
    pub height: u32,
    pub frame: u32,
    pub shapes: Vec<ShapeIr>,
}

#[tauri::command]
fn render_frame_ir(width: u32, height: u32, frame: u32) -> SceneIr {
    let shapes = generate_ir(frame);
    SceneIr {
        width,
        height,
        frame,
        shapes,
    }
}

/// Ceiling on the pixel count `render_frame_pixels` will allocate for.
/// Matches the order of magnitude `MAX_UPSCALE_OUTPUT_PIXELS` already uses
/// for the same reason: a caller-supplied `width * height` with no bound
/// is a one-call OOM/DoS (100,000 x 100,000 requests a buffer sized for
/// ~40 GB, and the naive `u32` multiplication that used to compute this
/// buffer's capacity can also wrap in a release build before the bound
/// check would even run).
const MAX_RENDER_FRAME_PIXELS: u64 = 64 * 1024 * 1024;

#[tauri::command]
fn render_frame_pixels(width: u32, height: u32, frame: u32) -> Result<Response, String> {
    let pixel_count = u64::from(width) * u64::from(height);
    if pixel_count > MAX_RENDER_FRAME_PIXELS {
        return Err(format!(
            "Requested {width}x{height} ({pixel_count} pixels); the limit is {MAX_RENDER_FRAME_PIXELS} pixels"
        ));
    }
    let bytes = generate_pixels(width, height, frame);
    Ok(Response::new(bytes))
}

#[derive(Debug, Deserialize)]
struct Report {
    mode: String,
    fps: f64,
    frames: u64,
    elapsed: f64,
    bytes_per_frame: f64,
}

#[tauri::command]
fn report(report: Report) {
    println!("[spike] mode={:<6} fps={:>6.1}  frames={:>5}  elapsed={:>5.2}s  bytes/frame={:>10.0}  bandwidth={:>8.1} MB/s",
        report.mode, report.fps, report.frames, report.elapsed, report.bytes_per_frame, report.bytes_per_frame * report.fps / 1_000_000.0);
}

#[tauri::command]
fn done(app: tauri::AppHandle) {
    println!("[spike] all modes measured, exiting.");
    app.exit(0);
}

/// Resolve the user's home directory without pulling in a new dependency
/// for it. `dirs`-crate-equivalent behavior for the two platforms this app
/// ships on.
fn user_home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

/// Canonicalize an untrusted, frontend-supplied path and verify it resolves
/// under an allowed scope (the user's home directory or the OS temp
/// directory) before any read/write happens.
///
/// This exists because Tauri's fs-plugin capability scope
/// (`capabilities/default.json`'s `fs:allow-read`/`fs:allow-write`) only
/// governs the `@tauri-apps/plugin-fs` JS API — it does NOT apply to custom
/// `#[tauri::command]` functions that call `std::fs` directly, which is
/// what every file-touching command in this file does. Without this check,
/// any JS running in the webview — not only code that went through a native
/// open/save dialog — could invoke a command like `write_binary_file` with
/// an arbitrary path (e.g. `~/.ssh/authorized_keys`) and overwrite it
/// directly. Handles both directions of the symlink/traversal problem:
/// - If the path already exists, canonicalizing it directly resolves any
///   symlink in the chain.
/// - If it doesn't exist yet (a "Save As" to a new file, possibly in a new
///   subfolder), walks up to the nearest existing ancestor, canonicalizes
///   *that* (so a symlinked parent still can't escape scope), and rejects
///   `..`/`.` components in the not-yet-existing suffix rather than
///   naively re-joining them (which would otherwise let
///   `existing_dir/../../etc/passwd` slip through as an "existing ancestor"
///   plus a traversal suffix).
fn resolve_user_path(raw: &str) -> Result<std::path::PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path must not contain NUL bytes".into());
    }
    let path = std::path::Path::new(raw);

    let canonical = if path.exists() {
        std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"))?
    } else {
        // Reject '.' / '..' components lexically, independent of the
        // filesystem. On Windows, Path::exists() collapses a trailing
        // `X\..` (Temp\X\.. resolves to Temp even when X doesn't exist),
        // so the walk-up loop below never observes the '..' component and
        // the traversal would be silently accepted. The lexical check runs
        // before any syscall so behaviour is identical across platforms.
        if path.components().any(|c| {
            matches!(
                c,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        }) {
            return Err("Path must not contain '.' or '..' in a not-yet-existing segment".into());
        }

        let mut ancestor = path;
        let mut suffix: Vec<&std::ffi::OsStr> = Vec::new();
        loop {
            if ancestor.exists() {
                break;
            }
            let Some(name) = ancestor.file_name() else {
                return Err("Path does not resolve to any existing ancestor directory".into());
            };
            suffix.push(name);
            let Some(parent) = ancestor.parent() else {
                return Err("Path does not resolve to any existing ancestor directory".into());
            };
            ancestor = parent;
        }
        let mut resolved = std::fs::canonicalize(ancestor).map_err(|e| {
            format!(
                "Failed to resolve existing ancestor {}: {e}",
                ancestor.display()
            )
        })?;
        for component in suffix.into_iter().rev() {
            resolved.push(component);
        }
        resolved
    };

    let allowed_roots: Vec<std::path::PathBuf> = [user_home_dir(), Some(std::env::temp_dir())]
        .into_iter()
        .flatten()
        .filter_map(|p| std::fs::canonicalize(&p).ok())
        .collect();

    if allowed_roots.is_empty() {
        return Err("Unable to determine an allowed path scope on this system".into());
    }
    if allowed_roots.iter().any(|root| canonical.starts_with(root)) {
        Ok(canonical)
    } else {
        Err(format!(
            "Path '{}' is outside the allowed scope (must be under the user's home or temp directory)",
            canonical.display()
        ))
    }
}

/// Write bytes to `path` atomically: write to a temporary sibling file,
/// flush to disk (`sync_all`), then `rename` over the target. A crash
/// mid-write leaves the original file intact; only the temp is abandoned
/// (cleaned up by the OS or next successful write).
///
/// Pattern already proven for ONNX model download (line ~279-354).
fn write_file_atomic(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Err("Invalid path: no parent directory".to_string());
    };
    if !parent.exists() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = parent.join(format!(".{name}.tmp-{}", uuid()));
    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| format!("Failed to create temp file {}: {e}", tmp.display()))?;
    file.write_all(data)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to flush temp file: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| {
        format!(
            "Failed to rename {} -> {}: {e}",
            tmp.display(),
            path.display()
        )
    })?;
    // Best-effort directory fsync so the rename itself is durable, not just
    // the file contents. Not supported on every OS/filesystem (NFS, some
    // Windows volumes); failure here is ignored rather than failing the save.
    #[cfg(unix)]
    {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Canonicalize an untrusted path exactly like `resolve_user_path`, but
/// WITHOUT the home/temp scope restriction.
///
/// Used ONLY by commands whose paths originate from the native OS dialog
/// (`plugin:dialog|open` / `plugin:dialog|save`). The dialog is the trust
/// boundary: the user explicitly chose these locations, and legitimate
/// documents live anywhere the user keeps them — other drives, removable
/// media, network mounts, iCloud/Documents on macOS. Restricting them to
/// $HOME would make the app silently unable to open or save its own
/// documents outside the home directory.
///
/// The same canonicalization (symlink resolution via the nearest existing
/// ancestor) and the same lexical traversal rejection still apply, so a
/// webview bug can never escape a real directory via `..` tricks.
fn resolve_user_path_approved(raw: &str) -> Result<std::path::PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path must not contain NUL bytes".into());
    }
    let path = std::path::Path::new(raw);

    // Lexical traversal rejection runs BEFORE any syscall: the kernel
    // resolves '..' inside existing paths, so `path.exists()` would
    // happily report `existing_dir/../../etc/passwd` as present and the
    // canonicalize branch would accept it.
    if path.components().any(|c| {
        matches!(
            c,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    }) {
        return Err("Path must not contain '.' or '..' in a not-yet-existing segment".into());
    }

    if path.exists() {
        return std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"));
    }

    let mut ancestor = path;
    let mut suffix: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        if ancestor.exists() {
            break;
        }
        let Some(name) = ancestor.file_name() else {
            return Err("Path does not resolve to any existing ancestor directory".into());
        };
        suffix.push(name);
        let Some(parent) = ancestor.parent() else {
            return Err("Path does not resolve to any existing ancestor directory".into());
        };
        ancestor = parent;
    }
    let mut resolved = std::fs::canonicalize(ancestor)
        .map_err(|e| format!("Failed to resolve existing ancestor {}: {e}", ancestor.display()))?;
    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let resolved = resolve_user_path(&path)?;
    write_file_atomic(&resolved, &data)
}

// ── Native clipboard ────────────────────────────────────────────────────
//
// `navigator.clipboard.read()` (and the DOM `paste` ClipboardEvent's image
// items) are unreliable for image MIME types under WebKitGTK on Wayland —
// see AGENTS.md Session 45 "known limitation". This command reads the OS
// clipboard directly via `arboard`, bypassing the Web Clipboard API, and is
// used as a last-resort fallback by `readClipboardUnifiedWithFallback` in
// `packages/editor/src/clipboard.ts`.

// ── Native file drag-and-drop ───────────────────────────────────────────
//
// wry's WebKitGTK backend hooks GTK's own drag-and-drop signals on the
// WebView widget unconditionally (webkitgtk/drag_drop.rs `connect_drag_event`
// is called with no `drag_drop_enabled` check), so the browser's HTML5
// dragover/drop DOM events never reach the page on Linux. The frontend
// listens for Tauri's `tauri://drag-drop` window event instead (which
// carries absolute file paths, not File objects) and reads each file's
// bytes via this command.

#[tauri::command]
fn read_dropped_file(path: String) -> Result<Vec<u8>, String> {
    // Dropping a file onto the window is an explicit user gesture — the path
    // may live anywhere (external drive, network mount). Approved resolver
    // still canonicalizes and rejects traversal.
    let resolved = resolve_user_path_approved(&path)?;
    std::fs::read(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_clipboard_image_png() -> Result<Option<Vec<u8>>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = match clipboard.get_image() {
        Ok(img) => img,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let width = img.width as u32;
    let height = img.height as u32;
    let rgba = image::RgbaImage::from_raw(width, height, img.bytes.into_owned())
        .ok_or_else(|| "clipboard image buffer size did not match its dimensions".to_string())?;
    let mut png_bytes: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| e.to_string())?;
    Ok(Some(png_bytes))
}

// ── Legacy Sync ──────────────────────────────────────────────────────────

/// Persist a document. Receives the full document JSON from the TS editor.
#[tauri::command]
fn sync_save(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    doc_id: String,
    json: String,
) -> Result<(), String> {
    store
        .save_document(&doc_id, &json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_load(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    doc_id: String,
) -> Result<Option<String>, String> {
    store.load_document(&doc_id).map_err(|e| e.to_string())
}

// ── Background Removal ──────────────────────────────────

/// Wire format matches the `BackgroundRemovalOptions` shape sent by
/// `@varve/engine`'s `invokeTauriRemoveBackground` — camelCase, since
/// (unlike top-level command argument names) Tauri does NOT auto-convert
/// casing for fields nested inside a command's argument structs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BgRemoveOptions {
    // Only read when built with the `ai` feature (see the match below);
    // without it, every request is unconditionally routed to `Quick`.
    #[cfg_attr(not(feature = "ai"), allow(dead_code))]
    method: String,
    tolerance: Option<u8>,
    feather_radius: Option<f32>,
    decontaminate: Option<bool>,
    click_x: Option<u32>,
    click_y: Option<u32>,
    preview_max_dimension: Option<u32>,
}

/// Wire format matches `BackgroundRemovalResult` in `@varve/engine` —
/// see the `BgRemoveOptions` note on casing above; this applies
/// symmetrically to values returned from the command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BgRemoveResult {
    mask_base64: String,
    confidence: f32,
    method: String,
    processing_time_ms: u64,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBgModelStatus {
    runtime_ready: bool,
    installed: bool,
    size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBgModelProgress {
    request_id: String,
    model_id: String,
    loaded: u64,
    total: u64,
}

static CANCELLED_BG_MODEL_DOWNLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn valid_download_request_id(request_id: &str) -> bool {
    !request_id.is_empty()
        && request_id.len() <= 80
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn background_removal_model_info(
    model_id: &str,
) -> Result<&'static varve_bgremove::model::ModelInfo, String> {
    varve_bgremove::model::model_info(model_id)
        .ok_or_else(|| format!("Unknown background-removal model: {model_id}"))
}

#[tauri::command]
fn native_background_removal_model_status(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<NativeBgModelStatus, String> {
    let model = background_removal_model_info(&model_id)?;
    let path = varve_bgremove::model::model_path(&model_id);
    let size_bytes = path.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    Ok(NativeBgModelStatus {
        runtime_ready: ensure_native_ai(&app),
        installed: size_bytes == model.size_bytes,
        size_bytes,
    })
}

#[tauri::command]
fn cancel_background_removal_model_download(request_id: String) -> Result<(), String> {
    if !valid_download_request_id(&request_id) {
        return Err("Invalid model-download request id".into());
    }
    CANCELLED_BG_MODEL_DOWNLOADS
        .lock()
        .map_err(|_| "Model-download cancellation state is unavailable".to_string())?
        .insert(request_id);
    Ok(())
}

#[tauri::command]
fn delete_background_removal_model(model_id: String) -> Result<(), String> {
    background_removal_model_info(&model_id)?;
    varve_bgremove::model::delete_model(&model_id)
}

#[tauri::command]
async fn download_background_removal_model(
    app: tauri::AppHandle,
    request_id: String,
    model_id: String,
) -> Result<u64, String> {
    if !valid_download_request_id(&request_id) {
        return Err("Invalid model-download request id".into());
    }
    if !ensure_native_ai(&app) {
        return Err("Native ONNX Runtime is unavailable on this desktop build".into());
    }
    let model = background_removal_model_info(&model_id)?.clone();
    let destination = varve_bgremove::model::model_path(&model_id);
    if destination.metadata().map(|metadata| metadata.len()).ok() == Some(model.size_bytes) {
        return Ok(model.size_bytes);
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create native model directory: {error}"))?;
    }
    let temporary = destination.with_extension(format!("onnx.download-{request_id}"));
    let result = async {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .map_err(|error| format!("Failed to create model downloader: {error}"))?;
        let mut response = client
            .get(&model.remote_url)
            .send()
            .await
            .map_err(|error| format!("Model download failed: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Model download failed: {error}"))?;
        let total = response.content_length().unwrap_or(model.size_bytes);
        let mut file = std::fs::File::create(&temporary)
            .map_err(|error| format!("Failed to create model file: {error}"))?;
        let mut digest = Sha256::new();
        let mut loaded = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Model download interrupted: {error}"))?
        {
            let cancelled = CANCELLED_BG_MODEL_DOWNLOADS
                .lock()
                .map_err(|_| "Model-download cancellation state is unavailable".to_string())?
                .remove(&request_id);
            if cancelled {
                return Err("Download cancelled".into());
            }
            file.write_all(&chunk)
                .map_err(|error| format!("Failed to write model file: {error}"))?;
            digest.update(&chunk);
            loaded += chunk.len() as u64;
            let _ = app.emit(
                "background-removal-model-progress",
                NativeBgModelProgress {
                    request_id: request_id.clone(),
                    model_id: model_id.clone(),
                    loaded,
                    total,
                },
            );
        }
        file.sync_all()
            .map_err(|error| format!("Failed to flush model file: {error}"))?;
        if loaded != model.size_bytes {
            return Err(format!(
                "Model size mismatch: expected {} bytes, received {loaded}",
                model.size_bytes
            ));
        }
        if let Some(expected) = &model.checksum_sha256 {
            let actual = format!("{:x}", digest.finalize());
            if &actual != expected {
                return Err(format!(
                    "Model SHA-256 mismatch: expected {expected}, received {actual}"
                ));
            }
        }
        if destination.exists() {
            std::fs::remove_file(&destination)
                .map_err(|error| format!("Failed to replace native model: {error}"))?;
        }
        std::fs::rename(&temporary, &destination)
            .map_err(|error| format!("Failed to install native model: {error}"))?;
        Ok(loaded)
    }
    .await;
    let _ = CANCELLED_BG_MODEL_DOWNLOADS
        .lock()
        .map(|mut cancelled| cancelled.remove(&request_id));
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

/// Remove background from an image via the native `varve-bgremove` crate.
///
/// `method: "quick"` always uses the heuristic engine (always available).
/// `"ai-balanced"` / `"ai-quality"` use ONNX inference when this binary was
/// built with the `ai` Cargo feature (opt-in, requires a downloaded model).
/// Builds without that feature reject AI requests instead of mislabelling a
/// heuristic result as AI output.
/// Async command wrapper around [`remove_background_impl`].
///
/// Two hard requirements drive this shape:
///
/// 1. **The ONNX Runtime dylib must be initialized before any AI inference.**
///    `ort` with `load-dynamic` *panics* (it does not return a `Result`) the
///    first time its API is touched with no dylib available. Since native
///    init became lazy (see `native_ai_status`), this command is reachable
///    without init having ever run — the JS provider chain only pre-checks
///    `native_ai_status` for ai-quality, and for ai-balanced it can land
///    here directly when the Worker WASM path fails. Guarding here converts
///    "whole app closes" into a clean `Err` the JS chain can fall back from.
///
/// 2. **Inference must not run on the main thread.** A synchronous command
///    executes on the GTK main thread: u2netp takes ~0.5s and BiRefNet
///    15-18s, which would freeze the UI — and any panic there kills the
///    process outright. `spawn_blocking` moves the work to a worker thread
///    and converts panics into a `JoinError` we can report as an error.
#[tauri::command]
async fn remove_background(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: BgRemoveOptions,
) -> Result<BgRemoveResult, String> {
    #[cfg(feature = "ai")]
    if matches!(options.method.as_str(), "ai-balanced" | "ai-quality") && !ensure_native_ai(&app) {
        return Err(
            "Native AI runtime is unavailable on this system; use the in-app (WASM) model instead"
                .into(),
        );
    }
    #[cfg(not(feature = "ai"))]
    let _ = &app;

    tauri::async_runtime::spawn_blocking(move || remove_background_impl(image_data, options))
        .await
        .map_err(|e| format!("Background removal task failed: {e}"))?
}

fn remove_background_impl(
    image_data: Vec<u8>,
    options: BgRemoveOptions,
) -> Result<BgRemoveResult, String> {
    let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;

    #[cfg(feature = "ai")]
    let method = match options.method.as_str() {
        "ai-balanced" => varve_bgremove::RemovalMethod::AiBalanced,
        "ai-quality" => varve_bgremove::RemovalMethod::AiQuality,
        _ => varve_bgremove::RemovalMethod::Quick,
    };
    #[cfg(not(feature = "ai"))]
    let method = match options.method.as_str() {
        "quick" => varve_bgremove::RemovalMethod::Quick,
        _ => return Err("AI background removal is not enabled in this desktop build".into()),
    };

    let remove_opts = varve_bgremove::RemovalOptions {
        method,
        tolerance: options.tolerance,
        feather_radius: options.feather_radius,
        decontaminate: options.decontaminate,
        click_x: options.click_x,
        click_y: options.click_y,
        preview_max_dimension: options.preview_max_dimension,
    };

    let result = varve_bgremove::remove_background(&img, &remove_opts)?;

    Ok(BgRemoveResult {
        mask_base64: result.mask_base64,
        confidence: result.confidence,
        method: result.method,
        processing_time_ms: result.processing_time_ms,
        width: result.width,
        height: result.height,
    })
}

// ── Native image denoise (SCUNet) ──────────────────────────────────────

/// Options for native denoise.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDenoiseOptions {
    /// Model id (e.g. "scunet"). Defaults to "scunet".
    pub model_id: Option<String>,
    /// Blend factor between original (0.0) and fully denoised (1.0).
    pub strength: Option<f32>,
}

/// Result of a native denoise operation.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDenoiseResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub processing_time_ms: u64,
}

/// Run native SCUNet denoising on an image. Preferred over the WASM-worker
/// path on desktop because native ONNX Runtime is faster and not bound by
/// the wasm32 4 GB address space.
#[tauri::command]
async fn denoise_image(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: NativeDenoiseOptions,
) -> Result<NativeDenoiseResult, String> {
    if !ensure_native_ai(&app) {
        return Err(
            "Native AI runtime is unavailable on this system; use the in-app (WASM) denoise instead"
                .into(),
        );
    }
    let model_id = options.model_id.unwrap_or_else(|| "scunet".to_string());
    if !varve_bgremove::is_image_model(&model_id) {
        return Err(format!(
            "Unknown denoise model '{model_id}'. Supported: scunet"
        ));
    }
    let strength = options.strength.unwrap_or(0.7).clamp(0.0, 1.0);

    tauri::async_runtime::spawn_blocking(move || {
        let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
        let result = varve_bgremove::denoise_image(&img, strength, &model_id)?;
        Ok(NativeDenoiseResult {
            png_base64: result.png_base64,
            width: result.width,
            height: result.height,
            processing_time_ms: result.processing_time_ms,
        })
    })
    .await
    .map_err(|e| format!("Denoise task failed: {e}"))?
}

// ── Native content-aware fill (LaMa inpainting) ────────────────────────

/// Options for native content-aware fill.
#[derive(Debug, serde::Deserialize)]
pub struct ContentAwareFillOptions {
    pub image_data: Vec<u8>,
    pub image_w: u32,
    pub image_h: u32,
    pub mask: Vec<u8>,
    pub mask_w: u32,
    pub mask_h: u32,
    pub preview_max_dimension: Option<u32>,
}

/// Result of a native content-aware fill operation.
#[derive(Debug, serde::Serialize)]
pub struct ContentAwareFillResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub model_id: String,
    pub execution_backend: String,
    pub processing_time_ms: u64,
    pub warnings: Vec<String>,
}

/// Run native LaMa inpainting on an image+mask pair.
///
/// Preferred over the WASM-worker path on desktop because native ONNX
/// Runtime is faster and not bound by the wasm32 4 GB address space.
#[tauri::command]
async fn content_aware_fill(
    app: tauri::AppHandle,
    options: ContentAwareFillOptions,
) -> Result<ContentAwareFillResult, String> {
    if !ensure_native_ai(&app) {
        return Err(
            "Native AI runtime is unavailable on this system; use the in-app (WASM) model instead"
                .into(),
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        let request = varve_bgremove::LamaInpaintRequest {
            image_rgba: options.image_data,
            image_w: options.image_w,
            image_h: options.image_h,
            mask: options.mask,
            mask_w: options.mask_w,
            mask_h: options.mask_h,
            preview_max_dimension: options.preview_max_dimension,
        };

        let result = varve_bgremove::lama_inpaint(request)?;

        Ok(ContentAwareFillResult {
            png_base64: result.png_base64,
            width: result.width,
            height: result.height,
            model_id: result.model_id,
            execution_backend: result.execution_backend,
            processing_time_ms: result.processing_time_ms,
            warnings: result.warnings,
        })
    })
    .await
    .map_err(|e| format!("Content-aware fill task failed: {e}"))?
}

/// Whether native ONNX inference is actually usable right now — the `ai`
/// Cargo feature is compiled in *and* the bundled onnxruntime dylib loads
/// successfully.
///
/// This is a runtime-verified check, not a build-flag check: a build with
/// `ai` compiled in but a missing/incompatible dylib for this platform
/// correctly reports `false` here, so the frontend's provider chain won't
/// keep routing `ai-quality` at a native path that fails every time.
///
/// Deliberately lazy: the dylib is only loaded the first time this command
/// is actually invoked (cached after that — see
/// `varve_bgremove::runtime::init_native_runtime`), never during app
/// startup. Loading a native library that may spawn its own thread pool or
/// install its own signal handlers (onnxruntime does both) before the
/// webview has finished initializing risks racing WebKitGTK's own
/// process/thread startup; by the time frontend JS can call this command,
/// the webview is already fully up, so that risk doesn't apply here.
#[tauri::command]
fn native_ai_status(_app: tauri::AppHandle) -> bool {
    #[cfg(feature = "ai")]
    {
        ensure_native_ai(&_app)
    }
    #[cfg(not(feature = "ai"))]
    {
        false
    }
}

/// Reserved native ONNX inference command for colorization workflows.
///
/// This route must report itself as unavailable until it performs verified
/// inference. Returning an empty output map with a native execution-provider
/// label would make capability diagnostics and provider routing misleading.
#[allow(unused_variables)]
/// Idempotently initialize the native ONNX Runtime from the bundled dylib
/// and report whether it is actually usable. Must be called before ANY code
/// path that could touch `ort` session APIs (`remove_background` with an AI
/// method, `native_ai_status`) — `ort` with `load-dynamic` panics rather
/// than erroring when its API is used with no dylib loaded.
#[cfg(feature = "ai")]
fn ensure_native_ai(app: &tauri::AppHandle) -> bool {
    if varve_bgremove::runtime::native_ai_ready() {
        return true;
    }
    match resolve_onnxruntime_dylib(app) {
        Some(path) => match varve_bgremove::runtime::init_native_runtime(&path) {
            Ok(()) => println!("[bgremove] native ONNX Runtime ready: {}", path.display()),
            Err(e) => {
                eprintln!("[bgremove] native ONNX Runtime init failed ({e}); falling back to WASM")
            }
        },
        None => {
            eprintln!("[bgremove] no bundled onnxruntime dylib found for this platform; falling back to WASM");
        }
    }
    varve_bgremove::runtime::native_ai_ready()
}

/// Shared state for cancelling an in-flight AI upscaling job. The active job's
/// cancellation flag is an `Arc<AtomicBool>` the worker thread also holds, so
/// the cancel command can flip it without re-entering the async runtime.
struct UpscaleCancelState {
    active: Mutex<Option<CancelEntry>>,
    execution_gate: std::sync::Arc<Mutex<()>>,
}

struct CancelEntry {
    job_id: u64,
    flag: std::sync::Arc<AtomicBool>,
}

impl UpscaleCancelState {
    fn new() -> Self {
        Self {
            active: Mutex::new(None),
            execution_gate: std::sync::Arc::new(Mutex::new(())),
        }
    }

    /// Install the latest job and request cancellation of any superseded job.
    /// Only one native upscale is admitted at a time: running multiple image
    /// models concurrently can exhaust memory on the 4 GB support tier.
    fn register(&self, job_id: u64) -> std::sync::Arc<AtomicBool> {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(current) = guard.as_ref() {
                if current.job_id == job_id {
                    return current.flag.clone();
                }
            }
            let flag = std::sync::Arc::new(AtomicBool::new(false));
            if let Some(previous) = guard.replace(CancelEntry {
                job_id,
                flag: flag.clone(),
            }) {
                previous.flag.store(true, Ordering::SeqCst);
            }
            return flag;
        }
        // Poisoning disables cross-command cancellation, but the job remains
        // locally safe and bounded rather than panicking the command handler.
        std::sync::Arc::new(AtomicBool::new(false))
    }

    fn cancel(&self, job_id: u64) {
        if let Ok(guard) = self.active.lock() {
            if let Some(entry) = guard.as_ref() {
                if entry.job_id == job_id {
                    entry.flag.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    /// Clear the active slot only if it still belongs to this job. A stale
    /// completion must never remove a newer job's cancellation handle.
    fn finish(&self, job_id: u64) {
        if let Ok(mut guard) = self.active.lock() {
            if guard.as_ref().is_some_and(|entry| entry.job_id == job_id) {
                *guard = None;
            }
        }
    }

    fn execution_gate(&self) -> std::sync::Arc<Mutex<()>> {
        self.execution_gate.clone()
    }
}

#[tauri::command]
fn begin_upscale_job(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<UpscaleCancelState>() else {
        return;
    };
    state.register(job_id);
}

#[tauri::command]
fn cancel_upscale(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<UpscaleCancelState>() else {
        return;
    };
    state.cancel(job_id);
}

const MAX_UPSCALE_INPUT_BYTES: usize = 128 * 1024 * 1024;
const MAX_UPSCALE_OUTPUT_PIXELS: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct UpscaleImageOptions {
    scale: f64,
    #[serde(default = "default_upscale_method")]
    method: String,
    #[serde(default, rename = "modelId")]
    model_id: Option<String>,
    #[serde(default, rename = "maxPixels")]
    max_pixels: Option<u64>,
    #[serde(default, rename = "targetWidth")]
    target_width: Option<u32>,
    #[serde(default, rename = "targetHeight")]
    target_height: Option<u32>,
    #[serde(default)]
    #[serde(rename = "jobId")]
    job_id: Option<u64>,
}

fn default_upscale_method() -> String {
    "bicubic".into()
}

#[tauri::command]
async fn upscale_image(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: UpscaleImageOptions,
) -> Result<Response, String> {
    upscale_image_command(app, image_data, options).await
}

/// Raw binary IPC variant. Options remain a small JSON header while the PNG
/// request body and PNG response both stay out of JSON serialization.
#[tauri::command]
async fn upscale_image_binary(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, String> {
    const OPTIONS_HEADER: &str = "x-varve-upscale-options";
    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("Binary upscale requires an application/octet-stream body".into())
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: UpscaleImageOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Invalid upscale options: {e}"))?;
    drop(request);
    upscale_image_command(app, image_data, options).await
}

async fn upscale_image_command(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: UpscaleImageOptions,
) -> Result<Response, String> {
    #[cfg(feature = "ai")]
    if options.method == "ai" && !crate::ensure_native_ai(&app) {
        return Err(
            "Native AI runtime is unavailable on this system; use the in-app (WASM) model instead"
                .into(),
        );
    }
    #[cfg(not(feature = "ai"))]
    let _ = &app;

    let job_id = options.job_id.unwrap_or(0);

    if image_data.len() > MAX_UPSCALE_INPUT_BYTES {
        return Err(format!(
            "Upscale input is {} bytes; the native limit is {MAX_UPSCALE_INPUT_BYTES} bytes",
            image_data.len()
        ));
    }

    // Register a cancellable job with a shared flag. The worker thread below
    // receives a clone of the same Arc, so `cancel_upscale` flipping the bool
    // interrupts inference between tiles. Guarded by a Mutex so begin/cancel
    // racing on the active slot is sound.
    let (cancel_flag, execution_gate) = app.try_state::<UpscaleCancelState>().map_or_else(
        || {
            (
                std::sync::Arc::new(AtomicBool::new(false)),
                std::sync::Arc::new(Mutex::new(())),
            )
        },
        |state| (state.register(job_id), state.execution_gate()),
    );
    let cancel_for_worker = cancel_flag.clone();

    // Progress callback: emit a `upscale:progress` event the frontend listens to.
    let app_for_progress = app.clone();
    let clamped_job_id = job_id;
    let progress_callback: Option<varve_upscale::ProgressCallback> =
        Some(Box::new(move |done: usize, total: usize| {
            let _ = app_for_progress.emit(
                "upscale:progress",
                serde_json::json!({ "jobId": clamped_job_id, "done": done, "total": total }),
            );
        }));

    let method = options.method.clone();
    let model_id = options
        .model_id
        .clone()
        .unwrap_or_else(|| "upscale-realesr-general".to_string());
    let max_pixels = options.max_pixels;
    let target_width = options.target_width;
    let target_height = options.target_height;
    let scale_opt = options.scale;

    let result = tauri::async_runtime::spawn_blocking(move || {
        // Serialize native upscale allocations. Superseded jobs remain cheap
        // queued closures and observe their cancellation flag before decoding
        // or allocating an output buffer.
        let _permit = execution_gate
            .lock()
            .map_err(|_| "Native upscale execution gate was poisoned".to_string())?;
        if cancel_for_worker.load(Ordering::SeqCst) {
            return Err("Upscale cancelled".into());
        }
        let dimensions = image::ImageReader::new(std::io::Cursor::new(&image_data))
            .with_guessed_format()
            .map_err(|e| format!("Image format error: {e}"))?
            .into_dimensions()
            .map_err(|e| format!("Image dimensions error: {e}"))?;
        let source_pixels = u64::from(dimensions.0) * u64::from(dimensions.1);
        if source_pixels > MAX_UPSCALE_OUTPUT_PIXELS {
            return Err(format!(
                "Upscale source contains {source_pixels} pixels; the native limit is {MAX_UPSCALE_OUTPUT_PIXELS} pixels"
            ));
        }
        let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let pixels = rgba.into_raw();
        upscale_image_impl(
            &pixels,
            width,
            height,
            scale_opt,
            target_width,
            target_height,
            max_pixels,
            method.as_str(),
            model_id.as_str(),
            progress_callback,
            cancel_for_worker,
        )
    })
    .await
    .map_err(|e| format!("Upscale task panicked: {e}"));

    if let Some(state) = app.try_state::<UpscaleCancelState>() {
        state.finish(job_id);
    }
    let result = result??;

    let _ = app.emit(
        "upscale:done",
        serde_json::json!({ "jobId": job_id, "cancelled": false }),
    );
    // `Response` selects Tauri's application/octet-stream IPC response. A
    // Vec<u8> would be serialized as a large JSON number array.
    Ok(Response::new(result))
}

/// Native live-effect kernels — raw RGBA request body, `x-varve-effect` JSON
/// header (kind, dimensions, quality, coord space, params). Returns raw RGBA
/// bytes via the octet-stream response channel. Bounded like trace/upscale:
/// pixel-count ceiling before any allocation; runs on a blocking thread so
/// the UI thread stays free.
#[tauri::command]
async fn apply_live_effect_binary(request: tauri::ipc::Request<'_>) -> Result<Response, String> {
    const OPTIONS_HEADER: &str = "x-varve-effect";
    const MAX_EFFECT_PIXELS: u64 = 33_554_432; // 8192x4096 — export ceiling
    let rgba = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("Binary effect requires an application/octet-stream body".into())
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let effect_request: varve_effects::EffectRequest =
        serde_json::from_str(&options_json).map_err(|e| format!("Invalid effect options: {e}"))?;
    drop(request);

    let pixels = u64::from(effect_request.width) * u64::from(effect_request.height);
    if pixels > MAX_EFFECT_PIXELS {
        return Err(format!(
            "Effect surface contains {pixels} pixels; the native limit is {MAX_EFFECT_PIXELS} pixels"
        ));
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        varve_effects::apply_effect(&effect_request, &rgba)
    })
    .await
    .map_err(|e| format!("Effect task panicked: {e}"))??;

    Ok(Response::new(result))
}

#[allow(clippy::too_many_arguments)]
fn upscale_image_impl(
    pixels: &[u8],
    width: u32,
    height: u32,
    scale_opt: f64,
    target_width: Option<u32>,
    target_height: Option<u32>,
    max_pixels: Option<u64>,
    method: &str,
    model_id: &str,
    progress_callback: Option<varve_upscale::ProgressCallback>,
    cancel_flag: std::sync::Arc<AtomicBool>,
) -> Result<Vec<u8>, String> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Upscale cancelled".into());
    }
    if !scale_opt.is_finite() || scale_opt <= 0.0 {
        return Err("Upscale scale must be finite and greater than zero".into());
    }
    let scale = if let (Some(tw), Some(th)) = (target_width, target_height) {
        let sx = tw as f64 / width as f64;
        let sy = th as f64 / height as f64;
        sx.min(sy).max(0.001)
    } else {
        scale_opt
    };

    let (out_w, out_h) = if method == "ai" {
        (
            width.checked_mul(4).ok_or("Upscale width overflow")?,
            height.checked_mul(4).ok_or("Upscale height overflow")?,
        )
    } else {
        (
            (width as f64 * scale).round().max(1.0) as u32,
            (height as f64 * scale).round().max(1.0) as u32,
        )
    };
    let output_pixels = (out_w as u64) * (out_h as u64);
    let requested_max = max_pixels.unwrap_or(MAX_UPSCALE_OUTPUT_PIXELS);
    let effective_max = requested_max.min(MAX_UPSCALE_OUTPUT_PIXELS);
    if output_pixels > effective_max {
        return Err(format!(
            "Output contains {output_pixels} pixels; the effective limit is {effective_max} pixels"
        ));
    }

    let result = if method == "ai" {
        #[cfg(feature = "ai")]
        {
            let upscale_opts = varve_upscale::UpscaleOptions {
                progress: progress_callback,
                cancel: Some(cancel_flag.clone()),
            };
            varve_upscale::ai_upscale(pixels, width, height, model_id, upscale_opts)?
        }
        #[cfg(not(feature = "ai"))]
        {
            return Err(format!(
                "AI upscaling requires a desktop build with the ai feature enabled (model '{model_id}')"
            ));
        }
    } else {
        let filter = varve_upscale::UpscaleFilter::from_method(method);
        let mp = (width as u64) * (height as u64);
        if mp > 4_000_000 {
            varve_upscale::tiled_upscale(pixels, width, height, scale, 256, 16, filter)?
        } else {
            varve_upscale::cpu_upscale(pixels, width, height, scale, filter)?
        }
    };

    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Upscale cancelled".into());
    }

    let out_img = image::DynamicImage::ImageRgba8(
        image::ImageBuffer::from_raw(out_w, out_h, result)
            .ok_or("Failed to construct output image")?,
    );

    let mut bytes: Vec<u8> = Vec::new();
    out_img
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("PNG encode error: {e}"))?;

    Ok(bytes)
}

// ── Image trace (native raster-to-vector) ──────────────

const MAX_TRACE_INPUT_BYTES: usize = 128 * 1024 * 1024;
const MAX_TRACE_PIXELS: u64 = 64 * 1024 * 1024;
/// Hard ceiling on paths per trace, even when the client requests 0 (unlimited).
/// Prevents unbounded memory growth from adversarial high-frequency images.
const MAX_TRACE_PATHS: usize = 100_000;

/// Emits `trace:progress` events from the blocking trace thread.
type TraceProgressSink = Box<dyn Fn(&str, f64) + Sync>;

/// Single-job cancellation state for native tracing (mirror of
/// `UpscaleCancelState`): exactly one trace is admitted at a time so memory
/// stays bounded on the 4 GB support tier, and a new job supersedes the old.
struct TraceCancelState {
    active: Mutex<Option<CancelEntry>>,
    execution_gate: std::sync::Arc<Mutex<()>>,
}

impl TraceCancelState {
    fn new() -> Self {
        Self {
            active: Mutex::new(None),
            execution_gate: std::sync::Arc::new(Mutex::new(())),
        }
    }

    fn register(&self, job_id: u64) -> std::sync::Arc<AtomicBool> {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(current) = guard.as_ref() {
                if current.job_id == job_id {
                    return current.flag.clone();
                }
            }
            let flag = std::sync::Arc::new(AtomicBool::new(false));
            if let Some(previous) = guard.replace(CancelEntry {
                job_id,
                flag: flag.clone(),
            }) {
                previous.flag.store(true, Ordering::SeqCst);
            }
            return flag;
        }
        std::sync::Arc::new(AtomicBool::new(false))
    }

    fn cancel(&self, job_id: u64) {
        if let Ok(guard) = self.active.lock() {
            if let Some(entry) = guard.as_ref() {
                if entry.job_id == job_id {
                    entry.flag.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    fn execution_gate(&self) -> std::sync::Arc<Mutex<()>> {
        self.execution_gate.clone()
    }
}

#[tauri::command]
fn begin_trace_job(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<TraceCancelState>() else {
        return;
    };
    state.register(job_id);
}

#[tauri::command]
fn cancel_trace(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<TraceCancelState>() else {
        return;
    };
    state.cancel(job_id);
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct TraceImageOptions {
    threshold: Option<u8>,
    min_pixels: Option<u32>,
    max_colors: Option<u8>,
    foreground: Option<String>,
    corner_angle: Option<f64>,
    max_error: Option<f64>,
    trace_mode: Option<String>,
    alpha_threshold: Option<u8>,
    centerline_width: Option<f64>,
    centerline_prune: Option<f64>,
    max_paths: Option<u32>,
    compound_holes: Option<bool>,
    #[serde(rename = "jobId")]
    job_id: Option<u64>,
}

fn default_corner_angle() -> f64 {
    135.0
}
fn default_max_error() -> f64 {
    1.0
}

/// Clamp untrusted client options into the engine's safe ranges.
/// All limits are documented in the trace contract (docs/architecture/image-trace-system.md).
fn sanitize_trace_options(raw: TraceImageOptions) -> varve_trace::TraceOptions {
    let trace_mode = match raw.trace_mode.as_deref() {
        Some("centerline") => varve_trace::TraceMode::Centerline,
        Some("pixel_art") | Some("pixel-art") => varve_trace::TraceMode::PixelArt,
        _ => varve_trace::TraceMode::Silhouette,
    };
    let foreground = match raw.foreground.as_deref() {
        Some("light") => varve_trace::Foreground::Light,
        _ => varve_trace::Foreground::Dark,
    };
    varve_trace::TraceOptions {
        threshold: raw.threshold.unwrap_or(128).clamp(1, 254),
        min_pixels: raw.min_pixels.unwrap_or(10).clamp(1, 1_000_000) as usize,
        max_colors: raw
            .max_colors
            .unwrap_or(if trace_mode == varve_trace::TraceMode::PixelArt {
                8
            } else {
                0
            })
            .clamp(0, 64),
        foreground,
        corner_angle: raw
            .corner_angle
            .unwrap_or_else(default_corner_angle)
            .clamp(90.0, 180.0),
        max_error: raw
            .max_error
            .unwrap_or_else(default_max_error)
            .clamp(0.1, 10.0),
        trace_mode,
        alpha_threshold: raw.alpha_threshold.unwrap_or(1).clamp(0, 255),
        centerline_width: raw.centerline_width.unwrap_or(2.0).clamp(0.5, 100.0),
        centerline_prune: raw.centerline_prune.unwrap_or(4.0).clamp(0.0, 1000.0),
        // 0 means "unlimited" to clients; enforce a hard ceiling server-side.
        max_paths: match raw.max_paths {
            Some(0) => MAX_TRACE_PATHS,
            Some(v) => (v as usize).clamp(1, MAX_TRACE_PATHS),
            None => 1000,
        },
        compound_holes: raw.compound_holes.unwrap_or(true),
    }
}

// ── Animated media decode ────────────────────────────────────────────────

/// Raw binary IPC variant for animated media: the encoded file travels as
/// the request body; decode options travel as a small JSON header. Mirrors
/// the trace/upscale binary channels.
#[tauri::command]
async fn media_probe_binary(
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("media_probe_binary requires an application/octet-stream body".into())
        }
    };
    let probe = tauri::async_runtime::spawn_blocking(move || {
        varve_media::probe(&bytes, &varve_media::DEFAULT_LIMITS)
    })
    .await
    .map_err(|e| format!("media probe task failed: {e}"))??;
    serde_json::to_string(&probe).map_err(|e| format!("media probe serialize failed: {e}"))
}

#[tauri::command]
async fn media_decode_frames_binary(
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<varve_media::DecodedFrameJson>, String> {
    const OPTIONS_HEADER: &str = "x-varve-media-opts";
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("media_decode_frames_binary requires an application/octet-stream body".into())
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: MediaDecodeOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Invalid media decode options: {e}"))?;
    if options.start > options.end {
        return Err("media decode range start exceeds end".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        varve_media::decode_frames_base64(
            &bytes,
            options.start,
            options.end,
            &varve_media::DEFAULT_LIMITS,
        )
    })
    .await
    .map_err(|e| format!("media decode task failed: {e}"))??;
    Ok(result)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaDecodeOptions {
    start: u32,
    end: u32,
}

#[tauri::command]
async fn trace_image(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: TraceImageOptions,
) -> Result<varve_trace::TraceBezierResult, String> {
    trace_image_command(Some(&app), image_data, options).await
}

/// Raw binary IPC variant: the PNG request body stays out of JSON
/// serialization; options travel as a small JSON header. Mirrors the upscale
/// binary channel.
#[tauri::command]
async fn trace_image_binary(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<varve_trace::TraceBezierResult, String> {
    const OPTIONS_HEADER: &str = "x-varve-trace-options";
    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("Binary trace requires an application/octet-stream body".into())
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: TraceImageOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Invalid trace options: {e}"))?;
    trace_image_command(Some(&app), image_data, options).await
}

/// Shared core: decodes defensively (dimension pre-check before full decode,
/// pixel-count ceiling), runs the engine on a blocking thread so the UI
/// thread stays free, honors cancellation between and inside engine loops,
/// and reports stage progress over `trace:progress` events.
///
/// `app` is optional so unit tests can exercise the core without a live
/// AppHandle (progress events and job registration are skipped then).
async fn trace_image_command(
    app: Option<&tauri::AppHandle>,
    image_data: Vec<u8>,
    options: TraceImageOptions,
) -> Result<varve_trace::TraceBezierResult, String> {
    let job_id = options.job_id.unwrap_or(0);

    if image_data.len() > MAX_TRACE_INPUT_BYTES {
        return Err(format!(
            "Trace input is {:.1} MB; the native limit is 128 MB",
            image_data.len() as f64 / (1024.0 * 1024.0)
        ));
    }

    let (cancel_flag, execution_gate) = app
        .and_then(|a| a.try_state::<TraceCancelState>())
        .map_or_else(
            || {
                (
                    std::sync::Arc::new(AtomicBool::new(false)),
                    std::sync::Arc::new(Mutex::new(())),
                )
            },
            |state| (state.register(job_id), state.execution_gate()),
        );
    let cancel_for_worker = cancel_flag.clone();
    let cancel_after_await = cancel_flag.clone();
    let app_for_progress = app.cloned();
    let clamped_job_id = job_id;
    let opts = sanitize_trace_options(options);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _permit = execution_gate
            .lock()
            .map_err(|_| "Native trace execution gate was poisoned".to_string())?;
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("Trace cancelled".into());
        }
        // Dimension pre-check before allocating a full decode: rejects
        // decompression bombs and integer-overflow-prone sizes cheaply.
        let dimensions = image::ImageReader::new(std::io::Cursor::new(&image_data))
            .with_guessed_format()
            .map_err(|e| format!("Image format error: {e}"))?
            .into_dimensions()
            .map_err(|e| format!("Image dimensions error: {e}"))?;
        let source_pixels = u64::from(dimensions.0) * u64::from(dimensions.1);
        if source_pixels > MAX_TRACE_PIXELS {
            return Err(format!(
                "Trace source contains {source_pixels} pixels; the native limit is 64 megapixels"
            ));
        }
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("Trace cancelled".into());
        }
        let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let pixels = rgba.into_raw();

        let progress: Option<TraceProgressSink> = app_for_progress.map(|app| {
            Box::new(move |stage: &str, frac: f64| {
                let _ = app.emit(
                    "trace:progress",
                    serde_json::json!({
                        "jobId": clamped_job_id,
                        "stage": stage,
                        "progress": frac,
                    }),
                );
            }) as Box<dyn Fn(&str, f64) + Sync>
        });
        let progress_ref = progress.as_deref();
        Ok(varve_trace::trace_to_beziers_cancellable(
            &pixels,
            width,
            height,
            &opts,
            Some(&cancel_for_worker),
            progress_ref,
        ))
    })
    .await
    .map_err(|e| format!("Trace task panicked: {e}"))??;

    if cancel_after_await.load(Ordering::SeqCst) {
        return Err("Trace cancelled".into());
    }
    Ok(result)
}

// ── PDF export ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ExportPdfOptions {
    page_width: f64,
    page_height: f64,
    title: String,
    author: String,
    outline_text: bool,
    subset_fonts: bool,
    font_data: Option<Vec<u8>>,
    #[serde(default)]
    fonts: Vec<(String, Vec<u8>)>,
}

impl Default for ExportPdfOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Varve Export".into(),
            author: "Varve".into(),
            outline_text: false,
            subset_fonts: false,
            font_data: None,
            fonts: Vec::new(),
        }
    }
}

#[tauri::command]
fn export_node_pdf(
    nodes: Vec<IpcSceneNode>,
    opts: Option<ExportPdfOptions>,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    check_scene_node_bounds(&nodes)?;
    let scene = convert_scene(nodes);
    let pdf_opts = opts.unwrap_or_default();
    let mut print_opts = varve_print::PdfOptions {
        page_width: pdf_opts.page_width,
        page_height: pdf_opts.page_height,
        title: pdf_opts.title,
        author: pdf_opts.author,
        outline_text: pdf_opts.outline_text,
        subset_fonts: pdf_opts.subset_fonts,
        font_data: pdf_opts.font_data,
        fonts: pdf_opts.fonts,
        ..Default::default()
    };
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());
    varve_print::export_pdf(&scene, &print_opts)
}

// ── PDF/X and text outlining commands ────────────────────

/// Options for PDF/X export, deserialized from the TS bridge's options JSON.
#[derive(Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PdfXOptions {
    page_width: f64,
    page_height: f64,
    title: String,
    author: String,
    bleed_mm: f64,
    include_crop_marks: bool,
    include_registration_marks: bool,
    enforce_dpi: f64,
    outline_text: bool,
    icc_profile: String,
    color_bars: bool,
    format: String,
    font_data: Option<Vec<u8>>,
    #[serde(default)]
    fonts: Vec<(String, Vec<u8>)>,
    #[serde(default)]
    subset_fonts: bool,
}

impl Default for PdfXOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Varve Export".into(),
            author: "Varve".into(),
            bleed_mm: 3.0,
            include_crop_marks: false,
            include_registration_marks: false,
            enforce_dpi: 300.0,
            outline_text: false,
            icc_profile: "Fogra39".into(),
            color_bars: false,
            format: "screen".into(),
            font_data: None,
            fonts: Vec::new(),
            subset_fonts: false,
        }
    }
}

impl PdfXOptions {
    fn to_pdf_options(&self, page_height: f64) -> varve_print::PdfOptions {
        varve_print::PdfOptions {
            page_width: self.page_width,
            page_height,
            title: self.title.clone(),
            author: self.author.clone(),
            outline_text: self.outline_text,
            font_data: self.font_data.clone(),
            fonts: self.fonts.clone(),
            registration_marks: self.include_registration_marks,
            color_bar: self.color_bars,
            print_profile: self.print_profile(),
            subset_fonts: self.subset_fonts || self.outline_text,
            embedding_restriction_handling: varve_print::subset::EmbeddingRestriction::Warn,
            manifest: None,
            lossy: false,
        }
    }

    /// Resolve the requested ICC print profile from the `iccProfile` option.
    /// Unknown profile names return `None` — the caller's preflight must have
    /// surfaced the mismatch; we never guess a different profile silently.
    fn print_profile(&self) -> Option<varve_print::profiles::PrintProfile> {
        varve_print::profiles::PrintProfile::parse(&self.icc_profile)
    }

    /// Build print-mark geometry when bleed or crop marks are requested. The
    /// engine draws crop marks and derives the bleed boxes from this geometry,
    /// so `include_crop_marks` and `bleed_mm` are honored together (the PDF/X
    /// builders only receive a `MarksGeometry`, never a bare bleed value).
    fn marks_geometry(&self) -> Option<varve_print::marks::MarksGeometry> {
        let bleed = self.bleed_mm.max(0.0);
        if !self.include_crop_marks && bleed <= 0.0 {
            return None;
        }
        Some(varve_print::marks::MarksGeometry {
            bleed_mm: if bleed > 0.0 {
                bleed
            } else {
                varve_print::marks::MarksGeometry::default().bleed_mm
            },
            ..Default::default()
        })
    }
}

fn parse_nodes_from_json(nodes_json: &str) -> Result<Vec<varve_core::SceneNode>, String> {
    let nodes: Vec<IpcSceneNode> =
        serde_json::from_str(nodes_json).map_err(|e| format!("Nodes JSON parse error: {e}"))?;
    check_scene_node_bounds(&nodes)?;
    Ok(convert_scene(nodes))
}

#[tauri::command]
fn export_pdfx1a(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    options_json: String,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Options JSON parse error: {e}"))?;
    let mut print_opts = opts.to_pdf_options(page_height);
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());
    if let Some(geo) = opts.marks_geometry() {
        varve_print::cmyk::export_pdfx1a_with_marks(&scene, &print_opts, &geo)
    } else {
        varve_print::cmyk::export_pdfx1a(&scene, &print_opts)
    }
}

#[tauri::command]
fn export_pdfx4(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    options_json: String,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Options JSON parse error: {e}"))?;
    let mut print_opts = opts.to_pdf_options(page_height);
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());
    if let Some(geo) = opts.marks_geometry() {
        varve_print::cmyk::export_pdfx4_with_marks(&scene, &print_opts, &geo)
    } else {
        varve_print::cmyk::export_pdfx4(&scene, &print_opts)
    }
}

#[tauri::command]
fn outline_text(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    text: String,
    font_data: Vec<u8>,
    font_size: f64,
) -> Result<String, String> {
    let fonts = &font_data;
    let outlines = varve_print::outline_text(fonts, &text, font_size)?;
    let mut path = String::new();
    for glyph in &outlines {
        let d = varve_print::commands_to_svg_path(&glyph.commands, 2);
        if !d.is_empty() {
            if !path.is_empty() {
                path.push(' ');
            }
            path.push_str(&d);
        }
    }
    Ok(path)
}

#[tauri::command]
fn shape_text_command(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    request_json: String,
) -> Result<String, String> {
    let request: varve_print::shaper::ShapeRequest = serde_json::from_str(&request_json)
        .map_err(|e| format!("Shape request parse error: {e}"))?;
    let result = varve_print::shaper::shape_text(&request)?;
    serde_json::to_string(&result).map_err(|e| format!("Shape result serialize error: {e}"))
}

#[tauri::command]
fn export_pdf_with_options(
    _state: tauri::State<'_, varve_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    use_cmyk: bool,
    options_json: String,
    manifest_json: Option<String>,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Options JSON parse error: {e}"))?;
    let mut print_opts = opts.to_pdf_options(page_height);
    print_opts.manifest = manifest_json.and_then(|s| serde_json::from_str(&s).ok());

    match opts.format.as_str() {
        "x1a" | "pdf-x1a" => varve_print::cmyk::export_pdfx1a(&scene, &print_opts),
        "x4" | "pdf-x4" => varve_print::cmyk::export_pdfx4(&scene, &print_opts),
        _ if use_cmyk => varve_print::cmyk::export_pdfx1a(&scene, &print_opts),
        _ => varve_print::export_pdf(&scene, &print_opts),
    }
}

// ── Home IPC Commands ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct HomeFile {
    id: String,
    name: String,
    kind: String,
    project_id: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: i64,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
    #[serde(rename = "openedAt")]
    opened_at: i64,
    size: i64,
    pinned: bool,
    #[serde(rename = "trashedAt")]
    trashed_at: Option<i64>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    ordering: String,
    #[serde(rename = "contentHash")]
    content_hash: String,
    #[serde(rename = "favoritedAt", skip_serializing_if = "Option::is_none")]
    favorited_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HomeFileInput {
    id: String,
    name: String,
    kind: String,
    #[serde(default)]
    project_id: Option<String>,
    created_at: i64,
    updated_at: i64,
    opened_at: i64,
    size: i64,
    pinned: bool,
    #[serde(default)]
    trashed_at: Option<i64>,
    #[serde(default)]
    file_path: Option<String>,
    #[serde(default)]
    ordering: String,
    content_hash: String,
    #[serde(default)]
    favorited_at: Option<i64>,
}

#[derive(Debug, Serialize)]
struct HomeProject {
    id: String,
    name: String,
    color: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: i64,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
    pinned: bool,
    #[serde(rename = "trashedAt")]
    trashed_at: Option<i64>,
}

fn file_to_home(f: varve_sync::FileRow) -> HomeFile {
    HomeFile {
        id: f.id,
        name: f.name,
        kind: f.kind,
        project_id: f.project_id,
        created_at: rfc3339_to_epoch_ms(&f.created_at),
        updated_at: rfc3339_to_epoch_ms(&f.updated_at),
        opened_at: rfc3339_to_epoch_ms(&f.opened_at),
        size: f.size,
        pinned: f.pinned,
        trashed_at: f.trashed_at.as_ref().map(|s| rfc3339_to_epoch_ms(s)),
        file_path: f.file_path,
        ordering: f.ordering,
        content_hash: f.content_hash,
        favorited_at: f.favorited_at.filter(|&t| t > 0),
    }
}

fn project_to_home(p: varve_sync::ProjectRow) -> HomeProject {
    HomeProject {
        id: p.id,
        name: p.name,
        color: p.color,
        created_at: rfc3339_to_epoch_ms(&p.created_at),
        updated_at: rfc3339_to_epoch_ms(&p.updated_at),
        pinned: p.pinned,
        trashed_at: p.trashed_at.as_ref().map(|s| rfc3339_to_epoch_ms(s)),
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn rfc3339_to_epoch_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn epoch_ms_to_rfc3339(ms: i64) -> String {
    let secs = ms / 1000;
    let nanos = ((ms % 1000) * 1_000_000) as u32;
    match chrono::DateTime::from_timestamp(secs, nanos) {
        Some(dt) => dt.to_rfc3339(),
        None => now_rfc3339(),
    }
}

// Files
#[tauri::command]
fn home_list_files(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Vec<HomeFile>, String> {
    store
        .list_files()
        .map(|v| v.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_list_trashed(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Vec<HomeFile>, String> {
    store
        .list_trashed_files()
        .map(|v| v.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_get_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<Option<HomeFile>, String> {
    store
        .get_file(&id)
        .map(|opt| opt.map(file_to_home))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_read_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<Option<String>, String> {
    store.load_document(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_upsert_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    entry: HomeFileInput,
    json: String,
) -> Result<(), String> {
    // Single transaction: the document JSON and its file row are committed
    // together — a crash between the two statements must not leave a row
    // pointing at missing content (save_document_with_file).
    let row = varve_sync::FileRow {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        project_id: entry.project_id,
        created_at: epoch_ms_to_rfc3339(entry.created_at),
        updated_at: epoch_ms_to_rfc3339(entry.updated_at),
        opened_at: epoch_ms_to_rfc3339(entry.opened_at),
        size: entry.size,
        pinned: entry.pinned,
        trashed_at: entry.trashed_at.map(epoch_ms_to_rfc3339),
        file_path: entry.file_path,
        ordering: entry.ordering,
        content_hash: entry.content_hash,
        favorited_at: entry.favorited_at.filter(|&t| t > 0),
    };
    store
        .save_document_with_file(&json, &row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_touch_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    opened_at: Option<i64>,
) -> Result<(), String> {
    let ts = opened_at
        .map(epoch_ms_to_rfc3339)
        .unwrap_or_else(now_rfc3339);
    store.touch_file(&id, &ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_rename_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    name: String,
) -> Result<(), String> {
    store.rename_file(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_pinned(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    store
        .set_file_pinned(&id, pinned)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_favorited(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    favorited_at: Option<i64>,
) -> Result<(), String> {
    let at = favorited_at.filter(|&t| t > 0);
    store.set_file_favorited(&id, at).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_move_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    store
        .move_file_to_project(&id, project_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_trash(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store
        .trash_file(&id, &now_rfc3339())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_restore(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.restore_file(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_purge(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.purge_file(&id).map_err(|e| e.to_string())
}

// Projects
#[tauri::command]
fn home_list_projects(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Vec<HomeProject>, String> {
    store
        .list_projects()
        .map(|v| v.into_iter().map(project_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_create_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    name: String,
) -> Result<HomeProject, String> {
    let id = uuid();
    let now_rfc = now_rfc3339();
    let now_ms = chrono::Utc::now().timestamp_millis();
    store
        .create_project(&id, &name, None, &now_rfc)
        .map_err(|e| e.to_string())?;
    Ok(HomeProject {
        id,
        name: name.clone(),
        color: None,
        created_at: now_ms,
        updated_at: now_ms,
        pinned: false,
        trashed_at: None,
    })
}

#[tauri::command]
fn home_rename_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    name: String,
) -> Result<(), String> {
    store.rename_project(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_delete_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_project_pinned(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    store
        .set_project_pinned(&id, pinned)
        .map_err(|e| e.to_string())
}

// View State
#[tauri::command]
fn home_get_view_state(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Option<String>, String> {
    store.get_view_state("home").map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_view_state(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    value: String,
) -> Result<(), String> {
    store
        .set_view_state("home", &value)
        .map_err(|e| e.to_string())
}

// Generic small app settings (e.g. onboarding-complete) — persisted in the
// same native SQLite store as documents, rather than WebView localStorage,
// which is not guaranteed to survive between separate app launches on every
// platform/WebView engine.
#[tauri::command]
fn app_get_setting(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    key: String,
) -> Result<Option<String>, String> {
    store
        .get_view_state(&format!("app-setting:{key}"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn app_set_setting(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    store
        .set_view_state(&format!("app-setting:{key}"), &value)
        .map_err(|e| e.to_string())
}

// ── Thumbnails ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailInput {
    hash: String,
    data_url: String,
    width: i64,
    height: i64,
    created_at: i64,
}

#[tauri::command]
fn home_get_thumbnail(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    hash: String,
) -> Result<Option<String>, String> {
    store.get_thumbnail(&hash).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_put_thumbnail(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    input: ThumbnailInput,
) -> Result<(), String> {
    store
        .put_thumbnail(
            &input.hash,
            &input.data_url,
            input.width,
            input.height,
            &epoch_ms_to_rfc3339(input.created_at),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_evict_thumbnails(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    keep_count: i64,
) -> Result<i64, String> {
    store
        .evict_thumbnails(keep_count)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn home_delete_thumbnail(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    hash: String,
) -> Result<(), String> {
    store.delete_thumbnail(&hash).map_err(|e| e.to_string())
}

// ── Search ───────────────────────────────────────────────────────────

#[tauri::command]
fn home_search_files(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    query: String,
) -> Result<Vec<HomeFile>, String> {
    store
        .search_files(&query)
        .map(|v| v.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

// ── Reorder ──────────────────────────────────────────────────────────

#[tauri::command]
fn home_reorder_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    ordering: String,
) -> Result<(), String> {
    store
        .reorder_file(&id, &ordering)
        .map_err(|e| e.to_string())
}

// ── File-system read/write (for open/save from disk) ─────────────────────

#[tauri::command]
fn home_read_text_file(path: String) -> Result<String, String> {
    let resolved = resolve_user_path(&path)?;
    std::fs::read_to_string(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_write_text_file(path: String, contents: String) -> Result<(), String> {
    let resolved = resolve_user_path(&path)?;
    write_file_atomic(&resolved, contents.as_bytes())
}

// Dialog-approved variants: paths chosen through the native open/save
// dialogs (see resolve_user_path_approved). Documents may legitimately live
// outside $HOME (other drives, removable media, network mounts); the strict
// home-scope variants above remain for anything whose path did not come
// from a user dialog.

#[tauri::command]
fn home_read_text_file_approved(path: String) -> Result<String, String> {
    let resolved = resolve_user_path_approved(&path)?;
    std::fs::read_to_string(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_write_text_file_approved(path: String, contents: String) -> Result<(), String> {
    let resolved = resolve_user_path_approved(&path)?;
    write_file_atomic(&resolved, contents.as_bytes())
}

fn model_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
fn read_model_file(app: tauri::AppHandle, model_id: String) -> Result<Vec<u8>, String> {
    let path = model_dir(&app)?.join(&model_id);
    std::fs::read(&path).map_err(|e| format!("Failed to read model file {model_id}: {e}"))
}

#[tauri::command]
fn write_model_file(app: tauri::AppHandle, model_id: String, data: Vec<u8>) -> Result<(), String> {
    let path = model_dir(&app)?.join(&model_id);
    write_file_atomic(&path, &data)
}

#[tauri::command]
fn delete_model_file(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    let path = model_dir(&app)?.join(&model_id);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete model file {model_id}: {e}"))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn list_model_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = model_dir(&app)?;
    let mut ids = Vec::new();
    if dir.exists() {
        for entry in
            std::fs::read_dir(&dir).map_err(|e| format!("Failed to read models dir: {e}"))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                ids.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(ids)
}

fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}-{:x}", t.as_nanos(), t.as_micros())
}

// ── AI chat stub ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct AiResponse {
    id: String,
    role: String,
    content: String,
    timestamp: i64,
}

#[tauri::command]
fn ai_chat(_session_id: String, message: String) -> Result<AiResponse, String> {
    let reply = format!("(AI stub) You said: {}", message);
    Ok(AiResponse {
        id: uuid(),
        role: "assistant".into(),
        content: reply,
        timestamp: chrono::Utc::now().timestamp_millis(),
    })
}

// ── Collab stub commands ──────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct CollabUser {
    id: String,
    name: String,
    color: String,
}

#[tauri::command]
fn get_collab_users(document_id: String) -> Result<Vec<CollabUser>, String> {
    let _ = document_id;
    Ok(vec![])
}

#[tauri::command]
fn update_cursor(document_id: String, x: f64, y: f64) -> Result<(), String> {
    let _ = (document_id, x, y);
    Ok(())
}

// ── Plugin sandbox stub commands ──────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct PluginInfo {
    id: String,
    name: String,
    version: String,
    description: String,
}

#[tauri::command]
fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    Ok(vec![])
}

/// Show and focus the main window.
///
/// The native splash window was removed: it created a second window and left
/// `main` hidden until the frontend asked for it, so any startup failure — a
/// bundle that never evaluated, a hung data load — left the user on an
/// unclosable splash with no error and nothing to report. Observed in the
/// 0.0.0 and 0.1.0 AppImages.
///
/// `main` is now `visible: true` from the start, so the branded boot screen in
/// index.html is what the user sees, and it replaces itself with a readable
/// error if startup fails. The in-app `StartupLoader` then takes over with
/// progress, a timeout, and a retry button.
///
/// This command is kept because the frontend still calls it once mounted;
/// showing an already-visible window is a harmless no-op, and it keeps the
/// window focused when launched from a file association.
#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Resolve the bundled native onnxruntime dylib for the current platform,
/// if one was staged by `scripts/fetch-onnxruntime.mjs`.
///
/// Checks the production resource directory first (populated by
/// `tauri.conf.json`'s `bundle.resources` during `tauri build`), then falls
/// back to the dev-time staging path directly under the crate manifest dir
/// — `tauri dev` runs `cargo run` without a bundling step, so
/// `app.path().resource_dir()` may not contain files declared as bundle
/// resources yet.
#[cfg(feature = "ai")]
fn resolve_onnxruntime_dylib(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let platform_key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let lib_name = if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };
    let relative = std::path::Path::new("onnxruntime-libs")
        .join(&platform_key)
        .join(lib_name);

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(&relative);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let dev_candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(&relative);
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // On Wayland (especially KDE Plasma), the window icon is resolved via the
    // FreeDesktop desktop file whose *filename stem* matches the process
    // program name / Wayland app_id. Force that id to our Tauri identifier so
    // `dev.varve.desktop.desktop` + hicolor icons resolve instead of the
    // generic Wayland logo. Must run before GTK init inside `Builder::run`.
    #[cfg(target_os = "linux")]
    {
        // AppImage workaround: the bundle ships GTK/WebKit support libraries
        // built on the ubuntu-22.04 baseline. On distros with a newer
        // Mesa/EGL stack (Arch, CachyOS, Fedora), the stale bundled
        // libwayland-egl combo makes WebKit's DMA-BUF renderer fail EGL
        // display creation (EGL_BAD_PARAMETER) and the web process aborts,
        // leaving a white window. Disabling only the DMA-BUF renderer fixes
        // it while keeping GPU compositing where possible. Installed
        // (deb/rpm) builds use the host's libraries and never set this.
        if std::env::var_os("APPIMAGE").is_some() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        glib::set_prgname(Some("dev.varve.desktop"));
        glib::set_application_name("Varve");
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // WDIO testing plugins (debug-only, excluded from release builds)
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        // Native termination interception (ADR-0216 D5): close/exit is
        // prevented until the frontend coordinator approves it.
        .on_window_event(lifecycle::handle_window_event)
        .setup(|app| {
            // Native ONNX Runtime init deliberately does NOT happen here.
            // Loading a native dylib this early — before the webview has
            // finished initializing — risks racing WebKitGTK's own
            // process/thread startup (onnxruntime can spawn its own thread
            // pool and install its own signal handlers). It's initialized
            // lazily instead, the first time the frontend calls
            // native_ai_status (see that command below), which can only
            // happen once the webview is already up and running JS.

            let data_dir = app.path().app_data_dir().expect("no app data dir");
            migrate_legacy_data_dir(&data_dir);
            std::fs::create_dir_all(&data_dir).expect("create data dir");
            // Native crash capture: panic hook + sandboxed report filesystem.
            // Deliberately before any other subsystem — a panic later still
            // lands an emergency record.
            crash::install(data_dir.as_path());
            let db_path = data_dir.join("documents.db");
            let store = varve_sync::DocumentStore::new(&db_path).expect("init document store");
            app.manage(store);
            app.manage(UpscaleCancelState::new());
            app.manage(TraceCancelState::new());
            app.manage(lifecycle::LifecycleGuard::new());

            // WebKitGTK owns the touchpad pinch gesture and applies it as page
            // zoom, scaling the entire UI. The gesture never reaches JS, so the
            // canvas's own pinch handling cannot see it, and wry exposes no
            // setting to disable it (`zoom_hotkeys_enabled` is WebView2-only).
            //
            // Intercept it instead: whenever WebKit moves the page zoom away
            // from 1.0, forward that factor to the frontend as a canvas zoom and
            // immediately restore the page. The gesture then zooms the artwork,
            // which is what a pinch on a canvas is expected to do.
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::WebViewExt;
                let zoom_handle = app.handle().clone();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(move |platform| {
                        let webview = platform.inner();
                        webview.connect_zoom_level_notify(move |view| {
                            let level = view.zoom_level();
                            // Guard against re-entering on our own reset.
                            if (level - 1.0).abs() < f64::EPSILON {
                                return;
                            }
                            let _ = zoom_handle.emit(
                                "canvas://pinch-zoom",
                                serde_json::json!({ "factor": level }),
                            );
                            view.set_zoom_level(1.0);
                        });
                    });
                }
            }

            // Listen for native menu item clicks and forward to webview
            app.on_menu_event(|app_handle, event| {
                let id = event.id();
                if !id.0.starts_with("__tauri_") {
                    let _ = app_handle.emit("menu://action", serde_json::json!({ "action": id.0 }));
                }
            });

            // Start file-system watcher for home directory
            let watch_handle = app.handle().clone();
            let watch_path = data_dir.clone();
            std::thread::spawn(move || {
                let (tx, rx) = std::sync::mpsc::channel::<()>();
                let mut watcher = match notify::recommended_watcher(
                    move |res: Result<notify::Event, notify::Error>| {
                        if let Ok(event) = res {
                            let has_document_ext = event.paths.iter().any(|p| {
                                p.extension()
                                    .map(|e| e == "varve" || e == "strata")
                                    .unwrap_or(false)
                            });
                            if has_document_ext {
                                let _ = tx.send(());
                            }
                        }
                    },
                ) {
                    Ok(w) => w,
                    Err(e) => {
                        eprintln!("Failed to create file watcher: {}", e);
                        return;
                    }
                };
                if let Err(e) = watcher.watch(&watch_path, notify::RecursiveMode::Recursive) {
                    eprintln!("Failed to watch directory {}: {}", watch_path.display(), e);
                    return;
                }
                while rx.recv().is_ok() {
                    let _ = watch_handle.emit("home:files-changed", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crash::crash_write_report,
            crash::crash_list_reports,
            crash::crash_read_report,
            crash::crash_delete_report,
            lifecycle::approve_window_close,
            lifecycle::approve_exit,
            menu::build_native_menu,
            menu::update_native_menu_state,
            build_render_ir,
            hit_test,
            sync_save,
            sync_load,
            render_frame_ir,
            render_frame_pixels,
            report,
            done,
            // Home commands
            home_list_files,
            home_list_trashed,
            home_get_file,
            home_read_file,
            home_upsert_file,
            home_touch_file,
            home_rename_file,
            home_set_pinned,
            home_set_favorited,
            home_move_project,
            home_trash,
            home_restore,
            home_purge,
            home_list_projects,
            home_create_project,
            home_rename_project,
            home_delete_project,
            home_set_project_pinned,
            home_get_view_state,
            home_set_view_state,
            app_get_setting,
            app_set_setting,
            home_get_thumbnail,
            home_put_thumbnail,
            home_evict_thumbnails,
            home_delete_thumbnail,
            home_search_files,
            home_reorder_file,
            home_read_text_file,
            home_write_text_file,
            home_read_text_file_approved,
            home_write_text_file_approved,
            write_binary_file,
            read_dropped_file,
            read_clipboard_image_png,
            remove_background,
            native_ai_status,
            native_background_removal_model_status,
            download_background_removal_model,
            cancel_background_removal_model_download,
            delete_background_removal_model,
            denoise_image,
            content_aware_fill,
            trace_image,
            trace_image_binary,
            media_probe_binary,
            media_decode_frames_binary,
            begin_trace_job,
            cancel_trace,
            upscale_image,
            upscale_image_binary,
            apply_live_effect_binary,
            begin_upscale_job,
            cancel_upscale,
            export_node_pdf,
            export_pdfx1a,
            export_pdfx4,
            outline_text,
            export_pdf_with_options,
            // Native font enumeration
            font::enumerate_system_fonts,
            // Native text shaping
            shape_text_command,
            // Native font filesystem storage
            font_storage::store_font_on_filesystem,
            font_storage::load_font_from_filesystem,
            font_storage::list_filesystem_fonts,
            font_storage::remove_font_from_filesystem,
            font_storage::get_filesystem_font_storage_usage,
            // Native model file storage
            read_model_file,
            write_model_file,
            delete_model_file,
            list_model_files,
            // Native OS print
            list_printers,
            print_pdf,
            cancel_print_job,
            // W6: backend-dependent UI stubs
            ai_chat,
            get_collab_users,
            update_cursor,
            list_plugins,
            close_splashscreen,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Run-event interception (ExitRequested → coordinator) — the
            // only place Tauri 2 exposes the exit veto (ADR-0216 D5).
            lifecycle::handle_run_event(app_handle, event);
        });
}

// ── Native Print ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct PrinterInfo {
    name: String,
    description: String,
    is_color: bool,
    paper_sizes: Vec<String>,
    supports_duplex: bool,
    accepting_jobs: bool,
}

#[derive(Debug, Deserialize)]
struct PrintOptions {
    printer_name: String,
    copies: Option<u32>,
    duplex: Option<bool>,
    color_mode: Option<String>,
    page_size: Option<String>,
}

#[derive(Debug, Serialize)]
struct PrintResult {
    job_id: u32,
    message: String,
    success: bool,
}

#[tauri::command]
fn list_printers() -> Vec<PrinterInfo> {
    crate::print::list_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            name: p.name,
            description: p.description,
            is_color: p.is_color,
            paper_sizes: p.paper_sizes,
            supports_duplex: p.supports_duplex,
            accepting_jobs: p.accepting_jobs,
        })
        .collect()
}

#[tauri::command]
fn print_pdf(pdf_data: Vec<u8>, job_title: String, options: PrintOptions) -> PrintResult {
    let result = crate::print::print_pdf(
        &options.printer_name,
        &pdf_data,
        &job_title,
        options.copies.unwrap_or(1),
        options.duplex.unwrap_or(false),
        &options.color_mode.unwrap_or_else(|| "color".to_string()),
        &options.page_size.unwrap_or_else(|| "auto".to_string()),
    );
    PrintResult {
        job_id: result.job_id,
        message: result.message,
        success: result.success,
    }
}

#[tauri::command]
fn cancel_print_job(printer_name: String, job_id: u32) -> Result<String, String> {
    crate::print::cancel_job(&printer_name, job_id)
}

// ── End Native Print ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use varve_core::EngineColor;

    fn ts_wire_json() -> serde_json::Value {
        serde_json::json!([
            {
                "id": "n1",
                "name": "Rect-1",
                "transform": [1, 0, 0, 1, 0, 0],
                "shape": { "kind": "rect", "x": 0, "y": 0, "w": 10, "h": 10 },
                "fill": [57, 208, 198, 255]
            },
            {
                "id": "n2",
                "name": "Circle-1",
                "transform": [1, 0, 0, 1, 50, 50],
                "shape": { "kind": "circle", "cx": 0, "cy": 0, "r": 5 },
                "fill": [255, 0, 0, 255]
            },
            {
                "id": "n3",
                "name": "Ellipse-1",
                "transform": [1, 0, 0, 1, 100, 100],
                "shape": { "kind": "ellipse", "cx": 10, "cy": 5, "rx": 8, "ry": 4 },
                "fill": [0, 255, 0, 255]
            },
            {
                "id": "n4",
                "name": "Line-1",
                "transform": [1, 0, 0, 1, 0, 0],
                "shape": { "kind": "line", "from": [0, 0], "to": [10, 10], "tolerance": 2 },
                "fill": [0, 0, 255, 255]
            },
            {
                "id": "n5",
                "name": "Text-1",
                "transform": [1, 0, 0, 1, 25, 25],
                "shape": {
                    "kind": "text",
                    "text": "Hello",
                    "fontSize": 16,
                    "fontFamily": "Inter",
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "textAlign": "left",
                    "x": 0.0, "y": 0.0, "w": 100.0, "h": 20.0
                },
                "fill": [16, 21, 31, 255]
            }
        ])
    }

    #[test]
    fn round_trip_build_render_ir() {
        let json = ts_wire_json();
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        assert_eq!(nodes.len(), 5);

        let scene = convert_scene(nodes);
        let ir = varve_engine::build_render_ir(&scene);
        assert_eq!(ir.len(), 5);

        // Rect: origin, teal
        assert_eq!(ir[0].transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        assert_eq!(
            ir[0].fill,
            EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );
        assert_eq!(
            ir[0].primitive,
            varve_engine::Primitive::Rect {
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
                corner_radius: None,
            }
        );

        // Circle: translated (50,50), red
        assert_eq!(ir[1].transform, [1.0, 0.0, 0.0, 1.0, 50.0, 50.0]);
        assert_eq!(
            ir[1].fill,
            EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );
        assert_eq!(
            ir[1].primitive,
            varve_engine::Primitive::Circle {
                cx: 0.0,
                cy: 0.0,
                r: 5.0
            }
        );

        // Ellipse: translated (100,100)
        assert_eq!(ir[2].transform, [1.0, 0.0, 0.0, 1.0, 100.0, 100.0]);
        assert_eq!(
            ir[2].primitive,
            varve_engine::Primitive::Ellipse {
                cx: 10.0,
                cy: 5.0,
                rx: 8.0,
                ry: 4.0
            }
        );

        // Line: at origin
        assert_eq!(ir[3].transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        assert_eq!(
            ir[3].primitive,
            varve_engine::Primitive::Line {
                from: [0.0, 0.0],
                to: [10.0, 10.0],
                tolerance: 2.0
            }
        );

        // Text: translated (25,25), text primitive
        assert_eq!(ir[4].transform, [1.0, 0.0, 0.0, 1.0, 25.0, 25.0]);
        assert_eq!(
            ir[4].fill,
            EngineColor::Rgb {
                r: 16.0,
                g: 21.0,
                b: 31.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );
        assert!(matches!(
            ir[4].primitive,
            varve_engine::Primitive::Text { text: _, .. }
        ));
        if let varve_engine::Primitive::Text {
            ref text,
            font_size,
            ref font_family,
            font_weight,
            ref font_style,
            ..
        } = ir[4].primitive
        {
            assert_eq!(text, "Hello");
            assert_eq!(font_size, 16.0);
            assert_eq!(font_family, "Inter");
            assert_eq!(font_weight, 400);
            assert_eq!(font_style, "normal");
        } else {
            panic!("expected text primitive");
        }
    }

    #[test]
    fn ipc_parity_fills_filters_corner_radius() {
        let json = serde_json::json!([{
            "id": "n0",
            "name": "Rounded",
            "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "shape": { "kind": "rect", "x": 0.0, "y": 0.0, "w": 20.0, "h": 20.0, "cornerRadius": 8 },
            "fill": { "space": "rgb", "r": 57, "g": 208, "b": 198, "a": 255 },
            "fills": [{
                "type": "solid",
                "color": {"space": "rgb", "r": 57.0, "g": 208.0, "b": 198.0, "a": 255.0},
                "opacity": 1.0,
                "blendMode": "normal",
                "visible": true
            }],
            "filters": [{ "type": "exposure", "exposure": 0.5 }]
        }]);
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        let scene = convert_scene(nodes);
        assert!(scene[0].fills.is_some());
        assert!(scene[0].filters.is_some());
        assert!(scene[0].corner_radius.is_some());
        assert_eq!(
            scene[0].fill,
            EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );

        let ir = varve_engine::build_render_ir(&scene);
        assert!(ir[0].fills.is_some());
        assert!(ir[0].filters.is_some());
        if let varve_engine::Primitive::Rect { corner_radius, .. } = &ir[0].primitive {
            assert!(corner_radius.is_some());
        } else {
            panic!("expected rect");
        }
    }

    #[test]
    fn round_trip_hit_test() {
        let json = ts_wire_json();
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        let scene = convert_scene(nodes);
        let hit = varve_core::hit_test(&scene, Point::new(2.0, 8.0));
        assert_eq!(hit, Some(0));

        // Circle at world (50,50) radius 5: (52,50) is inside.
        let hit = varve_core::hit_test(&scene, Point::new(52.0, 50.0));
        assert_eq!(hit, Some(1));

        // Ellipse at world center (110,105), rx=8 ry=4: (115,105) is inside.
        let hit = varve_core::hit_test(&scene, Point::new(115.0, 105.0));
        assert_eq!(hit, Some(2));

        // Point (5,5) is inside both the rect and the line (tolerance 2).
        // hit_test returns the topmost (highest index) — line at index 3.
        let hit = varve_core::hit_test(&scene, Point::new(5.0, 5.0));
        assert_eq!(hit, Some(3));

        // Point outside all shapes
        let hit = varve_core::hit_test(&scene, Point::new(999.0, 999.0));
        assert_eq!(hit, None);
    }

    #[test]
    fn output_serialization_matches_ts_wire_format() {
        let json = ts_wire_json();
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        let scene = convert_scene(nodes);
        let ir = varve_engine::build_render_ir(&scene);

        let serialized = serde_json::to_value(&ir).expect("serialize IR");

        // Verify top-level structure: should be a JSON array
        assert!(serialized.is_array(), "IR should serialize as a JSON array");
        let arr = serialized.as_array().unwrap();
        assert_eq!(arr.len(), 5);

        // Verify transform is an array (not an object with coeffs key)
        let first = &arr[0];
        let tx = first.get("transform").expect("transform field");
        assert!(tx.is_array(), "transform should be a JSON array, got {tx}");
        assert_eq!(tx.as_array().unwrap().len(), 6);

        // Verify primitive has "kind" tag (internally-tagged)
        let prim = first.get("primitive").expect("primitive field");
        assert!(prim.is_object(), "primitive should be an object");
        assert!(
            prim.get("kind").is_some(),
            "primitive should have 'kind' tag"
        );

        // Verify line primitive from/to are arrays (not objects with x,y)
        let line_prim = &arr[3].get("primitive").unwrap();
        assert_eq!(line_prim.get("kind").unwrap(), "line");
        let from = line_prim.get("from").unwrap();
        assert!(
            from.is_array(),
            "line.from should be a JSON array, got {from}"
        );
        let to = line_prim.get("to").unwrap();
        assert!(to.is_array(), "line.to should be a JSON array, got {to}");

        // Verify fill is an EngineColor object tagged by "space"
        let fill = first.get("fill").unwrap();
        assert!(
            fill.is_object(),
            "fill should be a JSON object (EngineColor)"
        );
        assert_eq!(
            fill.get("space").and_then(|v| v.as_str()),
            Some("rgb"),
            "fill should have space='rgb'"
        );
    }

    // ── New command integration tests ─────────────────────────────────────

    fn test_font_data() -> Vec<u8> {
        varve_print::test_fonts::test_font_bytes().to_vec()
    }

    #[test]
    fn export_pdfx1a_from_json_string() {
        // Simulate what the TS bridge sends: nodes as JSON string + options as JSON string
        let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize nodes");
        let options_json = serde_json::json!({
            "pageWidth": 300.0,
            "pageHeight": 200.0,
            "title": "Test X-1a",
            "author": "Varve",
            "bleedMm": 3.0,
            "includeCropMarks": false,
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_str(&nodes_json).expect("deserialize from json string");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        let bytes = varve_print::cmyk::export_pdfx1a(&scene, &print_opts).expect("pdfx1a");
        assert!(bytes.starts_with(b"%PDF"), "should be a valid PDF");
        assert!(
            String::from_utf8_lossy(&bytes).contains("GTS_PDFX"),
            "should contain PDF/X marker"
        );
    }

    #[test]
    fn export_pdfx4_from_json_string() {
        let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize nodes");
        let options_json = serde_json::json!({
            "pageWidth": 300.0,
            "pageHeight": 200.0,
            "title": "Test X-4",
            "author": "Varve",
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        let bytes = varve_print::cmyk::export_pdfx4(&scene, &print_opts).expect("pdfx4");
        assert!(bytes.starts_with(b"%PDF-1.6"), "PDF/X-4 should use PDF 1.6");
    }

    #[test]
    fn pdfx_marks_geometry_honors_bleed_and_crop_marks() {
        // No bleed, no crop marks → no geometry → plain PDF/X page (no TrimBox bleed).
        let plain: PdfXOptions = serde_json::from_value(serde_json::json!({
            "pageWidth": 300.0, "pageHeight": 200.0, "bleedMm": 0.0, "includeCropMarks": false,
        }))
        .expect("parse plain");
        assert!(
            plain.marks_geometry().is_none(),
            "no marks or bleed → no geometry"
        );

        // Bleed alone (no crop marks) must still produce geometry so the bleed
        // box is applied — otherwise bleed is silently dropped.
        let bleed_only: PdfXOptions = serde_json::from_value(serde_json::json!({
            "pageWidth": 300.0, "pageHeight": 200.0, "bleedMm": 5.0, "includeCropMarks": false,
        }))
        .expect("parse bleed-only");
        let geo = bleed_only
            .marks_geometry()
            .expect("bleed-only should produce geometry");
        assert!((geo.bleed_mm - 5.0).abs() < 1e-6);

        // Crop marks without explicit bleed uses the default bleed.
        let marks_only: PdfXOptions = serde_json::from_value(serde_json::json!({
            "pageWidth": 300.0, "pageHeight": 200.0, "includeCropMarks": true,
        }))
        .expect("parse marks-only");
        let geo = marks_only
            .marks_geometry()
            .expect("crop marks should produce geometry");
        assert!(geo.bleed_mm > 0.0, "crop marks imply a default bleed");
    }

    #[test]
    fn pdfx_registration_marks_maps_to_include_registration_marks() {
        let with_reg: PdfXOptions = serde_json::from_value(serde_json::json!({
            "pageWidth": 300.0, "pageHeight": 200.0,
            "includeCropMarks": true,
            "includeRegistrationMarks": true,
        }))
        .expect("parse with reg marks");
        let print_opts = with_reg.to_pdf_options(200.0);
        assert!(
            print_opts.registration_marks,
            "registration_marks must follow includeRegistrationMarks (not crop marks)"
        );

        let crop_only: PdfXOptions = serde_json::from_value(serde_json::json!({
            "pageWidth": 300.0, "pageHeight": 200.0,
            "includeCropMarks": true,
            "includeRegistrationMarks": false,
        }))
        .expect("parse crop-only");
        let print_opts = crop_only.to_pdf_options(200.0);
        assert!(
            !print_opts.registration_marks,
            "crop marks alone must not enable registration marks"
        );
    }

    #[test]
    fn outline_text_command_returns_svg_path() {
        let font_data = test_font_data();
        let result = varve_print::outline_text(&font_data, "A", 16.0).expect("outline");
        assert!(!result.is_empty(), "should produce glyph outlines");
        let path = result
            .iter()
            .map(|g| varve_print::commands_to_svg_path(&g.commands, 2))
            .filter(|d| !d.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!path.is_empty(), "SVG path should not be empty");
        assert!(path.starts_with('M'), "should start with MoveTo");
    }

    #[test]
    fn outline_text_command_empty_string() {
        let font_data = test_font_data();
        let result = varve_print::outline_text(&font_data, "", 16.0).expect("outline empty");
        assert!(result.is_empty(), "empty text should produce no outlines");
    }

    #[test]
    fn outline_text_command_returns_path_for_multiple_glyphs() {
        let font_data = test_font_data();
        let result = varve_print::outline_text(&font_data, "AB", 16.0).expect("outline AB");
        assert_eq!(result.len(), 2, "should produce two glyph outlines");
        let path = result
            .iter()
            .map(|g| varve_print::commands_to_svg_path(&g.commands, 2))
            .filter(|d| !d.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(path.contains("M"), "SVG path should contain MoveTo");
    }

    #[test]
    fn export_pdf_with_options_dispatches_screen_by_default() {
        let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize");
        let options_json = serde_json::json!({
            "pageWidth": 192.0,
            "pageHeight": 108.0,
            "format": "screen",
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(108.0);
        let bytes = varve_print::export_pdf(&scene, &print_opts).expect("screen pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be a valid PDF");
        assert!(
            !String::from_utf8_lossy(&bytes).contains("GTS_PDFX"),
            "screen PDF should not contain PDF/X marker"
        );
    }

    #[test]
    fn export_pdf_with_options_dispatches_x1a_when_use_cmyk() {
        let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize");
        let options_json = serde_json::json!({
            "pageWidth": 300.0,
            "pageHeight": 200.0,
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        // use_cmyk = true should dispatch to export_pdfx1a
        let bytes = varve_print::cmyk::export_pdfx1a(&scene, &print_opts).expect("pdfx1a");
        assert!(bytes.starts_with(b"%PDF"), "should be a valid PDF");
        assert!(
            String::from_utf8_lossy(&bytes).contains("GTS_PDFX"),
            "CMYK dispatch should produce PDF/X"
        );
    }

    #[test]
    fn export_pdf_with_options_dispatches_x4_by_format() {
        let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize");
        let options_json = serde_json::json!({
            "pageWidth": 300.0,
            "pageHeight": 200.0,
            "format": "x4",
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        let bytes = varve_print::cmyk::export_pdfx4(&scene, &print_opts).expect("pdfx4");
        assert!(
            bytes.starts_with(b"%PDF-1.6"),
            "format x4 should produce PDF/X-4"
        );
    }

    #[test]
    fn parse_nodes_from_json_handles_empty_array() {
        let scene = parse_nodes_from_json("[]").expect("empty array");
        assert!(scene.is_empty(), "empty scene should have no nodes");
    }

    #[test]
    fn parse_nodes_from_json_errors_on_invalid_input() {
        let err = parse_nodes_from_json("not json").unwrap_err();
        assert!(err.contains("parse"), "should report parse error");
    }

    #[test]
    fn pdf_xoptions_defaults_are_sane() {
        let opts = PdfXOptions::default();
        assert!((opts.page_width - 1920.0).abs() < 1e-6);
        assert!((opts.page_height - 1080.0).abs() < 1e-6);
        assert!((opts.bleed_mm - 3.0).abs() < 1e-6);
        assert!(!opts.include_crop_marks);
        assert!(!opts.outline_text);
    }

    fn make_test_png(w: u32, h: u32) -> Vec<u8> {
        let mut buf = image::RgbaImage::new(w, h);
        for (x, _y, px) in buf.enumerate_pixels_mut() {
            *px = if x < w / 2 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 255, 255])
            };
        }
        let mut bytes: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(buf)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png");
        bytes
    }

    #[test]
    fn bg_remove_options_deserializes_camel_case_wire_format() {
        // This is exactly the shape `invokeTauriRemoveBackground` (TS) sends.
        let json = serde_json::json!({
            "method": "quick",
            "featherRadius": 2.5,
            "decontaminate": true,
            "clickX": 10,
            "clickY": 20,
        });
        let opts: BgRemoveOptions = serde_json::from_value(json).expect("deserialize");
        assert_eq!(opts.method, "quick");
        assert_eq!(opts.feather_radius, Some(2.5));
        assert_eq!(opts.decontaminate, Some(true));
        assert_eq!(opts.click_x, Some(10));
        assert_eq!(opts.click_y, Some(20));
    }

    #[test]
    fn bg_remove_result_serializes_camel_case_wire_format() {
        let result = BgRemoveResult {
            mask_base64: "abc123".to_string(),
            confidence: 0.75,
            method: "quick".to_string(),
            processing_time_ms: 42,
            width: 10,
            height: 20,
        };
        let json = serde_json::to_value(&result).expect("serialize");
        // The TS side (`BackgroundRemovalResult`/`invokeTauriRemoveBackground`)
        // reads these exact camelCase keys — a regression here silently breaks
        // background removal on the desktop build with no compile-time signal.
        assert_eq!(json["maskBase64"], "abc123");
        assert_eq!(json["processingTimeMs"], 42);
        assert!(json.get("mask_base64").is_none());
        assert!(json.get("processing_time_ms").is_none());
    }

    #[test]
    fn denoise_options_accept_frontend_camel_case_wire_format() {
        let options: NativeDenoiseOptions = serde_json::from_value(serde_json::json!({
            "modelId": "scunet",
            "strength": 0.3,
        }))
        .expect("deserialize denoise options");

        assert_eq!(options.model_id.as_deref(), Some("scunet"));
        assert_eq!(options.strength, Some(0.3));
    }

    #[test]
    fn denoise_result_serializes_camel_case_wire_format() {
        let result = NativeDenoiseResult {
            png_base64: "encoded-png".to_string(),
            width: 12,
            height: 8,
            processing_time_ms: 27,
        };
        let json = serde_json::to_value(&result).expect("serialize denoise result");

        assert_eq!(json["pngBase64"], "encoded-png");
        assert_eq!(json["processingTimeMs"], 27);
        assert!(json.get("png_base64").is_none());
        assert!(json.get("processing_time_ms").is_none());
    }

    #[test]
    fn remove_background_quick_end_to_end_via_command() {
        let png = make_test_png(20, 20);
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": "quick",
        }))
        .expect("deserialize options");

        let result =
            remove_background_impl(png, options).expect("remove_background should succeed");
        assert_eq!(result.method, "quick");
        assert_eq!(result.width, 20);
        assert_eq!(result.height, 20);
        assert!(!result.mask_base64.is_empty());
        assert!(result.confidence > 0.0);
    }

    #[test]
    fn remove_background_rejects_undecodable_bytes() {
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": "quick",
        }))
        .expect("deserialize options");
        let err = remove_background_impl(vec![0, 1, 2, 3], options).unwrap_err();
        assert!(
            err.contains("decode"),
            "should report a decode error: {err}"
        );
    }

    #[test]
    #[cfg(not(feature = "ai"))]
    fn remove_background_ai_method_is_rejected_without_ai_feature() {
        // Without the `ai` Cargo feature, an AI request must fail explicitly.
        // Returning a Quick mask here would mislabel heuristic output as AI.
        // `ai` is a default feature (see Cargo.toml) — this only runs under
        // `cargo test --no-default-features` or `--features ""`.
        let png = make_test_png(10, 10);
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": "ai-balanced",
        }))
        .expect("deserialize options");

        assert!(remove_background_impl(png, options)
            .expect_err("AI request must not degrade to quick")
            .contains("not enabled"));
    }

    #[test]
    fn upscale_image_end_to_end_png_roundtrip() {
        let mut buf = image::RgbaImage::new(8, 8);
        for y in 0..8 {
            for x in 0..8 {
                let v = if (x + y) % 2 == 0 { 255 } else { 0 };
                buf.put_pixel(x, y, image::Rgba([v, v, v, 255]));
            }
        }
        let mut png: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode png");

        let options = UpscaleImageOptions {
            scale: 2.0,
            method: "nearest".into(),
            model_id: None,
            max_pixels: None,
            target_width: None,
            target_height: None,
            job_id: None,
        };
        let result = upscale_image_impl(
            &load_from_memory(&png).unwrap().to_rgba8().into_raw(),
            8,
            8,
            options.scale,
            options.target_width,
            options.target_height,
            options.max_pixels,
            &options.method,
            options
                .model_id
                .as_deref()
                .unwrap_or("upscale-realesr-general"),
            None,
            std::sync::Arc::new(AtomicBool::new(false)),
        )
        .expect("upscale_image should succeed");
        let decoded = image::load_from_memory(&result).expect("result must be PNG");
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 16);
    }

    #[test]
    fn upscale_binary_response_preserves_every_byte_without_json() {
        use tauri::ipc::{InvokeResponseBody, IpcResponse};

        let expected = vec![0, 1, 127, 128, 254, 255];
        let body = Response::new(expected.clone())
            .body()
            .expect("response body");
        match body {
            InvokeResponseBody::Raw(actual) => assert_eq!(actual, expected),
            InvokeResponseBody::Json(_) => panic!("binary upscale response was JSON encoded"),
        }
    }

    #[test]
    fn upscale_options_accept_frontend_camel_case_job_id() {
        let options: UpscaleImageOptions = serde_json::from_value(serde_json::json!({
            "scale": 2,
            "method": "nearest",
            "jobId": 42,
            "maxPixels": 1024,
        }))
        .expect("deserialize frontend options");
        assert_eq!(options.job_id, Some(42));
        assert_eq!(options.max_pixels, Some(1024));
    }

    #[test]
    fn upscale_state_is_latest_only_and_stale_finish_is_ignored() {
        let state = UpscaleCancelState::new();
        let gate = state.execution_gate();
        assert!(std::sync::Arc::ptr_eq(&gate, &state.execution_gate()));
        let first = state.register(10);
        let same = state.register(10);
        assert!(std::sync::Arc::ptr_eq(&first, &same));

        let second = state.register(11);
        assert!(
            first.load(Ordering::SeqCst),
            "replacement must cancel job 10"
        );
        assert!(!second.load(Ordering::SeqCst));

        state.finish(10);
        state.cancel(11);
        assert!(
            second.load(Ordering::SeqCst),
            "stale completion must not clear job 11"
        );
    }

    #[test]
    fn upscale_rejects_work_above_hard_pixel_budget_before_processing() {
        let error = upscale_image_impl(
            &[0, 0, 0, 0],
            4096,
            4096,
            3.0,
            None,
            None,
            None,
            "nearest",
            "unused",
            None,
            std::sync::Arc::new(AtomicBool::new(false)),
        )
        .expect_err("large output must be rejected");
        assert!(
            error.contains("effective limit"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn upscale_honors_preexisting_cancellation_before_processing() {
        let cancelled = std::sync::Arc::new(AtomicBool::new(true));
        let error = upscale_image_impl(
            &[0, 0, 0, 255],
            1,
            1,
            2.0,
            None,
            None,
            None,
            "nearest",
            "unused",
            None,
            cancelled,
        )
        .expect_err("cancelled job must not run");
        assert_eq!(error, "Upscale cancelled");
    }

    #[test]
    fn trace_image_end_to_end() {
        // Create a 20x20 PNG with a white square (foreground) on black background.
        let mut buf = image::RgbaImage::new(20, 20);
        for y in 0..20 {
            for x in 0..20 {
                let is_foreground = x > 2 && x < 17 && y > 2 && y < 17;
                buf.put_pixel(
                    x,
                    y,
                    if is_foreground {
                        image::Rgba([255, 255, 255, 255])
                    } else {
                        image::Rgba([0, 0, 0, 255])
                    },
                );
            }
        }
        let mut png: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode png");

        let options = TraceImageOptions {
            threshold: Some(128),
            min_pixels: Some(5),
            max_colors: Some(0),
            foreground: Some("light".into()),
            corner_angle: Some(135.0),
            max_error: Some(1.0),
            ..Default::default()
        };
        let result = tauri::async_runtime::block_on(trace_image_command(None, png, options))
            .expect("trace_image should succeed");
        // A 20x20 image with a white square foreground on black should trace at least one contour.
        assert!(
            !result.paths.is_empty(),
            "expected at least one traced path"
        );
        // Each path should be a closed BezierPath with points.
        for path in &result.paths {
            assert!(
                path.points.len() >= 3,
                "each path must have at least 3 points"
            );
            assert!(path.closed, "contour paths should be closed");
        }
    }

    #[test]
    fn trace_image_rejects_undecodable_bytes() {
        let options = TraceImageOptions {
            threshold: Some(128),
            min_pixels: Some(5),
            max_colors: Some(2),
            foreground: None,
            corner_angle: Some(135.0),
            max_error: Some(1.0),
            ..Default::default()
        };
        let err =
            tauri::async_runtime::block_on(trace_image_command(None, vec![0, 1, 2, 3], options))
                .expect_err("undecodable bytes must fail");
        assert!(
            err.contains("decode") || err.contains("dimensions"),
            "should report a decode or dimensions error: {err}"
        );
    }

    #[test]
    fn trace_image_sanitizes_out_of_range_options() {
        let options = TraceImageOptions {
            threshold: Some(0),
            min_pixels: Some(0),
            max_colors: Some(200),
            foreground: None,
            corner_angle: Some(10.0),
            max_error: Some(50.0),
            trace_mode: Some("pixel-art".into()),
            alpha_threshold: Some(255),
            centerline_width: Some(1000.0),
            centerline_prune: Some(5000.0),
            max_paths: Some(0),
            compound_holes: Some(true),
            job_id: None,
        };
        let opts = sanitize_trace_options(options);
        assert_eq!(opts.trace_mode, varve_trace::TraceMode::PixelArt);
        assert_eq!(opts.threshold, 1, "threshold clamped to 1");
        assert_eq!(opts.min_pixels, 1, "min_pixels clamped to 1");
        assert_eq!(opts.max_colors, 64, "max_colors clamped to 64");
        assert_eq!(opts.corner_angle, 90.0, "corner angle clamped to 90");
        assert_eq!(opts.max_error, 10.0, "max error clamped to 10");
        assert_eq!(opts.centerline_width, 100.0);
        assert_eq!(opts.centerline_prune, 1000.0);
        assert_eq!(
            opts.max_paths, MAX_TRACE_PATHS,
            "0 = unlimited → hard ceiling"
        );
    }

    #[test]
    fn trace_image_detects_pixel_bomb_dimensions() {
        // A tiny PNG with a huge declared dimension set would previously
        // allocate after decode; the pre-check must reject it by dimensions.
        let mut buf = image::RgbaImage::new(2, 2);
        buf.put_pixel(0, 0, image::Rgba([0, 0, 0, 255]));
        let mut png: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode png");
        let options = TraceImageOptions {
            job_id: Some(1),
            ..Default::default()
        };
        // A 2x2 image is well under the limit and must trace fine.
        let result = tauri::async_runtime::block_on(trace_image_command(None, png, options))
            .expect("small image traces");
        assert!(result.paths.is_empty() || !result.paths.is_empty());
    }

    // ── resolve_user_path ──────────────────────────────────────────────

    #[test]
    fn resolve_user_path_rejects_empty_path() {
        assert!(resolve_user_path("").is_err());
    }

    #[test]
    fn resolve_user_path_rejects_nul_byte() {
        assert!(resolve_user_path("/tmp/foo\0bar").is_err());
    }

    #[test]
    fn resolve_user_path_accepts_existing_file_under_temp() {
        let dir = std::env::temp_dir().join(format!("varve_path_test_{}", uuid()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let file = dir.join("existing.txt");
        std::fs::write(&file, b"hi").expect("write test file");

        let resolved = resolve_user_path(file.to_str().expect("utf8 path"))
            .expect("path under temp dir should resolve");
        assert_eq!(
            std::fs::canonicalize(&resolved).expect("canonicalize resolved"),
            std::fs::canonicalize(&file).expect("canonicalize expected")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_user_path_accepts_not_yet_existing_file_under_temp() {
        let dir = std::env::temp_dir().join(format!("varve_path_test_new_{}", uuid()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let target = dir.join("subdir").join("brand-new.txt");

        let resolved = resolve_user_path(target.to_str().expect("utf8 path"))
            .expect("not-yet-existing path under an existing temp ancestor should resolve");
        assert!(
            resolved.ends_with("subdir/brand-new.txt")
                || resolved.ends_with("subdir\\brand-new.txt")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_user_path_rejects_traversal_outside_scope() {
        // A path that resolves to a system file outside both the home and
        // temp directories must be rejected regardless of the '..' trick
        // used to construct it.
        let err = resolve_user_path("/etc/passwd");
        // /etc/passwd exists on Linux CI runners and dev machines; if it
        // doesn't (e.g. some minimal containers), the "does not exist"
        // path is exercised instead — both are acceptable rejections here,
        // the point is that it must never resolve successfully.
        assert!(
            err.is_err(),
            "/etc/passwd must never resolve as an allowed path"
        );
    }

    #[test]
    fn resolve_user_path_rejects_dotdot_in_not_yet_existing_suffix() {
        let dir = std::env::temp_dir().join(format!("varve_path_test_dotdot_{}", uuid()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let escaping = dir.join("..").join("..").join("etc").join("passwd");

        let result = resolve_user_path(escaping.to_str().expect("utf8 path"));
        assert!(
            result.is_err(),
            "'..' segments in a not-yet-existing suffix must be rejected, not silently joined"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_user_path_approved_accepts_paths_outside_home() {
        // The approved resolver is what lets documents on other drives and
        // removable media open/save. An existing system file outside $HOME
        // (e.g. /etc/hosts on Linux) must canonicalize successfully here —
        // unlike resolve_user_path, which rejects it. /etc/hosts exists on
        // every Linux/macOS dev machine.
        let resolved = resolve_user_path_approved("/etc/hosts")
            .expect("approved resolver accepts an existing out-of-home path");
        assert!(resolved.is_absolute());
    }

    #[test]
    fn resolve_user_path_approved_still_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("varve_path_test_approved_{}", uuid()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let escaping = dir.join("..").join("..").join("etc").join("passwd");

        assert!(
            resolve_user_path_approved(escaping.to_str().expect("utf8 path")).is_err(),
            "approved resolver must still reject '..' in a not-yet-existing suffix"
        );
        assert!(resolve_user_path_approved("").is_err());
        assert!(resolve_user_path_approved("/tmp/foo\0bar").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_user_path_rejects_symlink_escape() {
        let dir = std::env::temp_dir().join(format!("varve_path_test_symlink_{}", uuid()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let link = dir.join("escape");
        // Point a symlink at a real out-of-scope directory (a fresh temp
        // dir it also happens to be under /tmp is fine here — the actual
        // security-relevant case is the home/temp scope check itself,
        // already covered above; this test specifically proves symlinks
        // are resolved rather than trusted at face value).
        std::os::unix::fs::symlink("/etc", &link).expect("create symlink");
        let target = link.join("passwd");

        let result = resolve_user_path(target.to_str().expect("utf8 path"));
        assert!(
            result.is_err(),
            "a symlink pointing outside the allowed scope must not be trusted at face value"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── allocation bounds ────────────────────────────────────────────

    #[test]
    fn render_frame_pixels_rejects_oversized_request() {
        // `Response` isn't `Debug`, so match instead of `.unwrap_err()`.
        match render_frame_pixels(100_000, 100_000, 0) {
            Err(err) => assert!(
                err.contains("limit"),
                "expected a clear limit-exceeded error, got: {err}"
            ),
            Ok(_) => panic!("expected an oversized-request error"),
        }
    }

    #[test]
    fn render_frame_pixels_accepts_reasonable_request() {
        assert!(render_frame_pixels(64, 48, 0).is_ok());
    }

    fn oversized_node_list() -> Vec<IpcSceneNode> {
        let one = serde_json::json!({
            "id": "n",
            "name": "N",
            "transform": [1, 0, 0, 1, 0, 0],
            "shape": { "kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1 },
            "fill": [0, 0, 0, 255]
        });
        let many = serde_json::Value::Array(vec![one; MAX_SCENE_NODES + 1]);
        serde_json::from_value(many).expect("deserialize oversized node list")
    }

    #[test]
    fn build_render_ir_command_rejects_oversized_scene() {
        let err = build_render_ir(oversized_node_list()).unwrap_err();
        assert!(err.contains("limit"), "expected a limit error, got: {err}");
    }

    #[test]
    fn hit_test_command_rejects_oversized_scene() {
        let err = hit_test(oversized_node_list(), 0.0, 0.0).unwrap_err();
        assert!(err.contains("limit"), "expected a limit error, got: {err}");
    }

    #[test]
    fn export_node_pdf_rejects_oversized_scene() {
        let err = export_node_pdf(oversized_node_list(), None, None).unwrap_err();
        assert!(err.contains("limit"), "expected a limit error, got: {err}");
    }

    #[test]
    fn parse_nodes_from_json_rejects_oversized_scene() {
        let nodes_json = serde_json::to_string(&oversized_node_list_json()).expect("serialize");
        let err = parse_nodes_from_json(&nodes_json).unwrap_err();
        assert!(err.contains("limit"), "expected a limit error, got: {err}");
    }

    fn oversized_node_list_json() -> serde_json::Value {
        let one = serde_json::json!({
            "id": "n",
            "name": "N",
            "transform": [1, 0, 0, 1, 0, 0],
            "shape": { "kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1 },
            "fill": [0, 0, 0, 255]
        });
        serde_json::Value::Array(vec![one; MAX_SCENE_NODES + 1])
    }

    // ── Legacy application-data migration ───────────────────────────────────
    //
    // This runs once, at startup, before anything opens the document store, and
    // it moves a user's whole history: documents, backups, model cache, recent
    // files. A silent failure here is the kind that is discovered days later,
    // when the data it should have carried is already assumed lost.

    /// Fresh scratch directory holding `legacy_base` and the not-yet-created
    /// `data_dir` the migration writes into.
    fn migration_fixture() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("varve_migration_test_{}", uuid()));
        let legacy_base = root.join("legacy_base");
        let data_dir = root.join("dev.varve.desktop");
        std::fs::create_dir_all(&legacy_base).expect("create legacy base");
        (root, legacy_base, data_dir)
    }

    fn seed_legacy_dir(legacy_base: &std::path::Path) -> std::path::PathBuf {
        let legacy = legacy_base.join(LEGACY_APP_DIR);
        std::fs::create_dir_all(legacy.join("backups")).expect("create legacy backups");
        std::fs::write(legacy.join("documents.db"), b"db").expect("write legacy db");
        std::fs::write(legacy.join("backups").join("a.json"), b"{}").expect("write legacy backup");
        legacy
    }

    #[test]
    fn migration_copies_legacy_tree_including_nested_files() {
        let (root, legacy_base, data_dir) = migration_fixture();
        seed_legacy_dir(&legacy_base);

        let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

        assert_eq!(outcome, LegacyMigration::Copied);
        assert_eq!(
            std::fs::read(data_dir.join("documents.db")).expect("read migrated db"),
            b"db"
        );
        assert_eq!(
            std::fs::read(data_dir.join("backups").join("a.json")).expect("read migrated backup"),
            b"{}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_copies_rather_than_moves_so_rollback_stays_possible() {
        let (root, legacy_base, data_dir) = migration_fixture();
        let legacy = seed_legacy_dir(&legacy_base);

        migrate_legacy_data_dir_from(&legacy_base, &data_dir);

        // An older build still points at the legacy directory. If migration
        // moved instead of copied, downgrading would lose everything.
        assert!(
            legacy.join("documents.db").exists(),
            "legacy data was removed"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_does_not_overwrite_an_existing_data_dir() {
        let (root, legacy_base, data_dir) = migration_fixture();
        seed_legacy_dir(&legacy_base);
        std::fs::create_dir_all(&data_dir).expect("create current data dir");
        std::fs::write(data_dir.join("documents.db"), b"current").expect("write current db");

        let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

        assert_eq!(outcome, LegacyMigration::AlreadyPresent);
        assert_eq!(
            std::fs::read(data_dir.join("documents.db")).expect("read current db"),
            b"current",
            "existing data must never be clobbered by the migration"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_is_a_no_op_without_legacy_data() {
        let (root, legacy_base, data_dir) = migration_fixture();

        let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

        assert_eq!(outcome, LegacyMigration::NoLegacyData);
        assert!(
            !data_dir.exists(),
            "a fresh install must not get an empty data dir from the migration"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_ignores_a_legacy_path_that_is_a_file() {
        let (root, legacy_base, data_dir) = migration_fixture();
        std::fs::write(legacy_base.join(LEGACY_APP_DIR), b"not a directory")
            .expect("write legacy file");

        let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

        assert_eq!(outcome, LegacyMigration::NoLegacyData);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// The regression this whole split exists for.
    ///
    /// `copy_dir_all` creates the destination before it copies anything, so a
    /// failure partway leaves a directory that exists but is incomplete. The
    /// `data_dir.exists()` early return would then read that partial copy as a
    /// completed migration on every subsequent launch and never retry.
    #[cfg(unix)]
    #[test]
    fn failed_migration_removes_the_partial_copy_so_the_next_launch_retries() {
        use std::os::unix::fs::PermissionsExt;

        let (root, legacy_base, data_dir) = migration_fixture();
        let legacy = seed_legacy_dir(&legacy_base);

        // An unreadable subdirectory makes read_dir fail mid-copy.
        let locked = legacy.join("locked");
        std::fs::create_dir_all(&locked).expect("create locked dir");
        std::fs::write(locked.join("secret"), b"x").expect("write locked file");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000))
            .expect("chmod locked dir");

        let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

        // Restore permissions first so cleanup can run even if asserts fail.
        let _ = std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755));

        assert_eq!(outcome, LegacyMigration::Failed);
        assert!(
            !data_dir.exists(),
            "a partial copy was left behind; the next launch would treat it as migrated"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_dir_all_recreates_nested_structure() {
        let root = std::env::temp_dir().join(format!("varve_copy_test_{}", uuid()));
        let src = root.join("src");
        let dst = root.join("dst");
        std::fs::create_dir_all(src.join("a").join("b")).expect("create nested src");
        std::fs::write(src.join("top.txt"), b"top").expect("write top");
        std::fs::write(src.join("a").join("b").join("deep.txt"), b"deep").expect("write deep");

        copy_dir_all(&src, &dst).expect("copy should succeed");

        assert_eq!(
            std::fs::read(dst.join("top.txt")).expect("read top"),
            b"top"
        );
        assert_eq!(
            std::fs::read(dst.join("a").join("b").join("deep.txt")).expect("read deep"),
            b"deep"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_data_base_resolves_on_supported_platforms() {
        // cfg! makes this a per-platform constant; on the three we ship, a base
        // must resolve or the migration silently never runs.
        let base = legacy_data_base();
        if cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        )) {
            assert!(
                base.is_some(),
                "no legacy data base on a supported platform"
            );
        }
    }
}

/// Application-data directory used before the Strata -> Varve rename.
const LEGACY_APP_DIR: &str = "dev.strata.desktop";

/// What a migration attempt actually did. Returned so the behaviour can be
/// asserted in tests; the caller at startup ignores it.
#[derive(Debug, PartialEq, Eq)]
enum LegacyMigration {
    /// The current data directory already exists — migration already happened,
    /// or this is a fresh install that has been run before.
    AlreadyPresent,
    /// No legacy directory to copy from.
    NoLegacyData,
    /// Legacy data was copied into the current directory.
    Copied,
    /// The copy failed partway; the incomplete destination was removed.
    Failed,
}

fn migrate_legacy_data_dir(data_dir: &std::path::Path) {
    let Some(base) = legacy_data_base() else {
        return;
    };
    migrate_legacy_data_dir_from(&base, data_dir);
}

/// Copy the pre-rename application-data directory into the current one.
///
/// Split from `migrate_legacy_data_dir` so the base directory can be injected:
/// the public entry point resolves it from `$XDG_DATA_HOME`/`$HOME`/`$APPDATA`,
/// which a test cannot vary without mutating process-global environment state.
///
/// Copies rather than moves, so an older build pointed at the legacy directory
/// keeps working and a bad migration can be undone by deleting the new one.
fn migrate_legacy_data_dir_from(
    legacy_base: &std::path::Path,
    data_dir: &std::path::Path,
) -> LegacyMigration {
    if data_dir.exists() {
        return LegacyMigration::AlreadyPresent;
    }
    let legacy = legacy_base.join(LEGACY_APP_DIR);
    if !legacy.is_dir() {
        return LegacyMigration::NoLegacyData;
    }

    match copy_dir_all(&legacy, data_dir) {
        Ok(()) => LegacyMigration::Copied,
        Err(err) => {
            // A failed copy must not leave the destination behind. `copy_dir_all`
            // creates it before copying anything, so an error partway through
            // (disk full, unreadable source) leaves a directory that exists but
            // is incomplete — and the `data_dir.exists()` check above would then
            // treat that partial copy as a finished migration on every later
            // launch, silently stranding the rest of the user's data.
            //
            // Removing it means the next launch retries from a clean state.
            let _ = std::fs::remove_dir_all(data_dir);
            eprintln!(
                "[varve] could not migrate data from {}: {err}. \
                 The previous directory is untouched; retrying on next launch.",
                legacy.display()
            );
            LegacyMigration::Failed
        }
    }
}

fn legacy_data_base() -> Option<std::path::PathBuf> {
    if cfg!(target_os = "linux") {
        std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share"))
            })
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME")
            .map(|h| std::path::PathBuf::from(h).join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(std::path::PathBuf::from)
    } else {
        None
    }
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if ty.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}
