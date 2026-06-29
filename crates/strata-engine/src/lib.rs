//! Strata engine: scene -> render-IR builder.
//!
//! Per ADR-0001 the desktop/web UI replays a compact render-command IR (drawn
//! by the webview's canvas/WebGPU). This crate turns a `strata-core` Scene into
//! that IR. The heavy rasterization (wgpu GPU pipeline + tiny-skia CPU fallback
//! for headless/export) is layered on top in later tasks; the IR contract is the
//! stable seam between native engine and webview.
//!
//! Research basis: retained-mode draw-list emission (Piet/Skia Scene); the
//! IR-replay transport was validated empirically in task 0.2 (86 fps vs 8.5 fps
//! for pixel-push).

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use strata_core::{SceneNode, Shape};

/// One drawable record in the render IR. The webview replays these in order.
///
/// `transform` is `[f64; 6]` (not `kurbo::Affine`) because TS `Affine` =
/// `readonly [number, number, number, number, number, number]` — kurbo's default
/// serde produces `{"coeffs": [a,b,c,d,e,f]}` which would mismatch the wire format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderItem {
    pub transform: [f64; 6],
    /// RGBA fill, 0-255 per channel.
    pub fill: [u8; 4],
    pub primitive: Primitive,
}

/// Geometry primitive in a node's LOCAL space (pre-transform).
///
/// Serde uses internally-tagged representation matching the TS Primitive type
/// (`{ kind, ...fields }`) so the IPC bridge between Rust and the webview works
/// without adapter code. `Line` carries `from`/`to` as `[f64; 2]` (not
/// `kurbo::Point`) because TS `Point = readonly [number, number]` — kurbo's
/// Point serializes as `{x, y}` which would mismatch the wire format.
///
/// Research basis: serde `#[serde(tag = "kind")]` internally-tagged enum;
/// `@strata/engine` `Primitive` type is the stable webview contract (ADR-0001).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Primitive {
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

/// Build the render IR from a scene (paint order preserved). One item per node.
pub fn build_render_ir(nodes: &[SceneNode]) -> Vec<RenderItem> {
    nodes
        .iter()
        .map(|n| RenderItem {
            transform: n.transform.as_coeffs(),
            fill: n.fill,
            primitive: primitive_of(&n.shape),
        })
        .collect()
}

/// Build the render IR from a DFS-walked scene (from `walk_nodes`).
/// Emits one item per visited node, recursively flattening frame children
/// in paint order. Use this for nested frame-based scenes.
pub fn build_render_ir_flat(walked: &[(strata_core::NodeId, &SceneNode, Option<strata_core::NodeId>)]) -> Vec<RenderItem> {
    walked
        .iter()
        .map(|(_, node, _)| RenderItem {
            transform: node.transform.as_coeffs(),
            fill: node.fill,
            primitive: primitive_of(&node.shape),
        })
        .collect()
}

