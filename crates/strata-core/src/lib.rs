//! Strata core: geometry, scene-graph primitives, and hit-testing.
//!
//! Research basis:
//! - Geometry via `kurbo` (linebender) — the 2D math foundation shared with the
//!   vello/lyon rendering ecosystem we adopt in task 0.6 (strata-engine).
//! - Hit-testing follows the retained-mode inverse-transform pattern used by
//!   Piet/Skia Scene: world point -> local space, then point-in-shape.
//! - Scene-graph + fractional-index ordering design references Figma/Penpot's
//!   retained ordered-list model (slots + nesting land in task 0.8/1.1).

#![forbid(unsafe_code)]

pub mod geom;
pub mod scene;
pub mod shape;

pub use geom::{point_to_segment_dist_sq, rect_contains};
pub use scene::{hit_test, NodeId, SceneNode};
pub use shape::Shape;

pub use kurbo::{Affine, Circle, Ellipse, Line, Point, Rect, Vec2};
