//! Cubic Bezier curve fitting for traced raster contours.
//!
//! Takes a polyline contour from raster tracing and fits cubic Bezier curves
//! to each segment between detected corners, with recursive subdivision
//! when fitting error exceeds the threshold.
//!
//! Research basis: Schneider, "An Algorithm for Automatically Fitting Digitized
//! Curves" (Graphics Gems, 1990).

use crate::BezierPoint;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct CubicCoeffs {
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    cx: f64,
    cy: f64,
    dx: f64,
    dy: f64,
}

fn point_on_bezier(b: &CubicCoeffs, t: f64) -> (f64, f64) {
    let t2 = t * t;
    let t3 = t2 * t;
    (
        b.ax * t3 + b.bx * t2 + b.cx * t + b.dx,
        b.ay * t3 + b.by * t2 + b.cy * t + b.dy,
    )
}

fn angle_between(p1: (f64, f64), p2: (f64, f64), p3: (f64, f64)) -> f64 {
    let dx1 = p1.0 - p2.0;
    let dy1 = p1.1 - p2.1;
    let dx2 = p3.0 - p2.0;
    let dy2 = p3.1 - p2.1;
    let len1 = (dx1 * dx1 + dy1 * dy1).sqrt();
    let len2 = (dx2 * dx2 + dy2 * dy2).sqrt();
    if len1 < 1e-10 || len2 < 1e-10 {
        return 180.0;
    }
    let cos = ((dx1 * dx2 + dy1 * dy2) / (len1 * len2)).clamp(-1.0, 1.0);
    cos.acos() * 180.0 / std::f64::consts::PI
}

fn chord_length_params(points: &[(f64, f64)]) -> Vec<f64> {
    let n = points.len();
    let mut params = vec![0.0; n];
    let mut total = 0.0;
    for i in 1..n {
        let dx = points[i].0 - points[i - 1].0;
        let dy = points[i].1 - points[i - 1].1;
        total += (dx * dx + dy * dy).sqrt();
        params[i] = total;
    }
    if total > 0.0 {
        for p in params.iter_mut().skip(1) {
            *p /= total;
        }
    }
    params
}

fn fit_cubic_least_squares(points: &[(f64, f64)], s: usize, e: usize) -> Option<CubicCoeffs> {
    let p0 = points[s];
    let p3 = points[e];
    let segment: Vec<(f64, f64)> = points[s..=e].to_vec();
    if segment.len() < 2 {
        return None;
    }

    let t = chord_length_params(&segment);

    let mut a11 = 0.0;
    let mut a12 = 0.0;
    let mut a22 = 0.0;
    let mut b1x = 0.0;
    let mut b2x = 0.0;
    let mut b1y = 0.0;
    let mut b2y = 0.0;

    for i in 0..segment.len() {
        let ti = t[i];
        let ti2 = ti * ti;
        let ti3 = ti2 * ti;
        let u = 1.0 - ti;
        let u2 = u * u;
        let u3 = u2 * u;
        let a0_val = 3.0 * u2 * ti;
        let a1_val = 3.0 * u * ti2;
        let pt = segment[i];

        a11 += a0_val * a0_val;
        a12 += a0_val * a1_val;
        a22 += a1_val * a1_val;

        let bx = pt.0 - u3 * p0.0 - ti3 * p3.0;
        let by = pt.1 - u3 * p0.1 - ti3 * p3.1;

        b1x += a0_val * bx;
        b2x += a1_val * bx;
        b1y += a0_val * by;
        b2y += a1_val * by;
    }

    let det = a11 * a22 - a12 * a12;
    if det.abs() < 1e-12 {
        return None;
    }

    let c1x = (a22 * b1x - a12 * b2x) / det;
    let c2x = (a11 * b2x - a12 * b1x) / det;
    let c1y = (a22 * b1y - a12 * b2y) / det;
    let c2y = (a11 * b2y - a12 * b1y) / det;

    Some(CubicCoeffs {
        ax: p3.0 - 3.0 * c2x + 3.0 * c1x - p0.0,
        ay: p3.1 - 3.0 * c2y + 3.0 * c1y - p0.1,
        bx: 3.0 * c2x - 6.0 * c1x + 3.0 * p0.0,
        by: 3.0 * c2y - 6.0 * c1y + 3.0 * p0.1,
        cx: 3.0 * c1x - 3.0 * p0.0,
        cy: 3.0 * c1y - 3.0 * p0.1,
        dx: p0.0,
        dy: p0.1,
    })
}

