//! Scene graph node + hit-testing in world space.
//!
//! A `SceneNode` carries a local-space `Shape` plus an `Affine` transform that
//! maps local into its parent's space (composed up to world for hit-testing).
//! Frame nodes carry optional `children`, `component_id`, and `slots` for the
//! Component Slots model (Task 1.1).
//!
//! F6 (Inspector): added opacity, blend_mode, rotation, strokes, effects fields
//! with `#[serde(default)]` for backward-compatible deserialization. The engine
//! does not yet render these; they pass through the IR so the webview can consume.

use crate::geom::Affine;
use crate::shape::Shape;
use kurbo::Point;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Stable node identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u64);

// ── F6: Stroke, Effect, BlendMode types ─────────────────────────────────────

/// Mirrors the TS `BlendMode` discriminated union of 19 string literals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlendMode {
    PassThrough,
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
    PlusDarker,
    PlusLighter,
}

/// CMYK fallback for spot colours (mirrors TS `{ c: number; m: number; y: number; k: number }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CmykFallback {
    pub c: f64,
    pub m: f64,
    pub y: f64,
    pub k: f64,
}

/// Mirrors the TS `EngineColor` discriminated union tagged by `"space"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "space")]
pub enum EngineColor {
    #[serde(rename = "rgb")]
    Rgb {
        r: f64,
        g: f64,
        b: f64,
        a: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bit_depth: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        profile: Option<String>,
    },
    #[serde(rename = "cmyk")]
    Cmyk {
        c: f64,
        m: f64,
        y: f64,
        k: f64,
        a: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bit_depth: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        profile: Option<String>,
    },
    #[serde(rename = "gray")]
    Gray {
        v: f64,
        a: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bit_depth: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        profile: Option<String>,
    },
    #[serde(rename = "spot")]
    Spot {
        name: String,
        tint: f64,
        a: f64,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "processFallback"
        )]
        process_fallback: Option<CmykFallback>,
    },
}

// ── Gradient / Fill types (mirrors @strata/engine types.ts) ──────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub position: f64,
    pub color: EngineColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub midpoint: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientFill {
    #[serde(rename = "type")]
    pub gradient_type: String, // "linear", "radial", "angular", "diamond"
    pub stops: Vec<GradientStop>,
    #[serde(default)]
    pub rotation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<[f64; 6]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiling_mode: Option<String>, // "none", "repeat", "reflect"
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FillIR {
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
        #[serde(rename = "gradientType")]
        gradient_type: String,
        stops: Vec<GradientStop>,
        rotation: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transform: Option<[f64; 6]>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tiling_mode: Option<String>, // "none", "repeat", "reflect"
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "image")]
    Image {
        src: String,
        fit: String,
        x: f64,
        y: f64,
        scale: f64,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "imageWidth"
        )]
        image_width: Option<f64>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "imageHeight"
        )]
        image_height: Option<f64>,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "alphaMask")]
        alpha_mask: Option<String>,
    },
    #[serde(rename = "pattern")]
    Pattern {
        #[serde(rename = "tileSrc")]
        tile_src: String,
        spacing: f64,
        rotation: f64,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "imageWidth"
        )]
        image_width: Option<f64>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "imageHeight"
        )]
        image_height: Option<f64>,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stroke {
    pub color: EngineColor,
    pub weight: f64,
    pub align: String, // "inside", "center", "outside"
    pub dash_pattern: Vec<f64>,
    pub dash_offset: f64,
    pub cap: String,  // "butt", "round", "square"
    pub join: String, // "miter", "round", "bevel"
    pub miter_limit: f64,
    pub visible: bool,
}

