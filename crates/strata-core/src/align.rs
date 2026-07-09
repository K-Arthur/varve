//! Alignment and distribution operations for layout.
//!
//! This module provides the canonical Rust implementation of alignment (left,
//! center, right, top, middle, bottom) and distribution (even horizontal/vertical
//! spacing) algorithms used by the editor. It also provides oriented bounding box
//! (OBB) helpers for working with rotated shapes.
//!
//! Research basis:
//! - Figma/Sketch alignment/distribution semantics (selection-bounds frame,
//!   gap-based distribution, OBB-aware alignment for rotated nodes).
//! - `kurbo` for affine transform math.

use kurbo::Point;

/// 6 axes for alignment operations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AlignOp {
    Left,
    CenterH,
    Right,
    Top,
    CenterV,
    Bottom,
}

/// Distribution axis (horizontal = even X gaps, vertical = even Y gaps).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DistributeOp {
    Horizontal,
    Vertical,
}

/// A 2D bounding box for layout math (axis-aligned).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl BBox {
    pub fn left(&self) -> f64 {
        self.x
    }
    pub fn right(&self) -> f64 {
        self.x + self.w
    }
    pub fn center_x(&self) -> f64 {
        self.x + self.w / 2.0
    }
    pub fn top(&self) -> f64 {
        self.y
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }
    pub fn center_y(&self) -> f64 {
        self.y + self.h / 2.0
    }
}

/// Compute the target alignment frame for a set of bounding boxes.
///
/// Returns the union bounding box (min/max extents) of all input bounds.
/// Returns `None` if fewer than 2 items are provided.
pub fn compute_alignment_target(_axis: AlignOp, bounds: &[BBox]) -> Option<BBox> {
    if bounds.len() < 2 {
        return None;
    }
    let min_x = bounds.iter().map(|b| b.left()).fold(f64::INFINITY, f64::min);
    let max_x = bounds.iter().map(|b| b.right()).fold(f64::NEG_INFINITY, f64::max);
    let min_y = bounds.iter().map(|b| b.top()).fold(f64::INFINITY, f64::min);
    let max_y = bounds.iter().map(|b| b.bottom()).fold(f64::NEG_INFINITY, f64::max);
    Some(BBox {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    })
}

/// Compute the new position `(x, y)` for a bounding box aligned within a target frame.
pub fn align_bbox(bbox: &BBox, axis: AlignOp, target: &BBox) -> (f64, f64) {
    match axis {
        AlignOp::Left => (target.x, bbox.y),
        AlignOp::CenterH => (target.center_x() - bbox.w / 2.0, bbox.y),
        AlignOp::Right => (target.right() - bbox.w, bbox.y),
        AlignOp::Top => (bbox.x, target.y),
        AlignOp::CenterV => (bbox.x, target.center_y() - bbox.h / 2.0),
        AlignOp::Bottom => (bbox.x, target.bottom() - bbox.h),
    }
}

/// Compute evenly-spaced positions for a set of bounding boxes along an axis.
///
/// If `gap` is `None`, gaps are computed automatically to distribute items evenly
/// across their total span. If `gap` is `Some(g)`, that exact gap is used.
/// Returns positions (x for Horizontal, y for Vertical) in sorted-by-position order.
/// Returns `None` if fewer than 3 items are provided.
pub fn compute_distribution(
    axis: DistributeOp,
    bounds: &[BBox],
    gap: Option<f64>,
) -> Option<Vec<f64>> {
    if bounds.len() < 3 {
        return None;
    }

    // Sort bounds by leading edge along the axis
    let mut sorted: Vec<&BBox> = bounds.iter().collect();
    match axis {
        DistributeOp::Horizontal => sorted.sort_by(|a, b| a.left().partial_cmp(&b.left()).unwrap()),
        DistributeOp::Vertical => sorted.sort_by(|a, b| a.top().partial_cmp(&b.top()).unwrap()),
    }

    let n = sorted.len();
    let gap = gap.unwrap_or_else(|| {
        let (first_edge, last_edge) = match axis {
            DistributeOp::Horizontal => (sorted[0].left(), sorted[n - 1].right()),
            DistributeOp::Vertical => (sorted[0].top(), sorted[n - 1].bottom()),
        };
        let total_span = last_edge - first_edge;
        let total_size: f64 = match axis {
            DistributeOp::Horizontal => sorted.iter().map(|b| b.w).sum(),
            DistributeOp::Vertical => sorted.iter().map(|b| b.h).sum(),
        };
        (total_span - total_size) / (n - 1) as f64
    });

    let mut positions = Vec::with_capacity(n);
    let mut cursor = match axis {
        DistributeOp::Horizontal => sorted[0].left(),
        DistributeOp::Vertical => sorted[0].top(),
    };

    for bbox in &sorted {
        positions.push(cursor);
        match axis {
            DistributeOp::Horizontal => cursor += bbox.w + gap,
            DistributeOp::Vertical => cursor += bbox.h + gap,
        }
    }

    Some(positions)
}

