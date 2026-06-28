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

use kurbo::Affine;
use serde::{Deserialize, Serialize};
use strata_core::{Point, SceneNode, Shape};

/// One drawable record in the render IR. The webview replays these in order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderItem {
    pub transform: Affine,
    /// RGBA fill, 0-255 per channel.
    pub fill: [u8; 4],
    pub primitive: Primitive,
}

/// Geometry primitive in a node's LOCAL space (pre-transform).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Primitive {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
    Ellipse {
        center: Point,
        rx: f64,
        ry: f64,
    },
    Circle {
        center: Point,
        r: f64,
    },
    Line {
        from: Point,
        to: Point,
        tolerance: f64,
    },
}

/// Build the render IR from a scene (paint order preserved). One item per node.
pub fn build_render_ir(nodes: &[SceneNode]) -> Vec<RenderItem> {
    nodes
        .iter()
        .map(|n| RenderItem {
            transform: n.transform,
            fill: n.fill,
            primitive: primitive_of(&n.shape),
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
            center: *center,
            rx: *rx,
            ry: *ry,
        },
        Shape::Circle(c) => Primitive::Circle {
            center: c.center,
            r: c.radius,
        },
        Shape::Line { line, tolerance } => Primitive::Line {
            from: line.p0,
            to: line.p1,
            tolerance: *tolerance,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use strata_core::{Circle, Rect};

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(id),
            name: format!("r{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
            fill: [57, 208, 198, 255],
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
    fn preserves_transform_and_shape_kind() {
        let node = SceneNode {
            id: strata_core::NodeId(7),
            name: "c".into(),
            transform: Affine::translate((40.0, 40.0)),
            shape: Shape::Circle(Circle::new(Point::ZERO, 8.0)),
            fill: [255, 0, 0, 255],
        };
        let ir = build_render_ir(&[node]);
        assert!(matches!(ir[0].primitive, Primitive::Circle { r: 8.0, .. }));
        assert_eq!(ir[0].fill, [255, 0, 0, 255]);
        // transform survives into the IR (translate(40,40) matrix coefficients).
        let coeffs = ir[0].transform.as_coeffs();
        assert_eq!(coeffs[4], 40.0);
        assert_eq!(coeffs[5], 40.0);
    }
}
