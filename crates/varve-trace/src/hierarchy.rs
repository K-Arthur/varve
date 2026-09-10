//! Contour hierarchy detection for compound paths.
//!
//! Given a set of outer and hole contours from raster tracing, pairs each
//! hole with its containing outer using winding-number point-in-polygon.
//!
//! Research basis: Sutherland & Hodgman polygon clipping; winding-number
//! point-in-polygon test (Sunday, "Practical Geometry Algorithms", 2001).

use varve_core::Point;

/// A compound path: outer contour with optional hole rings.
#[derive(Debug, Clone, PartialEq)]
pub struct CompoundContour {
    pub outer: Vec<Point>,
    pub holes: Vec<Vec<Point>>,
}

/// Signed area of a polygon (positive = CCW, negative = CW).
fn signed_area(polygon: &[Point]) -> f64 {
    let n = polygon.len();
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    for i in 0..n {
        let a = &polygon[i];
        let b = &polygon[(i + 1) % n];
        area += a.x * b.y - b.x * a.y;
    }
    area * 0.5
}

/// Returns >0 for left turn, <0 for right turn, 0 for collinear.
fn is_left(a: &Point, b: &Point, c: &Point) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/// Winding-number point-in-polygon test.
/// Returns true if the point is inside the polygon (non-zero winding rule).
fn point_in_polygon_winding(point: &Point, polygon: &[Point]) -> bool {
    let mut winding = 0i32;
    let n = polygon.len();
    for i in 0..n {
        let a = &polygon[i];
        let b = &polygon[(i + 1) % n];
        if a.y <= point.y {
            if b.y > point.y && is_left(a, b, point) > 0.0 {
                winding += 1;
            }
        } else if b.y <= point.y && is_left(a, b, point) < 0.0 {
            winding -= 1;
        }
    }
    winding != 0
}

/// Ensure polygon has a consistent winding direction.
///
/// If `clockwise` is true, ensures the polygon is clockwise (negative area).
/// If `clockwise` is false, ensures the polygon is counter-clockwise (positive area).
fn ensure_winding(polygon: &[Point], clockwise: bool) -> Vec<Point> {
    let area = signed_area(polygon);
    let is_cw = area < 0.0;
    if is_cw == clockwise {
        polygon.to_vec()
    } else {
        polygon.iter().rev().copied().collect()
    }
}

