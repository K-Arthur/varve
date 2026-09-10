//! Pixel-boundary contour extraction for binary masks.
//!
//! Extracts closed, pixel-aligned boundary polygons from a binary mask by
//! chaining the unit boundary edges of each 4-connected component. This is
//! the same construction as the TS fallback tracer (`traceMaskToPaths`), and
//! it handles 1-pixel-thick rings, nested holes, and components touching the
//! image edge correctly — the classic 8-directional path follower cannot
//! walk such boundaries.
//!
//! Deterministic: components are discovered in scan order, edges are built
//! scan-ordered, and loop chaining pops bucket edges in insertion order.

use crate::{hierarchy, is_cancelled, polygon_area_internal, TraceCancellation};
use std::collections::{HashMap, HashSet};
use varve_core::Point;

/// A unit boundary edge of a pixel component (grid-aligned segment).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct Edge {
    sx: u32,
    sy: u32,
    ex: u32,
    ey: u32,
}

/// Chain boundary edges into closed loops (pixel-aligned polygons).
///
/// Mirror of the TS `loopsFromEdges` walker: edges are bucketed by start
/// point, a loop is walked by popping the next edge at the current end, and
/// stale/consumed bucket entries are skipped via a consumed set. Deterministic
/// given the scan-ordered edge list, and linear-ish even for long boundaries.
fn chain_loops(mut edges: Vec<Edge>) -> Vec<Vec<Point>> {
    let mut consumed: HashSet<Edge> = HashSet::new();
    let mut by_start: HashMap<(u32, u32), Vec<Edge>> = HashMap::new();
    for &edge in &edges {
        by_start.entry((edge.sx, edge.sy)).or_default().push(edge);
    }
    let mut loops: Vec<Vec<Point>> = Vec::new();
    while let Some(seed) = edges.pop() {
        if !consumed.insert(seed) {
            continue;
        }
        let mut points = vec![Point::new(seed.sx as f64, seed.sy as f64)];
        let mut end = (seed.ex, seed.ey);
        loop {
            if end == (seed.sx, seed.sy) {
                break;
            }
            points.push(Point::new(end.0 as f64, end.1 as f64));
            let next = by_start.get_mut(&end).and_then(|bucket| bucket.pop());
            let Some(next) = next else { break };
            if !consumed.insert(next) {
                // Stale entry from an already-walked loop; retry this vertex.
                continue;
            }
            end = (next.ex, next.ey);
        }
        if points.len() >= 3 && end == (seed.sx, seed.sy) {
            loops.push(points);
        }
    }
    loops
}

/// Collect the boundary edges of one 4-connected component (scan-ordered).
fn component_edges(mask: &[bool], width: u32, height: u32, component: &[u32]) -> Vec<Edge> {
    let w = width as usize;
    let mut edges = Vec::new();
    for &index in component {
        let x = (index % width) as usize;
        let y = (index / width) as usize;
        let has_left = x > 0 && mask[y * w + x - 1];
        let has_right = x + 1 < w && mask[y * w + x + 1];
        let has_up = y > 0 && mask[(y - 1) * w + x];
        let has_down = y + 1 < height as usize && mask[(y + 1) * w + x];
        let (x, y) = (x as u32, y as u32);
        if !has_up {
            edges.push(Edge {
                sx: x,
                sy: y,
                ex: x + 1,
                ey: y,
            });
        }
        if !has_right {
            edges.push(Edge {
                sx: x + 1,
                sy: y,
                ex: x + 1,
                ey: y + 1,
            });
        }
        if !has_down {
            edges.push(Edge {
                sx: x + 1,
                sy: y + 1,
                ex: x,
                ey: y + 1,
            });
        }
        if !has_left {
            edges.push(Edge {
                sx: x,
                sy: y + 1,
                ex: x,
                ey: y,
            });
        }
    }
    edges
}