/// Compute the 4 corner points of an oriented bounding box.
///
/// Given an affine transform and local rect dimensions `(0,0,w,h)`, returns
/// `[topLeft, topRight, bottomRight, bottomLeft]` in world space.
pub fn oriented_bbox(affine: kurbo::Affine, w: f64, h: f64) -> [Point; 4] {
    let tl = affine * Point::new(0.0, 0.0);
    let tr = affine * Point::new(w, 0.0);
    let br = affine * Point::new(w, h);
    let bl = affine * Point::new(0.0, h);
    [tl, tr, br, bl]
}

/// Convert an oriented bounding box (4 corner points) to an axis-aligned `BBox`.
pub fn obb_to_aabb(obb: &[Point; 4]) -> BBox {
    let xs = [obb[0].x, obb[1].x, obb[2].x, obb[3].x];
    let ys = [obb[0].y, obb[1].y, obb[2].y, obb[3].y];
    let min_x = xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_x = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let min_y = ys.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_y = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    BBox {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    }
}

/// Compute alignment target values using oriented bounding box corners.
///
/// For each OBB (4 corner points), computes the relevant edge per axis:
/// - `Left`: minimum X across all corners
/// - `CenterH`: average of all (min_x + max_x) / 2 values
/// - `Right`: maximum X across all corners
/// - `Top`: minimum Y across all corners
/// - `CenterV`: average of all (min_y + max_y) / 2 values
/// - `Bottom`: maximum Y across all corners
///
/// Returns the target position on the relevant axis, or `None` if empty.
pub fn obb_alignment_target(axis: AlignOp, obbs: &[[Point; 4]]) -> Option<f64> {
    if obbs.is_empty() {
        return None;
    }
    match axis {
        AlignOp::Left => obbs
            .iter()
            .flat_map(|obb| obb.iter())
            .map(|p| p.x)
            .fold(f64::INFINITY, f64::min)
            .into(),
        AlignOp::Right => obbs
            .iter()
            .flat_map(|obb| obb.iter())
            .map(|p| p.x)
            .fold(f64::NEG_INFINITY, f64::max)
            .into(),
        AlignOp::CenterH => {
            let count = obbs.len() as f64;
            let sum: f64 = obbs
                .iter()
                .map(|obb| {
                    let min_x = obb.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
                    let max_x = obb.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
                    (min_x + max_x) / 2.0
                })
                .sum();
            Some(sum / count)
        }
        AlignOp::Top => obbs
            .iter()
            .flat_map(|obb| obb.iter())
            .map(|p| p.y)
            .fold(f64::INFINITY, f64::min)
            .into(),
        AlignOp::Bottom => obbs
            .iter()
            .flat_map(|obb| obb.iter())
            .map(|p| p.y)
            .fold(f64::NEG_INFINITY, f64::max)
            .into(),
        AlignOp::CenterV => {
            let count = obbs.len() as f64;
            let sum: f64 = obbs
                .iter()
                .map(|obb| {
                    let min_y = obb.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
                    let max_y = obb.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
                    (min_y + max_y) / 2.0
                })
                .sum();
            Some(sum / count)
        }
    }
}

