//! Strata desktop shell — entrypoint.
//!
//! Task 0.2 render spike: measures two native→webview transport strategies.
//! See ADR-0001 for the decision and the empirical results.

mod renderer;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::renderer::{generate_ir, generate_pixels, ShapeIr};

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
            render_frame_ir,
            render_frame_pixels,
            report,
            done
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
