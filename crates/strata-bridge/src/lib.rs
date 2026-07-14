//! Engine wire format: TypeScript `@strata/engine` SceneNode JSON to `strata_core::SceneNode`.
//!
//! Shared by Tauri IPC and wasm-pack bindings.

use serde::Deserialize;
use serde_json::Value;
use strata_core::{
    Affine, BlendMode, Circle, Effect, EngineColor, FillIR, Line, PathPoint, Point, Rect,
    SceneNode, Shape, Stroke,
};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum IpcShape {
    #[serde(rename = "rect")]
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default, rename = "cornerRadius")]
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
        #[serde(rename = "arrowheadSize", default = "default_arrowhead")]
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
    Text(Box<IpcTextShape>),
}

/// Text is boxed as one semantic record so adding typography fields does not
/// inflate every `IpcShape` value on the native/WASM bridge stack.
#[derive(Debug, Deserialize)]
pub struct IpcTextShape {
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
    #[serde(default, rename = "textAlignVertical")]
    text_align_vertical: Option<String>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    #[serde(default, rename = "letterSpacing")]
    letter_spacing: Option<f64>,
    #[serde(default, rename = "lineHeight")]
    line_height: Option<f64>,
    #[serde(default, rename = "paragraphSpacing")]
    paragraph_spacing: Option<f64>,
    #[serde(default, rename = "textCase")]
    text_case: Option<String>,
    #[serde(default, rename = "textDecoration")]
    text_decoration: Option<String>,
    #[serde(default, rename = "textOverflow")]
    text_overflow: Option<String>,
    #[serde(default, rename = "listStyle")]
    list_style: Option<String>,
    #[serde(default, rename = "richText")]
    rich_text: Option<serde_json::Value>,
    #[serde(default, rename = "openTypeFeatures")]
    open_type_features: Option<serde_json::Value>,
    #[serde(default, rename = "variableAxes")]
    variable_axes: Option<serde_json::Value>,
    #[serde(default, rename = "textMode")]
    text_mode: Option<String>,
    #[serde(default, rename = "pathTextSettings")]
    path_text_settings: Option<serde_json::Value>,
    #[serde(default, rename = "pathShape")]
    path_shape: Option<serde_json::Value>,
}

fn default_arrowhead() -> f64 {
    10.0
}

impl IpcShape {
    fn into_shape(self) -> Shape {
        match self {
            IpcShape::Rect { x, y, w, h, .. } => Shape::Rect(Rect::new(x, y, x + w, y + h)),
            IpcShape::Ellipse { cx, cy, rx, ry } => Shape::Ellipse {
                center: Point::new(cx, cy),
                rx,
                ry,
            },
            IpcShape::Circle { cx, cy, r } => Shape::Circle(Circle::new(Point::new(cx, cy), r)),
            IpcShape::Line {
                from,
                to,
                tolerance,
            } => Shape::Line {
                line: Line::new(Point::new(from[0], from[1]), Point::new(to[0], to[1])),
                tolerance,
            },
            IpcShape::Polygon {
                cx,
                cy,
                radius,
                sides,
                rotation,
            } => Shape::Polygon {
                cx,
                cy,
                radius,
                sides,
                rotation,
            },
            IpcShape::Star {
                inner_radius,
                outer_radius,
                cx,
                cy,
                points,
                rotation,
            } => Shape::Star {
                cx,
                cy,
                inner_radius,
                outer_radius,
                points,
                rotation,
            },
            IpcShape::Arrow {
                from,
                to,
                tolerance,
                arrowhead_size,
            } => Shape::Arrow {
                from,
                to,
                tolerance,
                arrowhead_size,
            },
            IpcShape::Path {
                points,
                closed,
                tolerance,
                holes,
                fill_rule,
            } => Shape::Path {
                points,
                closed,
                tolerance,
                holes,
                fill_rule,
            },
            IpcShape::Text(text_shape) => {
                let IpcTextShape {
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
                } = *text_shape;
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
                }
            }
        }
    }

    fn corner_radius(&self) -> Option<serde_json::Value> {
        match self {
            IpcShape::Rect { corner_radius, .. } => corner_radius.clone(),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct IpcSceneNode {
    #[allow(dead_code)]
    pub id: String,
    pub name: String,
    #[serde(with = "affine_serde")]
    pub transform: Affine,
    pub shape: IpcShape,
    #[serde(
        default = "default_fill",
        deserialize_with = "deserialize_engine_color"
    )]
    pub fill: EngineColor,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_blend")]
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default, rename = "cornerRadius")]
    pub corner_radius: Option<serde_json::Value>,
    #[serde(default)]
    pub fills: Option<Vec<FillIR>>,
    #[serde(default)]
    pub filters: Option<Vec<serde_json::Value>>,
    // Text layout is present at the SceneNode level in the TS engine contract,
    // while geometry also carries a text primitive. Keep these overrides until
    // every producer emits one normalized primitive representation.
    #[serde(default, rename = "textAlignVertical")]
    pub text_align_vertical: Option<String>,
    #[serde(default, rename = "paragraphSpacing")]
    pub paragraph_spacing: Option<f64>,
    #[serde(default, rename = "textOverflow")]
    pub text_overflow: Option<String>,
    #[serde(default, rename = "listStyle")]
    pub list_style: Option<String>,
    #[serde(default, rename = "richText")]
    pub rich_text: Option<serde_json::Value>,
    #[serde(default, rename = "openTypeFeatures")]
    pub open_type_features: Option<serde_json::Value>,
    #[serde(default, rename = "variableAxes")]
    pub variable_axes: Option<serde_json::Value>,
    #[serde(default, rename = "textMode")]
    pub text_mode: Option<String>,
    #[serde(default, rename = "pathTextSettings")]
    pub path_text_settings: Option<serde_json::Value>,
}

