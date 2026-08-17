//! Engine wire format: TypeScript `@varve/engine` SceneNode JSON to `varve_core::SceneNode`.
//!
//! Shared by Tauri IPC and wasm-pack bindings.

use serde::Deserialize;
use serde_json::Value;
use varve_core::{
    Affine, BlendMode, Circle, Effect, EngineColor, FillIR, GradientFill, Line, PathPoint, Point,
    Rect, SceneNode, Shape, Stroke,
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
    /// V2.15+: compiled native table (ADR-0016 D3). The payload is opaque to
    /// the bridge — it is produced by the editor layout engine and consumed
    /// by the JS replay; Rust passes it through untouched.
    #[serde(rename = "table")]
    Table(serde_json::Value),
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

/// TypeScript `@varve/engine` EngineImageFillData shape (nested under `image`).
#[derive(Debug, Deserialize)]
pub struct IpcEngineImageFillData {
    pub src: String,
    pub fit: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default, rename = "imageWidth")]
    pub image_width: Option<f64>,
    #[serde(default, rename = "imageHeight")]
    pub image_height: Option<f64>,
    /// Non-destructive crop rect in source-pixel coordinates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<varve_core::scene::CropRect>,
    /// Image content rotation in degrees clockwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    /// Horizontal flip of image content.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "flipH")]
    pub flip_h: Option<bool>,
    /// Vertical flip of image content.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "flipV")]
    pub flip_v: Option<bool>,
}

fn default_scale() -> f64 {
    1.0
}

/// TypeScript `@varve/engine` EnginePatternFillData shape (nested under `pattern`).
#[derive(Debug, Deserialize)]
pub struct IpcEnginePatternFillData {
    #[serde(rename = "tileSrc")]
    pub tile_src: String,
    #[serde(default)]
    pub spacing: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default, rename = "imageWidth")]
    pub image_width: Option<f64>,
    #[serde(default, rename = "imageHeight")]
    pub image_height: Option<f64>,
}

/// TypeScript `@varve/engine` EngineFill shape (nested variant data).
/// The bridge flattens this into `varve_core::FillIR` for the native renderer.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum IpcEngineFill {
    #[serde(rename = "solid")]
    Solid {
        color: EngineColor,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "gradient")]
    Gradient {
        gradient: GradientFill,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "image")]
    Image {
        image: IpcEngineImageFillData,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "pattern")]
    Pattern {
        pattern: IpcEnginePatternFillData,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
}

impl IpcEngineFill {
    fn into_fill_ir(self, alpha_mask: Option<String>) -> FillIR {
        match self {
            IpcEngineFill::Solid {
                color,
                opacity,
                blend_mode,
                visible,
            } => FillIR::Solid {
                color,
                opacity,
                blend_mode,
                visible,
            },
            IpcEngineFill::Gradient {
                gradient,
                opacity,
                blend_mode,
                visible,
            } => FillIR::Gradient {
                gradient_type: gradient.gradient_type,
                stops: gradient.stops,
                rotation: gradient.rotation.unwrap_or(0.0),
                interpolation_space: gradient.interpolation_space,
                hue_interpolation: gradient.hue_interpolation,
                transform: gradient.transform,
                tiling_mode: gradient.tiling_mode,
                opacity,
                blend_mode,
                visible,
            },
            IpcEngineFill::Image {
                image,
                opacity,
                blend_mode,
                visible,
            } => FillIR::Image {
                src: image.src,
                fit: image.fit,
                x: image.x,
                y: image.y,
                scale: image.scale,
                image_width: image.image_width,
                image_height: image.image_height,
                opacity,
                blend_mode,
                visible,
                alpha_mask,
                crop: image.crop,
                rotation: image.rotation,
                flip_h: image.flip_h,
                flip_v: image.flip_v,
            },
            IpcEngineFill::Pattern {
                pattern,
                opacity,
                blend_mode,
                visible,
            } => FillIR::Pattern {
                tile_src: pattern.tile_src,
                spacing: pattern.spacing,
                rotation: pattern.rotation,
                image_width: pattern.image_width,
                image_height: pattern.image_height,
                opacity,
                blend_mode,
                visible,
            },
        }
    }
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
            IpcShape::Table(payload) => Shape::Table(payload),
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
    #[serde(rename = "blendMode")]
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default, rename = "cornerRadius")]
    pub corner_radius: Option<serde_json::Value>,
    #[serde(default, rename = "alphaMask")]
    pub alpha_mask: Option<String>,
    #[serde(default)]
    pub fills: Option<Vec<IpcEngineFill>>,
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
        bit_depth: None,
    }
}

