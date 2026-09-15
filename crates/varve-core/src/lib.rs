//! Strata core: geometry, scene-graph primitives, and hit-testing.
//!
//! Research basis:
//! - Geometry via `kurbo` (linebender) — the 2D math foundation shared with the
//!   vello/lyon rendering ecosystem we adopt in task 0.6 (varve-engine).
//! - Hit-testing follows the retained-mode inverse-transform pattern used by
//!   Piet/Skia Scene: world point -> local space, then point-in-shape.
//! - Scene-graph + fractional-index ordering design references Figma/Penpot's
//!   retained ordered-list model (slots + nesting land in task 0.8/1.1).

#![forbid(unsafe_code)]

pub mod align;
pub mod component;
pub mod expr;
pub mod geom;
pub mod scene;
pub mod shape;

pub use align::{
    align_bbox, compute_alignment_target, compute_distribution, compute_tidy_layout,
    obb_alignment_target, obb_to_aabb, oriented_bbox, AlignOp, BBox, DistributeOp,
};
pub use component::{slots_satisfied, ComponentDefinition, Slot, SlotKind};
pub use expr::evaluate;
pub use geom::{point_to_segment_dist_sq, rect_contains};
pub use scene::{
    get_parent, hit_test, walk_nodes, BlendMode, ChannelOffset, CmykFallback, CropRect, Effect,
    EngineColor, FillIR, GradientFill, GradientStop, NodeId, SceneNode, Stroke,
};
pub use shape::{PathPoint, Shape};

pub use kurbo::{Affine, Circle, Ellipse, Line, Point, Rect, Vec2};
