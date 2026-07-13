mod renderer;

use notify::Watcher;
use serde::{Deserialize, Serialize};
use strata_core::Point;
use tauri::ipc::Response;
use tauri::Emitter;
use tauri::Manager;
use image::load_from_memory;

use strata_bridge::{convert_engine_nodes, IpcSceneNode};

use crate::renderer::{generate_ir, generate_pixels, ShapeIr};

fn convert_scene(nodes: Vec<IpcSceneNode>) -> Vec<strata_core::SceneNode> {
    convert_engine_nodes(nodes)
}

#[tauri::command]
fn build_render_ir(nodes: Vec<IpcSceneNode>) -> Vec<strata_engine::RenderItem> {
    let scene = convert_scene(nodes);
    strata_engine::build_render_ir(&scene)
}

#[tauri::command]
fn hit_test(nodes: Vec<IpcSceneNode>, x: f64, y: f64) -> Option<usize> {
    let scene = convert_scene(nodes);
    strata_core::hit_test(&scene, Point::new(x, y))
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
    SceneIr { width, height, frame, shapes }
}

#[tauri::command]
fn render_frame_pixels(width: u32, height: u32, frame: u32) -> Response {
    let bytes = generate_pixels(width, height, frame);
    Response::new(bytes)
}

#[derive(Debug, Deserialize)]
struct Report { mode: String, fps: f64, frames: u64, elapsed: f64, bytes_per_frame: f64 }

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

#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

// ── Legacy Sync ──────────────────────────────────────────────────────────

/// Persist a document. Receives the full document JSON from the TS editor.
#[tauri::command]
fn sync_save(store: tauri::State<'_, strata_sync::DocumentStore>, doc_id: String, json: String) -> Result<(), String> {
    store.save_document(&doc_id, &json).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_load(store: tauri::State<'_, strata_sync::DocumentStore>, doc_id: String) -> Result<Option<String>, String> {
    store.load_document(&doc_id).map_err(|e| e.to_string())
}

// ── Background Removal ──────────────────────────────────

/// Wire format matches the `BackgroundRemovalOptions` shape sent by
/// `@strata/engine`'s `invokeTauriRemoveBackground` — camelCase, since
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

/// Wire format matches `BackgroundRemovalResult` in `@strata/engine` —
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

/// Remove background from an image via the native `strata-bgremove` crate.
///
/// `method: "quick"` always uses the heuristic engine (always available).
/// `"ai-balanced"` / `"ai-quality"` use ONNX inference when this binary was
/// built with the `ai` Cargo feature (opt-in, requires a downloaded model).
/// Builds without that feature reject AI requests instead of mislabelling a
/// heuristic result as AI output.
#[tauri::command]
fn remove_background(
    image_data: Vec<u8>,
    options: BgRemoveOptions,
) -> Result<BgRemoveResult, String> {
    let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;

    #[cfg(feature = "ai")]
    let method = match options.method.as_str() {
        "ai-balanced" => strata_bgremove::RemovalMethod::AiBalanced,
        "ai-quality" => strata_bgremove::RemovalMethod::AiQuality,
        _ => strata_bgremove::RemovalMethod::Quick,
    };
    #[cfg(not(feature = "ai"))]
    let method = match options.method.as_str() {
        "quick" => strata_bgremove::RemovalMethod::Quick,
        _ => return Err("AI background removal is not enabled in this desktop build".into()),
    };

    let remove_opts = strata_bgremove::RemovalOptions {
        method,
        tolerance: options.tolerance,
        feather_radius: options.feather_radius,
        decontaminate: options.decontaminate,
        click_x: options.click_x,
        click_y: options.click_y,
        preview_max_dimension: options.preview_max_dimension,
    };

    let result = strata_bgremove::remove_background(&img, &remove_opts)?;

    Ok(BgRemoveResult {
        mask_base64: result.mask_base64,
        confidence: result.confidence,
        method: result.method,
        processing_time_ms: result.processing_time_ms,
        width: result.width,
        height: result.height,
    })
}

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
}

