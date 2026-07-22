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
use strata_core::{BlendMode, EngineColor, FillIR, PathPoint, SceneNode, Shape};

/// One drawable record in the render IR. The webview replays these in order.
///
/// `transform` is `[f64; 6]` (not `kurbo::Affine`) because TS `Affine` =
/// `readonly [number, number, number, number, number, number]` — kurbo's default
/// serde produces `{"coeffs": [a,b,c,d,e,f]}` which would mismatch the wire format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderItem {
    pub transform: [f64; 6],
    /// Engine color fill (tagged union matching TS `EngineColor`).
    pub fill: EngineColor,
    pub primitive: Primitive,
    // ── F6: appearance (serde(default) for backward compat with old IR) ─────
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_blend_mode")]
    #[serde(rename = "blendMode")]
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub strokes: Vec<strata_core::Stroke>,
    #[serde(default)]
    pub effects: Vec<strata_core::Effect>,
    /// P2: stacked fills (solid/gradient). When present, paint bottom→top.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fills: Option<Vec<FillIR>>,
    /// Phase 5: nondestructive adjustment filter stack. Pass-through for the webview renderer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<serde_json::Value>>,
}

fn default_opacity() -> f64 {
    1.0
}
fn default_blend_mode() -> BlendMode {
    BlendMode::Normal
}
fn default_text_align_vertical() -> String {
    "top".to_owned()
}
fn default_line_height() -> f64 {
    1.4
}
fn default_text_none() -> String {
    "none".to_owned()
}
fn default_text_overflow() -> String {
    "visible".to_owned()
}
fn default_list_style() -> String {
    "none".to_owned()
}
fn default_text_mode() -> String {
    "point".to_owned()
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
#[allow(clippy::large_enum_variant)]
pub enum Primitive {
    #[serde(rename = "rect")]
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        corner_radius: Option<serde_json::Value>,
    },
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
    #[serde(rename = "arrow")]
    Arrow {
        from: [f64; 2],
        to: [f64; 2],
        tolerance: f64,
        #[serde(rename = "arrowheadSize")]
        arrowhead_size: f64,
    },
    #[serde(rename = "path")]
    Path {
        points: Vec<PathPoint>,
        closed: bool,
        tolerance: f64,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        holes: Vec<Vec<PathPoint>>,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "fillRule")]
        fill_rule: Option<String>,
    },
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
        #[serde(default = "default_text_align_vertical", rename = "textAlignVertical")]
        text_align_vertical: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default, rename = "letterSpacing")]
        letter_spacing: f64,
        #[serde(default = "default_line_height", rename = "lineHeight")]
        line_height: f64,
        #[serde(default, rename = "paragraphSpacing")]
        paragraph_spacing: f64,
        #[serde(default = "default_text_none", rename = "textCase")]
        text_case: String,
        #[serde(default = "default_text_none", rename = "textDecoration")]
        text_decoration: String,
        #[serde(default = "default_text_overflow", rename = "textOverflow")]
        text_overflow: String,
        #[serde(default = "default_list_style", rename = "listStyle")]
        list_style: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "richText")]
        rich_text: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "openTypeFeatures")]
        open_type_features: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "variableAxes")]
        variable_axes: Option<serde_json::Value>,
        #[serde(default = "default_text_mode", rename = "textMode")]
        text_mode: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "pathTextSettings")]
        path_text_settings: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "pathShape")]
        path_shape: Option<serde_json::Value>,
    },
}

/// Build the render IR from a scene (paint order preserved). One item per node.
pub fn build_render_ir(nodes: &[SceneNode]) -> Vec<RenderItem> {
    nodes
        .iter()
        .map(|n| RenderItem {
            transform: n.transform.as_coeffs(),
            fill: n.fill.clone(),
            primitive: primitive_of(&n.shape, n.corner_radius.as_ref()),
            opacity: n.opacity,
            blend_mode: n.blend_mode.clone(),
            strokes: n.strokes.clone(),
            effects: n.effects.clone(),
            fills: n.fills.clone(),
            filters: n.filters.clone(),
        })
        .collect()
}