fn max_fitting_error_index(
    coeffs: &CubicCoeffs,
    points: &[(f64, f64)],
    s: usize,
    e: usize,
) -> (f64, isize) {
    let segment: Vec<(f64, f64)> = points[s..=e].to_vec();
    let t = chord_length_params(&segment);
    let mut max_err = 0.0;
    let mut max_idx: isize = -1;
    for i in 1..segment.len() - 1 {
        let p = point_on_bezier(coeffs, t[i]);
        let pt = points[s + i];
        let err = ((p.0 - pt.0).powi(2) + (p.1 - pt.1).powi(2)).sqrt();
        if err > max_err {
            max_err = err;
            max_idx = (s + i) as isize;
        }
    }
    (max_err, max_idx)
}

type BezierHandles = (Option<(f64, f64)>, Option<(f64, f64)>);

fn coeffs_to_handles(c: &CubicCoeffs) -> BezierHandles {
    let c1x = c.cx / 3.0 + c.dx;
    let c1y = c.cy / 3.0 + c.dy;
    let c2x = c.bx / 3.0 + (2.0 * c.cx) / 3.0 + c.dx;
    let c2y = c.by / 3.0 + (2.0 * c.cy) / 3.0 + c.dy;

    let h_out_x = c1x - c.dx;
    let h_out_y = c1y - c.dy;
    let h_in_x = c2x - (c.ax + c.bx + c.cx + c.dx);
    let h_in_y = c2y - (c.ay + c.by + c.cy + c.dy);

    let handle_out = if h_out_x.abs() > 0.5 || h_out_y.abs() > 0.5 {
        Some((h_out_x, h_out_y))
    } else {
        None
    };

    let handle_in = if h_in_x.abs() > 0.5 || h_in_y.abs() > 0.5 {
        Some((h_in_x, h_in_y))
    } else {
        None
    };

    (handle_out, handle_in)
}

fn fit_segment_recursive(
    points: &[(f64, f64)],
    s: usize,
    e: usize,
    max_error: f64,
    anchors: &mut std::collections::BTreeSet<usize>,
) {
    if e - s < 3
        || ((points[e].0 - points[s].0).powi(2) + (points[e].1 - points[s].1).powi(2)).sqrt() < 3.0
    {
        anchors.insert(s);
        anchors.insert(e);
        return;
    }

    let coeffs = fit_cubic_least_squares(points, s, e);
    let coeffs = match coeffs {
        Some(c) => c,
        None => {
            anchors.insert(s);
            anchors.insert(e);
            return;
        }
    };

    let (max_err, index) = max_fitting_error_index(&coeffs, points, s, e);
    if max_err <= max_error || index < 0 {
        anchors.insert(s);
        anchors.insert(e);
        return;
    }

    fit_segment_recursive(points, s, index as usize, max_error, anchors);
    fit_segment_recursive(points, index as usize, e, max_error, anchors);
}

fn build_bezier_points(points: &[(f64, f64)], anchor_indices: &[usize]) -> Vec<BezierPoint> {
    if anchor_indices.len() < 2 {
        return points
            .iter()
            .map(|p| BezierPoint {
                x: p.0,
                y: p.1,
                handle_in: None,
                handle_out: None,
            })
            .collect();
    }

    let mut result: Vec<BezierPoint> = Vec::new();

    for ai in 0..anchor_indices.len() - 1 {
        let s = anchor_indices[ai];
        let e = anchor_indices[ai + 1];
        let start_pt = points[s];
        let end_pt = points[e];

        if e - s < 3 {
            if result.is_empty() {
                result.push(BezierPoint {
                    x: start_pt.0,
                    y: start_pt.1,
                    handle_in: None,
                    handle_out: None,
                });
            }
            result.push(BezierPoint {
                x: end_pt.0,
                y: end_pt.1,
                handle_in: None,
                handle_out: None,
            });
            continue;
        }

        let coeffs = fit_cubic_least_squares(points, s, e);
        let coeffs = match coeffs {
            Some(c) => c,
            None => {
                if result.is_empty() {
                    result.push(BezierPoint {
                        x: start_pt.0,
                        y: start_pt.1,
                        handle_in: None,
                        handle_out: None,
                    });
                }
                result.push(BezierPoint {
                    x: end_pt.0,
                    y: end_pt.1,
                    handle_in: None,
                    handle_out: None,
                });
                continue;
            }
        };

        let (handle_out, handle_in) = coeffs_to_handles(&coeffs);

        if result.is_empty() {
            result.push(BezierPoint {
                x: start_pt.0,
                y: start_pt.1,
                handle_in: None,
                handle_out,
            });
        } else {
            if let Some(last) = result.last_mut() {
                last.handle_out = handle_out;
            }
        }

        result.push(BezierPoint {
            x: end_pt.0,
            y: end_pt.1,
            handle_in,
            handle_out: None,
        });
    }

    result
}

