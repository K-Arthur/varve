//! Geometry primitives for Strata.
//!
//! Re-exports `kurbo` (linebender 2D geometry) as the canonical math foundation
//! and adds Strata-specific helpers. Using kurbo (rather than hand-rolled affine
//! math) keeps us bug-free and shared with the vello/lyon rendering ecosystem.
//!
//! Research basis: kurbo (Raph Levien / linebender), the 2D geometry library
//! behind Druid, Xilem, and Vello.

pub use kurbo::{Affine, Circle, Ellipse, Line, Point, Rect, Vec2};

/// Squared length of a vector (cheap; avoids sqrt for comparisons).
fn length_sq(v: Vec2) -> f64 {
    v.x * v.x + v.y * v.y
}

/// A 2D bounding-box hit test: is `pt` inside `rect` (closed)?
pub fn rect_contains(rect: Rect, pt: Point) -> bool {
    pt.x >= rect.min_x() && pt.x <= rect.max_x() && pt.y >= rect.min_y() && pt.y <= rect.max_y()
}

/// Distance from `pt` to the nearest point on `seg`, squared (avoid sqrt for compares).
pub fn point_to_segment_dist_sq(seg: Line, pt: Point) -> f64 {
    let (p0, p1) = (seg.p0, seg.p1);
    let v = p1 - p0;
    let len_sq = length_sq(v);
    if len_sq == 0.0 {
        return length_sq(pt - p0);
    }
    let t = ((pt - p0).dot(v) / len_sq).clamp(0.0, 1.0);
    let proj = p0 + v * t;
    length_sq(pt - proj)
}