fn default_opacity() -> f64 {
    1.0
}
fn default_blend() -> BlendMode {
    BlendMode::Normal
}
fn default_fill() -> EngineColor {
    EngineColor::Rgb {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 255.0,
        profile: None,
    }
}

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

fn deserialize_engine_color<'de, D>(d: D) -> Result<EngineColor, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = Value::deserialize(d)?;
    // New format: tagged union { "space": "rgb"|"cmyk"|"gray"|"spot", … }
    if let Ok(color) = serde_json::from_value::<EngineColor>(v.clone()) {
        return Ok(color);
    }
    // Backward compat: old [r, g, b, a] array → EngineRgbColor
    if let Ok(arr) = serde_json::from_value::<[u8; 4]>(v.clone()) {
        return Ok(EngineColor::Rgb {
            r: arr[0] as f64,
            g: arr[1] as f64,
            b: arr[2] as f64,
            a: arr[3] as f64,
            profile: None,
        });
    }
    Ok(EngineColor::Rgb {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 255.0,
        profile: None,
    })
}

/// Convert wire-format nodes (from TS engine) into native scene nodes.
pub fn convert_engine_nodes(nodes: Vec<IpcSceneNode>) -> Vec<SceneNode> {
    nodes
        .into_iter()
        .enumerate()
        .map(|(i, n)| {
            let shape_corner = n.shape.corner_radius();
            let mut shape = n.shape.into_shape();
            if let Shape::Text {
                text_align_vertical,
                paragraph_spacing,
                text_overflow,
                list_style,
                rich_text,
                open_type_features,
                variable_axes,
                text_mode,
                path_text_settings,
                ..
            } = &mut shape
            {
                // The node-level values are canonical in the TS stub engine.
                // Shape-level values remain supported for direct/native callers.
                if n.text_align_vertical.is_some() {
                    *text_align_vertical = n.text_align_vertical;
                }
                if n.paragraph_spacing.is_some() {
                    *paragraph_spacing = n.paragraph_spacing;
                }
                if n.text_overflow.is_some() {
                    *text_overflow = n.text_overflow;
                }
                if n.list_style.is_some() {
                    *list_style = n.list_style;
                }
                if n.rich_text.is_some() {
                    *rich_text = n.rich_text;
                }
                if n.open_type_features.is_some() {
                    *open_type_features = n.open_type_features;
                }
                if n.variable_axes.is_some() {
                    *variable_axes = n.variable_axes;
                }
                if n.text_mode.is_some() {
                    *text_mode = n.text_mode;
                }
                if n.path_text_settings.is_some() {
                    *path_text_settings = n.path_text_settings;
                }
            }
            SceneNode {
                id: strata_core::NodeId(i as u64),
                name: n.name,
                transform: n.transform,
                shape,
                fill: n.fill,
                children: Vec::new(),
                component_id: None,
                slots: None,
                opacity: n.opacity,
                blend_mode: n.blend_mode,
                rotation: n.rotation,
                strokes: n.strokes,
                effects: n.effects,
                corner_radius: n.corner_radius.or(shape_corner),
                fills: n.fills,
                filters: n.filters,
            }
        })
        .collect()
}

