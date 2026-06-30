mod renderer;

use notify::Watcher;
use serde::{Deserialize, Serialize};
use strata_core::{Circle, Line, Point, Rect, Shape};
use tauri::ipc::Response;
use tauri::Emitter;
use tauri::Manager;

use crate::renderer::{generate_ir, generate_pixels, ShapeIr};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
enum IpcShape {
    #[serde(rename = "rect")]
    Rect { x: f64, y: f64, w: f64, h: f64 },
    #[serde(rename = "ellipse")]
    Ellipse { cx: f64, cy: f64, rx: f64, ry: f64 },
    #[serde(rename = "circle")]
    Circle { cx: f64, cy: f64, r: f64 },
    #[serde(rename = "line")]
    Line { from: [f64; 2], to: [f64; 2], tolerance: f64 },
    #[serde(rename = "polygon")]
    Polygon { cx: f64, cy: f64, radius: f64, sides: u32, rotation: f64 },
    #[serde(rename = "star")]
    Star { cx: f64, cy: f64, #[serde(rename = "innerRadius")] inner_radius: f64, #[serde(rename = "outerRadius")] outer_radius: f64, points: u32, rotation: f64 },
    #[serde(rename = "text")]
    Text {
        text: String,
        #[serde(rename = "fontSize")]
        font_size: f64,
        #[serde(rename = "fontFamily")]
        font_family: String,
        #[serde(rename = "fontWeight")]
        font_weight: u16,
        #[serde(rename = "fontStyle")]
        font_style: String,
        #[serde(rename = "textAlign")]
        text_align: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
}

impl IpcShape {
    fn into_shape(self) -> Shape {
        match self {
            IpcShape::Rect { x, y, w, h } => Shape::Rect(Rect::new(x, y, x + w, y + h)),
            IpcShape::Ellipse { cx, cy, rx, ry } => Shape::Ellipse { center: Point::new(cx, cy), rx, ry },
            IpcShape::Circle { cx, cy, r } => Shape::Circle(Circle::new(Point::new(cx, cy), r)),
            IpcShape::Line { from, to, tolerance } => Shape::Line { line: Line::new(Point::new(from[0], from[1]), Point::new(to[0], to[1])), tolerance },
            IpcShape::Polygon { cx, cy, radius, sides, rotation } => Shape::Polygon { cx, cy, radius, sides, rotation },
            IpcShape::Star { inner_radius, outer_radius, cx, cy, points, rotation } => Shape::Star { cx, cy, inner_radius, outer_radius, points, rotation },
            IpcShape::Text { text, font_size, font_family, font_weight, font_style, text_align, x, y, w, h } => Shape::Text {
                text,
                font_size,
                font_family,
                font_weight,
                font_style,
                text_align,
                x,
                y,
                w,
                h,
            },
        }
    }
}

#[derive(Debug, Deserialize)]
struct IpcSceneNode {
    #[allow(dead_code)]
    id: String,
    name: String,
    #[serde(with = "affine_serde")]
    transform: strata_core::Affine,
    shape: IpcShape,
    fill: [u8; 4],
    #[serde(default = "default_opacity")]
    opacity: f64,
    #[serde(default = "default_blend")]
    blend_mode: String,
    #[serde(default)]
    rotation: f64,
    #[serde(default)]
    strokes: Vec<strata_core::Stroke>,
    #[serde(default)]
    effects: Vec<strata_core::Effect>,
}

fn default_opacity() -> f64 { 1.0 }
fn default_blend() -> String { "normal".into() }

mod affine_serde {
    use serde::{Deserialize, Deserializer};
    use strata_core::Affine;
    pub fn deserialize<'de, D>(d: D) -> Result<Affine, D::Error> where D: Deserializer<'de> {
        let coeffs: [f64; 6] = Deserialize::deserialize(d)?;
        Ok(Affine::new(coeffs))
    }
}

fn convert_scene(nodes: Vec<IpcSceneNode>) -> Vec<strata_core::SceneNode> {
    nodes.into_iter().enumerate().map(|(i, n)| strata_core::SceneNode {
        id: strata_core::NodeId(i as u64),
        name: n.name,
        transform: n.transform,
        shape: n.shape.into_shape(),
        fill: n.fill,
        children: Vec::new(),
        component_id: None,
        slots: None,
        opacity: n.opacity,
        blend_mode: n.blend_mode,
        rotation: n.rotation,
        strokes: n.strokes,
        effects: n.effects,
    }).collect()
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
    };
    strata_print::export_pdf(&scene, &print_opts)
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
            home_get_thumbnail,
            home_put_thumbnail,
            home_evict_thumbnails,
            home_search_files,
            home_reorder_file,
            home_read_text_file,
            home_write_text_file,
            write_binary_file,
            export_node_pdf,
            // W6: backend-dependent UI stubs
            ai_chat,
            get_collab_users,
            update_cursor,
            list_plugins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(ir[0].fill, [57, 208, 198, 255]);
        assert_eq!(
            ir[0].primitive,
            strata_engine::Primitive::Rect {
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
            }
        );

        // Circle: translated (50,50), red
        assert_eq!(ir[1].transform, [1.0, 0.0, 0.0, 1.0, 50.0, 50.0]);
        assert_eq!(ir[1].fill, [255, 0, 0, 255]);
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
        assert_eq!(ir[4].fill, [16, 21, 31, 255]);
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

        // Verify fill is an array of 4 numbers
        let fill = first.get("fill").unwrap();
        assert!(fill.is_array(), "fill should be a JSON array");
        assert_eq!(fill.as_array().unwrap().len(), 4);
    }
}