impl Default for Stroke {
    fn default() -> Self {
        Self {
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            weight: 1.0,
            align: "center".into(),
            dash_pattern: Vec::new(),
            dash_offset: 0.0,
            cap: "round".into(),
            join: "miter".into(),
            miter_limit: 4.0,
            visible: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Effect {
    #[serde(rename = "dropShadow")]
    DropShadow {
        x: f64,
        y: f64,
        blur: f64,
        spread: f64,
        color: EngineColor,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "innerShadow")]
    InnerShadow {
        x: f64,
        y: f64,
        blur: f64,
        spread: f64,
        color: EngineColor,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "layerBlur")]
    LayerBlur { radius: f64, visible: bool },
    #[serde(rename = "backgroundBlur")]
    BackgroundBlur { radius: f64, visible: bool },
    #[serde(rename = "outerGlow")]
    OuterGlow {
        blur: f64,
        spread: f64,
        color: EngineColor,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "innerGlow")]
    InnerGlow {
        blur: f64,
        spread: f64,
        color: EngineColor,
        opacity: f64,
        #[serde(rename = "blendMode")]
        blend_mode: BlendMode,
        visible: bool,
    },
    #[serde(rename = "glassMaterial")]
    GlassMaterial {
        blur: f64,
        tint: EngineColor,
        tint_opacity: f64,
        saturation: f64,
        brightness: f64,
        noise: f64,
        edge_highlight: bool,
        edge_highlight_width: f64,
        edge_highlight_color: EngineColor,
        edge_highlight_opacity: f64,
        visible: bool,
    },
}

// ── SceneNode ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneNode {
    pub id: NodeId,
    pub name: String,
    pub transform: Affine,
    pub shape: Shape,
    /// Engine color fill (tagged union matching TS `EngineColor`).
    pub fill: EngineColor,
    /// Child node IDs in paint order (frame nodes only).
    #[serde(default)]
    pub children: Vec<NodeId>,
    /// If this frame is a component instance, the component ID.
    #[serde(default)]
    pub component_id: Option<NodeId>,
    /// Slot fills: slot_id -> child NodeId.
    #[serde(default)]
    pub slots: Option<HashMap<String, NodeId>>,
    // ── F6: appearance fields (serde(default) for backward compat) ──────────
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_blend_mode")]
    #[serde(rename = "blendMode")]
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    /// P2: stacked fills (solid/gradient). When present, takes precedence over `fill`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fills: Option<Vec<FillIR>>,
    /// Corner radius for rect shapes (uniform or per-corner).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<serde_json::Value>,
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

/// Find the topmost node (highest paint-order index) whose shape contains the
/// world-space `pt`. Returns its index in `nodes`, or `None`.
///
/// Nodes are assumed to be in paint order (index 0 painted first / bottom).
pub fn hit_test(nodes: &[SceneNode], world: Point) -> Option<usize> {
    for (i, node) in nodes.iter().enumerate().rev() {
        let local = node.transform.inverse() * world;
        if node.shape.contains(local) {
            return Some(i);
        }
    }
    None
}

/// Walk all nodes in DFS paint order, yielding `(node_id, node, parent_id)`.
/// Root-level nodes have `parent_id = None`. Frame children are visited
/// recursively. Cycles are detected and terminated.
pub fn walk_nodes(nodes: &[SceneNode]) -> Vec<(NodeId, &SceneNode, Option<NodeId>)> {
    let map: HashMap<NodeId, &SceneNode> = nodes.iter().map(|n| (n.id, n)).collect();
    let children_set: HashSet<NodeId> = nodes
        .iter()
        .flat_map(|n| n.children.iter().filter(move |c| **c != n.id).copied())
        .collect();
    let mut result = Vec::with_capacity(nodes.len());
    let mut visited = HashSet::new();

    for node in nodes {
        if !children_set.contains(&node.id) {
            walk_node_dfs(&map, node, None, &mut visited, &mut result);
        }
    }

    result
}

fn walk_node_dfs<'a>(
    map: &HashMap<NodeId, &'a SceneNode>,
    node: &'a SceneNode,
    parent_id: Option<NodeId>,
    visited: &mut HashSet<NodeId>,
    result: &mut Vec<(NodeId, &'a SceneNode, Option<NodeId>)>,
) {
    if !visited.insert(node.id) {
        return;
    }
    result.push((node.id, node, parent_id));
    for child_id in &node.children {
        if let Some(child) = map.get(child_id) {
            walk_node_dfs(map, child, Some(node.id), visited, result);
        }
    }
}