/// Pair hole contours with their containing outer contours.
///
/// `outers` should be positive-area (CCW), `holes` should be negative-area (CW).
/// Returns (compound_paths, omitted_holes_count).
pub fn pair_holes(outers: &[Vec<Point>], holes: &[Vec<Point>]) -> (Vec<CompoundContour>, usize) {
    if outers.is_empty() {
        let omitted = if holes.is_empty() { 0 } else { holes.len() };
        return (Vec::new(), omitted);
    }

    // Sort outers by area descending (largest first)
    let mut sorted_outers: Vec<(usize, Vec<Point>, f64)> = outers
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let cw = ensure_winding(p, false);
            let area = signed_area(&cw).abs();
            (i, cw, area)
        })
        .collect();
    sorted_outers.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    // Prepare holes: ensure CW winding
    let prepared_holes: Vec<Vec<Point>> = holes.iter().map(|h| ensure_winding(h, true)).collect();

    // Assign each hole to the smallest containing outer
    let mut hole_assignments: Vec<Option<usize>> = vec![None; prepared_holes.len()];
    for (hi, hole) in prepared_holes.iter().enumerate() {
        if hole.is_empty() {
            continue;
        }
        // Use the first point of the hole for containment test
        let test_point = &hole[0];

        // Find the smallest outer that contains this hole point.
        // sorted_outers is sorted by area descending, so iterate in
        // reverse to check smaller outers first.
        let mut containing_outer: Option<usize> = None;
        for (oi, (_, outer, _)) in sorted_outers.iter().enumerate().rev() {
            if point_in_polygon_winding(test_point, outer) {
                containing_outer = Some(oi);
                break;
            }
        }

        hole_assignments[hi] = containing_outer;
    }

    // Build compound contours
    let mut used = vec![false; sorted_outers.len()];
    let mut compound: Vec<CompoundContour> = Vec::new();

    for (oi, (_, outer, _)) in sorted_outers.iter().enumerate() {
        if used[oi] {
            continue;
        }
        used[oi] = true;

        let assigned_holes: Vec<Vec<Point>> = prepared_holes
            .iter()
            .enumerate()
            .filter(|(hi, _)| hole_assignments[*hi] == Some(oi))
            .map(|(_, h)| h.clone())
            .collect();

        compound.push(CompoundContour {
            outer: outer.clone(),
            holes: assigned_holes,
        });
    }

    let omitted = hole_assignments.iter().filter(|a| a.is_none()).count();
    (compound, omitted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f64, y: f64) -> Point {
        Point::new(x, y)
    }

    fn square(x: f64, y: f64, size: f64) -> Vec<Point> {
        vec![
            point(x, y),
            point(x + size, y),
            point(x + size, y + size),
            point(x, y + size),
        ]
    }

    fn square_cw(x: f64, y: f64, size: f64) -> Vec<Point> {
        vec![
            point(x, y),
            point(x, y + size),
            point(x + size, y + size),
            point(x + size, y),
        ]
    }

    #[test]
    fn donut_one_compound_one_hole() {
        // Square outer (CCW) with square hole (CW)
        let outer = square(0.0, 0.0, 100.0);
        let hole = square_cw(25.0, 25.0, 50.0);

        let (compounds, omitted) = pair_holes(&[outer], &[hole]);
        assert_eq!(compounds.len(), 1, "should be 1 compound path");
        assert_eq!(compounds[0].holes.len(), 1, "should have 1 hole");
        assert_eq!(omitted, 0, "no holes should be omitted");
    }

    #[test]
    fn two_separate_shapes() {
        // Two separate squares, no holes
        let outer1 = square(0.0, 0.0, 50.0);
        let outer2 = square(100.0, 0.0, 50.0);

        let (compounds, omitted) = pair_holes(&[outer1, outer2], &[]);
        assert_eq!(compounds.len(), 2, "should be 2 compound paths");
        assert_eq!(compounds[0].holes.len(), 0, "no holes in path 1");
        assert_eq!(compounds[1].holes.len(), 0, "no holes in path 2");
        assert_eq!(omitted, 0);
    }

    #[test]
    fn no_holes_all_paths_are_outers() {
        let shapes = vec![
            square(0.0, 0.0, 10.0),
            square(20.0, 20.0, 10.0),
            square(40.0, 40.0, 10.0),
        ];
        let (compounds, omitted) = pair_holes(&shapes, &[]);
        assert_eq!(compounds.len(), 3, "all 3 shapes should be outers");
        assert_eq!(omitted, 0);
    }

    #[test]
    fn no_outers_omits_all_holes() {
        let hole = square_cw(0.0, 0.0, 50.0);
        let (compounds, omitted) = pair_holes(&[], &[hole]);
        assert!(compounds.is_empty(), "no outers → no compounds");
        assert_eq!(omitted, 1, "1 omitted hole");
    }

    #[test]
    fn nested_rings() {
        // Outer donut: outer square contains a hole
        let outer = square(0.0, 0.0, 100.0);
        let hole = square_cw(25.0, 25.0, 50.0);

        let (compounds, omitted) = pair_holes(&[outer], &[hole]);
        assert_eq!(compounds.len(), 1);
        assert_eq!(compounds[0].holes.len(), 1);
        // The hole should be inside the outer
        assert!(
            compounds[0].holes[0][0].x >= 24.0,
            "hole should be inside outer"
        );
        assert_eq!(omitted, 0);
    }

    #[test]
    fn winding_number_outside() {
        let poly = square(0.0, 0.0, 100.0);
        assert!(
            point_in_polygon_winding(&point(50.0, 50.0), &poly),
            "center should be inside"
        );
        assert!(
            !point_in_polygon_winding(&point(150.0, 50.0), &poly),
            "outside should be false"
        );
    }

    #[test]
    fn winding_number_degenerate_polygon() {
        // Triangle
        let poly = vec![point(0.0, 0.0), point(50.0, 100.0), point(100.0, 0.0)];
        assert!(
            point_in_polygon_winding(&point(50.0, 50.0), &poly),
            "center of triangle should be inside"
        );
        assert!(
            !point_in_polygon_winding(&point(50.0, -10.0), &poly),
            "above triangle should be outside"
        );
    }
}
