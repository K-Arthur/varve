//! Strata desktop shell — entrypoint.
//!
//! Tauri IPC commands:
//!   - `build_render_ir` — scene nodes → render IR (native engine bridge)
//!   - `hit_test` — world-space point → topmost node index
//!   - Legacy spike commands (render_frame_ir, render_frame_pixels, report, done)

mod renderer;

use serde::{Deserialize, Serialize};
use strata_core::Point;
use tauri::ipc::Response;

use crate::renderer::{generate_ir, generate_pixels, ShapeIr};

/// Adapter type: TS-side SceneNode serialized via serde_json.
/// Fields mirror @strata/engine's SceneNode shape.
#[derive(Debug, Deserialize)]
struct IpcSceneNode {
    id: String,
    name: String,
    #[serde(with = "affine_serde")]
    transform: kurbo::Affine,
    shape: strata_core::Shape,
    fill: [u8; 4],
}

/// Adapter for kurbo::Affine <-> [f64; 6] JSON array.
mod affine_serde {
    use kurbo::Affine;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(aff: &Affine, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        aff.as_coeffs().serialize(s)
    }

    pub fn deserialize<'de, D>(d: D) -> Result<Affine, D::Error>
    where
        D: Deserializer<'de>,
    {
        let coeffs: [f64; 6] = Deserialize::deserialize(d)?;
        Ok(Affine::new(coeffs))
    }
}

fn convert_scene(nodes: Vec<IpcSceneNode>) -> Vec<strata_core::SceneNode> {
    nodes
        .into_iter()
        .enumerate()
        .map(|(i, n)| strata_core::SceneNode {
            id: strata_core::NodeId(i as u64),
            name: n.name,
            transform: n.transform,
            shape: n.shape,
            fill: n.fill,
        })
        .collect()
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

/// Compact scene IR pushed across the IPC boundary (KB-scale, not MB).
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

/// Raw RGBA pixels pushed across the boundary (MB-scale at full res).
#[tauri::command]
fn render_frame_pixels(width: u32, height: u32, frame: u32) -> Response {
    let bytes = generate_pixels(width, height, frame);
    Response::new(bytes)
}

/// Frontend self-reports each measured mode; we log to stdout for capture.
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
    println!(
        "[spike] mode={:<6} fps={:>6.1}  frames={:>5}  elapsed={:>5.2}s  bytes/frame={:>10.0}  bandwidth={:>8.1} MB/s",
        report.mode,
        report.fps,
        report.frames,
        report.elapsed,
        report.bytes_per_frame,
        report.bytes_per_frame * report.fps / 1_000_000.0,
    );
}

#[tauri::command]
fn done(app: tauri::AppHandle) {
    println!("[spike] all modes measured, exiting.");
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            build_render_ir,
            hit_test,
            render_frame_ir,
            render_frame_pixels,
            report,
            done
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