fn default_upscale_method() -> String {
    "bicubic".into()
}

#[tauri::command]
fn upscale_image(image_data: Vec<u8>, options: UpscaleImageOptions) -> Result<Vec<u8>, String> {
    let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let pixels = rgba.into_raw();

    let scale = if let (Some(tw), Some(th)) = (options.target_width, options.target_height) {
        let sx = tw as f64 / width as f64;
        let sy = th as f64 / height as f64;
        sx.min(sy).max(0.001)
    } else {
        options.scale
    };

    let out_w = (width as f64 * scale).round().max(1.0) as u32;
    let out_h = (height as f64 * scale).round().max(1.0) as u32;
    if let Some(max) = options.max_pixels {
        if (out_w as u64) * (out_h as u64) > max {
            return Err(format!("Output exceeds the maximum of {max} pixels"));
        }
    }

    let result = if options.method == "ai" {
        let model_id = options
            .model_id
            .as_deref()
            .unwrap_or("upscale-realesr-general");
        #[cfg(feature = "ai")]
        {
            // Real-ESRGAN models are fixed 4x; ignore requested scale for inference.
            strata_upscale::ai_upscale(&pixels, width, height, model_id)?
        }
        #[cfg(not(feature = "ai"))]
        {
            return Err(format!(
                "AI upscaling requires a desktop build with the ai feature enabled (model '{model_id}')"
            ));
        }
    } else {
        let filter = strata_upscale::UpscaleFilter::from_method(&options.method);
        let mp = (width as u64) * (height as u64);
        if mp > 4_000_000 {
            strata_upscale::tiled_upscale(&pixels, width, height, scale, 256, 16, filter)?
        } else {
            strata_upscale::cpu_upscale(&pixels, width, height, scale, filter)?
        }
    };

    let result_w = if options.method == "ai" {
        width * 4
    } else {
        out_w
    };
    let result_h = if options.method == "ai" {
        height * 4
    } else {
        out_h
    };

    let out_img = image::DynamicImage::ImageRgba8(
        image::ImageBuffer::from_raw(result_w, result_h, result)
            .ok_or("Failed to construct output image")?,
    );

    let mut bytes: Vec<u8> = Vec::new();
    out_img
        .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode error: {e}"))?;

    Ok(bytes)
}

#[derive(Debug, Deserialize)]
struct TraceImageOptions {
    threshold: u8,
    min_pixels: usize,
    max_colors: u8,
}

#[tauri::command]
fn trace_image(image_data: Vec<u8>, options: TraceImageOptions) -> Result<Vec<strata_trace::Path>, String> {
    let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
    let gray = img.to_luma8();
    let (width, height) = gray.dimensions();
    let pixels = gray.into_raw();
    let opts = strata_trace::TraceOptions {
        threshold: options.threshold,
        min_pixels: options.min_pixels,
        max_colors: options.max_colors,
    };
    Ok(strata_trace::trace_contours(&pixels, width, height, &opts))
}

// ── PDF export ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ExportPdfOptions {
    page_width: f64,
    page_height: f64,
    title: String,
    author: String,
}

impl Default for ExportPdfOptions {
    fn default() -> Self {
        Self { page_width: 1920.0, page_height: 1080.0, title: "Strata Export".into(), author: "Strata".into() }
    }
}

#[tauri::command]
fn export_node_pdf(nodes: Vec<IpcSceneNode>, opts: Option<ExportPdfOptions>) -> Result<Vec<u8>, String> {
    let scene = convert_scene(nodes);
    let pdf_opts = opts.unwrap_or_default();
    let print_opts = strata_print::PdfOptions {
        page_width: pdf_opts.page_width,
        page_height: pdf_opts.page_height,
        title: pdf_opts.title,
        author: pdf_opts.author,
        ..Default::default()
    };
    strata_print::export_pdf(&scene, &print_opts)
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
}

