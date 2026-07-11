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
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default, rename = "letterSpacing")]
        letter_spacing: Option<f64>,
        #[serde(default, rename = "lineHeight")]
        line_height: Option<f64>,
        #[serde(default, rename = "textCase")]
        text_case: Option<String>,
        #[serde(default, rename = "textDecoration")]
        text_decoration: Option<String>,
        #[serde(default, rename = "openTypeFeatures")]
        open_type_features: Option<serde_json::Value>,
        #[serde(default, rename = "variableAxes")]
        variable_axes: Box<Option<serde_json::Value>>,
    },
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
            } => Shape::Path {
                points,
                closed,
                tolerance,
            },
            IpcShape::Text {
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
                letter_spacing,
                line_height,
                text_case,
                text_decoration,
                open_type_features,
                variable_axes,
            } => Shape::Text {
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
                letter_spacing,
                line_height,
                text_case,
                text_decoration,
                open_type_features,
                variable_axes: *variable_axes,
            },
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
            SceneNode {
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
}