fn primitive_of(shape: &Shape) -> Primitive {
    match shape {
        Shape::Rect(r) => Primitive::Rect {
            x: r.min_x(),
            y: r.min_y(),
            w: r.width(),
            h: r.height(),
        },
        Shape::Ellipse { center, rx, ry } => Primitive::Ellipse {
            cx: center.x,
            cy: center.y,
            rx: *rx,
            ry: *ry,
        },
        Shape::Circle(c) => Primitive::Circle {
            cx: c.center.x,
            cy: c.center.y,
            r: c.radius,
        },
        Shape::Line { line, tolerance } => Primitive::Line {
            from: [line.p0.x, line.p0.y],
            to: [line.p1.x, line.p1.y],
            tolerance: *tolerance,
        },
        Shape::Polygon { cx, cy, radius, sides, rotation } => Primitive::Polygon {
            cx: *cx,
            cy: *cy,
            radius: *radius,
            sides: *sides,
            rotation: *rotation,
        },
        Shape::Star { cx, cy, inner_radius, outer_radius, points, rotation } => Primitive::Star {
            cx: *cx,
            cy: *cy,
            inner_radius: *inner_radius,
            outer_radius: *outer_radius,
            points: *points,
            rotation: *rotation,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use strata_core::{Affine, Circle, Point, Rect};

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(id),
            name: format!("r{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
            fill: [57, 208, 198, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
        }
    }

    #[test]
    fn one_item_per_node_in_paint_order() {
        let scene = vec![
            rect_node(1, 0.0, 0.0, 10.0, 10.0),
            rect_node(2, 5.0, 5.0, 3.0, 3.0),
        ];
        let ir = build_render_ir(&scene);
        assert_eq!(ir.len(), 2);
        assert_eq!(ir[0].fill, [57, 208, 198, 255]);
        assert!(matches!(
            ir[0].primitive,
            Primitive::Rect {
                w: 10.0,
                h: 10.0,
                ..
            }
        ));
        assert!(matches!(
            ir[1].primitive,
            Primitive::Rect { w: 3.0, h: 3.0, .. }
        ));
    }

    #[test]
    fn empty_scene_yields_empty_ir() {
        assert!(build_render_ir(&[]).is_empty());
    }

    #[test]
    fn build_render_ir_flat_nested_frames() {
        use strata_core::walk_nodes;

        let scene = vec![
            SceneNode {
                id: strata_core::NodeId(1),
                name: "frame".into(),
                transform: Affine::translate((0.0, 0.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
                fill: [200, 200, 200, 255],
                children: vec![strata_core::NodeId(2), strata_core::NodeId(3)],
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: strata_core::NodeId(2),
                name: "child1".into(),
                transform: Affine::translate((10.0, 10.0)),
                shape: Shape::Circle(Circle::new(Point::ZERO, 5.0)),
                fill: [255, 0, 0, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: strata_core::NodeId(3),
                name: "child2".into(),
                transform: Affine::translate((20.0, 20.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 20.0, 20.0)),
                fill: [0, 255, 0, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
            SceneNode {
                id: strata_core::NodeId(4),
                name: "root-shape".into(),
                transform: Affine::translate((100.0, 100.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 50.0, 50.0)),
                fill: [57, 208, 198, 255],
                children: Vec::new(),
                component_id: None,
                slots: None,
            },
        ];

        let walked = walk_nodes(&scene);
        assert_eq!(walked.len(), 4);

        // DFS order: frame, child1, child2, root-shape
        assert_eq!(walked[0].0, strata_core::NodeId(1));
        assert_eq!(walked[0].2, None);

        assert_eq!(walked[1].0, strata_core::NodeId(2));
        assert_eq!(walked[1].2, Some(strata_core::NodeId(1)));

        assert_eq!(walked[2].0, strata_core::NodeId(3));
        assert_eq!(walked[2].2, Some(strata_core::NodeId(1)));

        assert_eq!(walked[3].0, strata_core::NodeId(4));
        assert_eq!(walked[3].2, None);

        let ir = build_render_ir_flat(&walked);
        assert_eq!(ir.len(), 4);

        // Frame (node 1): rect backdrop
        assert!(matches!(ir[0].primitive, Primitive::Rect { w: 100.0, h: 100.0, .. }));
        assert_eq!(ir[0].fill, [200, 200, 200, 255]);

        // child1 (node 2): circle
        assert!(matches!(ir[1].primitive, Primitive::Circle { r: 5.0, .. }));
        assert_eq!(ir[1].fill, [255, 0, 0, 255]);

        // child2 (node 3): rect
        assert!(matches!(ir[2].primitive, Primitive::Rect { w: 20.0, h: 20.0, .. }));
        assert_eq!(ir[2].fill, [0, 255, 0, 255]);

        // root-shape (node 4)
        assert!(matches!(ir[3].primitive, Primitive::Rect { w: 50.0, h: 50.0, .. }));
        assert_eq!(ir[3].fill, [57, 208, 198, 255]);
    }

    #[test]
    fn preserves_transform_and_shape_kind() {
        let node = SceneNode {
            id: strata_core::NodeId(7),
            name: "c".into(),
            transform: Affine::translate((40.0, 40.0)),
            shape: Shape::Circle(Circle::new(Point::ZERO, 8.0)),
            fill: [255, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
        };
        let ir = build_render_ir(&[node]);
        assert!(matches!(ir[0].primitive, Primitive::Circle { r: 8.0, .. }));
        assert_eq!(ir[0].fill, [255, 0, 0, 255]);
        assert_eq!(
            ir[0].primitive,
            Primitive::Circle {
                cx: 0.0,
                cy: 0.0,
                r: 8.0
            }
        );
        // transform survives into the IR (translate(40,40) matrix coefficients).
        assert_eq!(ir[0].transform, [1.0, 0.0, 0.0, 1.0, 40.0, 40.0]);
    }
}
