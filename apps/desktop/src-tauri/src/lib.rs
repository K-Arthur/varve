//! Strata desktop shell — entrypoint.
//!
//! Tauri IPC commands:
//!   - `build_render_ir` — scene nodes → render IR (native engine bridge)
//!   - `hit_test` — world-space point → topmost node index
//!   - Legacy spike commands (render_frame_ir, render_frame_pixels, report, done)

mod renderer;

use serde::{Deserialize, Serialize};
use strata_core::{Circle, Line, Point, Rect, Shape};
use tauri::ipc::Response;
use tauri::Manager;

use crate::renderer::{generate_ir, generate_pixels, ShapeIr};

/// IPC wire shape — kind-tagged to match `@strata/engine`'s `Shape` type exactly
/// (`{ kind: 'rect', x, y, w, h } | ...`). Rust's `strata_core::Shape` uses
/// serde's default externally-tagged enum form with kurbo field names
/// (`{ "Rect": { x0, y0, x1, y1 } }`), which does NOT match the TS wire format.
/// This adapter is the seam: deserialize the TS form, then convert to the
/// native `strata_core::Shape` for the engine.
///
/// Research basis: serde `#[serde(tag = "kind")]` internally-tagged enum;
/// `@strata/engine` `Shape` is the stable webview contract (ADR-0001).
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
    Line {
        from: [f64; 2],
        to: [f64; 2],
        tolerance: f64,
    },
    #[serde(rename = "polygon")]
    Polygon {
        cx: f64,
        cy: f64,
        radius: f64,
        sides: u32,
        rotation: f64,
    },
    #[serde(rename = "star")]
    Star {
        cx: f64,
        cy: f64,
        #[serde(rename = "innerRadius")]
        inner_radius: f64,
        #[serde(rename = "outerRadius")]
        outer_radius: f64,
        points: u32,
        rotation: f64,
    },
}

impl IpcShape {
    /// Convert the TS wire form into the native engine shape.
    /// kurbo `Rect` is `(x0, y0, x1, y1)`; TS rect is `(x, y, w, h)`.
    fn into_shape(self) -> Shape {
        match self {
            IpcShape::Rect { x, y, w, h } => Shape::Rect(Rect::new(x, y, x + w, y + h)),
            IpcShape::Ellipse { cx, cy, rx, ry } => Shape::Ellipse {
                center: Point::new(cx, cy),
                rx,
                ry,
            },
            IpcShape::Circle { cx, cy, r } => Shape::Circle(Circle::new(Point::new(cx, cy), r)),
            IpcShape::Line { from, to, tolerance } => Shape::Line {
                line: Line::new(Point::new(from[0], from[1]), Point::new(to[0], to[1])),
                tolerance,
            },
            IpcShape::Polygon { cx, cy, radius, sides, rotation } => Shape::Polygon {
                cx,
                cy,
                radius,
                sides,
                rotation,
            },
            IpcShape::Star { inner_radius, outer_radius, cx, cy, points, rotation } => Shape::Star {
                cx,
                cy,
                inner_radius,
                outer_radius,
                points,
                rotation,
            },
        }
    }
}

/// Adapter type: TS-side SceneNode serialized via serde_json.
/// Fields mirror @strata/engine's flat `SceneNode` wire shape
/// (`{ id, name, transform, shape, fill }`). The `shape` field uses `IpcShape`
/// (kind-tagged) so it deserializes the TS form directly.
#[derive(Debug, Deserialize)]
struct IpcSceneNode {
    #[allow(dead_code)]
    id: String,
    name: String,
    #[serde(with = "affine_serde")]
    transform: strata_core::Affine,
    shape: IpcShape,
    fill: [u8; 4],
}

/// Adapter for strata_core::Affine <-> [f64; 6] JSON array.
/// Only deserialize is used (IPC input side). Serialize is added when the
/// engine's output RenderItem also flows through this adapter.
mod affine_serde {
    use serde::{Deserialize, Deserializer};
    use strata_core::Affine;

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
            shape: n.shape.into_shape(),
            fill: n.fill,
            children: Vec::new(),
            component_id: None,
            slots: None,
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

/// Persist a document. Receives the full document JSON from the TS editor.
#[tauri::command]
fn sync_save(
    store: tauri::State<'_, strata_sync::DocumentStore>,
    doc_id: String,
    json: String,
) -> Result<(), String> {
    store.save_document(&doc_id, &json).map_err(|e| e.to_string())
}

/// Load a document by ID. Returns `null` (None) if not found.
#[tauri::command]
fn sync_load(
    store: tauri::State<'_, strata_sync::DocumentStore>,
    doc_id: String,
) -> Result<Option<String>, String> {
    store.load_document(&doc_id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).expect("create data dir");
            let db_path = data_dir.join("documents.db");
            let store = strata_sync::DocumentStore::new(&db_path)
                .expect("init document store");
            app.manage(store);
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
            done
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact JSON that `@strata/engine`'s `nativeEngine.buildIr()` would send
    /// across the Tauri IPC boundary. Proves the `IpcSceneNode` + `IpcShape`
    /// adapters deserialize the TS wire format correctly.
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
            }
        ])
    }

    #[test]
    fn round_trip_build_render_ir() {
        let json = ts_wire_json();
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        assert_eq!(nodes.len(), 4);

        let scene = convert_scene(nodes);
        let ir = strata_engine::build_render_ir(&scene);
        assert_eq!(ir.len(), 4);

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
    }

    #[test]
    fn round_trip_hit_test() {
        let json = ts_wire_json();
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        let scene = convert_scene(nodes);

        // Point (2,8) should hit only the rect (node 0);
        // the line (0,0)→(10,10) tol=2 does not reach (2,8).
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
        assert_eq!(arr.len(), 4);

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