/// Parse JSON array of engine nodes and convert to scene nodes.
pub fn parse_engine_nodes_json(json: &str) -> Result<Vec<SceneNode>, String> {
    let nodes: Vec<IpcSceneNode> =
        serde_json::from_str(json).map_err(|e| format!("deserialize engine nodes: {e}"))?;
    Ok(convert_engine_nodes(nodes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_engine_color_new_format() {
        let v = serde_json::json!({"space": "rgb", "r": 57.0, "g": 208.0, "b": 198.0, "a": 255.0});
        let color: EngineColor = serde_json::from_value(v).expect("engine color");
        assert_eq!(
            color,
            EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                profile: None
            }
        );
    }

    #[test]
    fn parse_engine_color_backward_compat_array() {
        // The custom deserializer handles array→EngineColor fallback
        // through IpcSceneNode deserialization.
        let json = serde_json::json!([{
            "id": "n0",
            "name": "test",
            "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "shape": { "kind": "rect", "x": 0, "y": 0, "w": 10, "h": 10 },
            "fill": [57, 208, 198, 255]
        }]);
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
        let scene = convert_engine_nodes(nodes);
        assert_eq!(scene.len(), 1);
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
    }

    #[test]
    fn parse_text_shape_node() {
        let json = serde_json::json!([{
            "id": "t1",
            "name": "Title",
            "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "shape": {
                "kind": "text",
                "text": "Hello",
                "fontSize": 16.0,
                "fontFamily": "Inter",
                "fontWeight": 400,
                "fontStyle": "normal",
                "textAlign": "left",
                "x": 0.0,
                "y": 0.0,
                "w": 80.0,
                "h": 20.0
            },
            "fill": {"space": "rgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 255.0}
        }]);
        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize text node");
        let scene = convert_engine_nodes(nodes);
        assert_eq!(scene.len(), 1);
        assert!(matches!(scene[0].shape, strata_core::Shape::Text { .. }));
    }

    #[test]
    fn parse_text_shape_preserves_canvas_layout_semantics() {
        // This mirrors the current TS SceneNode payload: dimensions and text mode
        // are carried by the shape while the remaining layout fields are on the
        // node. The native bridge must retain both before building render IR.
        let json = serde_json::json!([{
            "id": "t-area",
            "name": "Area text",
            "transform": [1.0, 0.0, 0.0, 1.0, 24.0, 36.0],
            "shape": {
                "kind": "text",
                "text": "First paragraph\nSecond paragraph",
                "fontSize": 18.0,
                "fontFamily": "Inter",
                "fontWeight": 500,
                "fontStyle": "normal",
                "textAlign": "center",
                "x": 0.0,
                "y": 0.0,
                "w": 240.0,
                "h": 120.0,
                "letterSpacing": 0.5,
                "lineHeight": 1.6,
                "textCase": "none",
                "textDecoration": "underline",
                "textMode": "area",
                "pathTextSettings": { "pathNodeId": "path-1", "offset": 12.0 }
            },
            "textAlignVertical": "middle",
            "paragraphSpacing": 9.0,
            "textOverflow": "ellipsis",
            "listStyle": "decimal",
            "richText": { "paragraphs": [] },
            "variableAxes": { "wght": 525.0 },
            "openTypeFeatures": { "liga": true },
            "fill": {"space": "rgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 255.0}
        }]);

        let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize text node");
        let scene = convert_engine_nodes(nodes);
        let shape = serde_json::to_value(&scene[0].shape).expect("serialize core text shape");
        let text = &shape["text"];

        assert_eq!(text["textMode"], "area");
        assert_eq!(text["textAlignVertical"], "middle");
        assert_eq!(text["paragraphSpacing"], 9.0);
        assert_eq!(text["textOverflow"], "ellipsis");
        assert_eq!(text["listStyle"], "decimal");
        assert_eq!(text["richText"], serde_json::json!({ "paragraphs": [] }));
        assert_eq!(text["pathTextSettings"]["pathNodeId"], "path-1");
    }

    #[test]
    fn image_fill_wire_preserves_canvas_resource_metadata() {
        let json = serde_json::json!([{
            "id": "image-fill",
            "name": "Masked image",
            "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "shape": { "kind": "rect", "x": 0.0, "y": 0.0, "w": 320.0, "h": 240.0 },
            "fill": { "space": "rgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 0.0 },
            "fills": [{
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
            }]
        }]);

        let nodes: Vec<IpcSceneNode> =
            serde_json::from_value(json).expect("deserialize image fill");
        let scene = convert_engine_nodes(nodes);
        let fills = serde_json::to_value(&scene[0].fills).expect("serialize core image fill");
        let image = &fills[0];

        assert_eq!(image["imageWidth"], 640.0);
        assert_eq!(image["imageHeight"], 480.0);
        assert_eq!(image["alphaMask"], "data:image/png;base64,TUFDSw==");
    }
}