/// Fit cubic Bezier curves to a traced polyline contour.
///
/// Returns `Vec<BezierPoint>` with handle_in/handle_out offsets. Sharp corners
/// are preserved as bare corner points. Curve segments between corners are fitted
/// with cubic Bezier curves, recursively subdivided when error exceeds max_error.
pub fn fit_bezier_to_contour(
    contour: &[(f64, f64)],
    closed: bool,
    corner_angle: f64,
    max_error: f64,
) -> Vec<BezierPoint> {
    if contour.len() < 4 {
        return contour
            .iter()
            .map(|p| BezierPoint {
                x: p.0,
                y: p.1,
                handle_in: None,
                handle_out: None,
            })
            .collect();
    }

    let n = contour.len();
    let mut corner_indices: Vec<usize> = vec![0];

    for i in 1..n - 1 {
        let angle = angle_between(contour[i - 1], contour[i], contour[i + 1]);
        if angle < corner_angle {
            corner_indices.push(i);
        }
    }

    if closed && n >= 3 {
        corner_indices.push(0);
    } else {
        corner_indices.push(n - 1);
    }

    corner_indices.sort();
    corner_indices.dedup();

    // No real corners: treat entire contour as one curve segment
    if corner_indices.len() <= 1 {
        let mut all_anchors = std::collections::BTreeSet::new();
        fit_segment_recursive(contour, 0, n - 1, max_error, &mut all_anchors);
        let sorted: Vec<usize> = all_anchors.into_iter().collect();
        if sorted.len() < 2 {
            return contour
                .iter()
                .map(|p| BezierPoint {
                    x: p.0,
                    y: p.1,
                    handle_in: None,
                    handle_out: None,
                })
                .collect();
        }
        let mut result = build_bezier_points(contour, &sorted);
        if closed && result.len() >= 2 {
            let first = result[0].clone();
            let last = result.last().unwrap().clone();
            let dx = last.x - first.x;
            let dy = last.y - first.y;
            if dx.abs() < 0.5 && dy.abs() < 0.5 {
                result.pop();
                result[0].handle_in = last.handle_in;
                if result.len() >= 2 {
                    if let Some(second_last) = result.last_mut() {
                        second_last.handle_out = last.handle_out;
                    }
                }
            }
        }
        return result;
    }

    let mut all_anchors = std::collections::BTreeSet::new();

    for ci in 0..corner_indices.len() - 1 {
        let s = corner_indices[ci];
        let e = corner_indices[ci + 1];
        if e - s < 2 {
            all_anchors.insert(s);
            continue;
        }
        all_anchors.insert(s);
        fit_segment_recursive(contour, s, e, max_error, &mut all_anchors);
    }

    // Handle wrap-around for closed contours
    if closed && corner_indices.len() >= 2 {
        let last_corner = corner_indices[corner_indices.len() - 1];
        let first_corner = corner_indices[0];
        for i in last_corner..n {
            all_anchors.insert(i);
        }
        for i in 0..first_corner {
            all_anchors.insert(i);
        }
    }

    let sorted: Vec<usize> = all_anchors.into_iter().collect();

    if sorted.len() < 2 {
        return contour
            .iter()
            .map(|p| BezierPoint {
                x: p.0,
                y: p.1,
                handle_in: None,
                handle_out: None,
            })
            .collect();
    }

    let mut result = build_bezier_points(contour, &sorted);

    if result.len() < 3 {
        return contour
            .iter()
            .map(|p| BezierPoint {
                x: p.0,
                y: p.1,
                handle_in: None,
                handle_out: None,
            })
            .collect();
    }

    if closed && result.len() >= 3 {
        let first_idx = 0;
        let last_idx = result.len() - 1;
        let dx = result[last_idx].x - result[first_idx].x;
        let dy = result[last_idx].y - result[first_idx].y;
        if dx.abs() < 0.5 && dy.abs() < 0.5 {
            let last_handle_in = result[last_idx].handle_in;
            let last_handle_out = result[last_idx].handle_out;
            result.pop();
            result[first_idx].handle_in = last_handle_in;
            if result.len() >= 2 {
                if let Some(second_last) = result.last_mut() {
                    second_last.handle_out = last_handle_out;
                }
            }
        } else {
            result[last_idx].handle_out = result[first_idx].handle_out;
            result[first_idx].handle_in = result[last_idx].handle_in;
        }
    }

    for pt in result.iter_mut() {
        if let Some(hi) = pt.handle_in {
            if hi.0.abs() < 0.5 && hi.1.abs() < 0.5 {
                pt.handle_in = None;
            }
        }
        if let Some(ho) = pt.handle_out {
            if ho.0.abs() < 0.5 && ho.1.abs() < 0.5 {
                pt.handle_out = None;
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(coords: &[(f64, f64)]) -> Vec<(f64, f64)> {
        coords.to_vec()
    }

    #[test]
    fn bare_points_for_3_point_contour() {
        let contour = pts(&[(0.0, 0.0), (10.0, 0.0), (5.0, 10.0)]);
        let result = fit_bezier_to_contour(&contour, true, 135.0, 1.0);
        assert_eq!(result.len(), 3);
        for pt in &result {
            assert!(pt.handle_in.is_none());
            assert!(pt.handle_out.is_none());
        }
    }

    #[test]
    fn straight_line_minimal_handles() {
        let contour = pts(&[
            (0.0, 0.0),
            (5.0, 0.0),
            (10.0, 0.0),
            (15.0, 0.0),
            (20.0, 0.0),
        ]);
        let result = fit_bezier_to_contour(&contour, false, 135.0, 1.0);
        assert!(result.len() >= 2);
        assert!((result[0].x - 0.0).abs() < 0.01);
        assert!((result[0].y - 0.0).abs() < 0.01);
        let last = result.last().unwrap();
        assert!((last.x - 20.0).abs() < 0.01);
        assert!((last.y - 0.0).abs() < 0.01);
    }

    #[test]
    fn curved_contour_generates_handles() {
        let mut contour = Vec::new();
        for i in 0..20 {
            let t = (i as f64 / 19.0) * std::f64::consts::PI;
            contour.push((i as f64 * 5.0, (t.sin() * 20.0).round()));
        }
        let result = fit_bezier_to_contour(&contour, false, 135.0, 1.0);
        assert!(result.len() < contour.len());
        let has_handles = result
            .iter()
            .any(|p| p.handle_in.is_some() || p.handle_out.is_some());
        assert!(has_handles);
    }

    #[test]
    fn preserves_right_angle_corner() {
        let contour = pts(&[
            (0.0, 0.0),
            (5.0, 0.0),
            (9.0, 0.0),
            (10.0, 0.0),
            (10.0, 5.0),
            (10.0, 10.0),
            (10.0, 5.0),
        ]);
        let result = fit_bezier_to_contour(&contour, false, 100.0, 1.0);
        let has_corner = result
            .iter()
            .any(|p| (p.x - 10.0).abs() < 1.0 && (p.y - 10.0).abs() < 1.0);
        assert!(has_corner);
    }

    #[test]
    fn square_produces_4_corner_points() {
        let contour = pts(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
        let result = fit_bezier_to_contour(&contour, true, 135.0, 0.1);
        assert_eq!(result.len(), 4);
        for pt in &result {
            let on_corner = (pt.x == 0.0 || pt.x == 10.0) && (pt.y == 0.0 || pt.y == 10.0);
            assert!(on_corner, "point ({}, {}) not on a corner", pt.x, pt.y);
        }
    }

    #[test]
    fn smooth_circle_reduces_anchors() {
        let mut contour = Vec::new();
        let cx = 50.0;
        let cy = 50.0;
        let r = 40.0;
        for i in 0..64 {
            let a = (i as f64 / 64.0) * std::f64::consts::PI * 2.0;
            contour.push((cx + r * a.cos(), cy + r * a.sin()));
        }
        let result = fit_bezier_to_contour(&contour, true, 135.0, 0.5);
        assert!(result.len() < contour.len());
        let has_handles = result
            .iter()
            .any(|p| p.handle_in.is_some() || p.handle_out.is_some());
        assert!(has_handles);
    }

    #[test]
    fn valid_closed_contour_from_8_perimeter_points() {
        let contour = pts(&[
            (0.0, 0.0),
            (5.0, 0.0),
            (10.0, 0.0),
            (10.0, 5.0),
            (10.0, 10.0),
            (5.0, 10.0),
            (0.0, 10.0),
            (0.0, 5.0),
        ]);
        let result = fit_bezier_to_contour(&contour, true, 135.0, 0.5);
        assert!(result.len() >= 4);
    }

    #[test]
    fn deterministic_output() {
        let contour = pts(&[
            (0.0, 0.0),
            (4.0, 1.0),
            (8.0, 2.0),
            (12.0, 0.0),
            (16.0, -1.0),
        ]);
        let a = fit_bezier_to_contour(&contour, false, 135.0, 1.0);
        let b = fit_bezier_to_contour(&contour, false, 135.0, 1.0);
        assert_eq!(a.len(), b.len());
        for i in 0..a.len() {
            assert!((a[i].x - b[i].x).abs() < 1e-10);
            assert!((a[i].y - b[i].y).abs() < 1e-10);
        }
    }
}