/// Build the render IR from a DFS-walked scene (from `walk_nodes`).
/// Emits one item per visited node, recursively flattening frame children
/// in paint order. Use this for nested frame-based scenes.
pub fn build_render_ir_flat(
    walked: &[(strata_core::NodeId, &SceneNode, Option<strata_core::NodeId>)],
) -> Vec<RenderItem> {
    walked
        .iter()
        .map(|(_, node, _)| RenderItem {
            transform: node.transform.as_coeffs(),
            fill: node.fill.clone(),
            primitive: primitive_of(&node.shape, node.corner_radius.as_ref()),
            opacity: node.opacity,
            blend_mode: node.blend_mode.clone(),
            strokes: node.strokes.clone(),
            effects: node.effects.clone(),
            fills: node.fills.clone(),
            filters: None,
        })
        .collect()
}

fn primitive_of(shape: &Shape, corner_radius: Option<&serde_json::Value>) -> Primitive {
    match shape {
        Shape::Rect(r) => Primitive::Rect {
            x: r.min_x(),
            y: r.min_y(),
            w: r.width(),
            h: r.height(),
            corner_radius: corner_radius.cloned(),
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
        Shape::Polygon {
            cx,
            cy,
            radius,
            sides,
            rotation,
        } => Primitive::Polygon {
            cx: *cx,
            cy: *cy,
            radius: *radius,
            sides: *sides,
            rotation: *rotation,
        },
        Shape::Star {
            cx,
            cy,
            inner_radius,
            outer_radius,
            points,
            rotation,
        } => Primitive::Star {
            cx: *cx,
            cy: *cy,
            inner_radius: *inner_radius,
            outer_radius: *outer_radius,
            points: *points,
            rotation: *rotation,
        },
        Shape::Arrow {
            from,
            to,
            tolerance,
            arrowhead_size,
        } => Primitive::Arrow {
            from: *from,
            to: *to,
            tolerance: *tolerance,
            arrowhead_size: *arrowhead_size,
        },
        Shape::Path {
            points,
            closed,
            tolerance,
            holes,
            fill_rule,
        } => Primitive::Path {
            points: points.clone(),
            closed: *closed,
            tolerance: *tolerance,
            holes: holes.clone(),
            fill_rule: fill_rule.clone(),
        },
        Shape::Text {
            text,
            font_size,
            font_family,
            font_weight,
            font_style,
            text_align,
            text_align_vertical,
            x,
            y,
            w,
            h,
            letter_spacing,
            line_height,
            paragraph_spacing,
            text_case,
            text_decoration,
            text_overflow,
            list_style,
            rich_text,
            open_type_features,
            variable_axes,
            text_mode,
            path_text_settings,
            path_shape,
        } => Primitive::Text {
            text: text.clone(),
            font_size: *font_size,
            font_family: font_family.clone(),
            font_weight: *font_weight,
            font_style: font_style.clone(),
            text_align: text_align.clone(),
            text_align_vertical: text_align_vertical
                .clone()
                .unwrap_or_else(default_text_align_vertical),
            x: *x,
            y: *y,
            w: *w,
            h: *h,
            letter_spacing: letter_spacing.unwrap_or_default(),
            line_height: line_height.unwrap_or_else(default_line_height),
            paragraph_spacing: paragraph_spacing.unwrap_or_default(),
            text_case: text_case.clone().unwrap_or_else(default_text_none),
            text_decoration: text_decoration.clone().unwrap_or_else(default_text_none),
            text_overflow: text_overflow.clone().unwrap_or_else(default_text_overflow),
            list_style: list_style.clone().unwrap_or_else(default_list_style),
            rich_text: rich_text.clone(),
            open_type_features: open_type_features.clone(),
            variable_axes: variable_axes.clone(),
            text_mode: text_mode.clone().unwrap_or_else(default_text_mode),
            path_text_settings: path_text_settings.clone(),
            path_shape: path_shape.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use strata_core::{Affine, BlendMode, Circle, EngineColor, Point, Rect};

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(id),
            name: format!("r{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
            fill: EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
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
    fn image_fill_ir_preserves_native_canvas_resource_metadata() {
        let mut node = rect_node(8, 0.0, 0.0, 320.0, 240.0);
        node.fills = Some(
            serde_json::from_value(serde_json::json!([{
                "type": "image",
                "src": "photo.png",
                "fit": "fit",
                "x": 3.0,
                "y": 4.0,
                "scale": 0.5,
                "imageWidth": 640.0,
                "imageHeight": 480.0,
                "alphaMask": "data:image/png;base64,TUFDSw==",
                "opacity": 0.75,
                "blendMode": "normal",
                "visible": true
            }]))
            .expect("deserialize image fill"),
        );

        let ir = build_render_ir(&[node]);
        let fills = serde_json::to_value(&ir[0].fills).expect("serialize render image fill");
        let image = &fills[0];

        assert_eq!(image["imageWidth"], 640.0);
        assert_eq!(image["imageHeight"], 480.0);
        assert_eq!(image["alphaMask"], "data:image/png;base64,TUFDSw==");
    }

    #[test]
    fn text_ir_preserves_canvas_layout_semantics() {
        let mut node = rect_node(9, 0.0, 0.0, 240.0, 120.0);
        node.shape = Shape::Text {
            text: "First paragraph\nSecond paragraph".into(),
            font_size: 18.0,
            font_family: "Inter".into(),
            font_weight: 500,
            font_style: "normal".into(),
            text_align: "center".into(),
            text_align_vertical: Some("middle".into()),
            x: 0.0,
            y: 0.0,
            w: 240.0,
            h: 120.0,
            letter_spacing: Some(0.5),
            line_height: Some(1.6),
            paragraph_spacing: Some(9.0),
            text_case: Some("none".into()),
            text_decoration: Some("underline".into()),
            text_overflow: Some("ellipsis".into()),
            list_style: Some("decimal".into()),
            rich_text: Some(serde_json::json!({ "paragraphs": [] })),
            open_type_features: Some(serde_json::json!({ "liga": true })),
            variable_axes: Some(serde_json::json!({ "wght": 525.0 })),
            text_mode: Some("area".into()),
            path_text_settings: Some(serde_json::json!({ "pathNodeId": "path-1", "offset": 12.0 })),
            path_shape: None,
        };

        let ir = build_render_ir(&[node]);
        let primitive = serde_json::to_value(&ir[0].primitive).expect("serialize text primitive");

        assert_eq!(primitive["textMode"], "area");
        assert_eq!(primitive["textAlignVertical"], "middle");
        assert_eq!(primitive["paragraphSpacing"], 9.0);
        assert_eq!(primitive["textOverflow"], "ellipsis");
        assert_eq!(primitive["listStyle"], "decimal");
        assert_eq!(primitive["pathTextSettings"]["pathNodeId"], "path-1");
    }

    #[test]
    fn legacy_text_ir_deserializes_with_canvas_layout_defaults() {
        let primitive: Primitive = serde_json::from_value(serde_json::json!({
            "kind": "text",
            "text": "Legacy",
            "fontSize": 14.0,
            "fontFamily": "sans-serif",
            "fontWeight": 400,
            "fontStyle": "normal",
            "textAlign": "left",
            "x": 0.0,
            "y": 0.0,
            "w": 60.0,
            "h": 20.0
        }))
        .expect("legacy text primitive");

        let value = serde_json::to_value(primitive).expect("serialize normalized text primitive");
        assert_eq!(value["textAlignVertical"], "top");
        assert_eq!(value["letterSpacing"], 0.0);
        assert_eq!(value["lineHeight"], 1.4);
        assert_eq!(value["paragraphSpacing"], 0.0);
        assert_eq!(value["textCase"], "none");
        assert_eq!(value["textDecoration"], "none");
        assert_eq!(value["textOverflow"], "visible");
        assert_eq!(value["listStyle"], "none");
        assert_eq!(value["textMode"], "point");
    }

    #[test]
    fn build_render_ir_flat_nested_frames() {
        use strata_core::walk_nodes;

        let rgb = |r: f64, g: f64, b: f64, a: f64| -> EngineColor {
            EngineColor::Rgb {
                r,
                g,
                b,
                a,
                bit_depth: None,
                profile: None,
            }
        };
        let scene = vec![
            SceneNode {
                id: strata_core::NodeId(1),
                name: "frame".into(),
                transform: Affine::translate((0.0, 0.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
                fill: rgb(200.0, 200.0, 200.0, 255.0),
                children: vec![strata_core::NodeId(2), strata_core::NodeId(3)],
                component_id: None,
                slots: None,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                rotation: 0.0,
                strokes: Vec::new(),
                effects: Vec::new(),
                fills: None,
                corner_radius: None,
                filters: None,
            },
            SceneNode {
                id: strata_core::NodeId(2),
                name: "child-circle".into(),
                transform: Affine::translate((5.0, 5.0)),
                shape: Shape::Circle(Circle::new(Point::ZERO, 5.0)),
                fill: rgb(255.0, 0.0, 0.0, 255.0),
                children: Vec::new(),
                component_id: None,
                slots: None,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                rotation: 0.0,
                strokes: Vec::new(),
                effects: Vec::new(),
                fills: None,
                corner_radius: None,
                filters: None,
            },
            SceneNode {
                id: strata_core::NodeId(3),
                name: "r3".into(),
                transform: Affine::translate((100.0, 100.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 20.0, 20.0)),
                fill: rgb(0.0, 255.0, 0.0, 255.0),
                children: Vec::new(),
                component_id: None,
                slots: None,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                rotation: 0.0,
                strokes: Vec::new(),
                effects: Vec::new(),
                fills: None,
                corner_radius: None,
                filters: None,
            },
            SceneNode {
                id: strata_core::NodeId(4),
                name: "r4".into(),
                transform: Affine::translate((50.0, 50.0)),
                shape: Shape::Rect(Rect::new(0.0, 0.0, 50.0, 50.0)),
                fill: rgb(57.0, 208.0, 198.0, 255.0),
                children: Vec::new(),
                component_id: None,
                slots: None,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                rotation: 0.0,
                strokes: Vec::new(),
                effects: Vec::new(),
                fills: None,
                corner_radius: None,
                filters: None,
            },
        ];

        let walked = walk_nodes(&scene);
        assert_eq!(walked.len(), 4);

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

        assert!(matches!(
            ir[0].primitive,
            Primitive::Rect {
                w: 100.0,
                h: 100.0,
                ..
            }
        ));
        assert_eq!(
            ir[0].fill,
            EngineColor::Rgb {
                r: 200.0,
                g: 200.0,
                b: 200.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );

        assert!(matches!(ir[1].primitive, Primitive::Circle { r: 5.0, .. }));
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

        assert!(matches!(
            ir[2].primitive,
            Primitive::Rect {
                w: 20.0,
                h: 20.0,
                ..
            }
        ));
        assert_eq!(
            ir[2].fill,
            EngineColor::Rgb {
                r: 0.0,
                g: 255.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );

        assert!(matches!(
            ir[3].primitive,
            Primitive::Rect {
                w: 50.0,
                h: 50.0,
                ..
            }
        ));
        assert_eq!(
            ir[3].fill,
            EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                bit_depth: None,
                profile: None
            }
        );
    }

    #[test]
    fn preserves_transform_and_shape_kind() {
        let node = SceneNode {
            id: strata_core::NodeId(7),
            name: "c".into(),
            transform: Affine::translate((40.0, 40.0)),
            shape: Shape::Circle(Circle::new(Point::ZERO, 8.0)),
            fill: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        };
        let ir = build_render_ir(&[node]);
        assert!(matches!(ir[0].primitive, Primitive::Circle { r: 8.0, .. }));
        assert_eq!(
            ir[0].fill,
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
            ir[0].primitive,
            Primitive::Circle {
                cx: 0.0,
                cy: 0.0,
                r: 8.0
            }
        );
        assert_eq!(ir[0].transform, [1.0, 0.0, 0.0, 1.0, 40.0, 40.0]);
    }
}