/// Simple 2D proximity grid sort.
///
/// Groups items into rows where Y difference is less than the average item height,
/// then sorts by X within each row. Returns grid positions `(row, col)` matching
/// input order.
pub fn compute_tidy_layout(items: &[(BBox, f64, f64)], max_cols: usize) -> Vec<(usize, usize)> {
    if items.is_empty() {
        return Vec::new();
    }

    // Build indexed entries with centers
    struct Entry {
        index: usize,
        cx: f64,
        cy: f64,
    }

    let mut entries: Vec<Entry> = items
        .iter()
        .enumerate()
        .map(|(i, (_, cx, cy))| Entry {
            index: i,
            cx: *cx,
            cy: *cy,
        })
        .collect();

    // Compute average height for row detection threshold
    let avg_h: f64 = items.iter().map(|(b, _, _)| b.h).sum::<f64>() / items.len() as f64;
    let row_threshold = avg_h * 0.5;

    // Sort by Y first
    entries.sort_by(|a, b| a.cy.partial_cmp(&b.cy).unwrap());

    // Group into rows
    let mut rows: Vec<Vec<Entry>> = Vec::new();
    for entry in entries {
        let placed = rows.iter_mut().find(|row| {
            let row_cy = row.iter().map(|e| e.cy).sum::<f64>() / row.len() as f64;
            (entry.cy - row_cy).abs() < row_threshold
        });
        if let Some(row) = placed {
            row.push(entry);
        } else {
            rows.push(vec![entry]);
        }
    }

    // Sort each row by X, assign grid positions, limit to max_cols
    let mut result = vec![(0usize, 0usize); items.len()];
    for (row_idx, row) in rows.iter().enumerate() {
        let mut sorted_row: Vec<&Entry> = row.iter().collect();
        sorted_row.sort_by(|a, b| a.cx.partial_cmp(&b.cx).unwrap());
        for (col_idx, entry) in sorted_row.iter().enumerate() {
            let col = col_idx.min(max_cols.saturating_sub(1));
            result[entry.index] = (row_idx, col);
        }
    }

    result
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use kurbo::Affine;
    use std::f64::consts::FRAC_PI_4;

    // ── BBox accessors ──────────────────────────────────────────────────────

    #[test]
    fn bbox_left_right() {
        let b = BBox { x: 10.0, y: 20.0, w: 100.0, h: 50.0 };
        assert_eq!(b.left(), 10.0);
        assert_eq!(b.right(), 110.0);
    }

    #[test]
    fn bbox_center_x() {
        let b = BBox { x: 10.0, y: 20.0, w: 100.0, h: 50.0 };
        assert_eq!(b.center_x(), 60.0);
    }

    #[test]
    fn bbox_top_bottom() {
        let b = BBox { x: 10.0, y: 20.0, w: 100.0, h: 50.0 };
        assert_eq!(b.top(), 20.0);
        assert_eq!(b.bottom(), 70.0);
    }

    #[test]
    fn bbox_center_y() {
        let b = BBox { x: 10.0, y: 20.0, w: 100.0, h: 50.0 };
        assert_eq!(b.center_y(), 45.0);
    }

    // ── compute_alignment_target ────────────────────────────────────────────

    #[test]
    fn alignment_target_two_items() {
        let bounds = vec![
            BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            BBox { x: 20.0, y: 30.0, w: 40.0, h: 20.0 },
        ];
        let target = compute_alignment_target(AlignOp::Left, &bounds).unwrap();
        assert_eq!(target.x, 0.0);
        assert_eq!(target.y, 0.0);
        assert_eq!(target.w, 60.0); // max_x=60 - min_x=0
        assert_eq!(target.h, 50.0); // max_y=50 - min_y=0
    }

    #[test]
    fn alignment_target_three_items() {
        let bounds = vec![
            BBox { x: 5.0, y: 5.0, w: 10.0, h: 10.0 },
            BBox { x: 0.0, y: 0.0, w: 20.0, h: 20.0 },
            BBox { x: 30.0, y: 15.0, w: 5.0, h: 5.0 },
        ];
        let target = compute_alignment_target(AlignOp::Left, &bounds).unwrap();
        assert_eq!(target.x, 0.0); // min X
        assert_eq!(target.y, 0.0); // min Y
        assert_eq!(target.w, 35.0); // max_x=35 - min_x=0
        assert_eq!(target.h, 20.0); // max_y=20 - min_y=0
    }

    #[test]
    fn alignment_target_zero_items() {
        assert!(compute_alignment_target(AlignOp::Left, &[]).is_none());
    }

    #[test]
    fn alignment_target_one_item() {
        let bounds = vec![BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }];
        assert!(compute_alignment_target(AlignOp::Left, &bounds).is_none());
    }

    // ── align_bbox ──────────────────────────────────────────────────────────

    #[test]
    fn align_bbox_left() {
        let bbox = BBox { x: 5.0, y: 5.0, w: 20.0, h: 10.0 };
        let target = BBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let (nx, ny) = align_bbox(&bbox, AlignOp::Left, &target);
        assert_eq!(nx, 0.0);
        assert_eq!(ny, 5.0);
    }

    #[test]
    fn align_bbox_center_h() {
        let bbox = BBox { x: 5.0, y: 5.0, w: 20.0, h: 10.0 };
        let target = BBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let (nx, ny) = align_bbox(&bbox, AlignOp::CenterH, &target);
        assert_eq!(nx, 40.0); // 50 - 10
        assert_eq!(ny, 5.0);
    }

    #[test]
    fn align_bbox_right() {
        let bbox = BBox { x: 5.0, y: 5.0, w: 20.0, h: 10.0 };
        let target = BBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let (nx, ny) = align_bbox(&bbox, AlignOp::Right, &target);
        assert_eq!(nx, 80.0); // 100 - 20
        assert_eq!(ny, 5.0);
    }

    #[test]
    fn align_bbox_top() {
        let bbox = BBox { x: 5.0, y: 5.0, w: 20.0, h: 10.0 };
        let target = BBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let (nx, ny) = align_bbox(&bbox, AlignOp::Top, &target);
        assert_eq!(nx, 5.0);
        assert_eq!(ny, 0.0);
    }

    #[test]
    fn align_bbox_center_v() {
        let bbox = BBox { x: 5.0, y: 5.0, w: 20.0, h: 10.0 };
        let target = BBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let (nx, ny) = align_bbox(&bbox, AlignOp::CenterV, &target);
        assert_eq!(nx, 5.0);
        assert_eq!(ny, 45.0); // 50 - 5
    }

    #[test]
    fn align_bbox_bottom() {
        let bbox = BBox { x: 5.0, y: 5.0, w: 20.0, h: 10.0 };
        let target = BBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let (nx, ny) = align_bbox(&bbox, AlignOp::Bottom, &target);
        assert_eq!(nx, 5.0);
        assert_eq!(ny, 90.0); // 100 - 10
    }

    // ── compute_distribution ────────────────────────────────────────────────

    #[test]
    fn distribute_three_horizontal_even() {
        // Items already evenly-spaced; positions should match their leading edges
        let bounds = vec![
            BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            BBox { x: 30.0, y: 0.0, w: 20.0, h: 10.0 },
            BBox { x: 70.0, y: 0.0, w: 10.0, h: 10.0 },
        ];
        let positions = compute_distribution(DistributeOp::Horizontal, &bounds, None).unwrap();
        assert_eq!(positions.len(), 3);
        // total_span = 80 - 0 = 80, total_size = 10+20+10 = 40, gap = (80-40)/2 = 20
        // sorted by x: [0,w=10], [30,w=20], [70,w=10]
        // positions: 0, 0+10+20=30, 30+20+20=70
        assert_eq!(positions[0], 0.0);
        assert_eq!(positions[1], 30.0);
        assert_eq!(positions[2], 70.0);
    }

    #[test]
    fn distribute_three_vertical_even() {
        let bounds = vec![
            BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            BBox { x: 0.0, y: 30.0, w: 10.0, h: 20.0 },
            BBox { x: 0.0, y: 70.0, w: 10.0, h: 10.0 },
        ];
        let positions = compute_distribution(DistributeOp::Vertical, &bounds, None).unwrap();
        assert_eq!(positions.len(), 3);
        // total_span = 80 - 0 = 80, total_size = 10+20+10 = 40, gap = (80-40)/2 = 20
        // sorted by y: [0,h=10], [30,h=20], [70,h=10]
        // positions: 0, 0+10+20=30, 30+20+20=70
        assert_eq!(positions[0], 0.0);
        assert_eq!(positions[1], 30.0);
        assert_eq!(positions[2], 70.0);
    }

    #[test]
    fn distribute_fixed_gap() {
        let bounds = vec![
            BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            BBox { x: 30.0, y: 0.0, w: 10.0, h: 10.0 },
            BBox { x: 60.0, y: 0.0, w: 10.0, h: 10.0 },
        ];
        let positions = compute_distribution(DistributeOp::Horizontal, &bounds, Some(5.0)).unwrap();
        assert_eq!(positions.len(), 3);
        assert_eq!(positions[0], 0.0);
        assert_eq!(positions[1], 15.0); // 0 + 10 + 5
        assert_eq!(positions[2], 30.0); // 15 + 10 + 5
    }

    #[test]
    fn distribute_less_than_three_items() {
        let two = vec![
            BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            BBox { x: 20.0, y: 0.0, w: 10.0, h: 10.0 },
        ];
        assert!(compute_distribution(DistributeOp::Horizontal, &two, None).is_none());

        let one = vec![BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }];
        assert!(compute_distribution(DistributeOp::Horizontal, &one, None).is_none());

        assert!(compute_distribution(DistributeOp::Horizontal, &[], None).is_none());
    }

    // ── oriented_bbox ───────────────────────────────────────────────────────

    #[test]
    fn oriented_bbox_identity() {
        let affine = Affine::IDENTITY;
        let obb = oriented_bbox(affine, 10.0, 20.0);
        assert_eq!(obb[0], Point::new(0.0, 0.0));
        assert_eq!(obb[1], Point::new(10.0, 0.0));
        assert_eq!(obb[2], Point::new(10.0, 20.0));
        assert_eq!(obb[3], Point::new(0.0, 20.0));
    }

    #[test]
    fn oriented_bbox_rotated() {
        // Rotate a 2x2 square by 45° about the origin
        let affine = Affine::rotate(FRAC_PI_4);
        let obb = oriented_bbox(affine, 2.0, 2.0);
        let sqrt2 = std::f64::consts::SQRT_2;
        // (0,0) stays at origin
        assert!((obb[0].x).abs() < 1e-10);
        assert!((obb[0].y).abs() < 1e-10);
        // (2,0) rotates to (sqrt2, sqrt2)
        assert!((obb[1].x - sqrt2).abs() < 1e-10);
        assert!((obb[1].y - sqrt2).abs() < 1e-10);
    }

    // ── obb_to_aabb ─────────────────────────────────────────────────────────

    #[test]
    fn obb_to_aabb_identity() {
        let obb = [
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 20.0),
            Point::new(0.0, 20.0),
        ];
        let aabb = obb_to_aabb(&obb);
        assert_eq!(aabb.x, 0.0);
        assert_eq!(aabb.y, 0.0);
        assert_eq!(aabb.w, 10.0);
        assert_eq!(aabb.h, 20.0);
    }

    #[test]
    fn obb_to_aabb_rotated() {
        // A 2x2 square rotated 45° → corners at (0,0), (√2,√2), (2√2,0), (√2,-√2)
        // AABB is [-√2/2, ... wait. Let me just compute directly.
        // Rotated 2x2 centered at (1,1) ...
        // Using the oriented_bbox function:
        let affine = Affine::rotate(FRAC_PI_4);
        let obb = oriented_bbox(affine, 2.0, 2.0);
        let aabb = obb_to_aabb(&obb);
        assert!(aabb.w > 0.0);
        assert!(aabb.h > 0.0);
        // For a 2x2 at origin rotated 45°, the AABB should be square with side = 2*sin(45)*2 = ~2.828
        assert!((aabb.w - 2.0_f64.sqrt() * 2.0).abs() < 1e-10);
        assert!((aabb.h - 2.0_f64.sqrt() * 2.0).abs() < 1e-10);
    }

    // ── obb_alignment_target ────────────────────────────────────────────────

    #[test]
    fn obb_align_target_empty() {
        assert!(obb_alignment_target(AlignOp::Left, &[]).is_none());
        assert!(obb_alignment_target(AlignOp::CenterH, &[]).is_none());
        assert!(obb_alignment_target(AlignOp::Right, &[]).is_none());
    }

    #[test]
    fn obb_align_left_right() {
        let obbs = vec![
            [Point::new(5.0, 0.0), Point::new(15.0, 0.0), Point::new(15.0, 10.0), Point::new(5.0, 10.0)],
            [Point::new(20.0, 5.0), Point::new(40.0, 5.0), Point::new(40.0, 25.0), Point::new(20.0, 25.0)],
        ];
        let left = obb_alignment_target(AlignOp::Left, &obbs).unwrap();
        assert_eq!(left, 5.0); // min X across all corners
        let right = obb_alignment_target(AlignOp::Right, &obbs).unwrap();
        assert_eq!(right, 40.0); // max X
    }

    #[test]
    fn obb_align_center_h() {
        let obbs = vec![
            [Point::new(0.0, 0.0), Point::new(20.0, 0.0), Point::new(20.0, 10.0), Point::new(0.0, 10.0)],
            [Point::new(30.0, 0.0), Point::new(50.0, 0.0), Point::new(50.0, 10.0), Point::new(30.0, 10.0)],
        ];
        let ch = obb_alignment_target(AlignOp::CenterH, &obbs).unwrap();
        // obb1 center X = 10, obb2 center X = 40, avg = 25
        assert_eq!(ch, 25.0);
    }

    #[test]
    fn obb_align_top_bottom() {
        let obbs = vec![
            [Point::new(0.0, 5.0), Point::new(10.0, 5.0), Point::new(10.0, 15.0), Point::new(0.0, 15.0)],
            [Point::new(0.0, 20.0), Point::new(10.0, 20.0), Point::new(10.0, 40.0), Point::new(0.0, 40.0)],
        ];
        let top = obb_alignment_target(AlignOp::Top, &obbs).unwrap();
        assert_eq!(top, 5.0); // min Y
        let bottom = obb_alignment_target(AlignOp::Bottom, &obbs).unwrap();
        assert_eq!(bottom, 40.0); // max Y
    }

    #[test]
    fn obb_align_center_v() {
        let obbs = vec![
            [Point::new(0.0, 0.0), Point::new(10.0, 0.0), Point::new(10.0, 20.0), Point::new(0.0, 20.0)],
            [Point::new(0.0, 30.0), Point::new(10.0, 30.0), Point::new(10.0, 50.0), Point::new(0.0, 50.0)],
        ];
        let cv = obb_alignment_target(AlignOp::CenterV, &obbs).unwrap();
        // obb1 center Y = 10, obb2 center Y = 40, avg = 25
        assert_eq!(cv, 25.0);
    }

    // ── compute_tidy_layout ─────────────────────────────────────────────────

    #[test]
    fn tidy_layout_empty() {
        let result = compute_tidy_layout(&[], 4);
        assert!(result.is_empty());
    }

    #[test]
    fn tidy_layout_scattered_points() {
        // Three items in a rough row, one below
        let items: Vec<(BBox, f64, f64)> = vec![
            (BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }, 5.0, 5.0),
            (BBox { x: 15.0, y: 0.0, w: 10.0, h: 10.0 }, 20.0, 5.0),
            (BBox { x: 30.0, y: 0.0, w: 10.0, h: 10.0 }, 35.0, 5.0),
            (BBox { x: 5.0, y: 20.0, w: 10.0, h: 10.0 }, 10.0, 25.0),
            (BBox { x: 20.0, y: 20.0, w: 10.0, h: 10.0 }, 25.0, 25.0),
        ];
        let result = compute_tidy_layout(&items, 4);
        assert_eq!(result.len(), 5);
        // All items in first row should have row=0
        assert_eq!(result[0].0, 0);
        assert_eq!(result[1].0, 0);
        assert_eq!(result[2].0, 0);
        // Items in second row should have row=1
        assert_eq!(result[3].0, 1);
        assert_eq!(result[4].0, 1);
        // Columns should be sorted by X within each row
        assert_eq!(result[0].1, 0); // cx=5
        assert_eq!(result[1].1, 1); // cx=20
        assert_eq!(result[2].1, 2); // cx=35
        assert_eq!(result[3].1, 0); // cx=10
        assert_eq!(result[4].1, 1); // cx=25
    }

    #[test]
    fn tidy_layout_respects_max_cols() {
        let items: Vec<(BBox, f64, f64)> = (0..5)
            .map(|i| {
                let x = i as f64 * 15.0;
                (BBox { x, y: 0.0, w: 10.0, h: 10.0 }, x + 5.0, 5.0)
            })
            .collect();
        let result = compute_tidy_layout(&items, 2);
        assert_eq!(result.len(), 5);
        // All in one row (same Y)
        for (i, r) in result.iter().enumerate() {
            assert_eq!(r.0, 0);
            // Columns should be at most 1 (since max_cols=2, col indices are 0,1)
            assert!(r.1 <= 1, "col {} for item {} exceeds max", r.1, i);
        }
    }
}
