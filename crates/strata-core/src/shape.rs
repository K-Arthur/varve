//! Shapes and point-containment for hit-testing.
//!
//! Shapes are defined in a node's LOCAL space; the hit-test layer transforms a
//! world-space pointer into local space before calling `contains`.

use crate::geom::{point_to_segment_dist_sq, Circle, Line, Point, Rect};

/// First-pass shape set. Bézier paths arrive with the lyon integration.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum Shape {
    Rect(Rect),
    /// Axis-aligned ellipse (center + semi-axes).
    Ellipse {
        center: Point,
        rx: f64,
        ry: f64,
    },
    Circle(Circle),
    /// A stroked segment; hit if the pointer is within `tolerance` of the line.
    Line {
        line: Line,
        tolerance: f64,
    },
}

impl Shape {
    /// Does this shape contain `pt` (in local space)?
    pub fn contains(&self, pt: Point) -> bool {
        match self {
            Shape::Rect(r) => crate::geom::rect_contains(*r, pt),
            Shape::Ellipse { center, rx, ry } => point_in_ellipse(*center, *rx, *ry, pt),
            Shape::Circle(c) => c.center.distance(pt) <= c.radius,
            Shape::Line { line, tolerance } => {
                point_to_segment_dist_sq(*line, pt) <= tolerance * tolerance
            }
        }
    }
}

fn point_in_ellipse(center: Point, rx: f64, ry: f64, pt: Point) -> bool {
    let dx = (pt.x - center.x) / rx;
    let dy = (pt.y - center.y) / ry;
    dx * dx + dy * dy <= 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_contains_corners_and_interior() {
        let r = Shape::Rect(Rect::new(0.0, 0.0, 10.0, 10.0));
        assert!(r.contains(Point::new(5.0, 5.0)));
        assert!(r.contains(Point::new(0.0, 0.0))); // closed
        assert!(r.contains(Point::new(10.0, 10.0)));
        assert!(!r.contains(Point::new(10.01, 5.0)));
        assert!(!r.contains(Point::new(-0.01, 5.0)));
    }

    #[test]
    fn circle_contains_within_radius() {
        let c = Shape::Circle(Circle::new(Point::new(0.0, 0.0), 5.0));
        assert!(c.contains(Point::new(3.0, 3.0)));
        assert!(c.contains(Point::new(5.0, 0.0)));
        assert!(!c.contains(Point::new(3.6, 3.6)));
    }

    #[test]
    fn ellipse_contains() {
        let e = Shape::Ellipse {
            center: Point::new(0.0, 0.0),
            rx: 10.0,
            ry: 4.0,
        };
        assert!(e.contains(Point::new(9.0, 0.0)));
        assert!(e.contains(Point::new(0.0, 3.0)));
        assert!(!e.contains(Point::new(0.0, 4.5)));
        assert!(!e.contains(Point::new(10.5, 0.0)));
    }

    #[test]
    fn line_hit_within_tolerance() {
        let l = Shape::Line {
            line: Line::new(Point::new(0.0, 0.0), Point::new(10.0, 0.0)),
            tolerance: 2.0,
        };
        assert!(l.contains(Point::new(5.0, 1.5)));
        assert!(!l.contains(Point::new(5.0, 2.5)));
        assert!(l.contains(Point::new(-1.0, 1.0))); // projects onto endpoint
    }
}