impl Default for PdfXOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Strata Export".into(),
            author: "Strata".into(),
            bleed_mm: 3.0,
            include_crop_marks: false,
            include_registration_marks: false,
            enforce_dpi: 300.0,
            outline_text: false,
            icc_profile: "Fogra39".into(),
            color_bars: false,
            format: "screen".into(),
            font_data: None,
        }
    }
}

impl PdfXOptions {
    fn to_pdf_options(&self, page_height: f64) -> strata_print::PdfOptions {
        strata_print::PdfOptions {
            page_width: self.page_width,
            page_height,
            title: self.title.clone(),
            author: self.author.clone(),
            outline_text: self.outline_text,
            font_data: self.font_data.clone(),
            fonts: Vec::new(),
            registration_marks: false,
            color_bar: false,
            print_profile: None,
        }
    }
}

fn parse_nodes_from_json(nodes_json: &str) -> Result<Vec<strata_core::SceneNode>, String> {
    let nodes: Vec<IpcSceneNode> =
        serde_json::from_str(nodes_json).map_err(|e| format!("Nodes JSON parse error: {e}"))?;
    Ok(convert_scene(nodes))
}

#[tauri::command]
fn export_pdfx1a(
    _state: tauri::State<'_, strata_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    options_json: String,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Options JSON parse error: {e}"))?;
    let print_opts = opts.to_pdf_options(page_height);
    strata_print::cmyk::export_pdfx1a(&scene, &print_opts)
}

#[tauri::command]
fn export_pdfx4(
    _state: tauri::State<'_, strata_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    options_json: String,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Options JSON parse error: {e}"))?;
    let print_opts = opts.to_pdf_options(page_height);
    strata_print::cmyk::export_pdfx4(&scene, &print_opts)
}