/// Find the parent frame that contains the node with the given ID.
/// Returns `None` for root-level nodes or nodes not present.
pub fn get_parent(nodes: &[SceneNode], id: NodeId) -> Option<NodeId> {
    nodes.iter().find_map(|n| {
        if n.children.contains(&id) {
            Some(n.id)
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{Circle, Rect};
    use kurbo::Affine;

    fn node(id: u64, shape: Shape, translate: (f64, f64)) -> SceneNode {
        SceneNode {
            id: NodeId(id),
            name: format!("node-{id}"),
            transform: Affine::translate(translate),
            shape,
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
    fn hits_topmost_when_overlapping() {
        let nodes = vec![
            node(1, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (0.0, 0.0)),
            node(2, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (2.0, 2.0)),
        ];
        assert_eq!(hit_test(&nodes, Point::new(5.0, 5.0)), Some(1));
    }

    #[test]
    fn hits_only_node_containing_point() {
        let nodes = vec![
            node(1, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (0.0, 0.0)),
            node(
                2,
                Shape::Circle(Circle::new(Point::new(0.0, 0.0), 3.0)),
                (50.0, 50.0),
            ),
        ];
        assert_eq!(hit_test(&nodes, Point::new(5.0, 5.0)), Some(0));
        assert_eq!(hit_test(&nodes, Point::new(50.0, 50.0)), Some(1));
        assert_eq!(hit_test(&nodes, Point::new(99.0, 99.0)), None);
    }

    #[test]
    fn respects_transforms() {
        let node = SceneNode {
            id: NodeId(1),
            name: "scaled".into(),
            transform: Affine::scale(2.0),
            shape: Shape::Rect(Rect::new(0.0, 0.0, 5.0, 5.0)),
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
        };
        assert_eq!(hit_test(&[node], Point::new(9.0, 9.0)), Some(0));
    }

    #[test]
    fn empty_scene_misses() {
        assert_eq!(hit_test(&[], Point::new(0.0, 0.0)), None);
    }

    #[test]
    fn legacy_image_fill_defaults_optional_canvas_resource_metadata() {
        let fill: FillIR = serde_json::from_value(serde_json::json!({
            "type": "image",
            "src": "legacy.png",
            "fit": "fill",
            "x": 0.0,
            "y": 0.0,
            "scale": 1.0,
            "opacity": 1.0,
            "blendMode": "normal",
            "visible": true
        }))
        .expect("legacy image fill");

        let normalized = serde_json::to_value(fill).expect("serialize legacy image fill");
        assert!(normalized.get("imageWidth").is_none());
        assert!(normalized.get("imageHeight").is_none());
        assert!(normalized.get("alphaMask").is_none());
    }

    #[test]
    fn walk_nodes_flat_scene() {
        let nodes = vec![
            node(1, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (0.0, 0.0)),
            node(2, Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0)), (5.0, 5.0)),
        ];
        let walked = walk_nodes(&nodes);
        assert_eq!(walked.len(), 2);
        assert_eq!(walked[0].0, NodeId(1));
        assert_eq!(walked[0].2, None);
        assert_eq!(walked[1].0, NodeId(2));
        assert_eq!(walked[1].2, None);
    }

    #[test]
    fn walk_nodes_empty_yields_empty() {
        assert!(walk_nodes(&[]).is_empty());
    }
}
#[test]
fn blend_modes_round_trip_with_typescript_camel_case_ids() {
    let cases = [
        ("passThrough", BlendMode::PassThrough),
        ("colorDodge", BlendMode::ColorDodge),
        ("colorBurn", BlendMode::ColorBurn),
        ("hardLight", BlendMode::HardLight),
        ("softLight", BlendMode::SoftLight),
        ("plusDarker", BlendMode::PlusDarker),
        ("plusLighter", BlendMode::PlusLighter),
    ];
    for (wire, expected) in cases {
        let decoded: BlendMode =
            serde_json::from_value(serde_json::json!(wire)).expect("deserialize blend mode");
        assert_eq!(decoded, expected);
        assert_eq!(
            serde_json::to_value(decoded).expect("serialize blend mode"),
            wire
        );
    }
}