/// Cyclic collinear removal for closed pixel-aligned loops.
///
/// Chains from unit edges contain only collinear redundancy, so removing
/// any point exactly on the line between its neighbors (checked cyclically,
/// so the closing edge participates) is sufficient — no RDP needed, and a
/// closed square collapses to exactly its four corners.
pub fn remove_collinear(points: &[Point]) -> Vec<Point> {
    let mut pts = points.to_vec();
    if pts.len() < 4 {
        return pts;
    }
    let mut changed = true;
    while changed && pts.len() > 3 {
        changed = false;
        let m = pts.len();
        for i in 0..m {
            let prev = pts[(i + m - 1) % m];
            let cur = pts[i];
            let next = pts[(i + 1) % m];
            // Integer-pixel coordinates: collinear iff the cross product is 0.
            let cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
            if cross.abs() <= f64::EPSILON * 8.0 {
                pts.remove(i);
                changed = true;
                break;
            }
        }
    }
    pts
}

/// Boundary polygons of every 4-connected component of a binary mask.
///
/// Each returned polygon is closed (first point repeats implicitly) and
/// pixel-aligned; collinear runs are already collapsed. Components with
/// fewer than `min_region` pixels are skipped. Cancellation is polled
/// between components. Deterministic.
pub fn component_polylines(
    mask: &[bool],
    width: u32,
    height: u32,
    min_region: usize,
    cancel: Option<&TraceCancellation>,
) -> Vec<Vec<Point>> {
    let count = (width * height) as usize;
    let mut labels = vec![0u32; count];
    let mut next_label = 1u32;
    let mut polys: Vec<Vec<Point>> = Vec::new();
    for seed in 0..count {
        if cancel.is_some_and(is_cancelled) {
            break;
        }
        if !mask[seed] || labels[seed] != 0 {
            continue;
        }
        // Scan-ordered 4-connected flood fill.
        let mut component: Vec<u32> = Vec::new();
        let mut queue = vec![seed as u32];
        labels[seed] = next_label;
        while let Some(index) = queue.pop() {
            component.push(index);
            let x = index % width;
            let y = index / width;
            if x > 0 {
                let n = index - 1;
                if mask[n as usize] && labels[n as usize] == 0 {
                    labels[n as usize] = next_label;
                    queue.push(n);
                }
            }
            if x + 1 < width {
                let n = index + 1;
                if mask[n as usize] && labels[n as usize] == 0 {
                    labels[n as usize] = next_label;
                    queue.push(n);
                }
            }
            if y > 0 {
                let n = index - width;
                if mask[n as usize] && labels[n as usize] == 0 {
                    labels[n as usize] = next_label;
                    queue.push(n);
                }
            }
            if y + 1 < height {
                let n = index + width;
                if mask[n as usize] && labels[n as usize] == 0 {
                    labels[n as usize] = next_label;
                    queue.push(n);
                }
            }
        }
        next_label += 1;
        if component.len() < min_region {
            continue;
        }
        // Sort component pixels so edge order is scan-deterministic.
        component.sort_unstable();
        let edges = component_edges(mask, width, height, &component);
        for loop_pts in chain_loops(edges) {
            let collapsed = remove_collinear(&loop_pts);
            if collapsed.len() >= 3 {
                polys.push(collapsed);
            }
        }
    }
    polys
}

/// Partition boundary polygons into outer contours (positive area) and hole
/// rings (negative area, i.e. clockwise).
pub fn split_outers_holes(polys: &[Vec<Point>]) -> (Vec<Vec<Point>>, Vec<Vec<Point>>) {
    let mut outers: Vec<Vec<Point>> = Vec::new();
    let mut hole_rings: Vec<Vec<Point>> = Vec::new();
    for poly in polys {
        if polygon_area_internal(poly) >= 0.0 {
            outers.push(poly.clone());
        } else {
            hole_rings.push(poly.clone());
        }
    }
    (outers, hole_rings)
}

/// Pair hole rings with their containing outer contours.
///
/// Returns the compound paths plus the count of holes that could not be
/// paired (when no outer exists, or a hole falls outside every outer).
pub fn pair_compound_holes(polys: &[Vec<Point>]) -> (Vec<hierarchy::CompoundContour>, usize) {
    let (outers, hole_rings) = split_outers_holes(polys);
    hierarchy::pair_holes(&outers, &hole_rings)
}