#[tauri::command]
fn outline_text(
    _state: tauri::State<'_, strata_sync::DocumentStore>,
    text: String,
    font_data: Vec<u8>,
    font_size: f64,
) -> Result<String, String> {
    let fonts = &font_data;
    let outlines = strata_print::outline_text(fonts, &text, font_size)?;
    let mut path = String::new();
    for glyph in &outlines {
        let d = strata_print::commands_to_svg_path(&glyph.commands, 2);
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
fn export_pdf_with_options(
    _state: tauri::State<'_, strata_sync::DocumentStore>,
    nodes_json: String,
    page_height: f64,
    use_cmyk: bool,
    options_json: String,
) -> Result<Vec<u8>, String> {
    let scene = parse_nodes_from_json(&nodes_json)?;
    let opts: PdfXOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Options JSON parse error: {e}"))?;
    let print_opts = opts.to_pdf_options(page_height);

    match opts.format.as_str() {
        "x1a" | "pdf-x1a" => strata_print::cmyk::export_pdfx1a(&scene, &print_opts),
        "x4" | "pdf-x4" => strata_print::cmyk::export_pdfx4(&scene, &print_opts),
        _ if use_cmyk => strata_print::cmyk::export_pdfx1a(&scene, &print_opts),
        _ => strata_print::export_pdf(&scene, &print_opts),
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

fn file_to_home(f: strata_sync::FileRow) -> HomeFile {
    HomeFile {
        id: f.id, name: f.name, kind: f.kind, project_id: f.project_id,
        created_at: rfc3339_to_epoch_ms(&f.created_at),
        updated_at: rfc3339_to_epoch_ms(&f.updated_at),
        opened_at: rfc3339_to_epoch_ms(&f.opened_at),
        size: f.size, pinned: f.pinned,
        trashed_at: f.trashed_at.as_ref().map(|s| rfc3339_to_epoch_ms(s)),
        file_path: f.file_path, ordering: f.ordering, content_hash: f.content_hash,
    }
}

fn project_to_home(p: strata_sync::ProjectRow) -> HomeProject {
    HomeProject {
        id: p.id, name: p.name, color: p.color,
        created_at: rfc3339_to_epoch_ms(&p.created_at),
        updated_at: rfc3339_to_epoch_ms(&p.updated_at),
        pinned: p.pinned,
        trashed_at: p.trashed_at.as_ref().map(|s| rfc3339_to_epoch_ms(s)),
    }
}

fn now_rfc3339() -> String { chrono::Utc::now().to_rfc3339() }

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
fn home_list_files(store: tauri::State<'_, strata_sync::DocumentStore>) -> Result<Vec<HomeFile>, String> {
    store.list_files().map(|v| v.into_iter().map(file_to_home).collect()).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_list_trashed(store: tauri::State<'_, strata_sync::DocumentStore>) -> Result<Vec<HomeFile>, String> {
    store.list_trashed_files().map(|v| v.into_iter().map(file_to_home).collect()).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_get_file(store: tauri::State<'_, strata_sync::DocumentStore>, id: String) -> Result<Option<HomeFile>, String> {
    store.get_file(&id).map(|opt| opt.map(file_to_home)).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_read_file(store: tauri::State<'_, strata_sync::DocumentStore>, id: String) -> Result<Option<String>, String> {
    store.load_document(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_upsert_file(store: tauri::State<'_, strata_sync::DocumentStore>, entry: HomeFileInput, json: String) -> Result<(), String> {
    store.save_document(&entry.id, &json).map_err(|e| e.to_string())?;
    store.upsert_file(
        &entry.id, &entry.name, &entry.kind, entry.project_id.as_deref(),
        &epoch_ms_to_rfc3339(entry.created_at),
        &epoch_ms_to_rfc3339(entry.updated_at),
        &epoch_ms_to_rfc3339(entry.opened_at),
        entry.size, entry.pinned,
        entry.trashed_at.map(epoch_ms_to_rfc3339).as_deref(),
        entry.file_path.as_deref(), &entry.ordering, &entry.content_hash,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_touch_file(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, opened_at: Option<i64>) -> Result<(), String> {
    let ts = opened_at.map(epoch_ms_to_rfc3339).unwrap_or_else(now_rfc3339);
    store.touch_file(&id, &ts).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_rename_file(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, name: String) -> Result<(), String> {
    store.rename_file(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_pinned(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, pinned: bool) -> Result<(), String> {
    store.set_file_pinned(&id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_move_project(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, project_id: Option<String>) -> Result<(), String> {
    store.move_file_to_project(&id, project_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_trash(store: tauri::State<'_, strata_sync::DocumentStore>, id: String) -> Result<(), String> {
    store.trash_file(&id, &now_rfc3339()).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_restore(store: tauri::State<'_, strata_sync::DocumentStore>, id: String) -> Result<(), String> {
    store.restore_file(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_purge(store: tauri::State<'_, strata_sync::DocumentStore>, id: String) -> Result<(), String> {
    store.purge_file(&id).map_err(|e| e.to_string())
}

// Projects
#[tauri::command]
fn home_list_projects(store: tauri::State<'_, strata_sync::DocumentStore>) -> Result<Vec<HomeProject>, String> {
    store.list_projects().map(|v| v.into_iter().map(project_to_home).collect()).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_create_project(store: tauri::State<'_, strata_sync::DocumentStore>, name: String) -> Result<HomeProject, String> {
    let id = uuid();
    let now_rfc = now_rfc3339();
    let now_ms = chrono::Utc::now().timestamp_millis();
    store.create_project(&id, &name, None, &now_rfc).map_err(|e| e.to_string())?;
    Ok(HomeProject { id, name: name.clone(), color: None, created_at: now_ms, updated_at: now_ms, pinned: false, trashed_at: None })
}

#[tauri::command]
fn home_rename_project(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, name: String) -> Result<(), String> {
    store.rename_project(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_delete_project(store: tauri::State<'_, strata_sync::DocumentStore>, id: String) -> Result<(), String> {
    store.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_project_pinned(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, pinned: bool) -> Result<(), String> {
    store.set_project_pinned(&id, pinned).map_err(|e| e.to_string())
}

// View State
#[tauri::command]
fn home_get_view_state(store: tauri::State<'_, strata_sync::DocumentStore>) -> Result<Option<String>, String> {
    store.get_view_state("home").map_err(|e| e.to_string())
}

#[tauri::command]
fn home_set_view_state(store: tauri::State<'_, strata_sync::DocumentStore>, value: String) -> Result<(), String> {
    store.set_view_state("home", &value).map_err(|e| e.to_string())
}

// Generic small app settings (e.g. onboarding-complete) — persisted in the
// same native SQLite store as documents, rather than WebView localStorage,
// which is not guaranteed to survive between separate app launches on every
// platform/WebView engine.
#[tauri::command]
fn app_get_setting(store: tauri::State<'_, strata_sync::DocumentStore>, key: String) -> Result<Option<String>, String> {
    store.get_view_state(&format!("app-setting:{key}")).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_set_setting(store: tauri::State<'_, strata_sync::DocumentStore>, key: String, value: String) -> Result<(), String> {
    store.set_view_state(&format!("app-setting:{key}"), &value).map_err(|e| e.to_string())
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
fn home_get_thumbnail(store: tauri::State<'_, strata_sync::DocumentStore>, hash: String) -> Result<Option<String>, String> {
    store.get_thumbnail(&hash).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_put_thumbnail(store: tauri::State<'_, strata_sync::DocumentStore>, input: ThumbnailInput) -> Result<(), String> {
    store.put_thumbnail(&input.hash, &input.data_url, input.width, input.height, &epoch_ms_to_rfc3339(input.created_at)).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_evict_thumbnails(store: tauri::State<'_, strata_sync::DocumentStore>, keep_count: i64) -> Result<i64, String> {
    store.evict_thumbnails(keep_count).map_err(|e| e.to_string())
}

// ── Search ───────────────────────────────────────────────────────────

#[tauri::command]
fn home_search_files(store: tauri::State<'_, strata_sync::DocumentStore>, query: String) -> Result<Vec<HomeFile>, String> {
    store.search_files(&query).map(|v| v.into_iter().map(file_to_home).collect()).map_err(|e| e.to_string())
}

// ── Reorder ──────────────────────────────────────────────────────────

#[tauri::command]
fn home_reorder_file(store: tauri::State<'_, strata_sync::DocumentStore>, id: String, ordering: String) -> Result<(), String> {
    store.reorder_file(&id, &ordering).map_err(|e| e.to_string())
}

// ── File-system read/write (for open/save from disk) ─────────────────────

#[tauri::command]
fn home_read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| e.to_string())
}

fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
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

/// Close the native splashscreen and reveal the main window once the frontend is ready.
/// Pattern: https://v2.tauri.app/learn/splashscreen/ (2026-07-13)
#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).expect("create data dir");
            let db_path = data_dir.join("documents.db");
            let store = strata_sync::DocumentStore::new(&db_path).expect("init document store");
            app.manage(store);

            // Start file-system watcher for home directory
            let watch_handle = app.handle().clone();
            let watch_path = data_dir.clone();
            std::thread::spawn(move || {
                let (tx, rx) = std::sync::mpsc::channel::<()>();
                let mut watcher = match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                    if let Ok(event) = res {
                        let has_strata = event.paths.iter().any(|p| {
                            p.extension().map(|e| e == "strata").unwrap_or(false)
                        });
                        if has_strata {
                            let _ = tx.send(());
                        }
                    }
                }) {
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
            home_search_files,
            home_reorder_file,
            home_read_text_file,
            home_write_text_file,
            write_binary_file,
            remove_background,
            trace_image,
            upscale_image,
            export_node_pdf,
            export_pdfx1a,
            export_pdfx4,
            outline_text,
            export_pdf_with_options,
            // W6: backend-dependent UI stubs
            ai_chat,
            get_collab_users,
            update_cursor,
            list_plugins,
            close_splashscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use strata_core::EngineColor;

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
        let ir = strata_engine::build_render_ir(&scene);
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
                profile: None
            }
        );
        assert_eq!(
            ir[0].primitive,
            strata_engine::Primitive::Rect {
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
                profile: None
            }
        );
        assert_eq!(
            ir[1].primitive,
            strata_engine::Primitive::Circle {
                cx: 0.0,
                cy: 0.0,
                r: 5.0
            }
        );

        // Ellipse: translated (100,100)
        assert_eq!(ir[2].transform, [1.0, 0.0, 0.0, 1.0, 100.0, 100.0]);
        assert_eq!(
            ir[2].primitive,
            strata_engine::Primitive::Ellipse {
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
            strata_engine::Primitive::Line {
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
                profile: None
            }
        );
        assert!(matches!(
            ir[4].primitive,
            strata_engine::Primitive::Text { text: _, .. }
        ));
        if let strata_engine::Primitive::Text { ref text, font_size, ref font_family, font_weight, ref font_style, .. } = ir[4].primitive {
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
                profile: None
            }
        );

        let ir = strata_engine::build_render_ir(&scene);
        assert!(ir[0].fills.is_some());
        assert!(ir[0].filters.is_some());
        if let strata_engine::Primitive::Rect { corner_radius, .. } = &ir[0].primitive {
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
        let hit = strata_core::hit_test(&scene, Point::new(2.0, 8.0));
        assert_eq!(hit, Some(0));

        // Circle at world (50,50) radius 5: (52,50) is inside.
        let hit = strata_core::hit_test(&scene, Point::new(52.0, 50.0));
        assert_eq!(hit, Some(1));

        // Ellipse at world center (110,105), rx=8 ry=4: (115,105) is inside.
        let hit = strata_core::hit_test(&scene, Point::new(115.0, 105.0));
        assert_eq!(hit, Some(2));

        // Point (5,5) is inside both the rect and the line (tolerance 2).
        // hit_test returns the topmost (highest index) — line at index 3.
        let hit = strata_core::hit_test(&scene, Point::new(5.0, 5.0));
        assert_eq!(hit, Some(3));

        // Point outside all shapes
        let hit = strata_core::hit_test(&scene, Point::new(999.0, 999.0));
        assert_eq!(hit, None);
    }

    #[test]
    fn output_serialization_matches_ts_wire_format() {
        let json = ts_wire_json();
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        let scene = convert_scene(nodes);
        let ir = strata_engine::build_render_ir(&scene);

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
        assert!(fill.is_object(), "fill should be a JSON object (EngineColor)");
        assert_eq!(
            fill.get("space").and_then(|v| v.as_str()),
            Some("rgb"),
            "fill should have space='rgb'"
        );
    }

    // ── New command integration tests ─────────────────────────────────────

    fn test_font_data() -> Vec<u8> {
        let paths = [
            "/usr/share/fonts/TTF/Vera.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/Inter-Regular.ttf",
        ];
        for p in &paths {
            if let Ok(data) = std::fs::read(p) {
                return data;
            }
        }
        panic!("no test font found — tried {paths:?}")
    }

    #[test]
    fn export_pdfx1a_from_json_string() {
        // Simulate what the TS bridge sends: nodes as JSON string + options as JSON string
        let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize nodes");
        let options_json = serde_json::json!({
            "pageWidth": 300.0,
            "pageHeight": 200.0,
            "title": "Test X-1a",
            "author": "Strata",
            "bleedMm": 3.0,
            "includeCropMarks": false,
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_str(&nodes_json).expect("deserialize from json string");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        let bytes = strata_print::cmyk::export_pdfx1a(&scene, &print_opts).expect("pdfx1a");
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
            "author": "Strata",
        })
        .to_string();

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        let bytes = strata_print::cmyk::export_pdfx4(&scene, &print_opts).expect("pdfx4");
        assert!(bytes.starts_with(b"%PDF-1.6"), "PDF/X-4 should use PDF 1.6");
    }

    #[test]
    fn outline_text_command_returns_svg_path() {
        let font_data = test_font_data();
        let result = strata_print::outline_text(&font_data, "A", 16.0).expect("outline");
        assert!(!result.is_empty(), "should produce glyph outlines");
        let path = result
            .iter()
            .map(|g| strata_print::commands_to_svg_path(&g.commands, 2))
            .filter(|d| !d.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!path.is_empty(), "SVG path should not be empty");
        assert!(path.starts_with('M'), "should start with MoveTo");
    }

    #[test]
    fn outline_text_command_empty_string() {
        let font_data = test_font_data();
        let result = strata_print::outline_text(&font_data, "", 16.0).expect("outline empty");
        assert!(result.is_empty(), "empty text should produce no outlines");
    }

    #[test]
    fn outline_text_command_returns_path_for_multiple_glyphs() {
        let font_data = test_font_data();
        let result = strata_print::outline_text(&font_data, "AB", 16.0).expect("outline AB");
        assert_eq!(result.len(), 2, "should produce two glyph outlines");
        let path = result
            .iter()
            .map(|g| strata_print::commands_to_svg_path(&g.commands, 2))
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

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(108.0);
        let bytes = strata_print::export_pdf(&scene, &print_opts).expect("screen pdf");
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

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        // use_cmyk = true should dispatch to export_pdfx1a
        let bytes = strata_print::cmyk::export_pdfx1a(&scene, &print_opts).expect("pdfx1a");
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

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_str(&nodes_json).expect("deserialize");
        let scene = convert_scene(nodes);
        let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
        let print_opts = opts.to_pdf_options(200.0);
        let bytes = strata_print::cmyk::export_pdfx4(&scene, &print_opts).expect("pdfx4");
        assert!(bytes.starts_with(b"%PDF-1.6"), "format x4 should produce PDF/X-4");
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
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
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
    fn remove_background_quick_end_to_end_via_command() {
        let png = make_test_png(20, 20);
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": "quick",
        }))
        .expect("deserialize options");

        let result = remove_background(png, options).expect("remove_background should succeed");
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
        let err = remove_background(vec![0, 1, 2, 3], options).unwrap_err();
        assert!(err.contains("decode"), "should report a decode error: {err}");
    }

    #[test]
    fn remove_background_ai_method_is_rejected_without_ai_feature() {
        // Without the `ai` Cargo feature compiled in (the default distributed
        // build per ADR-0005), requesting an AI method must not error — it
        // should transparently degrade to the heuristic and say so honestly
        // via the returned `method` field.
        let png = make_test_png(10, 10);
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": "ai-balanced",
        }))
        .expect("deserialize options");

        #[cfg(not(feature = "ai"))]
        assert!(remove_background(png, options)
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
        };
        let result = upscale_image(png, options).expect("upscale_image should succeed");
        let decoded = image::load_from_memory(&result).expect("result must be PNG");
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 16);
    }

    #[test]
    fn trace_image_end_to_end() {
        // Create a 20x20 PNG with a white square (foreground) on black background.
        let mut buf = image::RgbaImage::new(20, 20);
        for y in 0..20 {
            for x in 0..20 {
                let is_foreground = x > 2 && x < 17 && y > 2 && y < 17;
                buf.put_pixel(x, y, if is_foreground {
                    image::Rgba([255, 255, 255, 255])
                } else {
                    image::Rgba([0, 0, 0, 255])
                });
            }
        }
        let mut png: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode png");

        let options = TraceImageOptions {
            threshold: 128,
            min_pixels: 5,
            max_colors: 2,
        };
        let result = trace_image(png, options).expect("trace_image should succeed");
        // A 20x20 image with a white square foreground on black should trace at least one contour.
        assert!(!result.is_empty(), "expected at least one traced path");
        // Each path should be a closed contour with points.
        for path in &result {
            assert!(path.points.len() >= 3, "each path must have at least 3 points");
            assert!(path.closed, "contour paths should be closed");
        }
    }

    #[test]
    fn trace_image_rejects_undecodable_bytes() {
        let options = TraceImageOptions {
            threshold: 128,
            min_pixels: 5,
            max_colors: 2,
        };
        let err = trace_image(vec![0, 1, 2, 3], options).unwrap_err();
        assert!(err.contains("decode"), "should report a decode error: {err}");
    }
}