mod affine_serde {
    use serde::{Deserialize, Deserializer};
    use varve_core::Affine;

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
            bit_depth: None,
        });
    }
    Ok(EngineColor::Rgb {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 255.0,
        profile: None,
        bit_depth: None,
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
                id: varve_core::NodeId(i as u64),
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
                fills: n.fills.map(|fills| {
                    fills
                        .into_iter()
                        .map(|f| f.into_fill_ir(n.alpha_mask.clone()))
                        .collect()
                }),
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
                bit_depth: None,
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
                bit_depth: None,
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
        assert!(matches!(scene[0].shape, varve_core::Shape::Text { .. }));
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
        // Real TS engine payload uses nested `image` objects and a node-level
        // alphaMask from backgroundRemoval.maskDataUrl.
        let json = serde_json::json!([{
            "id": "image-fill",
            "name": "Masked image",
            "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "shape": { "kind": "rect", "x": 0.0, "y": 0.0, "w": 320.0, "h": 240.0 },
            "fill": { "space": "rgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 0.0 },
            "alphaMask": "data:image/png;base64,TUFDSw==",
            "fills": [{
                "type": "image",
                "image": {
                    "src": "photo.png",
                    "fit": "fit",
                    "x": 3.0,
                    "y": 4.0,
                    "scale": 0.5,
                    "imageWidth": 640.0,
                    "imageHeight": 480.0
                },
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

        assert_eq!(image["src"], "photo.png");
        assert_eq!(image["fit"], "fit");
        assert_eq!(image["imageWidth"], 640.0);
        assert_eq!(image["imageHeight"], 480.0);
        assert_eq!(image["alphaMask"], "data:image/png;base64,TUFDSw==");
    }
}
#[test]
fn ipc_scene_node_reads_typescript_blend_mode_field() {
    let json = serde_json::json!({
        "id": "blend-node",
        "name": "Blend node",
        "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        "shape": { "kind": "rect", "x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0 },
        "fill": { "space": "rgb", "r": 1.0, "g": 2.0, "b": 3.0, "a": 255.0 },
        "blendMode": "colorDodge"
    });

    let node: IpcSceneNode = serde_json::from_value(json).expect("deserialize IPC node");
    assert_eq!(node.blend_mode, BlendMode::ColorDodge);
    let converted = convert_engine_nodes(vec![node]);
    assert_eq!(converted[0].blend_mode, BlendMode::ColorDodge);
}

#[test]
fn ipc_table_shape_passes_through_unchanged() {
    let table_payload = serde_json::json!({
        "kind": "table",
        "x": 0.0,
        "y": 0.0,
        "w": 300.0,
        "h": 120.0,
        "cornerRadius": 4.0,
        "borderColor": { "space": "rgb", "r": 10.0, "g": 10.0, "b": 10.0, "a": 255.0 },
        "borderWidth": 1.0,
        "dividerColor": { "space": "rgb", "r": 200.0, "g": 200.0, "b": 200.0, "a": 255.0 },
        "dividerWidth": 1.0,
        "colPositions": [0.0, 150.0, 300.0],
        "rowPositions": [0.0, 40.0, 120.0],
        "cells": [
            {
                "x": 0.0,
                "y": 0.0,
                "w": 150.0,
                "h": 40.0,
                "fill": { "space": "rgb", "r": 240.0, "g": 240.0, "b": 240.0, "a": 255.0 },
                "text": {
                    "lines": ["Header A"],
                    "fontSize": 13.0,
                    "fontFamily": "Inter",
                    "fontWeight": 600.0,
                    "fontStyle": "normal",
                    "color": { "space": "rgb", "r": 0.0, "g": 0.0, "b": 0.0, "a": 255.0 },
                    "alignH": "left",
                    "alignV": "middle",
                    "padding": 8.0
                }
            }
        ]
    });

    let json = serde_json::json!({
        "id": "table-node",
        "name": "Table",
        "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        "shape": table_payload,
        "fill": { "space": "rgb", "r": 255.0, "g": 255.0, "b": 255.0, "a": 255.0 }
    });

    let node: IpcSceneNode = serde_json::from_value(json).expect("deserialize table node");
    let converted = convert_engine_nodes(vec![node]);
    let Shape::Table(payload) = &converted[0].shape else {
        panic!("expected Shape::Table");
    };
    // IpcShape is internally tagged, so serde strips the kind field at parse
    // time; the remaining table payload passes through unchanged. The engine
    // Primitive (also internally tagged) re-adds the tag when serializing.
    assert_eq!(payload["w"], 300.0);
    assert_eq!(payload["cells"][0]["text"]["lines"][0], "Header A");
    let wire = serde_json::to_value(&converted[0].shape).expect("serialize shape");
    assert_eq!(wire["Table"]["w"], 300.0);
}
