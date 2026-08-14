//! Crop marks, registration marks, and colour bar geometry for print export.
//!
//! Provides `MarksGeometry` with configurable bleed/trim/mark sizes, plus
//! functions to compute corner crop marks, registration crosshair positions,
//! and colour bar swatch rectangles.
//!
//! Research basis: ISO 216 (page sizes), ISO 12647-2 (process control),
//! common prepress mark conventions.

#![forbid(unsafe_code)]

/// Geometry parameters for print marks.
#[derive(Debug, Clone, Copy)]
pub struct MarksGeometry {
    /// Bleed extension beyond the trim box (mm).
    pub bleed_mm: f64,
    /// Whether crop marks should be painted. Bleed geometry can be emitted
    /// without printer marks, so these concerns stay independent.
    pub draw_crop_marks: bool,
    /// Offset of the crop mark from the trim corner (mm).
    pub trim_offset_mm: f64,
    /// Length of each crop mark arm (mm).
    pub mark_length_mm: f64,
    /// Line width for marks in points (1 pt = 1/72 inch).
    pub line_width_pt: f64,
}

impl Default for MarksGeometry {
    fn default() -> Self {
        Self {
            bleed_mm: 3.0,
            draw_crop_marks: true,
            trim_offset_mm: 3.0,
            mark_length_mm: 10.0,
            line_width_pt: 0.25,
        }
    }
}

/// Compute L-shaped crop mark lines around a trim box.
///
/// Returns 8 `(x1, y1, x2, y2)` line segments forming 4 corner marks
/// (top-left, top-right, bottom-right, bottom-left). Each corner is
/// an L: two perpendicular arms extending outward from the trim corner.
pub fn crop_mark_lines(
    trim_x: f64,
    trim_y: f64,
    trim_w: f64,
    trim_h: f64,
    geo: &MarksGeometry,
) -> [(f64, f64, f64, f64); 8] {
    let o = geo.trim_offset_mm;
    let l = geo.mark_length_mm;

    let x1 = trim_x;
    let y1 = trim_y;
    let x2 = trim_x + trim_w;
    let y2 = trim_y + trim_h;

    [
        // Top-left corner: horizontal arm (left → right), vertical arm (top → bottom)
        (x1 - l, y1 - o, x1, y1 - o),
        (x1 - o, y1 - l, x1 - o, y1),
        // Top-right corner
        (x2, y1 - o, x2 + l, y1 - o),
        (x2 + o, y1 - l, x2 + o, y1),
        // Bottom-right corner
        (x2 + l, y2 + o, x2, y2 + o),
        (x2 + o, y2 + l, x2 + o, y2),
        // Bottom-left corner
        (x1 - l, y2 + o, x1, y2 + o),
        (x1 - o, y2 + l, x1 - o, y2),
    ]
}

/// Compute 5 registration mark (crosshair) positions.
///
/// Returns `(x, y)` for: centre, top-left, top-right, bottom-right, bottom-left.
/// Each is centred on the trim area at the given offset from the edge.
pub fn registration_mark_positions(
    trim_x: f64,
    trim_y: f64,
    trim_w: f64,
    trim_h: f64,
) -> [(f64, f64); 5] {
    let cx = trim_x + trim_w / 2.0;
    let cy = trim_y + trim_h / 2.0;
    let margin = 15.0; // mm from edge

    [
        (cx, cy),                                             // centre
        (trim_x + margin, trim_y + margin),                   // top-left
        (trim_x + trim_w - margin, trim_y + margin),          // top-right
        (trim_x + trim_w - margin, trim_y + trim_h - margin), // bottom-right
        (trim_x + margin, trim_y + trim_h - margin),          // bottom-left
    ]
}

/// Compute colour bar swatch positions.
///
/// Returns a list of `(x, y, w, h)` rectangles, one per swatch, arranged
/// horizontally below the trim area. The colour bar includes process
/// colours (CMYK) plus tint steps or spot colours.
pub fn color_bar_positions(
    trim_x: f64,
    trim_y: f64,
    trim_w: f64,
    _trim_h: f64,
    swatch_count: usize,
) -> Vec<(f64, f64, f64, f64)> {
    if swatch_count == 0 {
        return Vec::new();
    }

    let swatch_w = trim_w / swatch_count as f64;
    let swatch_h = 10.0; // 10 mm tall
    let bar_y = trim_y + 15.0; // 15 mm below trim (actually above since PDF coords flip)

    (0..swatch_count)
        .map(|i| {
            let x = trim_x + i as f64 * swatch_w;
            (x, bar_y, swatch_w, swatch_h)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_mark_lines_count() {
        let geo = MarksGeometry::default();
        let lines = crop_mark_lines(0.0, 0.0, 100.0, 100.0, &geo);
        assert_eq!(lines.len(), 8, "should return 8 line segments");
    }

    #[test]
    fn registration_mark_count() {
        let positions = registration_mark_positions(0.0, 0.0, 100.0, 100.0);
        assert_eq!(positions.len(), 5, "should return 5 positions");
    }

    #[test]
    fn marks_geometry_defaults() {
        let geo = MarksGeometry::default();
        assert!((geo.bleed_mm - 3.0).abs() < 1e-6, "bleed should be 3mm");
        assert!(
            (geo.trim_offset_mm - 3.0).abs() < 1e-6,
            "trim_offset should be 3mm"
        );
        assert!(
            (geo.mark_length_mm - 10.0).abs() < 1e-6,
            "mark_length should be 10mm"
        );
        assert!(
            (geo.line_width_pt - 0.25).abs() < 1e-6,
            "line_width should be 0.25pt"
        );
    }

    #[test]
    fn crop_mark_lines_corners() {
        let geo = MarksGeometry {
            trim_offset_mm: 2.0,
            mark_length_mm: 8.0,
            ..Default::default()
        };
        let lines = crop_mark_lines(10.0, 20.0, 200.0, 150.0, &geo);
        // Top-left horizontal: x1=10-8=2, y1=20-2=18, x2=10, y2=18
        assert!((lines[0].0 - 2.0).abs() < 1e-6);
        assert!((lines[0].1 - 18.0).abs() < 1e-6);
        assert!((lines[0].2 - 10.0).abs() < 1e-6);
        // Top-left vertical: x1=10-2=8, y1=20-8=12, x2=8, y2=20
        assert!((lines[1].0 - 8.0).abs() < 1e-6);
        assert!((lines[1].1 - 12.0).abs() < 1e-6);
        assert!((lines[1].2 - 8.0).abs() < 1e-6);
        assert!((lines[1].3 - 20.0).abs() < 1e-6);
    }

    #[test]
    fn registration_mark_positions_center() {
        let positions = registration_mark_positions(0.0, 0.0, 100.0, 100.0);
        assert!((positions[0].0 - 50.0).abs() < 1e-6, "centre x");
        assert!((positions[0].1 - 50.0).abs() < 1e-6, "centre y");
    }

    #[test]
    fn color_bar_positions_count() {
        let rects = color_bar_positions(10.0, 20.0, 200.0, 150.0, 5);
        assert_eq!(rects.len(), 5, "should produce 5 swatches");
        assert!(
            (rects[0].0 - 10.0).abs() < 1e-6,
            "first swatch starts at trim_x"
        );
        assert!(
            (rects[0].2 - 40.0).abs() < 1e-6,
            "each swatch = 200/5 = 40mm wide"
        );
    }

    #[test]
    fn color_bar_positions_empty() {
        let rects = color_bar_positions(0.0, 0.0, 100.0, 100.0, 0);
        assert!(rects.is_empty(), "zero swatches should be empty");
    }
}
