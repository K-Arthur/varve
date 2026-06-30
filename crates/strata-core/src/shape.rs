//! Shapes and point-containment for hit-testing.
//!
//! Shapes are defined in a node's LOCAL space; the hit-test layer transforms a
//! world-space pointer into local space before calling `contains`.

use crate::geom::{point_to_segment_dist_sq, Circle, Line, Point, Rect};

/// A single point in a bezier path (mirrors TS `PathPoint`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PathPoint {
    pub x: f64,
    pub y: f64,
    #[serde(rename = "handleIn")]
    pub handle_in: Option<[f64; 2]>,
    #[serde(rename = "handleOut")]
    pub handle_out: Option<[f64; 2]>,
}

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
    /// Regular polygon (equilateral, centered).
    Polygon {
        cx: f64,
        cy: f64,
        radius: f64,
        sides: u32,
        rotation: f64,
    },
    /// Star shape (alternating inner/outer vertices).
    Star {
        cx: f64,
        cy: f64,
        inner_radius: f64,
        outer_radius: f64,
        points: u32,
        rotation: f64,
    },
    /// Directed line segment with an arrowhead at the `to` end.
    Arrow {
        from: [f64; 2],
        to: [f64; 2],
        tolerance: f64,
        #[serde(rename = "arrowheadSize")]
        arrowhead_size: f64,
    },
    /// Bezier path (open or closed).
    Path {
        points: Vec<PathPoint>,
        closed: bool,
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
            Shape::Polygon {
                cx,
                cy,
                radius,
                sides,
                rotation,
            } => {
                let verts = polygon_vertices(*cx, *cy, *radius, *sides, *rotation);
                point_in_polygon(&verts, pt)
            }
            Shape::Star {
                cx,
                cy,
                inner_radius,
                outer_radius,
                points,
                rotation,
            } => {
                let verts =
                    star_vertices(*cx, *cy, *inner_radius, *outer_radius, *points, *rotation);
                point_in_polygon(&verts, pt)
            }
            Shape::Arrow {
                from,
                to,
                tolerance,
                ..
            } => {
                let line = Line::new(Point::new(from[0], from[1]), Point::new(to[0], to[1]));
                point_to_segment_dist_sq(line, pt) <= tolerance * tolerance
            }
            Shape::Path {
                points,
                closed,
                tolerance,
            } => {
                if points.is_empty() {
                    return false;
                }
                if *closed && points.len() >= 3 {
                    let verts: Vec<Point> = points.iter().map(|p| Point::new(p.x, p.y)).collect();
                    point_in_polygon(&verts, pt)
                } else {
                    // Open path: hit if within tolerance of any segment.
                    for i in 0..points.len().saturating_sub(1) {
                        let a = Point::new(points[i].x, points[i].y);
                        let b = Point::new(points[i + 1].x, points[i + 1].y);
                        let line = Line::new(a, b);
                        if point_to_segment_dist_sq(line, pt) <= tolerance * tolerance {
                            return true;
                        }
                    }
                    false
                }
            }
        }
    }
}

fn polygon_vertices(cx: f64, cy: f64, radius: f64, sides: u32, rotation: f64) -> Vec<Point> {
    let mut verts = Vec::with_capacity(sides as usize);
    for i in 0..sides {
        let a = 2.0 * std::f64::consts::PI * i as f64 / sides as f64 - std::f64::consts::FRAC_PI_2
            + rotation;
        verts.push(Point::new(cx + radius * a.cos(), cy + radius * a.sin()));
    }
    verts
}

fn star_vertices(
    cx: f64,
    cy: f64,
    inner_radius: f64,
    outer_radius: f64,
    points: u32,
    rotation: f64,
) -> Vec<Point> {
    let total = (points * 2) as usize;
    let mut verts = Vec::with_capacity(total);
    for i in 0..total {
        let a = std::f64::consts::PI * i as f64 / points as f64 - std::f64::consts::FRAC_PI_2
            + rotation;
        let r = if i % 2 == 0 {
            outer_radius
        } else {
            inner_radius
        };
        verts.push(Point::new(cx + r * a.cos(), cy + r * a.sin()));
    }
    verts
}

fn point_in_polygon(vertices: &[Point], pt: Point) -> bool {
    let mut inside = false;
    let mut j = vertices.len() - 1;
    for i in 0..vertices.len() {
        if (vertices[i].y > pt.y) != (vertices[j].y > pt.y)
            && pt.x
                < (vertices[j].x - vertices[i].x) * (pt.y - vertices[i].y)
                    / (vertices[j].y - vertices[i].y)
                    + vertices[i].x
        {
            inside = !inside;
        }
        j = i;
    }
    inside
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
