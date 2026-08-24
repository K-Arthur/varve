//! Print pipeline: font outlining, RGB/CMYK PDF export.
//!
//! `export_pdf()` converts a flat scene into PDF bytes using lopdf, emitting
//! path operators for each shape node. CMYK/PDF-X export lives in `cmyk.rs`.
//!
//! Research basis: lopdf for PDF generation. PDF graphics model uses path
//! construction operators (m, l, re, h, f) per the ISO 32000 spec.

#![forbid(unsafe_code)]
// Pre-existing clippy exceptions (low-priority, not introduced by this session).
#![allow(
    clippy::too_many_arguments,
    clippy::option_as_ref_deref,
    clippy::derivable_impls
)]

pub mod cmyk;
pub mod icc;
pub mod marks;
pub mod outline;
pub mod profiles;
pub mod resources;
pub mod shaper;
pub mod subset;

/// Shared cross-platform test-font resolver. Kept non-`cfg(test)` so the
/// desktop crate's test module can reuse the bundled fixture instead of
/// duplicating Linux-only font paths (which broke macOS/Windows CI).
pub mod test_fonts;

use varve_colour::engine_color_rgba;

pub use outline::{
    commands_to_svg_path, outline_text, outline_text_multi, GlyphOutline, PathCommand,
};

use std::collections::HashMap;

use ab_glyph::Font as AbGlyphFont;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use varve_core::{Effect, EngineColor, FillIR, GradientStop, SceneNode, Shape};

use crate::subset::{
    collect_used_chars, get_subset_tag, subset_font, validate_embedding_permission,
    EmbeddingPermission, EmbeddingRestriction,
};

use crate::profiles::PrintProfile;

/// Options for PDF export.
#[derive(Debug, Clone)]
pub struct PdfOptions {
    pub page_width: f64,
    pub page_height: f64,
    pub title: String,
    pub author: String,
    /// When true, text nodes are outlined into vector paths using `font_data`.
    pub outline_text: bool,
    /// Raw TTF/OTF font bytes for text outlining (legacy single-font).
    pub font_data: Option<Vec<u8>>,
    /// Multiple fonts for multi-font outlining: (family_name, raw bytes).
    pub fonts: Vec<(String, Vec<u8>)>,
    /// Whether to draw registration marks.
    pub registration_marks: bool,
    /// Whether to draw a color bar.
    pub color_bar: bool,
    /// Print profile for CMYK conversion (None = RGB).
    pub print_profile: Option<PrintProfile>,
    /// When true, subset each font to only the characters used in the document
    /// and embed the subset font programs in the PDF (searchable text).
    pub subset_fonts: bool,
    /// How to handle fonts whose OS/2 fsType restricts embedding.
    pub embedding_restriction_handling: EmbeddingRestriction,
    /// Optional resource manifest carrying decoded image bytes for pattern fills.
    /// When `None`, pattern fills fall back to a neutral gray fill.
    pub manifest: Option<resources::ExportManifest>,
    /// When true, emit a warning when converting high bit depth colors
    /// (float32/uint16) to 8-bit PDF color values.
    pub lossy: bool,
}

impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Strata Export".into(),
            author: "Strata".into(),
            outline_text: false,
            font_data: None,
            fonts: Vec::new(),
            registration_marks: false,
            color_bar: false,
            print_profile: None,
            subset_fonts: false,
            embedding_restriction_handling: EmbeddingRestriction::Warn,
            manifest: None,
            lossy: false,
        }
    }
}

fn color_to_rgb_string(fill: &EngineColor) -> String {
    if is_spot_color(fill) {
        return spot_color_separation(fill);
    }
    let (r, g, b, _) = engine_color_rgba(fill);
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;
    format!("{rf:.3} {gf:.3} {bf:.3} rg")
}

/// Normalized 0-1 CMYK channels of an authored CMYK color.
///
/// Channel scale follows the color's declared bit depth (uint8 → /255,
/// uint16 → /65535, float depths → as-is). Authored CMYK channels must be
/// emitted directly — never round-tripped through RGB — so pure K stays
/// (0 0 0 1) and profile association is preserved instead of being replaced
/// by a naive `(1-c)(1-k)` build.
fn cmyk_normalized(color: &EngineColor) -> Option<(f32, f32, f32, f32)> {
    let EngineColor::Cmyk {
        c,
        m,
        y,
        k,
        bit_depth,
        ..
    } = color
    else {
        return None;
    };
    let div: f32 = match bit_depth.as_deref().map(str::to_owned) {
        Some(d) if d == "uint16" => 65535.0,
        Some(d) if d == "float16" || d == "float32" => 1.0,
        _ => 255.0,
    };
    Some((
        *c as f32 / div,
        *m as f32 / div,
        *y as f32 / div,
        *k as f32 / div,
    ))
}

fn is_spot_color(color: &EngineColor) -> bool {
    matches!(color, EngineColor::Spot { .. })
}

/// Emit a PDF /Separation color space for a spot color.
/// Returns the PDF commands to set the spot color, using the process fallback
/// for the separation's DeviceCMYK alternate.
fn spot_color_separation(color: &EngineColor) -> String {
    if let EngineColor::Spot { name, tint, a, .. } = color {
        let tint_val = (tint / 100.0).clamp(0.0, 1.0);
        // Set color space to /Separation with the spot color name.
        // The alternate DeviceCMYK uses the process fallback; the tint value
        // (0-1) maps to spot concentration.
        format!(
            "[/Separation {name} /DeviceCMYK {{0 0 0 0}}] cs\n{:.3} sc\n",
            tint_val * (*a / 255.0)
        )
    } else {
        String::new()
    }
}

fn color_to_cmyk_string(fill: &EngineColor, profile: Option<PrintProfile>) -> String {
    if is_spot_color(fill) {
        return spot_color_separation(fill);
    }
    // Native CMYK: emit the authored channels at the color's own bit-depth
    // scale. No CMYK→RGB→CMYK round trip (which would turn pure K into a
    // four-color build and discard the authored profile association).
    if let Some((c, m, y, k)) = cmyk_normalized(fill) {
        return format!("{c:.3} {m:.3} {y:.3} {k:.3} k");
    }
    let (r, g, b, _) = engine_color_rgba(fill);
    let (c, m, y, k) = match profile {
        Some(p) => crate::cmyk::rgb_to_cmyk_icc(
            p,
            r,
            g,
            b,
            crate::profiles::RenderingIntent::Relative,
            true,
        ),
        None => crate::cmyk::rgb_to_cmyk(r, g, b),
    };
    format!(
        "{:.3} {:.3} {:.3} {:.3} k",
        c as f32 / 255.0,
        m as f32 / 255.0,
        y as f32 / 255.0,
        k as f32 / 255.0
    )
}

fn color_to_stroke_rgb_string(fill: &EngineColor) -> String {
    let (r, g, b, _) = engine_color_rgba(fill);
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;
    format!("{rf:.3} {gf:.3} {bf:.3} RG")
}

fn color_to_stroke_cmyk_string(fill: &EngineColor, profile: Option<PrintProfile>) -> String {
    if let Some((c, m, y, k)) = cmyk_normalized(fill) {
        return format!("{c:.3} {m:.3} {y:.3} {k:.3} K");
    }
    let (r, g, b, _) = engine_color_rgba(fill);
    let (c, m, y, k) = match profile {
        Some(p) => crate::cmyk::rgb_to_cmyk_icc(
            p,
            r,
            g,
            b,
            crate::profiles::RenderingIntent::Relative,
            true,
        ),
        None => crate::cmyk::rgb_to_cmyk(r, g, b),
    };
    format!(
        "{:.3} {:.3} {:.3} {:.3} K",
        c as f32 / 255.0,
        m as f32 / 255.0,
        y as f32 / 255.0,
        k as f32 / 255.0
    )
}

/// Extract PDF path operators (m, l, c, re, h) for the given shape node,
/// WITHOUT fill/stroke operators or color. Returns bytes suitable for
/// use by `render_fills`, `render_strokes`, and `render_effects`.
///
/// Coordinates are in PDF space (Y-up) with the affine translation applied.
fn shape_path_operators(node: &SceneNode, page_height: f64) -> Vec<u8> {
    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];

    match &node.shape {
        Shape::Rect(r) => {
            let x = r.min_x() + x_off;
            let y = page_height - r.max_y() - y_off;
            let w = r.width();
            let h = r.height();
            format!("{x:.2} {y:.2} {w:.2} {h:.2} re\n").into_bytes()
        }
        Shape::Circle(c) => {
            let cx = c.center.x + x_off;
            let cy = page_height - c.center.y - y_off;
            let r = c.radius;
            format!("{cx:.2} {cy:.2} {r:.2} 0 360 arc\n").into_bytes()
        }
        Shape::Ellipse { center, rx, ry } => {
            let cx = center.x + x_off;
            let cy = page_height - center.y - y_off;
            format!("{cx:.2} {cy:.2} {rx:.2} {ry:.2} 0 360 arc\n").into_bytes()
        }
        Shape::Line { line, tolerance: _ } => {
            let x1 = line.p0.x + x_off;
            let y1 = page_height - line.p0.y - y_off;
            let x2 = line.p1.x + x_off;
            let y2 = page_height - line.p1.y - y_off;
            format!("{x1:.2} {y1:.2} m\n{x2:.2} {y2:.2} l\n").into_bytes()
        }
        Shape::Polygon {
            cx,
            cy,
            radius,
            sides,
            rotation,
        } => {
            let scx = cx + x_off;
            let scy = page_height - cy - y_off;
            let mut buf = Vec::new();
            for i in 0..*sides {
                let a = 2.0 * std::f64::consts::PI * i as f64 / *sides as f64
                    - std::f64::consts::FRAC_PI_2
                    + rotation;
                let px = scx + radius * a.cos();
                let py = scy + radius * a.sin();
                if i == 0 {
                    buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
                } else {
                    buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
                }
            }
            buf.extend_from_slice(b"h\n");
            buf
        }
        Shape::Star {
            cx,
            cy,
            inner_radius,
            outer_radius,
            points,
            rotation,
        } => {
            let scx = cx + x_off;
            let scy = page_height - cy - y_off;
            let mut buf = Vec::new();
            let total = points * 2;
            for i in 0..total {
                let a = std::f64::consts::PI * i as f64 / *points as f64
                    - std::f64::consts::FRAC_PI_2
                    + rotation;
                let r = if i % 2 == 0 {
                    *outer_radius
                } else {
                    *inner_radius
                };
                let px = scx + r * a.cos();
                let py = scy + r * a.sin();
                if i == 0 {
                    buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
                } else {
                    buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
                }
            }
            buf.extend_from_slice(b"h\n");
            buf
        }
        Shape::Arrow { from, to, .. } => {
            let x0 = from[0] + x_off;
            let y0 = page_height - from[1] - y_off;
            let x1 = to[0] + x_off;
            let y1 = page_height - to[1] - y_off;
            format!("{x0:.2} {y0:.2} m\n{x1:.2} {y1:.2} l\n").into_bytes()
        }
        Shape::Path { points, closed, .. } => {
            if points.is_empty() {
                return Vec::new();
            }
            let mut buf = Vec::new();
            for (i, pt) in points.iter().enumerate() {
                let px = pt.x + x_off;
                let py = page_height - pt.y - y_off;
                if i == 0 {
                    buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
                } else {
                    let prev = &points[i - 1];
                    let prev_px = prev.x + x_off;
                    let prev_py = page_height - prev.y - y_off;
                    if prev.handle_out.is_some() || pt.handle_in.is_some() {
                        let cp1x = if let Some(ho) = prev.handle_out {
                            prev_px + ho[0]
                        } else {
                            prev_px
                        };
                        let cp1y = if let Some(ho) = prev.handle_out {
                            prev_py - ho[1]
                        } else {
                            prev_py
                        };
                        let cp2x = if let Some(hi) = pt.handle_in {
                            px + hi[0]
                        } else {
                            px
                        };
                        let cp2y = if let Some(hi) = pt.handle_in {
                            py - hi[1]
                        } else {
                            py
                        };
                        buf.extend(
                            format!("{cp1x:.2} {cp1y:.2} {cp2x:.2} {cp2y:.2} {px:.2} {py:.2} c\n")
                                .as_bytes(),
                        );
                    } else {
                        buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
                    }
                }
            }
            if *closed {
                buf.extend_from_slice(b"h\n");
            }
            buf
        }
        // Native tables are compiled by the editor render layer before print
        // export; a raw table shape prints as nothing here.
        Shape::Table(_) => Vec::new(),
        Shape::Text { x, y, w, h, .. } => {
            let px = x + x_off;
            let py = page_height - y - h - y_off;
            format!("{px:.2} {py:.2} {w:.2} {h:.2} re\n").into_bytes()
        }
    }
}

/// State for rendering image fills in PDF output.
///
/// Carries the `Document` + a counter for naming image XObjects (`/Im0`, `/Im1`, ...)
/// and collects the references so the caller can add an `XObject` resource dict
/// to the page.
pub(crate) struct ImageRenderState<'a> {
    pub doc: &'a mut Document,
    pub counter: u32,
    pub refs: Vec<(String, Object)>,
    /// Graphics state dictionaries for fill opacity (opacity -> GS name).
    gs_cache: HashMap<u32, String>,
}

impl<'a> ImageRenderState<'a> {
    pub fn new(doc: &'a mut Document) -> Self {
        Self {
            doc,
            counter: 0,
            refs: Vec::new(),
            gs_cache: HashMap::new(),
        }
    }

    /// Get-or-create an ExtGState dictionary for a given fill opacity.
    /// Returns the GS name (e.g. "GS075") to use with `gs` in the content stream.
    pub fn get_or_create_opacity_gs(&mut self, opacity: f64) -> String {
        let key = (opacity.clamp(0.0, 1.0) * 1000.0) as u32;
        if let Some(name) = self.gs_cache.get(&key) {
            return name.clone();
        }
        let name = format!("GS{key:03}");
        let gs = dictionary! {
            "Type" => "ExtGState",
            "ca" => opacity.clamp(0.0, 1.0),
        };
        self.refs.push((name.clone(), Object::Dictionary(gs)));
        self.gs_cache.insert(key, name.clone());
        name
    }
}

/// Generate a small checkerboard placeholder image (16×16 RGB pixels).
/// Used as a stand-in for image fills when the real pixel data is unavailable
/// (the live renderer owns the actual decoded bitmap).
fn generate_checkerboard() -> Vec<u8> {
    const SIZE: u32 = 16;
    let mut data = Vec::with_capacity((SIZE * SIZE * 3) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            if (x / 4 + y / 4) % 2 == 0 {
                data.extend_from_slice(&[57, 208, 198]); // teal
            } else {
                data.extend_from_slice(&[255, 240, 245]); // light pink
            }
        }
    }
    data
}

/// Compute the axis-aligned bounding box of a shape node in PDF space (Y-up).
/// Returns `(x, y, w, h)` where `(x, y)` is the bottom-left corner.
/// Compute PDF image placement (draw rect + offset) for the given fit mode,
/// source dimensions, destination bounds, and scale override.
///
/// Returns (draw_w, draw_h, draw_offset_x, draw_offset_y) where the draw rect
/// is positioned at shape_bounds + draw_offset in PDF coordinate space.
#[allow(clippy::too_many_arguments)]
fn compute_pdf_image_placement(
    fit: &str,
    src_w: f64,
    src_h: f64,
    dst_w: f64,
    dst_h: f64,
    user_scale: f64,
) -> (f64, f64, f64, f64) {
    if !src_w.is_finite()
        || !src_h.is_finite()
        || !dst_w.is_finite()
        || !dst_h.is_finite()
        || !user_scale.is_finite()
        || src_w <= 0.0
        || src_h <= 0.0
        || dst_w <= 0.0
        || dst_h <= 0.0
        || user_scale <= 0.0
    {
        return (dst_w, dst_h, 0.0, 0.0);
    }
    match fit {
        "stretch" => (dst_w, dst_h, 0.0, 0.0),
        "fit" => {
            // CSS contain: fit within bounds while maintaining aspect ratio
            let aspect = src_w / src_h;
            let dst_aspect = dst_w / dst_h;
            if aspect > dst_aspect {
                // Source is wider: width matches bounds
                let h = dst_w / aspect;
                let w = dst_w * user_scale;
                let h = h * user_scale;
                (w, h, (dst_w - w) / 2.0, (dst_h - h) / 2.0)
            } else {
                let w = dst_h * aspect;
                let w = w * user_scale;
                let h = dst_h * user_scale;
                (w, h, (dst_w - w) / 2.0, (dst_h - h) / 2.0)
            }
        }
        "tile" => {
            // Tile mode: use source size × user scale as tile size
            (src_w * user_scale, src_h * user_scale, 0.0, 0.0)
        }
        "crop" => {
            // Manual crop mode: natural source size × user scale, anchored at
            // the node bounds origin. Fill x/y supplies the user pan.
            (src_w * user_scale, src_h * user_scale, 0.0, 0.0)
        }
        _ => {
            // Default "fill": CSS cover, then multiply the policy result by
            // user scale around the destination centre.
            let aspect = src_w / src_h;
            let dst_aspect = dst_w / dst_h;
            let (base_w, base_h) = if aspect > dst_aspect {
                (dst_h * aspect, dst_h)
            } else {
                (dst_w, dst_w / aspect)
            };
            let w = base_w * user_scale;
            let h = base_h * user_scale;
            (w, h, (dst_w - w) / 2.0, (dst_h - h) / 2.0)
        }
    }
}

fn shape_local_bounds(node: &SceneNode) -> (f64, f64, f64, f64) {
    match &node.shape {
        Shape::Rect(r) => (r.min_x(), r.min_y(), r.width(), r.height()),
        Shape::Circle(c) => (
            c.center.x - c.radius,
            c.center.y - c.radius,
            2.0 * c.radius,
            2.0 * c.radius,
        ),
        Shape::Ellipse { center, rx, ry } => (center.x - rx, center.y - ry, 2.0 * rx, 2.0 * ry),
        Shape::Line { line, .. } => (
            line.p0.x.min(line.p1.x),
            line.p0.y.min(line.p1.y),
            (line.p0.x - line.p1.x).abs(),
            (line.p0.y - line.p1.y).abs(),
        ),
        Shape::Polygon { cx, cy, radius, .. } => {
            (cx - radius, cy - radius, 2.0 * radius, 2.0 * radius)
        }
        Shape::Star {
            cx,
            cy,
            outer_radius,
            ..
        } => (
            cx - outer_radius,
            cy - outer_radius,
            2.0 * outer_radius,
            2.0 * outer_radius,
        ),
        Shape::Arrow { from, to, .. } => (
            from[0].min(to[0]),
            from[1].min(to[1]),
            (from[0] - to[0]).abs(),
            (from[1] - to[1]).abs(),
        ),
        Shape::Path { points, .. } => {
            if points.is_empty() {
                return (0.0, 0.0, 0.0, 0.0);
            }
            let min_x = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
            let max_x = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
            let min_y = points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
            let max_y = points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
            (min_x, min_y, max_x - min_x, max_y - min_y)
        }
        Shape::Text { x, y, w, h, .. } => (*x, *y, *w, *h),
        Shape::Table(_) => (0.0, 0.0, 0.0, 0.0),
    }
}

fn multiply_pdf_affine(lhs: [f64; 6], rhs: [f64; 6]) -> [f64; 6] {
    [
        lhs[0] * rhs[0] + lhs[2] * rhs[1],
        lhs[1] * rhs[0] + lhs[3] * rhs[1],
        lhs[0] * rhs[2] + lhs[2] * rhs[3],
        lhs[1] * rhs[2] + lhs[3] * rhs[3],
        lhs[0] * rhs[4] + lhs[2] * rhs[5] + lhs[4],
        lhs[1] * rhs[4] + lhs[3] * rhs[5] + lhs[5],
    ]
}

fn apply_pdf_affine(matrix: [f64; 6], x: f64, y: f64) -> (f64, f64) {
    (
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
    )
}

fn node_affine(node: &SceneNode) -> [f64; 6] {
    node.transform.as_coeffs()
}

fn image_content_affine(
    node: &SceneNode,
    draw_x: f64,
    draw_y: f64,
    draw_w: f64,
    draw_h: f64,
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
) -> [f64; 6] {
    let radians = rotation.to_radians();
    let (sin, cos) = radians.sin_cos();
    let sx = if flip_h { -1.0 } else { 1.0 };
    let sy = if flip_v { -1.0 } else { 1.0 };
    let linear = [cos * sx, sin * sx, -sin * sy, cos * sy, 0.0, 0.0];
    let cx = draw_x + draw_w / 2.0;
    let cy = draw_y + draw_h / 2.0;
    let around_center = [
        linear[0],
        linear[1],
        linear[2],
        linear[3],
        cx - linear[0] * cx - linear[2] * cy,
        cy - linear[1] * cx - linear[3] * cy,
    ];
    multiply_pdf_affine(node_affine(node), around_center)
}

fn transformed_rect_clip(
    matrix: [f64; 6],
    page_height: f64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> String {
    let corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
    let points = corners.map(|(px, py)| {
        let (world_x, world_y) = apply_pdf_affine(matrix, px, py);
        (world_x, page_height - world_y)
    });
    let first = points[0];
    let mut result = format!("{:.4} {:.4} m\n", first.0, first.1);
    for point in &points[1..] {
        result.push_str(&format!("{:.4} {:.4} l\n", point.0, point.1));
    }
    result.push_str("h W n\n");
    result
}

fn pdf_image_matrix(
    matrix: [f64; 6],
    page_height: f64,
    draw_x: f64,
    draw_y: f64,
    draw_w: f64,
    draw_h: f64,
) -> [f64; 6] {
    // Image XObjects occupy a unit square whose sample rows run top-to-bottom.
    // Map that square into y-down node-local coordinates, then through the
    // complete local→world affine and finally into PDF's y-up page space.
    let (origin_x, origin_y) = apply_pdf_affine(matrix, draw_x, draw_y + draw_h);
    [
        matrix[0] * draw_w,
        -matrix[1] * draw_w,
        -matrix[2] * draw_h,
        matrix[3] * draw_h,
        origin_x,
        page_height - origin_y,
    ]
}

const PERSPECTIVE_GRID: usize = 8;

fn perspective_quad_valid(quad: &[[f64; 2]; 4]) -> bool {
    if quad.iter().flatten().any(|v| !v.is_finite()) {
        return false;
    }
    let mut sign = 0.0;
    for i in 0..4 {
        let a = quad[i];
        let b = quad[(i + 1) % 4];
        let c = quad[(i + 2) % 4];
        let cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if cross.abs() < 1e-9 {
            return false;
        }
        if sign == 0.0 {
            sign = cross.signum();
        } else if cross.signum() != sign {
            return false;
        }
    }
    sign != 0.0
}

fn bilinear_quad_point(quad: &[[f64; 2]; 4], u: f64, v: f64) -> [f64; 2] {
    let top = [
        quad[0][0] + (quad[1][0] - quad[0][0]) * u,
        quad[0][1] + (quad[1][1] - quad[0][1]) * u,
    ];
    let bottom = [
        quad[3][0] + (quad[2][0] - quad[3][0]) * u,
        quad[3][1] + (quad[2][1] - quad[3][1]) * u,
    ];
    [
        top[0] + (bottom[0] - top[0]) * v,
        top[1] + (bottom[1] - top[1]) * v,
    ]
}

fn solve_linear3(mut matrix: [[f64; 4]; 3]) -> Option<[f64; 3]> {
    for column in 0..3 {
        let mut pivot = column;
        for row in (column + 1)..3 {
            if matrix[row][column].abs() > matrix[pivot][column].abs() {
                pivot = row;
            }
        }
        if matrix[pivot][column].abs() < 1e-12 {
            return None;
        }
        matrix.swap(column, pivot);
        let divisor = matrix[column][column];
        for value in &mut matrix[column][column..4] {
            *value /= divisor;
        }
        for row in 0..3 {
            if row == column {
                continue;
            }
            let factor = matrix[row][column];
            let pivot_row = matrix[column];
            for (offset, value) in matrix[row][column..4].iter_mut().enumerate() {
                let index = column + offset;
                *value -= factor * pivot_row[index];
            }
        }
    }
    Some([matrix[0][3], matrix[1][3], matrix[2][3]])
}

/// Affine map from three source points to three PDF destination points.
/// PDF's `cm` is affine-only, so the projective quad is subdivided into small
/// source/destination triangles and each triangle clips the shared image XObject.
fn triangle_affine(src: [[f64; 2]; 3], dst: [[f64; 2]; 3]) -> Option<[f64; 6]> {
    let x = [
        [src[0][0], src[0][1], 1.0, dst[0][0]],
        [src[1][0], src[1][1], 1.0, dst[1][0]],
        [src[2][0], src[2][1], 1.0, dst[2][0]],
    ];
    let y = [
        [src[0][0], src[0][1], 1.0, dst[0][1]],
        [src[1][0], src[1][1], 1.0, dst[1][1]],
        [src[2][0], src[2][1], 1.0, dst[2][1]],
    ];
    let [a, c, e] = solve_linear3(x)?;
    let [b, d, f] = solve_linear3(y)?;
    Some([a, b, c, d, e, f])
}

fn inverse_affine(matrix: [f64; 6]) -> Option<[f64; 6]> {
    let det = matrix[0] * matrix[3] - matrix[2] * matrix[1];
    if !det.is_finite() || det.abs() < 1e-12 {
        return None;
    }
    let a = matrix[3] / det;
    let b = -matrix[1] / det;
    let c = -matrix[2] / det;
    let d = matrix[0] / det;
    Some([
        a,
        b,
        c,
        d,
        -(a * matrix[4] + c * matrix[5]),
        -(b * matrix[4] + d * matrix[5]),
    ])
}

fn render_perspective_triangles(
    node: &SceneNode,
    page_height: f64,
    image_name: &str,
    image_width: f64,
    image_height: f64,
    fit: &str,
    fill_x: f64,
    fill_y: f64,
    fill_scale: f64,
    crop: Option<(f64, f64, f64, f64)>,
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
    opacity: f64,
    quad: &[[f64; 2]; 4],
    state: &mut ImageRenderState<'_>,
) -> String {
    if !perspective_quad_valid(quad)
        || image_width <= 0.0
        || image_height <= 0.0
        || !image_width.is_finite()
        || !image_height.is_finite()
    {
        return String::new();
    }
    let (bounds_x, bounds_y, bounds_w, bounds_h) = shape_local_bounds(node);
    if bounds_w <= 0.0 || bounds_h <= 0.0 {
        return String::new();
    }
    let (draw_w, draw_h, draw_ox, draw_oy) = compute_pdf_image_placement(
        fit,
        image_width,
        image_height,
        bounds_w,
        bounds_h,
        fill_scale,
    );
    if draw_w <= 0.0 || draw_h <= 0.0 {
        return String::new();
    }
    let draw_x = bounds_x + fill_x + draw_ox;
    let draw_y = bounds_y + fill_y + draw_oy;
    let sample = crop.unwrap_or((0.0, 0.0, image_width, image_height));
    let sample_draw = (
        draw_x + sample.0 / image_width * draw_w,
        draw_y + sample.1 / image_height * draw_h,
        sample.2 / image_width * draw_w,
        sample.3 / image_height * draw_h,
    );
    if sample_draw.2 <= 0.0 || sample_draw.3 <= 0.0 {
        return String::new();
    }

    let radians = rotation.to_radians();
    let (sin, cos) = radians.sin_cos();
    let sx = if flip_h { -1.0 } else { 1.0 };
    let sy = if flip_v { -1.0 } else { 1.0 };
    let linear = [cos * sx, sin * sx, -sin * sy, cos * sy, 0.0, 0.0];
    let cx = draw_x + draw_w / 2.0;
    let cy = draw_y + draw_h / 2.0;
    let content = [
        linear[0],
        linear[1],
        linear[2],
        linear[3],
        cx - linear[0] * cx - linear[2] * cy,
        cy - linear[1] * cx - linear[3] * cy,
    ];
    let inverse = match inverse_affine(content) {
        Some(value) => value,
        None => return String::new(),
    };

    let mut grid = vec![vec![[0.0; 2]; PERSPECTIVE_GRID + 1]; PERSPECTIVE_GRID + 1];
    for (row, grid_row) in grid.iter_mut().enumerate() {
        for (col, cell) in grid_row.iter_mut().enumerate() {
            let u = col as f64 / PERSPECTIVE_GRID as f64;
            let v = row as f64 / PERSPECTIVE_GRID as f64;
            let local = [bounds_x + bounds_w * u, bounds_y + bounds_h * v];
            let untransformed = apply_pdf_affine(inverse, local[0], local[1]);
            let source_x =
                sample.0 + ((untransformed.0 - sample_draw.0) / sample_draw.2) * sample.2;
            let source_y =
                sample.1 + ((untransformed.1 - sample_draw.1) / sample_draw.3) * sample.3;
            *cell = [source_x, source_y];
        }
    }

    let mut result = String::new();
    if opacity < 1.0 {
        let gs_name = state.get_or_create_opacity_gs(opacity);
        result.push_str(&format!("/{gs_name} gs\n"));
    }
    let world_matrix = node_affine(node);
    for (row, rows) in grid.windows(2).enumerate() {
        let top = &rows[0];
        let bottom = &rows[1];
        for (col, _) in top.iter().enumerate().take(PERSPECTIVE_GRID) {
            let u0 = col as f64 / PERSPECTIVE_GRID as f64;
            let u1 = (col + 1) as f64 / PERSPECTIVE_GRID as f64;
            let v0 = row as f64 / PERSPECTIVE_GRID as f64;
            let v1 = (row + 1) as f64 / PERSPECTIVE_GRID as f64;
            let destinations = [
                bilinear_quad_point(quad, u0, v0),
                bilinear_quad_point(quad, u1, v0),
                bilinear_quad_point(quad, u1, v1),
                bilinear_quad_point(quad, u0, v1),
            ];
            let sources = [top[col], top[col + 1], bottom[col + 1], bottom[col]];
            let triangles = [(0, 1, 3), (1, 2, 3)];
            for (a, b, c) in triangles {
                let source_triangle = [sources[a], sources[b], sources[c]];
                let destination_triangle = [destinations[a], destinations[b], destinations[c]];
                let destination_page = destination_triangle.map(|point| {
                    let (world_x, world_y) = apply_pdf_affine(world_matrix, point[0], point[1]);
                    [world_x, page_height - world_y]
                });
                let source_triangle_normalized = source_triangle.map(|point| {
                    [
                        (point[0] / image_width).clamp(0.0, 1.0),
                        1.0 - (point[1] / image_height).clamp(0.0, 1.0),
                    ]
                });
                let Some(matrix) = triangle_affine(source_triangle_normalized, destination_page)
                else {
                    continue;
                };
                let clip = source_triangle_normalized;
                result.push_str("q\n");
                result.push_str(&format!(
                    "{:.6} {:.6} {:.6} {:.6} {:.6} {:.6} cm\n",
                    matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]
                ));
                result.push_str(&format!(
                    "{:.6} {:.6} m\n{:.6} {:.6} l\n{:.6} {:.6} l\nh W n\n/{image_name} Do\nQ\n",
                    clip[0][0], clip[0][1], clip[1][0], clip[1][1], clip[2][0], clip[2][1]
                ));
            }
        }
    }
    result
}

fn shape_pdf_bounds(node: &SceneNode, page_height: f64) -> (f64, f64, f64, f64) {
    let (x, y, w, h) = shape_local_bounds(node);
    let matrix = node_affine(node);
    let corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
    let points = corners.map(|(px, py)| {
        let (world_x, world_y) = apply_pdf_affine(matrix, px, py);
        (world_x, page_height - world_y)
    });
    let min_x = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let max_y = points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    (min_x, min_y, max_x - min_x, max_y - min_y)
}

/// Render stacked fills from `node.fills` (bottom-to-top, last = topmost).
/// Falls back to `node.fill` when `fills` is None or empty.
///
/// A gradient shading definition collected during render.
/// The actual PDF objects are created later (after the render borrow ends).
#[derive(Clone)]
enum ShadingKind {
    Linear,
    Radial,
}

struct GradientShadingDef {
    kind: ShadingKind,
    stops: Vec<GradientStop>,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
    rotation: f64,
}

/// Tracks gradient shading definitions during render. Collects gradient
/// data without borrowing the document, then creates PDF objects in a
/// deferred pass.
struct ShadingRegistry {
    definitions: Vec<(String, GradientShadingDef)>,
    next_id: u64,
}

impl ShadingRegistry {
    fn new() -> Self {
        Self {
            definitions: Vec::new(),
            next_id: 1,
        }
    }

    /// Register a linear gradient. Returns the resource name (e.g., "Sh1").
    fn add_linear_gradient(
        &mut self,
        stops: &[GradientStop],
        use_cmyk: bool,
        profile: Option<PrintProfile>,
        rotation: f64,
    ) -> String {
        let name = format!("Sh{}", self.next_id);
        self.next_id += 1;
        self.definitions.push((
            name.clone(),
            GradientShadingDef {
                kind: ShadingKind::Linear,
                stops: stops.to_vec(),
                use_cmyk,
                profile,
                rotation,
            },
        ));
        name
    }

    /// Register a radial gradient. Returns the resource name (e.g., "Sh1").
    fn add_radial_gradient(
        &mut self,
        stops: &[GradientStop],
        use_cmyk: bool,
        profile: Option<PrintProfile>,
        rotation: f64,
    ) -> String {
        let name = format!("Sh{}", self.next_id);
        self.next_id += 1;
        self.definitions.push((
            name.clone(),
            GradientShadingDef {
                kind: ShadingKind::Radial,
                stops: stops.to_vec(),
                use_cmyk,
                profile,
                rotation,
            },
        ));
        name
    }

    /// Create all PDF shading objects in the document and return resource refs.
    fn create_pdf_objects(&self, doc: &mut Document) -> Vec<(String, ObjectId)> {
        let mut resources = Vec::new();
        for (name, def) in &self.definitions {
            let func_id = create_sampled_function(doc, &def.stops, def.use_cmyk, def.profile);
            let color_space = if def.use_cmyk {
                "DeviceCMYK"
            } else {
                "DeviceRGB"
            };
            match def.kind {
                ShadingKind::Linear => {
                    // Apply rotation around center (0.5, 0.5) to the Coords.
                    // Default unrotated: [0, 0, 1, 0] (horizontal).
                    let rot_rad = def.rotation * (std::f64::consts::PI / 180.0);
                    let (cos, sin) = (rot_rad.cos() as f32, rot_rad.sin() as f32);
                    let x1 = 0.5 - cos * 0.5;
                    let y1 = 0.5 - sin * 0.5;
                    let x2 = 0.5 + cos * 0.5;
                    let y2 = 0.5 + sin * 0.5;
                    let shading_dict = dictionary! {
                        "ShadingType" => 2i64,
                        "ColorSpace" => color_space,
                        "Domain" => vec![Object::Real(0.0), Object::Real(1.0)],
                        "Coords" => vec![
                            Object::Real(x1), Object::Real(y1),
                            Object::Real(x2), Object::Real(y2),
                        ],
                        "Function" => Object::Reference(func_id),
                        "Extend" => vec![Object::Boolean(true), Object::Boolean(true)],
                    };
                    let shading_id = doc.new_object_id();
                    doc.objects
                        .insert(shading_id, Object::Dictionary(shading_dict));
                    resources.push((name.clone(), shading_id));
                }
                ShadingKind::Radial => {
                    // Type 3 (Radial) shading: start circle at center with r=0,
                    // end circle at center with r=0.707 (half the diagonal of
                    // the unit square used by the clipping path).
                    let shading_dict = dictionary! {
                        "ShadingType" => 3i64,
                        "ColorSpace" => color_space,
                        "Domain" => vec![Object::Real(0.0), Object::Real(1.0)],
                        "Coords" => vec![
                            Object::Real(0.5), Object::Real(0.5), Object::Real(0.0),
                            Object::Real(0.5), Object::Real(0.5), Object::Real(std::f64::consts::FRAC_1_SQRT_2 as f32),
                        ],
                        "Function" => Object::Reference(func_id),
                        "Extend" => vec![Object::Boolean(true), Object::Boolean(true)],
                    };
                    let shading_id = doc.new_object_id();
                    doc.objects
                        .insert(shading_id, Object::Dictionary(shading_dict));
                    resources.push((name.clone(), shading_id));
                }
            }
        }
        resources
    }
}

/// Create a Type 0 sampled function for gradient color interpolation.
fn create_sampled_function(
    doc: &mut Document,
    stops: &[GradientStop],
    use_cmyk: bool,
    profile: Option<PrintProfile>,
) -> ObjectId {
    const SAMPLES: usize = 256;
    let mut samples: Vec<u8> = Vec::with_capacity(SAMPLES * if use_cmyk { 4 } else { 3 });

    for i in 0..SAMPLES {
        let t = i as f64 / (SAMPLES - 1) as f64;
        let color = sample_gradient(stops, t);
        if use_cmyk {
            // Native CMYK samples (from CMYK-space interpolation) emit
            // directly; RGB samples convert via the profile/naive path.
            let (cc, cm, cy, ck) = match cmyk_normalized(&color) {
                Some((c, m, y, k)) => (
                    (c * 255.0) as u8,
                    (m * 255.0) as u8,
                    (y * 255.0) as u8,
                    (k * 255.0) as u8,
                ),
                None => {
                    let (r, g, b, _) = engine_color_rgba(&color);
                    match profile {
                        Some(p) => crate::cmyk::rgb_to_cmyk_icc(
                            p,
                            r,
                            g,
                            b,
                            crate::profiles::RenderingIntent::Relative,
                            true,
                        ),
                        None => crate::cmyk::rgb_to_cmyk(r, g, b),
                    }
                }
            };
            samples.push(cc);
            samples.push(cm);
            samples.push(cy);
            samples.push(ck);
        } else {
            let (r, g, b, _) = engine_color_rgba(&color);
            samples.push(r);
            samples.push(g);
            samples.push(b);
        }
    }

    let func_dict = dictionary! {
        "FunctionType" => 0i64,
        "Domain" => vec![Object::Real(0.0), Object::Real(1.0)],
        "Range" => vec![
            Object::Real(0.0), Object::Real(255.0),
            Object::Real(0.0), Object::Real(255.0),
            Object::Real(0.0), Object::Real(255.0),
            Object::Real(0.0), Object::Real(255.0),
        ],
        "Size" => vec![Object::Integer(SAMPLES as i64)],
        "BitsPerSample" => 8i64,
        "Order" => 1i64,
    };

    let func_stream = Stream::new(func_dict, samples);
    let func_id = doc.new_object_id();
    doc.objects.insert(func_id, Object::Stream(func_stream));
    func_id
}

/// Sample a gradient at position t (0.0-1.0) by interpolating between stops.
fn sample_gradient(stops: &[GradientStop], t: f64) -> EngineColor {
    if stops.is_empty() {
        return EngineColor::Rgb {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
    }
    if stops.len() == 1 {
        return stops[0].color.clone();
    }
    // Find the two stops surrounding t
    let mut lower = &stops[0];
    let mut upper = &stops[stops.len() - 1];
    for window in stops.windows(2) {
        if t >= window[0].position && t <= window[1].position {
            lower = &window[0];
            upper = &window[1];
            break;
        }
    }
    let range = upper.position - lower.position;
    let local_t = if range > 0.0 {
        (t - lower.position) / range
    } else {
        0.0
    };
    // Native CMYK stops interpolate in CMYK space (channel lerp on the
    // normalized values) so authored print values — including pure K — are
    // never round-tripped through a naive RGB build.
    if let (Some((c1, m1, y1, k1)), Some((c2, m2, y2, k2))) =
        (cmyk_normalized(&lower.color), cmyk_normalized(&upper.color))
    {
        let lerp = |a: f32, b: f32| -> f64 { a as f64 + (b as f64 - a as f64) * local_t };
        return EngineColor::Cmyk {
            c: lerp(c1, c2),
            m: lerp(m1, m2),
            y: lerp(y1, y2),
            k: lerp(k1, k2),
            a: 255.0,
            bit_depth: Some("float32".to_string()),
            profile: None,
        };
    }
    // Linear interpolation in RGB space (mixed-space gradients)
    let (r1, g1, b1, a1) = engine_color_rgba(&lower.color);
    let (r2, g2, b2, a2) = engine_color_rgba(&upper.color);
    let lerp = |a: u8, b: u8| -> f64 { a as f64 + (b as f64 - a as f64) * local_t };
    EngineColor::Rgb {
        r: lerp(r1, r2),
        g: lerp(g1, g2),
        b: lerp(b1, b2),
        a: lerp(a1, a2),
        bit_depth: None,
        profile: None,
    }
}
/// `use_cmyk` controls whether RGB or CMYK color operators are emitted.
///
/// When `image_state` is `Some`, image fills are rendered as checkerboard
/// placeholders via XObject `Do` operators (clipped to the shape path for
/// non-rectangular geometry). When `None`, image/pattern fills emit an
/// explicit "not rendered" comment (backward-compatible).
fn render_fills(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    mut image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
    profile: Option<PrintProfile>,
    mut shading_registry: Option<&mut ShadingRegistry>,
    lossy: bool,
) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    if path_ops.is_empty() {
        return Vec::new();
    }

    let mut buf = Vec::new();

    if let Some(fills) = &node.fills {
        if !fills.is_empty() {
            // Iterate bottom-to-top (Vec order is paint order)
            for fill in fills.iter() {
                if !fill_visible(fill) {
                    continue;
                }
                match fill {
                    FillIR::Image {
                        src,
                        x: fill_x,
                        y: fill_y,
                        scale: fill_scale,
                        fit: fill_fit,
                        opacity,
                        alpha_mask,
                        crop,
                        rotation: fill_rotation,
                        flip_h,
                        flip_v,
                        perspective,
                        ..
                    } => {
                        match &mut image_state {
                            Some(state) => {
                                buf.extend_from_slice(b"q\n");

                                // Every image fill is clipped to its object.
                                // Rectangles use the complete object affine;
                                // complex shapes retain their existing path
                                // representation until the shared path writer
                                // is migrated to local-space geometry.
                                if matches!(node.shape, Shape::Rect(_)) {
                                    let (x, y, w, h) = shape_local_bounds(node);
                                    buf.extend_from_slice(
                                        transformed_rect_clip(
                                            node_affine(node),
                                            page_height,
                                            x,
                                            y,
                                            w,
                                            h,
                                        )
                                        .as_bytes(),
                                    );
                                } else {
                                    buf.extend(&path_ops);
                                    buf.extend_from_slice(b"W n\n");
                                }

                                // Try to resolve image from manifest by source URL
                                let manifest_image = manifest
                                    .as_ref()
                                    .and_then(|m| m.resolve_image_by_src(src).ok());

                                match manifest_image {
                                    Some(img) if img.is_valid() => {
                                        // Detect if source data is RGBA (width * height * 4 == data.len())
                                        let is_rgba =
                                            img.data.len() >= (img.width * img.height * 4) as usize;
                                        let alpha_data = if is_rgba {
                                            Some(rgba_extract_alpha(&img.data))
                                        } else {
                                            None
                                        };

                                        // Real pixel data from the TS-side ICC pipeline
                                        let (data, cs, bpc) = match img.color_space {
                                            resources::ColorSpace::Cmyk => {
                                                // CMYK data: embed directly as DeviceCMYK
                                                (img.data.clone(), "DeviceCMYK", 4u32)
                                            }
                                            _ => {
                                                // RGBA data: strip alpha to RGB for PDF
                                                let rgb = if is_rgba {
                                                    rgba_to_rgb(&img.data)
                                                } else {
                                                    img.data.clone()
                                                };
                                                (rgb, "DeviceRGB", 3u32)
                                            }
                                        };

                                        let img_w = img.width as f64;
                                        let img_h = img.height as f64;
                                        let normalized_crop = crop.as_ref().and_then(|c| {
                                            if !c.x.is_finite()
                                                || !c.y.is_finite()
                                                || !c.w.is_finite()
                                                || !c.h.is_finite()
                                                || c.w <= 0.0
                                                || c.h <= 0.0
                                            {
                                                return None;
                                            }
                                            let x = c.x.clamp(0.0, img_w);
                                            let y = c.y.clamp(0.0, img_h);
                                            let right = (c.x + c.w).clamp(x, img_w);
                                            let bottom = (c.y + c.h).clamp(y, img_h);
                                            (right > x && bottom > y).then_some((
                                                x,
                                                y,
                                                right - x,
                                                bottom - y,
                                            ))
                                        });

                                        match embed_image_with_colorspace(
                                            state.doc,
                                            &data,
                                            img.width,
                                            img.height,
                                            bpc,
                                            cs,
                                            alpha_data.as_deref(),
                                        ) {
                                            Ok(obj_ref) => {
                                                let name = format!("Im{}", state.counter);
                                                state.counter += 1;
                                                state.refs.push((name.clone(), obj_ref));

                                                if let Some(perspective) = perspective.as_ref() {
                                                    let normalized_crop =
                                                        crop.as_ref().and_then(|c| {
                                                            if !c.x.is_finite()
                                                                || !c.y.is_finite()
                                                                || !c.w.is_finite()
                                                                || !c.h.is_finite()
                                                                || c.w <= 0.0
                                                                || c.h <= 0.0
                                                            {
                                                                return None;
                                                            }
                                                            let x = c.x.clamp(0.0, img_w);
                                                            let y = c.y.clamp(0.0, img_h);
                                                            let right = (c.x + c.w).clamp(x, img_w);
                                                            let bottom =
                                                                (c.y + c.h).clamp(y, img_h);
                                                            (right > x && bottom > y).then_some((
                                                                x,
                                                                y,
                                                                right - x,
                                                                bottom - y,
                                                            ))
                                                        });
                                                    let perspective_ops =
                                                        render_perspective_triangles(
                                                            node,
                                                            page_height,
                                                            &name,
                                                            img_w,
                                                            img_h,
                                                            fill_fit,
                                                            *fill_x,
                                                            *fill_y,
                                                            *fill_scale,
                                                            normalized_crop,
                                                            fill_rotation.unwrap_or(0.0),
                                                            *flip_h == Some(true),
                                                            *flip_v == Some(true),
                                                            *opacity,
                                                            &perspective.quad,
                                                            state,
                                                        );
                                                    buf.extend_from_slice(
                                                        perspective_ops.as_bytes(),
                                                    );
                                                } else {
                                                    let (bounds_x, bounds_y, bw, bh) =
                                                        shape_local_bounds(node);

                                                    // Compute the full-source placement. A crop
                                                    // remains a sample within this destination; it
                                                    // never changes fit aspect or stretches itself
                                                    // back over the object bounds.
                                                    let (draw_w, draw_h, draw_ox, draw_oy) =
                                                        compute_pdf_image_placement(
                                                            fill_fit,
                                                            img_w,
                                                            img_h,
                                                            bw,
                                                            bh,
                                                            *fill_scale,
                                                        );
                                                    let draw_x = bounds_x + fill_x + draw_ox;
                                                    let draw_y = bounds_y + fill_y + draw_oy;

                                                    let flip_h_val = *flip_h == Some(true);
                                                    let flip_v_val = *flip_v == Some(true);
                                                    let rot = fill_rotation.unwrap_or(0.0);
                                                    let content_matrix = image_content_affine(
                                                        node, draw_x, draw_y, draw_w, draw_h, rot,
                                                        flip_h_val, flip_v_val,
                                                    );

                                                    // Crop clipping uses the same transformed
                                                    // proportional destination as the full image
                                                    // and its embedded SMask.
                                                    if let Some((src_x, src_y, src_w, src_h)) =
                                                        normalized_crop
                                                    {
                                                        let sample_x =
                                                            draw_x + src_x / img_w * draw_w;
                                                        let sample_y =
                                                            draw_y + src_y / img_h * draw_h;
                                                        let sample_w = src_w / img_w * draw_w;
                                                        let sample_h = src_h / img_h * draw_h;
                                                        buf.extend_from_slice(
                                                            transformed_rect_clip(
                                                                content_matrix,
                                                                page_height,
                                                                sample_x,
                                                                sample_y,
                                                                sample_w,
                                                                sample_h,
                                                            )
                                                            .as_bytes(),
                                                        );
                                                    }

                                                    // Apply per-fill opacity via ExtGState
                                                    if *opacity < 1.0 {
                                                        let gs_name = state
                                                            .get_or_create_opacity_gs(*opacity);
                                                        buf.extend(
                                                            format!("/{gs_name} gs\n").as_bytes(),
                                                        );
                                                    }
                                                    let image_matrix = pdf_image_matrix(
                                                        content_matrix,
                                                        page_height,
                                                        draw_x,
                                                        draw_y,
                                                        draw_w,
                                                        draw_h,
                                                    );
                                                    buf.extend(
                                                        format!(
                                                            "{:.4} {:.4} {:.4} {:.4} {:.4} {:.4} cm\n",
                                                            image_matrix[0],
                                                            image_matrix[1],
                                                            image_matrix[2],
                                                            image_matrix[3],
                                                            image_matrix[4],
                                                            image_matrix[5],
                                                        )
                                                        .as_bytes(),
                                                    );
                                                    buf.extend(format!("/{name} Do\n").as_bytes());
                                                }
                                            }
                                            Err(e) => {
                                                buf.extend(
                                                    format!("% image fill embed error: {e}\n")
                                                        .as_bytes(),
                                                );
                                            }
                                        }
                                    }
                                    _ => {
                                        // Fallback: checkerboard placeholder (no manifest or no match)
                                        const PH: u32 = 16;
                                        let checkerboard = generate_checkerboard();
                                        match embed_image(state.doc, &checkerboard, PH, PH) {
                                            Ok(obj_ref) => {
                                                let name = format!("Im{}", state.counter);
                                                state.counter += 1;
                                                state.refs.push((name.clone(), obj_ref));

                                                let (bx, by, bw, bh) =
                                                    shape_pdf_bounds(node, page_height);
                                                let tx = bx + fill_x;
                                                let ty = by + fill_y;
                                                let sx = bw / PH as f64;
                                                let sy = bh / PH as f64;

                                                // Apply per-fill opacity via ExtGState
                                                if *opacity < 1.0 {
                                                    let gs_name =
                                                        state.get_or_create_opacity_gs(*opacity);
                                                    buf.extend(
                                                        format!("/{gs_name} gs\n").as_bytes(),
                                                    );
                                                }

                                                buf.extend(
                                                    format!(
                                                        "{sx:.4} 0 0 {sy:.4} {tx:.4} {ty:.4} cm\n"
                                                    )
                                                    .as_bytes(),
                                                );
                                                buf.extend(format!("/{name} Do\n").as_bytes());

                                                if use_cmyk {
                                                    let note = "% image fill CMYK conversion not yet implemented; checkerboard placeholder rendered as RGB\n";
                                                    buf.extend_from_slice(note.as_bytes());
                                                }

                                                if let Some(mask_type) = alpha_mask {
                                                    let note = format!(
                                                        "% alpha mask type '{:?}' not yet implemented for image fill in PDF export; use SMask via RGBA data\n",
                                                        mask_type
                                                    );
                                                    buf.extend_from_slice(note.as_bytes());
                                                }
                                            }
                                            Err(e) => {
                                                buf.extend(
                                                    format!("% image fill embed error: {e}\n")
                                                        .as_bytes(),
                                                );
                                            }
                                        }
                                    }
                                }
                                buf.extend_from_slice(b"Q\n");
                            }
                            None => {
                                // No document — keep legacy behaviour
                                buf.extend_from_slice(
                                    b"% image/pattern fill (not rendered in basic PDF)\n",
                                );
                            }
                        }
                    }
                    FillIR::Pattern {
                        tile_src,
                        spacing,
                        rotation,
                        image_width,
                        image_height,
                        opacity,
                        blend_mode: _,
                        visible: _,
                    } => {
                        let tile_w = image_width.unwrap_or(32.0);
                        let tile_h = image_height.unwrap_or(32.0);
                        let angle = *rotation * std::f64::consts::PI / 180.0;
                        let cos_a = angle.cos();
                        let sin_a = angle.sin();

                        buf.extend_from_slice(b"q\n");

                        // Non-rectangular shapes: clip to the shape path first
                        if !matches!(node.shape, Shape::Rect(_)) {
                            buf.extend(&path_ops);
                            buf.extend_from_slice(b"W n\n");
                        }

                        // Try to resolve tile from manifest
                        let tile_image = manifest.as_ref().and_then(|m| {
                            m.patterns
                                .iter()
                                .find(|p| p.id == *tile_src || p.tile_image_id == *tile_src)
                                .and_then(|pat| m.resolve_image(&pat.tile_image_id).ok())
                        });

                        match tile_image {
                            Some(img) if img.is_valid() => {
                                // Convert RGBA to RGB (PDF XObjects use DeviceRGB)
                                let rgb_data: Vec<u8> = img
                                    .data
                                    .chunks_exact(4)
                                    .flat_map(|rgba| [rgba[0], rgba[1], rgba[2]])
                                    .collect();

                                match embed_image(
                                    image_state.as_mut().unwrap().doc,
                                    &rgb_data,
                                    img.width,
                                    img.height,
                                ) {
                                    Ok(obj_ref) => {
                                        let state = image_state.as_mut().unwrap();
                                        let name = format!("Pat{}", state.counter);
                                        state.counter += 1;
                                        state.refs.push((name.clone(), obj_ref));

                                        // Clip to shape bounds
                                        let (shape_x, shape_y, shape_w, shape_h) =
                                            shape_pdf_bounds(node, page_height);
                                        buf.extend_from_slice(b"q\n");
                                        buf.extend(&path_ops);
                                        buf.extend_from_slice(b"W n\n");

                                        // Tile the image across shape bounds
                                        let x_step = tile_w + *spacing;
                                        let y_step = tile_h + *spacing;
                                        let max_tiles = ((shape_w / x_step + 1.0)
                                            * (shape_h / y_step + 1.0))
                                            as u32;
                                        if max_tiles > 1000 {
                                            buf.extend(format!(
                                                "% WARNING: pattern tile count {max_tiles} exceeds 1000; consider a larger tile size\n"
                                            ).as_bytes());
                                        }

                                        let mut y = shape_y;
                                        while y < shape_y + shape_h + tile_h {
                                            let mut x = shape_x;
                                            while x < shape_x + shape_w + tile_w {
                                                // Apply rotation around tile center
                                                if *rotation != 0.0 {
                                                    let cx = x + tile_w / 2.0;
                                                    let cy = y + tile_h / 2.0;
                                                    // Rotation matrix: cos -sin sin cos about (cx,cy)
                                                    // Combined: translate(-cx,-cy) * rotate * translate(cx,cy)
                                                    // = [cos -sin  cx(1-cos)+cy*sin]
                                                    //   [sin  cos  cy(1-cos)-cx*sin]
                                                    buf.extend(format!(
                                                        "{cos_a:.6} {sin_a:.6} {:.6} {cos_a:.6} {:.4} {:.4} cm\n",
                                                        -sin_a,
                                                        cx * (1.0 - cos_a) + cy * sin_a,
                                                        cy * (1.0 - cos_a) - cx * sin_a,
                                                    ).as_bytes());
                                                }

                                                // Position and scale tile
                                                buf.extend(
                                                    format!(
                                                        "{tile_w:.4} 0 0 {tile_h:.4} {x:.4} {y:.4} cm\n"
                                                    )
                                                    .as_bytes(),
                                                );
                                                buf.extend(format!("/{name} Do\n").as_bytes());

                                                // Undo rotation
                                                if *rotation != 0.0 {
                                                    let cx = x + tile_w / 2.0;
                                                    let cy = y + tile_h / 2.0;
                                                    buf.extend(format!(
                                                        "{cos_a:.6} {sin_a:.6} {:.6} {cos_a:.6} {:.4} {:.4} cm\n",
                                                        -sin_a,
                                                        cx * (1.0 - cos_a) - cy * sin_a,
                                                        cy * (1.0 - cos_a) + cx * sin_a,
                                                    ).as_bytes());
                                                }

                                                x += x_step;
                                            }
                                            y += y_step;
                                        }

                                        // Apply opacity if needed
                                        if *opacity < 1.0 {
                                            buf.extend(
                                                format!("% pattern opacity={:.3}\n", opacity)
                                                    .as_bytes(),
                                            );
                                        }

                                        buf.extend_from_slice(b"Q\n"); // restore clip
                                    }
                                    Err(e) => {
                                        buf.extend(
                                            format!("% pattern tile embed error: {e}\n").as_bytes(),
                                        );
                                        // Fallback to gray fill
                                        buf.extend_from_slice(b"0.75 0.75 0.75 rg\n");
                                        let (bx, by, bw, bh) = shape_pdf_bounds(node, page_height);
                                        buf.extend(
                                            format!("{bx:.4} {by:.4} {bw:.4} {bh:.4} re f\n")
                                                .as_bytes(),
                                        );
                                    }
                                }
                            }
                            _ => {
                                // No manifest or missing tile — gray fill with warning
                                buf.extend_from_slice(b"0.75 0.75 0.75 rg\n");
                                let (bx, by, bw, bh) = shape_pdf_bounds(node, page_height);
                                buf.extend(
                                    format!("{bx:.4} {by:.4} {bw:.4} {bh:.4} re f\n").as_bytes(),
                                );
                                buf.extend_from_slice(
                                    b"% WARNING: pattern tile not found in export manifest; rendered as gray fill\n",
                                );
                            }
                        }

                        if *opacity < 1.0 {
                            buf.extend(format!("% pattern opacity={opacity:.3}\n").as_bytes());
                        }

                        buf.extend_from_slice(b"Q\n");
                    }
                    FillIR::Solid { .. } => {
                        buf.extend_from_slice(b"q\n");
                        let color_str = fill_to_color_string(fill, use_cmyk, profile, lossy);
                        buf.extend(color_str.as_bytes());
                        buf.extend(b"\n");
                        buf.extend(&path_ops);
                        buf.extend_from_slice(b"f\n");
                        if fill_opacity(fill) < 1.0 {
                            buf.extend(format!("% opacity={:.3}\n", fill_opacity(fill)).as_bytes());
                        }
                        buf.extend_from_slice(b"Q\n");
                    }
                    FillIR::Gradient {
                        gradient_type,
                        stops,
                        rotation,
                        ..
                    } => {
                        buf.extend_from_slice(b"q\n");
                        let use_shading = stops.len() >= 2;
                        if use_shading {
                            if let Some(registry) = shading_registry.as_mut() {
                                let shading_name = match gradient_type.as_str() {
                                    "radial" => registry
                                        .add_radial_gradient(stops, use_cmyk, profile, *rotation),
                                    _ => registry
                                        .add_linear_gradient(stops, use_cmyk, profile, *rotation),
                                };
                                buf.extend(&path_ops);
                                buf.extend_from_slice(b"W n\n");
                                buf.extend(format!("/{shading_name} sh\n").as_bytes());
                            } else {
                                let color_str =
                                    fill_to_color_string(fill, use_cmyk, profile, lossy);
                                buf.extend(color_str.as_bytes());
                                buf.extend(b"\n");
                                buf.extend(&path_ops);
                                buf.extend_from_slice(b"f\n");
                            }
                        } else {
                            let color_str = fill_to_color_string(fill, use_cmyk, profile, lossy);
                            buf.extend(color_str.as_bytes());
                            buf.extend(b"\n");
                            buf.extend(&path_ops);
                            buf.extend_from_slice(b"f\n");
                        }
                        if fill_opacity(fill) < 1.0 {
                            buf.extend(format!("% opacity={:.3}\n", fill_opacity(fill)).as_bytes());
                        }
                        buf.extend_from_slice(b"Q\n");
                    }
                }
            }
            return buf;
        }
    }

    // Fallback to node.fill
    buf.extend_from_slice(b"q\n");
    if use_cmyk {
        buf.extend(color_to_cmyk_string(&node.fill, profile).as_bytes());
    } else {
        buf.extend(color_to_rgb_string(&node.fill).as_bytes());
    }
    buf.extend(b"\n");
    buf.extend(&path_ops);
    buf.extend_from_slice(b"f\n");
    if node.opacity < 1.0 {
        buf.extend(format!("% opacity={:.3}\n", node.opacity).as_bytes());
    }
    buf.extend_from_slice(b"Q\n");
    buf
}

/// Render strokes from `node.strokes`.
fn render_strokes(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    if path_ops.is_empty() || node.strokes.is_empty() {
        return Vec::new();
    }

    let mut buf = Vec::new();
    for stroke in &node.strokes {
        if !stroke.visible {
            continue;
        }
        buf.extend_from_slice(b"q\n");

        // Line width
        buf.extend(format!("{:.2} w\n", stroke.weight).as_bytes());

        // Line cap: 0=butt, 1=round, 2=square
        let cap_val: u8 = match stroke.cap.as_str() {
            "round" => 1,
            "square" => 2,
            _ => 0,
        };
        buf.extend(format!("{cap_val} J\n").as_bytes());

        // Line join: 0=miter, 1=round, 2=bevel
        let join_val: u8 = match stroke.join.as_str() {
            "round" => 1,
            "bevel" => 2,
            _ => 0,
        };
        buf.extend(format!("{join_val} j\n").as_bytes());

        // Miter limit
        buf.extend(format!("{:.2} M\n", stroke.miter_limit).as_bytes());

        // Dash pattern
        if !stroke.dash_pattern.is_empty() {
            let dash_str: Vec<String> = stroke
                .dash_pattern
                .iter()
                .map(|v| format!("{v:.2}"))
                .collect();
            buf.extend(
                format!("[{}] {:.2} d\n", dash_str.join(" "), stroke.dash_offset).as_bytes(),
            );
        }

        // Color
        if use_cmyk {
            buf.extend(color_to_stroke_cmyk_string(&stroke.color, profile).as_bytes());
        } else {
            buf.extend(color_to_stroke_rgb_string(&stroke.color).as_bytes());
        }
        buf.extend(b"\n");

        buf.extend(&path_ops);
        buf.extend_from_slice(b"S\n");
        buf.extend_from_slice(b"Q\n");
    }
    buf
}

/// Render effects. dropShadow is rendered as an offset, semi-transparent
/// black copy of the path. Other effects are emitted as comments.
fn render_effects(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    let has_filters = node
        .filters
        .as_ref()
        .map(|f| !f.is_empty())
        .unwrap_or(false);
    if path_ops.is_empty() || (node.effects.is_empty() && !has_filters) {
        return Vec::new();
    }

    let mut buf = Vec::new();
    for effect in &node.effects {
        match effect {
            Effect::DropShadow {
                x,
                y,
                blur,
                spread: _,
                color,
                opacity,
                visible,
                ..
            } => {
                if !visible || *opacity <= 0.0 {
                    continue;
                }
                buf.extend_from_slice(b"q\n");

                // Apply shadow offset translation
                let blur_approx = blur.max(0.0);
                let spread_approx = blur_approx * 0.5;
                let tx = x + spread_approx;
                let ty = y + spread_approx;
                buf.extend(format!("1 0 0 1 {tx:.2} {ty:.2} cm\n").as_bytes());

                // Shadow fill color
                if use_cmyk {
                    buf.extend(color_to_cmyk_string(color, profile).as_bytes());
                } else {
                    buf.extend(color_to_rgb_string(color).as_bytes());
                }
                buf.extend(b"\n");

                buf.extend(&path_ops);
                buf.extend_from_slice(b"f\n");

                if *opacity < 1.0 {
                    buf.extend(format!("% opacity={:.3}\n", opacity).as_bytes());
                }
                if *blur > 0.0 {
                    buf.extend(format!("% blur={:.2}\n", blur).as_bytes());
                }
                buf.extend_from_slice(b"Q\n");
            }
            Effect::InnerShadow { visible, .. } => {
                if *visible {
                    buf.extend(b"% innerShadow (not rendered in basic PDF)\n");
                }
            }
            Effect::LayerBlur {
                radius, visible, ..
            } => {
                if *visible {
                    buf.extend(format!("% layerBlur radius={radius:.2}\n").as_bytes());
                }
            }
            Effect::BackgroundBlur {
                radius, visible, ..
            } => {
                if *visible {
                    buf.extend(format!("% backgroundBlur radius={radius:.2}\n").as_bytes());
                }
            }
            Effect::DepthBlur {
                depth_map_id,
                blur_strength,
                visible,
                ..
            } => {
                // Depth-aware blur depends on an image-space depth resource and
                // is currently replayed by the Canvas2D/WASM renderer only.
                // Keep print output honest instead of dropping it silently.
                if *visible {
                    buf.extend(
                        format!(
                            "% depthBlur depthMapId={depth_map_id} blurStrength={blur_strength:.2} (not rendered in basic PDF)\n"
                        )
                        .as_bytes(),
                    );
                }
            }
            Effect::OuterGlow { visible, .. } => {
                if *visible {
                    buf.extend(b"% outerGlow (not rendered in basic PDF)\n");
                }
            }
            Effect::InnerGlow { visible, .. } => {
                if *visible {
                    buf.extend(b"% innerGlow (not rendered in basic PDF)\n");
                }
            }
            Effect::GlassMaterial {
                blur,
                edge_highlight: _,
                edge_highlight_width: _,
                visible,
                ..
            } => {
                if *visible {
                    buf.extend(
                        format!("% glassMaterial blur={blur:.2} (not rendered in basic PDF)\n")
                            .as_bytes(),
                    );
                }
            }
            Effect::ChromaticAberration { visible, .. } => {
                if *visible {
                    buf.extend(b"% chromaticAberration (not rendered in basic PDF)\n");
                }
            }
            Effect::Glitch { visible, .. } => {
                if *visible {
                    buf.extend(b"% glitch (not rendered in basic PDF)\n");
                }
            }
        }
    }

    if has_filters {
        // The nondestructive adjustment stack (curves, levels, halftone, etc.)
        // is CPU-rasterized by the live canvas renderer only; there is no
        // Rust-side implementation of it (see packages/engine/src/filters.ts
        // and halftone.ts). Surface that honestly instead of silently
        // dropping the effect from print output.
        buf.extend_from_slice(
            b"% nondestructive adjustment stack (e.g. halftone, curves, levels) not rendered in basic PDF export\n",
        );
    }

    buf
}

/// Embed raw image data as a PDF Image XObject in the document.
///
/// Returns the object reference that can be used in content streams
/// via `/ImName Do`. The image data should be raw pixel data
/// (R,G,B per pixel, `width * height * 3` bytes).
pub fn embed_image(
    doc: &mut Document,
    image_data: &[u8],
    width: u32,
    height: u32,
) -> Result<Object, String> {
    let expected = (width * height * 3) as usize;
    if image_data.len() < expected {
        return Err(format!(
            "Image data too short: got {} bytes, expected {expected}",
            image_data.len()
        ));
    }

    let image_id = doc.new_object_id();
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => width as i64,
            "Height" => height as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Length" => expected as i64,
        },
        image_data[..expected].to_vec(),
    );
    doc.objects.insert(image_id, Object::Stream(stream));
    Ok(Object::Reference(image_id))
}

/// Embed image data with an explicit color space.
///
/// `bpc` = bytes per component (3 for RGB, 4 for CMYK).
/// `color_space_name` = PDF color space name (e.g. "DeviceRGB", "DeviceCMYK").
pub fn embed_image_with_colorspace(
    doc: &mut Document,
    image_data: &[u8],
    width: u32,
    height: u32,
    bpc: u32,
    color_space_name: &str,
    alpha_data: Option<&[u8]>,
) -> Result<Object, String> {
    let expected = (width * height * bpc) as usize;
    if image_data.len() < expected {
        return Err(format!(
            "Image data too short: got {} bytes, expected {expected}",
            image_data.len()
        ));
    }

    let mut image_dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => width as i64,
        "Height" => height as i64,
        "ColorSpace" => color_space_name,
        "BitsPerComponent" => 8,
        "Length" => expected as i64,
    };

    // Embed alpha channel as a soft mask (SMask) for transparency support.
    // The alpha is stored as a separate 1-component 8-bit image XObject
    // and linked via /SMask in the image dictionary.
    if let Some(alpha) = alpha_data {
        let alpha_expected = (width * height) as usize;
        if alpha.len() >= alpha_expected {
            let mask_id = doc.new_object_id();
            let mask_stream = Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => width as i64,
                    "Height" => height as i64,
                    "ColorSpace" => "DeviceGray",
                    "BitsPerComponent" => 8,
                    "Length" => alpha_expected as i64,
                },
                alpha[..alpha_expected].to_vec(),
            );
            doc.objects.insert(mask_id, Object::Stream(mask_stream));
            image_dict.set("SMask", Object::Reference(mask_id));
        }
    }

    let image_id = doc.new_object_id();
    let stream = Stream::new(image_dict, image_data[..expected].to_vec());
    doc.objects.insert(image_id, Object::Stream(stream));
    Ok(Object::Reference(image_id))
}

/// Extract the alpha channel from RGBA pixel data.
/// Returns Vec<u8> with one byte per pixel (the alpha value).
pub fn rgba_extract_alpha(data: &[u8]) -> Vec<u8> {
    data.chunks_exact(4).map(|rgba| rgba[3]).collect()
}

/// Convert RGBA pixel data to RGB by stripping the alpha channel.
pub fn rgba_to_rgb(data: &[u8]) -> Vec<u8> {
    data.chunks_exact(4)
        .flat_map(|rgba| [rgba[0], rgba[1], rgba[2]])
        .collect()
}

/// Legacy shape_to_pdf_content — maintained for backward compatibility
/// with `build_pdfx_content` in cmyk.rs.
/// Shape → PDF content stream. `use_cmyk`/`profile` control whether fills and
/// strokes are emitted as ICC-aware CMYK operators (PDF/X-1a) or plain RGB.
fn shape_to_pdf_content(
    node: &SceneNode,
    page_height: f64,
    image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"q\n");
    let effects = render_effects(node, page_height, use_cmyk, profile);
    buf.extend(&effects);
    let fills = render_fills(
        node,
        page_height,
        use_cmyk,
        image_state,
        manifest,
        profile,
        None,
        false,
    );
    buf.extend(&fills);
    let strokes = render_strokes(node, page_height, use_cmyk, profile);
    buf.extend(&strokes);
    buf.extend_from_slice(b"Q\n");
    buf
}

/// Check if a fill contains high bit depth colors that will lose precision
/// when converted to 8-bit PDF. Prints a warning to stderr.
fn check_lossy_color(fill: &FillIR) {
    let colors: Vec<&EngineColor> = match fill {
        FillIR::Solid { color, .. } => vec![color],
        FillIR::Gradient { stops, .. } => stops.iter().map(|s| &s.color).collect(),
        _ => return,
    };
    for color in colors {
        let bit_depth = match color {
            EngineColor::Rgb { bit_depth, .. } => bit_depth.as_deref(),
            EngineColor::Cmyk { bit_depth, .. } => bit_depth.as_deref(),
            EngineColor::Gray { bit_depth, .. } => bit_depth.as_deref(),
            _ => None,
        };
        if let Some(bd) = bit_depth {
            if bd != "uint8" && bd != "uint16" {
                eprintln!("[warn] exporting {bd} color as 8-bit PDF — precision will be lost");
            }
        }
    }
}
/// Helper: convert a FillIR to an RGB or CMYK fill color string.
fn fill_to_color_string(
    fill: &FillIR,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
    lossy: bool,
) -> String {
    if lossy {
        check_lossy_color(fill);
    }
    match fill {
        FillIR::Solid { color, .. } => {
            if use_cmyk {
                color_to_cmyk_string(color, profile)
            } else {
                color_to_rgb_string(color)
            }
        }
        FillIR::Gradient { stops, .. } => {
            // Gradient fills approximate as solid using the first stop color.
            if let Some(stop) = stops.first() {
                if use_cmyk {
                    color_to_cmyk_string(&stop.color, profile)
                } else {
                    color_to_rgb_string(&stop.color)
                }
            } else if use_cmyk {
                color_to_cmyk_string(
                    &EngineColor::Rgb {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    profile,
                )
            } else {
                color_to_rgb_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                })
            }
        }
        FillIR::Image { .. } | FillIR::Pattern { .. } => {
            if use_cmyk {
                color_to_cmyk_string(
                    &EngineColor::Rgb {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    profile,
                )
            } else {
                color_to_rgb_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                })
            }
        }
    }
}

// ── FillIR helpers (free functions as we can't impl on external type) ─

fn fill_visible(fill: &FillIR) -> bool {
    match fill {
        FillIR::Solid { visible, .. } => *visible,
        FillIR::Gradient { visible, .. } => *visible,
        FillIR::Image { visible, .. } => *visible,
        FillIR::Pattern { visible, .. } => *visible,
    }
}

fn fill_opacity(fill: &FillIR) -> f64 {
    match fill {
        FillIR::Solid { opacity, .. } => *opacity,
        FillIR::Gradient { opacity, .. } => *opacity,
        FillIR::Image { opacity, .. } => *opacity,
        FillIR::Pattern { opacity, .. } => *opacity,
    }
}

/// Convert a glyph outline to PDF path content bytes.
///
/// Each `PathCommand` is mapped to the equivalent PDF path operator
/// (m, l, c, h). The result is filled with `fill_color` and closed with `Q`.
/// Coordinates are flipped so that Y increases upward (PDF convention).
fn glyph_outline_to_pdf(
    outline: &GlyphOutline,
    color: &str,
    x_base: f64,
    y_base: f64,
    page_height: f64,
) -> Vec<u8> {
    let mut buf = format!("q\n{color}\n").into_bytes();
    for cmd in &outline.commands {
        match cmd {
            PathCommand::MoveTo(x, y) => {
                let px = x_base + x;
                let py = page_height - (y_base - y);
                buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
            }
            PathCommand::LineTo(x, y) => {
                let px = x_base + x;
                let py = page_height - (y_base - y);
                buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
            }
            PathCommand::CurveTo(x1, y1, x2, y2, x3, y3) => {
                let p1x = x_base + x1;
                let p1y = page_height - (y_base - y1);
                let p2x = x_base + x2;
                let p2y = page_height - (y_base - y2);
                let p3x = x_base + x3;
                let p3y = page_height - (y_base - y3);
                buf.extend(
                    format!("{p1x:.2} {p1y:.2} {p2x:.2} {p2y:.2} {p3x:.2} {p3y:.2} c\n").as_bytes(),
                );
            }
            PathCommand::ClosePath => {
                buf.extend_from_slice(b"h\n");
            }
        }
    }
    buf.extend_from_slice(b"f\nQ\n");
    buf
}

/// Internal record for an embedded subset font.
#[allow(dead_code)]
struct EmbeddedFontEntry {
    /// Resource name in the page's font dict (e.g. "F1").
    res_name: String,
    /// BaseFont name with subset tag prefix (e.g. "ABCDEF+DejaVuSans").
    /// Font family from the scene model.
    family: String,
    /// Object ID of the font dictionary in the PDF document.
    dict_id: ObjectId,
    /// Whether this font is embedded as a CIDFont2 (Identity-H) for
    /// non-WinAnsi/CJK text. When true, the font dictionary uses
    /// /Subtype /CIDFontType2 and a /CIDSystemInfo entry.
    is_cid: bool,
}

/// Build a PDF TJ array string with per-glyph character hex codes.
/// Format: [(glyph1) (glyph2) ...] TJ
/// This preserves individual glyph identity for selectable text.
/// Full kerning support requires reading the GPOS/kern table directly;
/// for now we emit each glyph as a hex string with zero kerning.
fn build_tj_array(text: &str, _font_data: &[u8], _font_size: f64, _face_index: u32) -> String {
    let mut parts: Vec<String> = Vec::new();
    for c in text.chars() {
        let cp = c as u32;
        if cp <= 0xFF {
            // Single-byte hex for WinAnsi
            parts.push(format!("<{:02X}>", cp as u8));
        } else {
            // Two-byte hex for non-WinAnsi (CID)
            parts.push(format!("<{:04X}>", cp));
        }
    }
    format!("[{}] TJ", parts.join(" "))
}

/// Escape a string for use in a PDF literal string `(...)`.
fn escape_pdf_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_ascii() && (c as u8) < 32 => {
                out.push_str(&format!("\\{:03o}", c as u8));
            }
            c => out.push(c),
        }
    }
    out
}

/// Detect text that cannot be represented in WinAnsiEncoding and therefore
/// MUST be outlined into vector paths. Arabic, Hebrew, Devanagari, CJK, and
/// any codepoint above U+00FF fall here.
pub fn requires_outline(text: &str) -> bool {
    text.chars().any(|c| (c as u32) > 0xFF)
}

/// Check whether text contains any character outside WinAnsi range
/// (i.e., needs CID font or outline).
pub fn has_non_winansi(text: &str) -> bool {
    requires_outline(text)
}

/// Extract the text content of a node if it is a text shape, else None.
fn shape_text(node: &SceneNode) -> Option<&str> {
    match &node.shape {
        Shape::Text { text, .. } => Some(text),
        _ => None,
    }
}

/// Check whether every character in `text` fits in WinAnsiEncoding
/// (roughly Latin-1 printable characters plus common whitespace).
fn can_encode_win_ansi(text: &str) -> bool {
    text.chars().all(|c| {
        let cp = c as u32;
        cp == 0x09
            || cp == 0x0A
            || cp == 0x0D
            || (0x20..=0x7E).contains(&cp)
            || (0xA0..=0xFF).contains(&cp)
    })
}

/// Encode text using WinAnsiEncoding byte values.
fn encode_win_ansi(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let cp = ch as u32;
        match cp {
            // Pass through ASCII and Latin-1 Supplement
            0x09 | 0x0A | 0x0D | 0x20..=0x7E | 0xA0..=0xFF => out.push(cp as u8),
            // Approximate common characters not in WinAnsi:
            0x2013 | 0x2014 => out.push(0x2D), // en/em dash → hyphen
            0x2018 | 0x2019 => out.push(0x27), // curly quotes → '
            0x201C | 0x201D => out.push(0x22), // curly double quotes → "
            0x2022 => out.push(0xB7),          // bullet → middle dot
            0x20AC => out.push(0x80),          // € in WinAnsi is 0x80
            _ => out.push(0x20),               // space as safest fallback
        }
    }
    out
}

/// Collect all text from scene nodes, grouped by font family.
fn collect_text_per_family(nodes: &[SceneNode]) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    for node in nodes {
        if let Shape::Text {
            text, font_family, ..
        } = &node.shape
        {
            if !text.is_empty() {
                map.entry(font_family.clone()).or_default().push_str(text);
            }
        }
    }
    map
}

/// Compute ascender for a font from its raw bytes.
fn font_ascender(font_data: &[u8], font_size: f64) -> f64 {
    if let Ok(font) = ab_glyph::FontArc::try_from_vec(font_data.to_vec()) {
        let scale = font_size / font.units_per_em().unwrap_or(1000.0) as f64;
        return font.ascent_unscaled() as f64 * scale;
    }
    font_size * 0.8
}

/// Read font metrics from font binary data using ttf_parser.
fn read_font_metrics(font_data: &[u8], face_index: u32) -> FontMetrics {
    if let Ok(face) = ttf_parser::Face::parse(font_data, face_index) {
        let upem = f64::from(face.units_per_em());
        let scale = 1000.0 / upem;

        let ascent = f64::from(face.ascender()) * scale;
        let descent = f64::from(face.descender()) * scale;
        let cap_height = face
            .capital_height()
            .map(|c| f64::from(c) * scale)
            .unwrap_or(500.0);
        let _x_height: f64 = face
            .x_height()
            .map(|x| f64::from(x) * scale)
            .unwrap_or(250.0);

        // FontBBox from head table
        let head = face.tables().head;
        let bbox = [
            f64::from(head.global_bbox.x_min) * scale,
            f64::from(head.global_bbox.y_min) * scale,
            f64::from(head.global_bbox.x_max) * scale,
            f64::from(head.global_bbox.y_max) * scale,
        ];

        // Determine flags from OS/2 table
        let flags = if face.tables().os2.is_some() {
            let mut f = 32i32;
            if face.is_italic() {
                f |= 1 << 3;
            }
            f
        } else {
            32
        };

        FontMetrics {
            ascent: ascent.max(0.0),
            descent: descent.min(0.0),
            cap_height: cap_height.max(100.0),
            stem_v: 50.0,
            italic_angle: 0.0,
            flags,
            bbox,
            units_per_em: upem,
        }
    } else {
        FontMetrics {
            ascent: 800.0,
            descent: -200.0,
            cap_height: 500.0,
            stem_v: 50.0,
            italic_angle: 0.0,
            flags: 32,
            bbox: [0.0, -200.0, 1000.0, 800.0],
            units_per_em: 1000.0,
        }
    }
}

struct FontMetrics {
    ascent: f64,
    descent: f64,
    cap_height: f64,
    stem_v: f64,
    italic_angle: f64,
    flags: i32,
    bbox: [f64; 4],
    #[allow(dead_code)]
    units_per_em: f64,
}

/// Embed a font program into the PDF document as a TrueType font with
/// FontDescriptor and font dictionary, returning the entry record.
fn embed_font_program(
    doc: &mut Document,
    family: &str,
    base_font: &str,
    font_data: &[u8],
    font_idx: usize,
) -> Result<EmbeddedFontEntry, String> {
    // Read metrics from actual font binary
    let metrics = read_font_metrics(font_data, 0);

    // 1. Font program stream (FontFile2)
    let font_stream_id = doc.new_object_id();
    let font_stream = Stream::new(
        dictionary! {
            "Length1" => font_data.len() as i64,
        },
        font_data.to_vec(),
    );
    doc.objects
        .insert(font_stream_id, Object::Stream(font_stream));

    // 2. Font descriptor with metrics read from actual font data
    let descriptor_id = doc.new_object_id();
    let font_name_bytes = base_font.as_bytes().to_vec();
    let descriptor = dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => Object::Name(font_name_bytes.clone()),
        "Flags" => metrics.flags,
        "FontBBox" => vec![
            Object::Real(metrics.bbox[0] as f32),
            Object::Real(metrics.bbox[1] as f32),
            Object::Real(metrics.bbox[2] as f32),
            Object::Real(metrics.bbox[3] as f32),
        ],
        "ItalicAngle" => metrics.italic_angle as i32,
        "Ascent" => metrics.ascent as i32,
        "Descent" => metrics.descent as i32,
        "CapHeight" => metrics.cap_height as i32,
        "StemV" => metrics.stem_v as i64,
        "FontFile2" => Object::Reference(font_stream_id),
    };
    doc.objects
        .insert(descriptor_id, Object::Dictionary(descriptor));

    // 3. Font dictionary
    let res_name = format!("F{}", font_idx + 1);
    let font_dict_id = doc.new_object_id();
    let font_dict = dictionary! {
        "Type" => "Font",
        "Subtype" => "TrueType",
        "BaseFont" => Object::Name(font_name_bytes),
        "FontDescriptor" => Object::Reference(descriptor_id),
        "Encoding" => "WinAnsiEncoding",
        "FirstChar" => 32,
        "LastChar" => 255,
    };
    doc.objects
        .insert(font_dict_id, Object::Dictionary(font_dict));

    // 4. ToUnicode CMap for text extraction
    let to_unicode_id = doc.new_object_id();
    let to_unicode_stream = build_to_unicode_cmap(font_data, 0);
    doc.objects.insert(
        to_unicode_id,
        Object::Stream(Stream::new(dictionary! {}, to_unicode_stream)),
    );

    // Add ToUnicode reference to font dict
    if let Object::Dictionary(dict) = doc.objects.get_mut(&font_dict_id).unwrap() {
        dict.set("ToUnicode", Object::Reference(to_unicode_id));
    }

    Ok(EmbeddedFontEntry {
        res_name,
        family: family.to_string(),
        dict_id: font_dict_id,
        is_cid: false,
    })
}

/// Embed a font program as a CIDFont2 (Type 0 font with Identity-H CMap).
/// Used for non-WinAnsi text (CJK, Arabic, Hebrew, etc.) where the font
/// cannot use WinAnsiEncoding but can be referenced by CID (character ID).
fn embed_cid_font_program(
    doc: &mut Document,
    family: &str,
    base_font: &str,
    font_data: &[u8],
    font_idx: usize,
) -> Result<EmbeddedFontEntry, String> {
    let metrics = read_font_metrics(font_data, 0);

    // 1. Font program stream (FontFile2)
    let font_stream_id = doc.new_object_id();
    let font_stream = Stream::new(
        dictionary! { "Length1" => font_data.len() as i64 },
        font_data.to_vec(),
    );
    doc.objects
        .insert(font_stream_id, Object::Stream(font_stream));

    // 2. FontDescriptor
    let descriptor_id = doc.new_object_id();
    let font_name_bytes = base_font.as_bytes().to_vec();
    let descriptor = dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => Object::Name(font_name_bytes.clone()),
        "Flags" => metrics.flags,
        "FontBBox" => vec![
            Object::Real(metrics.bbox[0] as f32),
            Object::Real(metrics.bbox[1] as f32),
            Object::Real(metrics.bbox[2] as f32),
            Object::Real(metrics.bbox[3] as f32),
        ],
        "ItalicAngle" => metrics.italic_angle as i32,
        "Ascent" => metrics.ascent as i32,
        "Descent" => metrics.descent as i32,
        "CapHeight" => metrics.cap_height as i32,
        "StemV" => metrics.stem_v as i32,
        "FontFile2" => Object::Reference(font_stream_id),
    };
    doc.objects
        .insert(descriptor_id, Object::Dictionary(descriptor));

    // 3. CIDSystemInfo
    let cid_system_info_id = doc.new_object_id();
    let cid_system_info = dictionary! {
        "Registry" => Object::string_literal("Strata"),
        "Ordering" => Object::string_literal("Identity"),
        "Supplement" => 0,
    };
    doc.objects
        .insert(cid_system_info_id, Object::Dictionary(cid_system_info));

    // 4. CIDFont dictionary (CIDFontType2 for TrueType outlines)
    let cid_font_dict_id = doc.new_object_id();
    let tag = get_subset_tag(family);
    let cid_base_font = format!("{}{}", tag, base_font);
    let cid_font_dict = dictionary! {
        "Type" => "Font",
        "Subtype" => "CIDFontType2",
        "BaseFont" => Object::Name(cid_base_font.as_bytes().to_vec()),
        "CIDSystemInfo" => Object::Reference(cid_system_info_id),
        "FontDescriptor" => Object::Reference(descriptor_id),
        "DW" => 1000, // Default glyph width
    };
    doc.objects
        .insert(cid_font_dict_id, Object::Dictionary(cid_font_dict));

    // 5. CMap stream (Identity-H)
    let cmap_id = doc.new_object_id();
    let cmap_data = build_identity_h_cmap();
    doc.objects.insert(
        cmap_id,
        Object::Stream(Stream::new(dictionary! {}, cmap_data)),
    );

    // 6. Type 0 font dictionary referencing CIDFont + CMap
    let font_dict_id = doc.new_object_id();
    let res_name = format!("F{}", font_idx + 1);
    let font_dict = dictionary! {
        "Type" => "Font",
        "Subtype" => "Type0",
        "BaseFont" => Object::Name(cid_base_font.as_bytes().to_vec()),
        "Encoding" => Object::Reference(cmap_id),
        "DescendantFonts" => vec![Object::Reference(cid_font_dict_id)],
    };
    doc.objects
        .insert(font_dict_id, Object::Dictionary(font_dict));

    // 7. ToUnicode CMap for text extraction
    let to_unicode_id = doc.new_object_id();
    let to_unicode_stream = build_to_unicode_cmap(font_data, 0);
    doc.objects.insert(
        to_unicode_id,
        Object::Stream(Stream::new(dictionary! {}, to_unicode_stream)),
    );
    if let Object::Dictionary(dict) = doc.objects.get_mut(&font_dict_id).unwrap() {
        dict.set("ToUnicode", Object::Reference(to_unicode_id));
    }

    Ok(EmbeddedFontEntry {
        res_name,
        family: family.to_string(),
        dict_id: font_dict_id,
        is_cid: true,
    })
}

/// Build an Identity-H CMap stream for CIDFont keying.
/// Maps 2-byte character codes directly to CIDs (identity mapping).
fn build_identity_h_cmap() -> Vec<u8> {
    let mut cmap = Vec::new();
    cmap.extend_from_slice(b"/CIDInit /ProcSet findresource begin\n");
    cmap.extend_from_slice(b"12 dict begin\n");
    cmap.extend_from_slice(b"begincmap\n");
    cmap.extend_from_slice(
        b"/CIDSystemInfo << /Registry (Strata) /Ordering (Identity) /Supplement 0 >> def\n",
    );
    cmap.extend_from_slice(b"/CMapName /Strata-Identity def\n");
    cmap.extend_from_slice(b"/CMapType 2 def\n");
    cmap.extend_from_slice(b"1 begincodespacerange\n");
    cmap.extend_from_slice(b"<0000> <FFFF>\n");
    cmap.extend_from_slice(b"endcodespacerange\n");
    cmap.extend_from_slice(b"1 beginbfrange\n");
    cmap.extend_from_slice(b"<0000> <FFFF> <0000>\n");
    cmap.extend_from_slice(b"endbfrange\n");
    cmap.extend_from_slice(b"endcmap\n");
    cmap.extend_from_slice(b"end\n");
    cmap
}

/// Build a ToUnicode CMap stream for CIDFont-based text extraction.
/// Maps character codes (0x00-0xFF for WinAnsi) to Unicode values
/// using the font's cmap table.
fn build_to_unicode_cmap(font_data: &[u8], face_index: u32) -> Vec<u8> {
    // Build bfrange entries: character code → Unicode
    let mut ranges: Vec<(u8, u8, u32)> = Vec::new();

    if let Ok(face) = ttf_parser::Face::parse(font_data, face_index) {
        let mut range_start: Option<u8> = None;
        let mut range_unicode: Option<u32> = None;

        for code in 0x20u8..=0xFF {
            let glyph = face.glyph_index(char::from(code));
            if glyph.is_some() {
                match (range_start, range_unicode) {
                    (Some(rs), Some(ru))
                        if u32::from(rs) + u32::from(code) - u32::from(rs) == ru => {}
                    (Some(rs), Some(ru)) => {
                        ranges.push((rs, code - 1, ru));
                        range_start = Some(code);
                        range_unicode = Some(u32::from(code));
                    }
                    _ => {
                        range_start = Some(code);
                        range_unicode = Some(u32::from(code));
                    }
                }
            }
        }

        if let (Some(rs), Some(ru)) = (range_start, range_unicode) {
            ranges.push((rs, 0xFF, ru));
        }
    }

    if ranges.is_empty() {
        ranges.push((0x20, 0xFF, 0x20));
    }

    let mut cmap = Vec::new();
    cmap.extend_from_slice(b"/CIDInit /ProcSet findresource begin\n");
    cmap.extend_from_slice(b"12 dict begin\n");
    cmap.extend_from_slice(b"begincmap\n");
    cmap.extend_from_slice(
        b"/CIDSystemInfo << /Registry (Strata) /Ordering (Identity) /Supplement 0 >> def\n",
    );
    cmap.extend_from_slice(b"/CMapName /Strata-Identity def\n");
    cmap.extend_from_slice(b"/CMapType 2 def\n");
    cmap.extend_from_slice(b"1 begincodespacerange\n");
    cmap.extend_from_slice(b"<00> <FF>\n");
    cmap.extend_from_slice(b"endcodespacerange\n");

    cmap.extend_from_slice(format!("{} beginbfrange\n", ranges.len()).as_bytes());
    for (start, end, unicode_start) in &ranges {
        cmap.extend_from_slice(
            format!("<{start:02X}> <{end:02X}> <{unicode_start:04X}>\n").as_bytes(),
        );
    }
    cmap.extend_from_slice(b"endbfrange\n");
    cmap.extend_from_slice(b"endcmap\n");
    cmap.extend_from_slice(b"end\n");

    cmap
}

/// A single text run extracted from the rich text model.
#[allow(dead_code)]
struct RichTextRun {
    text: String,
    font_family: Option<String>,
    font_size: Option<f64>,
    font_weight: Option<i64>,
    font_style: Option<String>,
}

/// Parse rich text runs from a `serde_json::Value` matching the TS `RichText`
/// interface: `{ paragraphs: [{ runs: [{ text, format? }] }] }`.
fn parse_rich_text_runs(value: &serde_json::Value) -> Vec<RichTextRun> {
    let mut runs = Vec::new();
    let paragraphs = match value.get("paragraphs").and_then(|v| v.as_array()) {
        Some(p) => p,
        None => return runs,
    };
    for para in paragraphs {
        let run_list = match para.get("runs").and_then(|v| v.as_array()) {
            Some(r) => r,
            None => continue,
        };
        for run_val in run_list {
            let text = run_val
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let format = run_val.get("format");
            let font_family = format
                .and_then(|f| f.get("fontFamily"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let font_size = format
                .and_then(|f| f.get("fontSize"))
                .and_then(|v| v.as_f64());
            let font_weight = format
                .and_then(|f| f.get("fontWeight"))
                .and_then(|v| v.as_i64());
            let font_style = format
                .and_then(|f| f.get("fontStyle"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if !text.is_empty() {
                runs.push(RichTextRun {
                    text,
                    font_family,
                    font_size,
                    font_weight,
                    font_style,
                });
            }
        }
        // Add paragraph break as a newline between paragraphs
        runs.push(RichTextRun {
            text: "\n".to_string(),
            font_family: None,
            font_size: None,
            font_weight: None,
            font_style: None,
        });
    }
    runs
}

/// Render a rich text node to PDF content using per-run fallback.
/// WinAnsi-encodable runs get native PDF text (searchable/selectable),
/// others are outlined as vector paths. This is more granular than the
/// all-or-nothing approach that rasterizes the entire node when one
/// span contains non-WinAnsi characters.
fn render_rich_text_to_pdf(
    node: &SceneNode,
    opts: &PdfOptions,
    embedded_fonts: &[EmbeddedFontEntry],
    page_height: f64,
) -> Option<Vec<u8>> {
    let Shape::Text {
        text: _,
        font_size: node_font_size,
        font_family: node_font_family,
        x: text_x,
        y: text_y,
        w: _text_w,
        h: _text_h,
        ..
    } = &node.shape
    else {
        return None;
    };

    let rich_text = match &node.shape {
        Shape::Text { rich_text, .. } => rich_text.as_ref()?,
        _ => return None,
    };

    let runs = parse_rich_text_runs(rich_text);
    if runs.is_empty() {
        return None;
    }

    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];
    let use_cmyk = opts.print_profile.is_some();
    let _color_str = if use_cmyk {
        color_to_cmyk_string(&node.fill, opts.print_profile)
    } else {
        color_to_rgb_string(&node.fill)
    };
    let do_outline = opts.outline_text && (opts.font_data.is_some() || !opts.fonts.is_empty());

    let mut content = Vec::new();
    let mut current_x = *text_x;
    let line_height = node_font_size * 1.2;
    let mut current_y = *text_y;

    for run in &runs {
        if run.text == "\n" {
            current_x = *text_x;
            current_y += line_height;
            continue;
        }

        let run_font_size = run.font_size.unwrap_or(*node_font_size);
        let run_font_family = run.font_family.as_deref().unwrap_or(node_font_family);
        let run_text = &run.text;

        // Per-run approximation: text advances by character count × 0.5 × font_size
        let run_width = run_text.len() as f64 * run_font_size * 0.5;

        // Try native PDF text (WinAnsi-encodable + embedded font available)
        let can_winansi = can_encode_win_ansi(run_text);
        let has_matching_font = embedded_fonts.iter().any(|ef| ef.family == run_font_family);

        if !run_text.is_empty() && can_winansi && has_matching_font {
            if let Some(ef) = embedded_fonts
                .iter()
                .find(|ef| ef.family == run_font_family)
            {
                let asc = get_ascender(opts, run_font_size);
                let pdf_x = current_x + x_off;
                let pdf_y = page_height - current_y - asc - y_off;
                let encoded = encode_win_ansi(run_text);
                let escaped = escape_pdf_string(&String::from_utf8_lossy(&encoded));

                content.extend_from_slice(b"BT\n");
                content.extend(
                    format!(
                        "/{} {} Tf\n1 0 0 1 {:.2} {:.2} Tm\n({}) Tj\nET\n",
                        ef.res_name, run_font_size, pdf_x, pdf_y, escaped
                    )
                    .as_bytes(),
                );
                current_x += run_width;
                continue;
            }
        }

        // Try outlining this run
        if do_outline || !run_text.is_empty() && requires_outline(run_text) {
            if let Some(mut cmd) = try_outline_node(
                node,
                run_text,
                run_font_size,
                run_font_family,
                &current_x,
                &current_y,
                opts,
            ) {
                content.append(&mut cmd);
                current_x += run_width;
                continue;
            }
        }

        // Fallback: rasterize as filled rect (same as existing shape fallback)
        // at the run's position and estimated width
        let fill_color = if use_cmyk {
            color_to_cmyk_string(&node.fill, opts.print_profile)
        } else {
            color_to_rgb_string(&node.fill)
        };
        let asc = get_ascender(opts, run_font_size);
        let pdf_y = page_height - current_y - asc - y_off;
        let pdf_x = current_x + x_off;
        content.extend_from_slice(b"q\n");
        content.extend(fill_color.as_bytes());
        content.extend(b"\n");
        content.extend(
            format!(
                "{:.2} {:.2} {:.2} {:.2} re\nf\n",
                pdf_x, pdf_y, run_width, run_font_size
            )
            .as_bytes(),
        );
        // Comment noting this run was rasterized
        content.extend(
            format!(
                "% raster fallback for non-encodable/non-outlineable run: '{}'\n",
                run_text
            )
            .as_bytes(),
        );
        content.extend_from_slice(b"Q\n");
        current_x += run_width;
    }

    Some(content)
}

/// Export a scene to PDF bytes using lopdf.
///
/// Each shape node becomes a filled path. When `opts.outline_text` is true
/// and `opts.font_data` is `Some`, text nodes are outlined as vector paths
/// instead of filled rectangles. When `opts.subset_fonts` is true, fonts
/// are subsetted to used characters and embedded as font programs, enabling
/// searchable text. The new pipeline respects stacked fills, strokes, and
/// effects.
pub fn export_pdf(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    let mut doc = Document::new();
    let page_id = doc.new_object_id();

    let use_cmyk = opts.print_profile.is_some();

    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");
    // White background
    if use_cmyk {
        content.extend_from_slice(b"0 0 0 0 k\n");
    } else {
        content.extend_from_slice(b"1 1 1 rg\n");
    }
    content.extend_from_slice(
        format!("0 0 {:.2} {:.2} re\nf\n", opts.page_width, opts.page_height).as_bytes(),
    );

    // ── Font subsetting / embedding ─────────────────────────────────────
    let embedded_fonts: Vec<EmbeddedFontEntry> = if opts.subset_fonts && !opts.fonts.is_empty() {
        let family_text = collect_text_per_family(nodes);
        let mut entries: Vec<EmbeddedFontEntry> = Vec::new();

        for (font_idx, (family, font_data)) in opts.fonts.iter().enumerate() {
            // Validate embedding permission
            match validate_embedding_permission(font_data) {
                Ok(perm) => match perm {
                    EmbeddingPermission::Restricted => match opts.embedding_restriction_handling {
                        EmbeddingRestriction::Warn => {
                            eprintln!(
                                "[warning] font '{family}' has Restricted embedding — skipping"
                            );
                            continue;
                        }
                        EmbeddingRestriction::Block => {
                            return Err(format!(
                                "Font '{family}' embedding blocked by license (Restricted)"
                            ));
                        }
                        EmbeddingRestriction::Substitute => {
                            continue;
                        }
                    },
                    EmbeddingPermission::NoSubsetting => {
                        // Embed full font without subsetting
                        let tag = get_subset_tag(family);
                        let sanitized_name: String =
                            family.chars().filter(|c| c.is_alphanumeric()).collect();
                        let base_font = format!("{tag}{sanitized_name}");

                        let entry =
                            embed_font_program(&mut doc, family, &base_font, font_data, font_idx)?;
                        entries.push(entry);
                        continue;
                    }
                    _ => { /* proceed with subsetting */ }
                },
                Err(e) => {
                    eprintln!(
                        "[warning] font '{family}' permission check failed ({e}) — embedding anyway"
                    );
                }
            }

            // Collect used chars for this family
            let used_text = family_text.get(family).map(|s| s.as_str()).unwrap_or("");
            let chars = collect_used_chars(used_text);

            // Subset the font
            let subset_data = if chars.is_empty() {
                font_data.clone()
            } else {
                match subset_font(font_data, &chars) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!(
                            "[warning] failed to subset font '{family}': {e} — embedding full font"
                        );
                        font_data.clone()
                    }
                }
            };

            let tag = get_subset_tag(family);
            let sanitized_name: String = family.chars().filter(|c| c.is_alphanumeric()).collect();
            let base_font = format!("{tag}{sanitized_name}");

            // Embed as WinAnsi font for Latin text
            let entry = embed_font_program(&mut doc, family, &base_font, &subset_data, font_idx)?;
            entries.push(entry);

            // Also embed as CID font for non-WinAnsi text (CJK, Arabic, etc.)
            // if the family text contains non-Latin characters
            let used_text = family_text.get(family).map(|s| s.as_str()).unwrap_or("");
            if has_non_winansi(used_text) {
                let cid_idx = entries.len() + font_idx;
                let cid_entry =
                    embed_cid_font_program(&mut doc, family, &base_font, &subset_data, cid_idx)?;
                entries.push(cid_entry);
            }
        }

        entries
    } else {
        Vec::new()
    };

    let do_outline = opts.outline_text && (opts.font_data.is_some() || !opts.fonts.is_empty());
    // Build a map from family → font entry for quick lookup (also CID variants)
    fn build_font_map(
        entries: &[EmbeddedFontEntry],
    ) -> (
        std::collections::HashMap<String, &EmbeddedFontEntry>,
        std::collections::HashMap<String, &EmbeddedFontEntry>,
    ) {
        let mut winansi_map = std::collections::HashMap::new();
        let mut cid_map = std::collections::HashMap::new();
        for ef in entries {
            if ef.is_cid {
                cid_map.entry(ef.family.clone()).or_insert(ef);
            } else {
                winansi_map.entry(ef.family.clone()).or_insert(ef);
            }
        }
        (winansi_map, cid_map)
    }
    let (font_map, cid_font_map) = build_font_map(&embedded_fonts);
    let _ = font_map;
    let _ = cid_font_map;

    let mut need_bt = false;

    // ── Build content with image rendering support ──────────────────────
    let (image_refs, shading_registry) = {
        let mut image_state = ImageRenderState::new(&mut doc);
        let mut shading_registry = ShadingRegistry::new();

        for node in nodes {
            // Granular rich text fallback: when a node has rich text spans,
            // process each run independently instead of all-or-nothing.
            // Valid runs get native PDF text; non-WinAnsi runs are outlined.
            let is_text_node = matches!(&node.shape, Shape::Text { .. });
            let has_rich_text = matches!(
                &node.shape,
                Shape::Text {
                    rich_text: Some(_),
                    ..
                }
            );

            if is_text_node && has_rich_text {
                // Flush any pending BT first
                if need_bt {
                    content.extend_from_slice(b"ET\n");
                    need_bt = false;
                }
                if let Some(mut rich_content) =
                    render_rich_text_to_pdf(node, opts, &embedded_fonts, opts.page_height)
                {
                    content.append(&mut rich_content);
                    continue;
                }
                // If rich text rendering fails (no runs), fall through to
                // the flat text path below.
            }

            // Try embedded font text rendering (flat text, no rich text)
            if let Shape::Text {
                text,
                font_size,
                font_family,
                x,
                y,
                ..
            } = &node.shape
            {
                let is_non_winansi = requires_outline(text);

                if !text.is_empty() && !embedded_fonts.is_empty() {
                    // Try WinAnsi font for Latin text
                    if !is_non_winansi && can_encode_win_ansi(text) {
                        if let Some(ef) = embedded_fonts
                            .iter()
                            .find(|ef| ef.family == *font_family && !ef.is_cid)
                        {
                            let tx = node.transform.as_coeffs();
                            let x_off = tx[4];
                            let y_off = tx[5];

                            let asc = font_ascender(
                                opts.fonts
                                    .iter()
                                    .find(|(n, _)| n == font_family)
                                    .map(|(_, d)| d.as_slice())
                                    .unwrap_or_default(),
                                *font_size,
                            );

                            let pdf_x = x + x_off;
                            let pdf_y = opts.page_height - y - asc - y_off;

                            if !need_bt {
                                content.extend_from_slice(b"BT\n");
                                need_bt = true;
                            }
                            // Use TJ array with kerning when font binary is available
                            let font_data_ref = opts
                                .fonts
                                .iter()
                                .find(|(n, _)| n == font_family)
                                .map(|(_, d)| d.as_slice());
                            let tj_str = match font_data_ref {
                                Some(fd) => build_tj_array(text, fd, *font_size, 0),
                                None => {
                                    let encoded = encode_win_ansi(text);
                                    let escaped =
                                        escape_pdf_string(&String::from_utf8_lossy(&encoded));
                                    format!("({}) Tj", escaped)
                                }
                            };
                            content.extend(
                                format!(
                                    "/{} {} Tf\n1 0 0 1 {:.2} {:.2} Tm\n{}\n",
                                    ef.res_name, font_size, pdf_x, pdf_y, tj_str
                                )
                                .as_bytes(),
                            );
                            continue;
                        }
                    }

                    // Try CID font for non-WinAnsi text (CJK, Arabic, Hebrew, etc.)
                    if is_non_winansi {
                        if let Some(ef) = embedded_fonts
                            .iter()
                            .find(|ef| ef.family == *font_family && ef.is_cid)
                        {
                            let tx = node.transform.as_coeffs();
                            let x_off = tx[4];
                            let y_off = tx[5];

                            let asc = font_ascender(
                                opts.fonts
                                    .iter()
                                    .find(|(n, _)| n == font_family)
                                    .map(|(_, d)| d.as_slice())
                                    .unwrap_or_default(),
                                *font_size,
                            );

                            let pdf_x = x + x_off;
                            let pdf_y = opts.page_height - y - asc - y_off;

                            // Emit as CID-keyed text with hex string encoding
                            // Each character becomes a 2-byte hex CID
                            let hex_cids: String = text
                                .chars()
                                .map(|c| format!("{:04X}", c as u32))
                                .collect::<Vec<_>>()
                                .join("");

                            if !need_bt {
                                content.extend_from_slice(b"BT\n");
                                need_bt = true;
                            }
                            content.extend(
                                format!(
                                    "/{} {} Tf\n1 0 0 1 {:.2} {:.2} Tm\n<{}> Tj\n",
                                    ef.res_name, font_size, pdf_x, pdf_y, hex_cids
                                )
                                .as_bytes(),
                            );
                            continue;
                        }
                    }
                }
            }

            // Flush BT if we were in text mode
            if need_bt {
                content.extend_from_slice(b"ET\n");
                need_bt = false;
            }

            // Try outline mode — or forced outline for non-WinAnsi text
            // (Arabic, Hebrew, CJK cannot be encoded in WinAnsiEncoding and MUST
            // be outlined even when opts.outline_text is false).
            if do_outline || shape_text(node).is_some_and(|t| !t.is_empty() && requires_outline(t))
            {
                if let Shape::Text {
                    text,
                    font_size,
                    font_family,
                    x,
                    y,
                    ..
                } = &node.shape
                {
                    if !text.is_empty() {
                        let outlined =
                            try_outline_node(node, text, *font_size, font_family, x, y, opts);
                        if let Some(mut cmd) = outlined {
                            content.append(&mut cmd);
                            continue;
                        }
                    }
                }
            }
            // New pipeline: effects + fills + strokes
            content.extend_from_slice(b"q\n");
            let effects = render_effects(node, opts.page_height, use_cmyk, opts.print_profile);
            content.extend(&effects);
            let fills = render_fills(
                node,
                opts.page_height,
                use_cmyk,
                Some(&mut image_state),
                opts.manifest.as_ref(),
                opts.print_profile,
                Some(&mut shading_registry),
                opts.lossy,
            );
            content.extend(&fills);
            let strokes = render_strokes(node, opts.page_height, use_cmyk, opts.print_profile);
            content.extend(&strokes);
            content.extend_from_slice(b"Q\n");
        }

        (std::mem::take(&mut image_state.refs), shading_registry)
    };

    if need_bt {
        content.extend_from_slice(b"ET\n");
    }
    content.extend_from_slice(b"Q\n");

    let content_stream = Stream::new(dictionary! {}, content);
    let content_id = doc.new_object_id();
    doc.objects
        .insert(content_id, Object::Stream(content_stream));

    // Font resources
    let font_dict = if embedded_fonts.is_empty() {
        dictionary! {
            "F1" => dictionary! {
                "Type" => "Font",
                "Subtype" => "Type1",
                "BaseFont" => "Helvetica",
            },
        }
    } else {
        let mut fd = lopdf::Dictionary::new();
        for ef in &embedded_fonts {
            fd.set(ef.res_name.as_bytes(), Object::Reference(ef.dict_id));
        }
        fd
    };
    let mut resources = dictionary! {
        "Font" => font_dict,
    };
    if !image_refs.is_empty() {
        let mut xdict = lopdf::Dictionary::new();
        let mut gs_dict = lopdf::Dictionary::new();
        for (name, ref_obj) in &image_refs {
            let is_ext_gs = match ref_obj {
                Object::Dictionary(d) => {
                    d.get(b"Type").ok().and_then(|o| o.as_name().ok()) == Some(b"ExtGState")
                }
                _ => false,
            };
            if is_ext_gs {
                gs_dict.set(name.as_bytes(), ref_obj.clone());
            } else {
                xdict.set(name.as_bytes(), ref_obj.clone());
            }
        }
        resources.set("XObject", xdict);
        if !gs_dict.is_empty() {
            resources.set("ExtGState", gs_dict);
        }
    }
    let shading_resources = shading_registry.create_pdf_objects(&mut doc);
    if !shading_resources.is_empty() {
        let mut sdict = lopdf::Dictionary::new();
        for (name, obj_id) in &shading_resources {
            sdict.set(name.as_bytes(), Object::Reference(*obj_id));
        }
        resources.set("Shading", sdict);
    }

    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let page = dictionary! {
        "Type" => "Page",
        "MediaBox" => vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(opts.page_width as f32),
            Object::Real(opts.page_height as f32),
        ],
        "Contents" => Object::Reference(content_id),
        "Resources" => resources,
        "Parent" => Object::Reference(pages_id),
    };
    doc.objects.insert(page_id, Object::Dictionary(page));

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => Object::Integer(1),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));

    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc.version = "1.4".to_string();
    doc.compress();

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("PDF save failed: {e}"))?;
    Ok(output)
}

/// Try to outline a text node. Returns Some(bytes) on success, None on fallback.
fn try_outline_node(
    node: &SceneNode,
    text: &str,
    font_size: f64,
    font_family: &str,
    x: &f64,
    y: &f64,
    opts: &PdfOptions,
) -> Option<Vec<u8>> {
    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];
    let use_cmyk = opts.print_profile.is_some();
    let color_str = if use_cmyk {
        color_to_cmyk_string(&node.fill, opts.print_profile)
    } else {
        color_to_rgb_string(&node.fill)
    };

    // Try multi-font lookup first
    let glyphs = if !opts.fonts.is_empty() {
        outline_text_multi(&opts.fonts, font_family, text, font_size).ok()
    } else {
        None
    };

    // Fall back to single font
    let glyphs = glyphs.or_else(|| {
        opts.font_data.as_ref().and_then(|fd| {
            outline_text(fd, text, font_size)
                .ok()
                .filter(|g| !g.is_empty())
        })
    })?;

    if glyphs.is_empty() {
        return None;
    }

    let ascender = get_ascender(opts, font_size);
    let y_base = y + ascender;
    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");

    // Drop shadow for text
    let shadow = render_effects(node, opts.page_height, use_cmyk, opts.print_profile);
    content.extend(&shadow);

    for glyph in &glyphs {
        let cmd = glyph_outline_to_pdf(
            glyph,
            &color_str,
            x + x_off,
            y_base + y_off,
            opts.page_height,
        );
        content.extend_from_slice(&cmd);
    }
    content.extend_from_slice(b"Q\n");
    Some(content)
}

/// Get ascender for font data.
fn get_ascender(opts: &PdfOptions, font_size: f64) -> f64 {
    // Try multi-font first
    if let Some(fd) = opts.fonts.first().map(|(_, d)| d.clone()) {
        if let Ok(font) = ab_glyph::FontArc::try_from_vec(fd) {
            let scale = font_size / font.units_per_em().unwrap_or(1000.0) as f64;
            return font.ascent_unscaled() as f64 * scale;
        }
    }
    // Fall back to single font
    if let Some(ref fd) = opts.font_data {
        if let Ok(font) = ab_glyph::FontArc::try_from_vec(fd.clone()) {
            let scale = font_size / font.units_per_em().unwrap_or(1000.0) as f64;
            return font.ascent_unscaled() as f64 * scale;
        }
    }
    font_size * 0.8
}

#[cfg(test)]
mod tests {
    use super::*;
    use varve_core::scene::FillPerspective;
    use varve_core::{
        Affine, BlendMode, Circle, EngineColor, FillIR, GradientStop, Point, Rect, Stroke,
    };

    // ── Helpers ────────────────────────────────────────────────────────

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: varve_core::NodeId(id),
            name: format!("r{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
            fill: EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        }
    }

    fn text_node(id: u64, x: f64, y: f64, text: &str, font_size: f64) -> SceneNode {
        SceneNode {
            id: varve_core::NodeId(id),
            name: format!("t{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Text {
                text: text.into(),
                font_size,
                font_family: "DejaVu Sans".into(),
                font_weight: 400,
                font_style: "normal".into(),
                text_align: "left".into(),
                text_align_vertical: None,
                x: 0.0,
                y: 0.0,
                w: font_size * text.len() as f64 * 0.6,
                h: font_size * 1.2,
                letter_spacing: None,
                line_height: None,
                paragraph_spacing: None,
                text_case: None,
                text_decoration: None,
                text_overflow: None,
                list_style: None,
                rich_text: None,
                open_type_features: None,
                variable_axes: None,
                text_mode: None,
                path_text_settings: None,
                path_shape: None,
            },
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        }
    }

    fn test_font_data() -> Vec<u8> {
        crate::test_fonts::test_font_bytes().to_vec()
    }

    fn solid_fill(r: u8, g: u8, b: u8, a: u8, visible: bool) -> FillIR {
        FillIR::Solid {
            color: EngineColor::Rgb {
                r: r as f64,
                g: g as f64,
                b: b as f64,
                a: a as f64,
                bit_depth: None,
                profile: None,
            },
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible,
        }
    }

    fn gradient_fill(visible: bool) -> FillIR {
        FillIR::Gradient {
            gradient_type: "linear".into(),
            stops: vec![
                GradientStop {
                    position: 0.0,
                    color: EngineColor::Rgb {
                        r: 255.0,
                        g: 0.0,
                        b: 0.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    midpoint: None,
                },
                GradientStop {
                    position: 1.0,
                    color: EngineColor::Rgb {
                        r: 0.0,
                        g: 0.0,
                        b: 255.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    midpoint: None,
                },
            ],
            rotation: 0.0,
            interpolation_space: None,
            hue_interpolation: None,
            transform: None,
            tiling_mode: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible,
        }
    }

    // ── shape_path_operators tests ─────────────────────────────────────

    #[test]
    fn path_ops_rect() {
        let node = rect_node(1, 10.0, 20.0, 100.0, 50.0);
        let ops = shape_path_operators(&node, 200.0);
        let s = String::from_utf8_lossy(&ops);
        assert!(s.contains("re"), "rect should have 're' operator");
        assert!(s.ends_with("re\n"), "should end with re");
    }

    #[test]
    fn path_ops_circle() {
        let node = SceneNode {
            id: varve_core::NodeId(1),
            name: "c".into(),
            transform: Affine::translate((50.0, 50.0)),
            shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 30.0)),
            fill: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        };
        let ops = shape_path_operators(&node, 100.0);
        let s = String::from_utf8_lossy(&ops);
        assert!(s.contains("arc"), "circle should have 'arc' operator");
    }

    #[test]
    fn path_ops_path_no_fill_stroke() {
        let node = SceneNode {
            id: varve_core::NodeId(1),
            name: "p".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Path {
                points: vec![
                    varve_core::PathPoint {
                        x: 0.0,
                        y: 0.0,
                        handle_in: None,
                        handle_out: None,
                    },
                    varve_core::PathPoint {
                        x: 100.0,
                        y: 100.0,
                        handle_in: None,
                        handle_out: None,
                    },
                ],
                closed: false,
                tolerance: 1.0,
                holes: vec![],
                fill_rule: None,
            },
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        };
        let ops = shape_path_operators(&node, 100.0);
        let s = String::from_utf8_lossy(&ops);
        assert!(s.contains("m\n"), "path should have moveto");
        assert!(s.contains("l\n"), "path should have lineto");
        assert!(!s.contains("f"), "path ops should NOT contain fill");
        assert!(!s.contains("S"), "path ops should NOT contain stroke");
        assert!(!s.contains("rg"), "path ops should NOT contain color");
    }

    #[test]
    fn path_ops_empty_path() {
        let node = SceneNode {
            id: varve_core::NodeId(1),
            name: "e".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Path {
                points: vec![],
                closed: false,
                tolerance: 1.0,
                holes: vec![],
                fill_rule: None,
            },
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        };
        let ops = shape_path_operators(&node, 100.0);
        assert!(ops.is_empty(), "empty path should produce empty ops");
    }

    // ── render_fills tests ─────────────────────────────────────────────

    #[test]
    fn render_fills_solid() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![solid_fill(255, 0, 0, 255, true)]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "should contain RGB color");
        assert!(s.contains("f\n"), "should contain fill operator");
        assert!(s.contains("re\n"), "should contain path");
    }

    #[test]
    fn render_fills_gradient() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![gradient_fill(true)]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "gradient approximated as solid");
        assert!(s.contains("f\n"), "should fill");
    }

    #[test]
    fn render_fills_spot_color_separation() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let spot = EngineColor::Spot {
            name: "PANTONE 185 C".into(),
            tint: 80.0,
            a: 255.0,
            process_fallback: Some(varve_core::CmykFallback {
                c: 0.0,
                m: 91.0,
                y: 76.0,
                k: 0.0,
            }),
        };
        node.fills = Some(vec![FillIR::Solid {
            color: spot,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("/Separation"),
            "spot color should emit /Separation color space: {s}"
        );
        assert!(
            s.contains("PANTONE 185 C"),
            "spot color name should appear in separation: {s}"
        );
    }

    #[test]
    fn render_fills_gradient_emits_shading() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![gradient_fill(true)]);
        let mut registry = ShadingRegistry::new();
        let result = render_fills(
            &node,
            100.0,
            false,
            None,
            None,
            None,
            Some(&mut registry),
            false,
        );
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("/Sh1 sh"),
            "should emit shading operator for gradient"
        );
        assert!(s.contains("W n"), "should clip to path before shading");
        assert_eq!(
            registry.definitions.len(),
            1,
            "should have one gradient definition"
        );
    }

    #[test]
    fn render_fills_fallback() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        // Default fill is teal: 57, 208, 198
        assert!(s.contains("0.224"), "should contain R component of teal");
        assert!(s.contains("0.816"), "should contain G component of teal");
        assert!(s.contains("f\n"), "should fill");
    }

    #[test]
    fn render_fills_multi() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![
            solid_fill(255, 0, 0, 255, true),
            solid_fill(0, 255, 0, 255, true),
        ]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("1.000 0.000 0.000 rg"), "first fill red");
        assert!(s.contains("0.000 1.000 0.000 rg"), "second fill green");
        // Should render both fills
        let count = s.matches("f\n").count();
        assert_eq!(count, 2, "should fill twice for two fills");
    }

    #[test]
    fn render_fills_opacity() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Solid {
            color: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            opacity: 0.5,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("opacity=0.500"), "should emit opacity comment");
    }

    #[test]
    fn render_fills_invisible() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![solid_fill(255, 0, 0, 255, false)]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(!s.contains("rg"), "invisible fill should not render");
    }

    #[test]
    fn render_fills_image_not_rendered_as_solid_black() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Image {
            src: "data:image/png;base64,AAAA".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: None,
            image_height: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(
            !s.contains("0 0 0 rg") && !s.contains("f\n"),
            "image fill has no PDF XObject pipeline yet and must not silently \
             paint a solid color in its place: {s}"
        );
        assert!(
            s.contains("not rendered"),
            "should explicitly note the unsupported image fill: {s}"
        );
    }

    #[test]
    fn render_fills_pattern_renders_gray_fallback_without_manifest() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Pattern {
            tile_src: "data:image/png;base64,AAAA".into(),
            spacing: 0.0,
            rotation: 0.0,
            image_width: None,
            image_height: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("0.75 0.75 0.75 rg"),
            "pattern without manifest should fallback to gray fill: {s}"
        );
        assert!(
            s.contains("WARNING"),
            "should include a warning comment: {s}"
        );
    }

    #[test]
    fn render_fills_pattern_honours_dimension_overrides_fallback() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Pattern {
            tile_src: "tile.png".into(),
            spacing: 4.0,
            rotation: 45.0,
            image_width: Some(64.0),
            image_height: Some(48.0),
            opacity: 0.75,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("0.75 0.75 0.75 rg"),
            "should fallback to gray: {s}"
        );
        assert!(s.contains("WARNING"), "should include warning: {s}");
        assert!(
            s.contains("pattern opacity=0.750"),
            "should include opacity: {s}"
        );
    }

    #[test]
    fn render_fills_pattern_embeds_raster_tile() {
        use crate::resources::{ExportManifest, ImageResource, PatternResource};

        let manifest = ExportManifest {
            images: vec![ImageResource {
                id: "tile_0".into(),
                src: None,
                mime_type: "image/png".into(),
                width: 32,
                height: 32,
                data: vec![200u8; 32 * 32 * 4],
                color_space: resources::ColorSpace::Rgb,
            }],
            patterns: vec![PatternResource {
                id: "pat_0".into(),
                tile_image_id: "tile_0".into(),
                spacing: 5.0,
                rotation: 0.0,
                tile_width: 32.0,
                tile_height: 32.0,
            }],
        };

        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Pattern {
            tile_src: "pat_0".into(),
            spacing: 5.0,
            rotation: 0.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);

        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let content = render_fills(
            &node,
            800.0,
            false,
            Some(&mut state),
            Some(&manifest),
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&content);
        assert!(
            s.contains("/Pat"),
            "should contain pattern XObject reference: {s}"
        );
        assert!(s.contains("Do"), "should contain Do operator: {s}");
        assert!(
            !s.contains("0.8 0.85 0.9"),
            "should NOT contain placeholder light blue: {s}"
        );
        assert!(
            !s.contains("0.75 0.75 0.75 rg"),
            "should NOT contain fallback gray: {s}"
        );
        assert_eq!(state.refs.len(), 1, "should have 1 pattern image reference");
    }

    #[test]
    fn render_fills_pattern_falls_back_to_gray_without_manifest() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Pattern {
            tile_src: "pat_0".into(),
            spacing: 5.0,
            rotation: 0.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);

        let content = render_fills(&node, 800.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&content);
        assert!(
            s.contains("0.75 0.75 0.75 rg"),
            "should fallback to gray: {s}"
        );
        assert!(s.contains("WARNING"), "should include warning comment: {s}");
    }

    #[test]
    fn render_fills_pattern_missing_tile_in_manifest_falls_back() {
        use crate::resources::{ExportManifest, ImageResource, PatternResource};

        let manifest = ExportManifest {
            images: vec![ImageResource {
                id: "other_tile".into(),
                src: None,
                mime_type: "image/png".into(),
                width: 16,
                height: 16,
                data: vec![128u8; 16 * 16 * 4],
                color_space: resources::ColorSpace::Rgb,
            }],
            patterns: vec![PatternResource {
                id: "pat_missing".into(),
                tile_image_id: "other_tile".into(),
                spacing: 0.0,
                rotation: 0.0,
                tile_width: 16.0,
                tile_height: 16.0,
            }],
        };

        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Pattern {
            tile_src: "nonexistent_pat".into(),
            spacing: 0.0,
            rotation: 0.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);

        let content = render_fills(
            &node,
            800.0,
            false,
            None,
            Some(&manifest),
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&content);
        assert!(
            s.contains("0.75 0.75 0.75 rg"),
            "missing pattern should fallback to gray: {s}"
        );
        assert!(s.contains("WARNING"), "should warn about missing tile: {s}");
    }

    #[test]
    fn render_fills_pattern_with_rotation() {
        use crate::resources::{ExportManifest, ImageResource, PatternResource};

        let manifest = ExportManifest {
            images: vec![ImageResource {
                id: "tile_r".into(),
                src: None,
                mime_type: "image/png".into(),
                width: 16,
                height: 16,
                data: vec![255u8; 16 * 16 * 4],
                color_space: resources::ColorSpace::Rgb,
            }],
            patterns: vec![PatternResource {
                id: "pat_r".into(),
                tile_image_id: "tile_r".into(),
                spacing: 2.0,
                rotation: 45.0,
                tile_width: 16.0,
                tile_height: 16.0,
            }],
        };

        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Pattern {
            tile_src: "pat_r".into(),
            spacing: 2.0,
            rotation: 45.0,
            image_width: Some(16.0),
            image_height: Some(16.0),
            opacity: 0.8,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);

        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let content = render_fills(
            &node,
            800.0,
            false,
            Some(&mut state),
            Some(&manifest),
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&content);
        assert!(s.contains("/Pat"), "should contain pattern XObject: {s}");
        assert!(
            s.contains("pattern opacity=0.800"),
            "should include opacity comment: {s}"
        );
    }

    #[test]
    fn render_fills_empty_fills_fallsback() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![]);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "empty fills should fallback");
    }

    #[test]
    fn render_fills_none_fallsback() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "None fills should fallback to fill");
    }

    // ── render_fills image fill tests ──────────────────────────────────

    #[test]
    fn pdf_image_placement_matches_canvas_fit_policies() {
        assert_eq!(
            compute_pdf_image_placement("fill", 200.0, 100.0, 100.0, 100.0, 1.0),
            (200.0, 100.0, -50.0, 0.0),
            "fill is cover"
        );
        assert_eq!(
            compute_pdf_image_placement("fit", 200.0, 100.0, 100.0, 100.0, 2.0),
            (200.0, 100.0, -50.0, 0.0),
            "fit policy result is multiplied by user scale"
        );
        assert_eq!(
            compute_pdf_image_placement("crop", 200.0, 100.0, 100.0, 100.0, 0.5),
            (100.0, 50.0, 0.0, 0.0),
            "crop is natural size times scale at the bounds origin"
        );
        assert_eq!(
            compute_pdf_image_placement("stretch", 200.0, 100.0, 80.0, 60.0, 3.0),
            (80.0, 60.0, 0.0, 0.0),
            "stretch intentionally ignores uniform content scale"
        );
    }

    fn image_fill_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        let mut node = rect_node(id, x, y, w, h);
        node.fills = Some(vec![FillIR::Image {
            src: "data:image/png;base64,AAAA".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]);
        node
    }

    fn image_manifest(src: &str, width: u32, height: u32) -> resources::ExportManifest {
        resources::ExportManifest {
            images: vec![resources::ImageResource {
                id: "image".into(),
                src: Some(src.into()),
                mime_type: "image/png".into(),
                width,
                height,
                data: vec![180; (width * height * 4) as usize],
                color_space: resources::ColorSpace::Rgb,
            }],
            patterns: Vec::new(),
        }
    }

    #[test]
    fn render_fills_image_perspective_subdivides_into_pdf_triangles() {
        let mut node = image_fill_node(1, 0.0, 0.0, 100.0, 80.0);
        node.fills = Some(vec![FillIR::Image {
            src: "perspective-src".into(),
            fit: "stretch".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 0.8,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: Some(FillPerspective {
                quad: [[0.0, 0.0], [100.0, 8.0], [92.0, 80.0], [0.0, 72.0]],
            }),
        }]);
        let manifest = image_manifest("perspective-src", 32, 32);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            200.0,
            false,
            Some(&mut state),
            Some(&manifest),
            None,
            None,
            false,
        );
        let content = String::from_utf8_lossy(&result);
        assert_eq!(
            state
                .refs
                .iter()
                .filter(|(name, _)| name.starts_with("Im"))
                .count(),
            1,
            "perspective reuses one image XObject"
        );
        assert_eq!(
            content.matches("/Im0 Do").count(),
            PERSPECTIVE_GRID * PERSPECTIVE_GRID * 2
        );
        assert!(content.matches("cm").count() >= PERSPECTIVE_GRID * PERSPECTIVE_GRID * 2);
        assert!(
            content.contains("/GS800 gs"),
            "per-fill opacity should remain applied"
        );
        assert!(!content.contains("image fill not rendered"));
    }

    #[test]
    fn render_fills_image_with_document_renders_xobject() {
        let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            100.0,
            false,
            Some(&mut state),
            None,
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("/Im0 Do"),
            "image fill should emit Do operator for embedded XObject: {s}"
        );
        assert!(
            s.contains("cm"),
            "image fill should emit transformation matrix: {s}"
        );
        // Check that the image XObject was embedded
        assert_eq!(state.refs.len(), 1, "should have 1 image reference");
        assert_eq!(state.counter, 1, "counter should be 1");
    }

    #[test]
    fn render_fills_image_crop_transform_uses_full_source_geometry() {
        let mut node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Image {
            src: "image-src".into(),
            fit: "fill".into(),
            x: 10.0,
            y: -5.0,
            scale: 1.25,
            image_width: Some(200.0),
            image_height: Some(100.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: Some(varve_core::scene::CropRect {
                x: 50.0,
                y: 25.0,
                w: 100.0,
                h: 50.0,
            }),
            rotation: Some(90.0),
            flip_h: Some(true),
            flip_v: None,
            perspective: None,
        }]);
        let manifest = image_manifest("image-src", 200, 100);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            200.0,
            false,
            Some(&mut state),
            Some(&manifest),
            None,
            None,
            false,
        );
        let content = String::from_utf8_lossy(&result);

        assert!(
            content.contains("0.0000 250.0000 125.0000 0.0000 -2.5000 30.0000 cm"),
            "image matrix must include fill offset, post-policy scale, rotation, and flip around the full draw rect: {content}"
        );
        assert_eq!(
            content.matches("h W n").count(),
            2,
            "object clip and proportional transformed source-crop clip must both be present: {content}"
        );
        assert!(
            !content.contains("250.0000 0 0 125.0000"),
            "crop must not be stretched/refit as a standalone image: {content}"
        );

        let image_ref = match &state.refs[0].1 {
            Object::Reference(object_id) => *object_id,
            other => panic!("expected image reference, got {other:?}"),
        };
        let image = state.doc.get_object(image_ref).expect("embedded image");
        let Object::Stream(stream) = image else {
            panic!("image XObject should be a stream");
        };
        assert!(
            stream.dict.get(b"SMask").is_ok(),
            "RGBA alpha must remain attached to the same transformed full-source XObject"
        );
    }

    #[test]
    fn render_fills_image_uses_complete_object_affine() {
        let mut node = image_fill_node(1, 0.0, 0.0, 100.0, 80.0);
        node.transform = Affine::new([2.0, 0.5, 0.25, 1.5, 30.0, 40.0]);
        node.fills = Some(vec![FillIR::Image {
            src: "affine-src".into(),
            fit: "stretch".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: Some(100.0),
            image_height: Some(80.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]);
        let manifest = image_manifest("affine-src", 100, 80);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            200.0,
            false,
            Some(&mut state),
            Some(&manifest),
            None,
            None,
            false,
        );
        let content = String::from_utf8_lossy(&result);

        assert!(
            content.contains("200.0000 -50.0000 -20.0000 120.0000 50.0000 40.0000 cm"),
            "image XObject matrix must retain object scale and skew: {content}"
        );
        assert!(
            content.contains("30.0000 160.0000 m")
                && content.contains("230.0000 110.0000 l")
                && content.contains("250.0000 -10.0000 l")
                && content.contains("50.0000 40.0000 l"),
            "object clip must use all four transformed bounds corners: {content}"
        );
        assert_eq!(
            shape_pdf_bounds(&node, 200.0),
            (30.0, -10.0, 220.0, 170.0),
            "transformed export bounds must include the full affine"
        );
    }

    #[test]
    fn render_fills_image_without_document_compat() {
        // Without a document, image fills should still emit the "not rendered" comment
        let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false, None, None, None, None, false);
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("not rendered"),
            "image fill without doc should note not rendered: {s}"
        );
        assert!(
            !s.contains("Do"),
            "image fill without doc should not emit Do: {s}"
        );
    }

    #[test]
    fn render_fills_image_nonrect_clips() {
        // A circle node with an image fill should emit a clip path (W n)
        let node = SceneNode {
            id: varve_core::NodeId(1),
            name: "circle-img".into(),
            transform: varve_core::Affine::translate((50.0, 50.0)),
            shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 40.0)),
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: Some(vec![FillIR::Image {
                src: "data:image/png;base64,AAAA".into(),
                fit: "fill".into(),
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                image_width: Some(32.0),
                image_height: Some(32.0),
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                visible: true,
                alpha_mask: None,
                crop: None,
                rotation: None,
                flip_h: None,
                flip_v: None,
                perspective: None,
            }]),
            corner_radius: None,
            filters: None,
        };
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            100.0,
            false,
            Some(&mut state),
            None,
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("W n"),
            "non-rect image fill should emit clip path (W n): {s}"
        );
        assert!(
            s.contains("/Im0 Do"),
            "non-rect image fill should still emit Do: {s}"
        );
    }

    #[test]
    fn render_fills_image_with_opacity() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![FillIR::Image {
            src: "data:image/png;base64,AAAA".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 0.5,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            100.0,
            false,
            Some(&mut state),
            None,
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("GS500 gs"),
            "image fill with opacity 0.5 should emit GS500 gs (ExtGState): {s}"
        );
        assert!(
            s.contains("/Im0 Do"),
            "image fill with opacity should still emit Do: {s}"
        );
    }

    #[test]
    fn export_pdf_with_image_fill() {
        let node = image_fill_node(1, 10.0, 10.0, 100.0, 100.0);
        let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf with image fill");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
        assert!(
            bytes.len() > 300,
            "PDF with image fill should have meaningful content"
        );
    }

    #[test]
    fn render_fills_image_multiple_fills_mixed() {
        // Stacked fill: solid + image + solid — all should render
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![
            FillIR::Solid {
                color: EngineColor::Rgb {
                    r: 255.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                },
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                visible: true,
            },
            FillIR::Image {
                src: "data:image/png;base64,AAAA".into(),
                fit: "fill".into(),
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                image_width: Some(32.0),
                image_height: Some(32.0),
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                visible: true,
                alpha_mask: None,
                crop: None,
                rotation: None,
                flip_h: None,
                flip_v: None,
                perspective: None,
            },
        ]);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            100.0,
            false,
            Some(&mut state),
            None,
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "should have solid fill color");
        assert!(s.contains("/Im0 Do"), "should have image Do operator");
        assert_eq!(state.refs.len(), 1, "one image reference");
    }

    #[test]
    fn render_fills_image_uses_cmyk_comment() {
        let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(
            &node,
            100.0,
            true,
            Some(&mut state),
            None,
            None,
            None,
            false,
        );
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("CMYK conversion not yet implemented"),
            "CMYK mode should emit conversion comment: {s}"
        );
        assert!(s.contains("/Im0 Do"), "CMYK mode should still emit Do: {s}");
    }

    // ── render_strokes tests ───────────────────────────────────────────

    fn node_with_stroke(stroke: Stroke) -> SceneNode {
        SceneNode {
            id: varve_core::NodeId(1),
            name: "s".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: vec![stroke],
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        }
    }

    #[test]
    fn render_strokes_width() {
        let stroke = Stroke {
            weight: 5.0,
            visible: true,
            ..Default::default()
        };
        let node = node_with_stroke(stroke);
        let result = render_strokes(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("5.00 w"), "should set line width to 5");
        assert!(s.contains("S\n"), "should stroke");
    }

    #[test]
    fn render_strokes_cap() {
        let stroke = Stroke {
            cap: "round".into(),
            visible: true,
            ..Default::default()
        };
        let node = node_with_stroke(stroke);
        let result = render_strokes(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("1 J"), "round cap = 1");
    }

    #[test]
    fn render_strokes_join() {
        let stroke = Stroke {
            join: "bevel".into(),
            visible: true,
            ..Default::default()
        };
        let node = node_with_stroke(stroke);
        let result = render_strokes(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("2 j"), "bevel join = 2");
    }

    #[test]
    fn render_strokes_dash() {
        let stroke = Stroke {
            dash_pattern: vec![4.0, 2.0],
            dash_offset: 1.0,
            visible: true,
            ..Default::default()
        };
        let node = node_with_stroke(stroke);
        let result = render_strokes(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("["), "dash pattern should have bracket");
        assert!(s.contains("d\n"), "should set dash");
    }

    #[test]
    fn render_strokes_invisible() {
        let stroke = Stroke {
            visible: false,
            ..Default::default()
        };
        let node = node_with_stroke(stroke);
        let result = render_strokes(&node, 100.0, false, None);
        assert!(
            result.is_empty(),
            "invisible stroke should produce no output"
        );
    }

    #[test]
    fn render_strokes_empty() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_strokes(&node, 100.0, false, None);
        assert!(result.is_empty(), "no strokes should produce no output");
    }

    // ── render_effects tests ───────────────────────────────────────────

    #[test]
    fn render_effects_dropshadow() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.effects = vec![Effect::DropShadow {
            id: None,
            x: 5.0,
            y: 5.0,
            blur: 2.0,
            spread: 0.0,
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            opacity: 0.5,
            blend_mode: BlendMode::Normal,
            visible: true,
        }];
        let result = render_effects(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("cm"), "shadow should use translation matrix");
        assert!(s.contains("0.000 0.000 0.000 rg"), "shadow should be black");
        assert!(s.contains("f\n"), "shadow should be filled");
    }

    #[test]
    fn render_effects_no_effects() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_effects(&node, 100.0, false, None);
        assert!(result.is_empty(), "no effects should produce no output");
    }

    #[test]
    fn render_effects_adjustment_filters_commented() {
        // A nondestructive adjustment stack (halftone, curves, etc.) has no
        // Rust-side renderer. It must be surfaced as an honest PDF comment
        // rather than silently vanishing from print export.
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.filters = Some(vec![serde_json::json!({ "kind": "halftone" })]);
        let result = render_effects(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("nondestructive adjustment stack"),
            "adjustment/filter stack should be honestly flagged as unrendered, got: {s}"
        );
    }

    #[test]
    fn render_effects_empty_filters_produce_no_output() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.filters = Some(vec![]);
        let result = render_effects(&node, 100.0, false, None);
        assert!(
            result.is_empty(),
            "an empty filters array should not produce a spurious comment"
        );
    }

    #[test]
    fn render_effects_inner_shadow_commented() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.effects = vec![Effect::InnerShadow {
            id: None,
            x: 2.0,
            y: 2.0,
            blur: 1.0,
            spread: 0.0,
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            opacity: 0.5,
            blend_mode: BlendMode::Normal,
            visible: true,
        }];
        let result = render_effects(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("innerShadow"), "should have comment");
    }

    #[test]
    fn render_effects_depth_blur_commented() {
        // Depth blur relies on an image-space resource unavailable to the
        // vector PDF renderer. Export must acknowledge that limitation rather
        // than silently omitting a visible effect.
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.effects = vec![Effect::DepthBlur {
            id: Some("depth-blur-1".into()),
            depth_map_id: "depth-map-1".into(),
            depth_map: None,
            focus_depth: 0.5,
            focus_range: 0.2,
            blur_strength: 12.0,
            falloff: 1.0,
            invert: false,
            edge_protection: 0.035,
            visible: true,
        }];
        let result = render_effects(&node, 100.0, false, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("depthBlur depthMapId=depth-map-1"), "got: {s}");
        assert!(s.contains("not rendered in basic PDF"), "got: {s}");
    }

    // ── embed_image tests ──────────────────────────────────────────────

    #[test]
    fn embed_image_creates_xobject() {
        let mut doc = Document::new();
        let w = 2u32;
        let h = 2u32;
        let data = vec![255u8, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]; // 4 RGB pixels
        let result = embed_image(&mut doc, &data, w, h);
        assert!(result.is_ok(), "should embed successfully");
        let obj = result.unwrap();
        // Should be a reference to an object
        match obj {
            Object::Reference(_) => {} // correct
            _ => panic!("should return a Reference"),
        }
    }

    #[test]
    fn embed_image_short_data() {
        let mut doc = Document::new();
        let result = embed_image(&mut doc, &[0u8; 2], 10, 10);
        assert!(result.is_err(), "should fail on short data");
    }

    #[test]
    fn embed_image_document_has_stream() {
        let mut doc = Document::new();
        let data = vec![128u8; 3 * 4 * 4]; // 4x4 RGB
        let obj = embed_image(&mut doc, &data, 4, 4).unwrap();
        if let Object::Reference(id) = obj {
            let stored = doc.objects.get(&id).expect("object should exist");
            match stored {
                Object::Stream(s) => {
                    assert_eq!(
                        s.dict
                            .get(b"Subtype")
                            .ok()
                            .and_then(|o| o.as_name().ok())
                            .map(|b| String::from_utf8_lossy(b).into_owned()),
                        Some("Image".to_string())
                    );
                    assert_eq!(
                        s.dict.get(b"Width").ok().and_then(|o| o.as_i64().ok()),
                        Some(4)
                    );
                    assert_eq!(
                        s.dict.get(b"Height").ok().and_then(|o| o.as_i64().ok()),
                        Some(4)
                    );
                }
                _ => panic!("should be a Stream"),
            }
        }
    }

    // ── PDF export integration tests ───────────────────────────────────

    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }

    #[test]
    fn export_pdf_returns_valid_bytes() {
        let nodes = vec![
            rect_node(1, 0.0, 0.0, 100.0, 100.0),
            rect_node(2, 50.0, 50.0, 50.0, 50.0),
        ];
        let opts = PdfOptions::default();
        let bytes = export_pdf(&nodes, &opts).expect("pdf export");
        assert!(
            bytes.starts_with(b"%PDF"),
            "bytes should start with PDF header"
        );
        assert!(bytes.len() > 200, "PDF should have meaningful content");
    }

    #[test]
    fn export_empty_scene() {
        let bytes = export_pdf(&[], &PdfOptions::default()).expect("empty pdf");
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn export_pdf_with_circle() {
        let nodes = vec![SceneNode {
            id: varve_core::NodeId(1),
            name: "circle".into(),
            transform: Affine::translate((100.0, 100.0)),
            shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 50.0)),
            fill: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        }];
        let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with circle");
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn export_pdf_with_stacked_fills() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![
            solid_fill(255, 0, 0, 255, true),
            solid_fill(0, 0, 255, 128, true),
        ]);
        let bytes = export_pdf(&[node], &PdfOptions::default()).expect("stacked fills pdf");
        assert!(bytes.starts_with(b"%PDF"));
        assert!(bytes.len() > 200, "should have content");
    }

    #[test]
    fn export_pdf_with_strokes() {
        let stroke = Stroke {
            weight: 3.0,
            visible: true,
            ..Default::default()
        };
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.strokes = vec![stroke];
        let bytes = export_pdf(&[node], &PdfOptions::default()).expect("stroked pdf");
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn export_pdf_with_effects() {
        let mut node = rect_node(1, 10.0, 10.0, 100.0, 100.0);
        node.effects = vec![Effect::DropShadow {
            id: None,
            x: 5.0,
            y: 5.0,
            blur: 2.0,
            spread: 0.0,
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            opacity: 0.5,
            blend_mode: BlendMode::Normal,
            visible: true,
        }];
        let bytes = export_pdf(&[node], &PdfOptions::default()).expect("effects pdf");
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn export_pdf_no_text_operators() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf");
        let content = String::from_utf8_lossy(&bytes);
        assert!(
            !content.contains("/Tj") && !content.contains("/TJ"),
            "should not contain text operators"
        );
    }

    // ── Text outlining integration tests ─────────────────────────────────

    #[test]
    fn export_pdf_outlines_text() {
        let font_data = test_font_data();
        let nodes = vec![text_node(1, 10.0, 10.0, "A", 24.0)];
        let opts = PdfOptions {
            outline_text: true,
            font_data: Some(font_data),
            ..Default::default()
        };
        let bytes = export_pdf(&nodes, &opts).expect("outlined text pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
        assert!(
            bytes.len() > 500,
            "outlined text should be larger than minimal PDF"
        );
    }

    #[test]
    fn export_pdf_outlines_text_multiple_glyphs() {
        let font_data = test_font_data();
        let nodes = vec![text_node(1, 10.0, 10.0, "AB", 24.0)];
        let opts = PdfOptions {
            outline_text: true,
            font_data: Some(font_data),
            ..Default::default()
        };
        let bytes = export_pdf(&nodes, &opts).expect("outlined AB pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
        assert!(
            bytes.len() > 600,
            "two-glyph text should be larger than one glyph"
        );
    }

    #[test]
    fn export_pdf_outlines_text_disabled_by_default() {
        let nodes = vec![text_node(1, 10.0, 10.0, "Hello", 16.0)];
        let opts = PdfOptions::default();
        let bytes = export_pdf(&nodes, &opts).expect("non-outlined pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    }

    #[test]
    fn export_pdf_outlines_text_empty_string() {
        let font_data = test_font_data();
        let nodes = vec![text_node(1, 10.0, 10.0, "", 16.0)];
        let opts = PdfOptions {
            outline_text: true,
            font_data: Some(font_data),
            ..Default::default()
        };
        let bytes = export_pdf(&nodes, &opts).expect("empty text pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    }

    #[test]
    fn export_pdf_outlines_text_font_data_none_falls_back() {
        let nodes = vec![text_node(1, 10.0, 10.0, "Test", 16.0)];
        let opts = PdfOptions {
            outline_text: true,
            font_data: None,
            ..Default::default()
        };
        let bytes = export_pdf(&nodes, &opts).expect("fallback pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    }

    #[test]
    fn export_pdf_outlines_text_larger_than_rectangle() {
        let font_data = test_font_data();
        let nodes = vec![text_node(1, 10.0, 10.0, "ABX", 24.0)];
        let opts_outline = PdfOptions {
            outline_text: true,
            font_data: Some(font_data.clone()),
            ..Default::default()
        };
        let opts_rect = PdfOptions {
            outline_text: false,
            font_data: Some(font_data),
            ..Default::default()
        };
        let outlined = export_pdf(&nodes, &opts_outline).expect("outlined");
        let rect = export_pdf(&nodes, &opts_rect).expect("rect");
        assert!(
            outlined.len() > rect.len(),
            "outlined PDF ({}) should be larger than rect PDF ({})",
            outlined.len(),
            rect.len()
        );
    }

    #[test]
    fn export_pdf_outlines_text_respects_fill_color() {
        let font_data = test_font_data();
        let node = SceneNode {
            id: varve_core::NodeId(1),
            name: "red-text".into(),
            transform: Affine::translate((10.0, 10.0)),
            shape: Shape::Text {
                text: "A".into(),
                font_size: 24.0,
                font_family: "DejaVu Sans".into(),
                font_weight: 400,
                font_style: "normal".into(),
                text_align: "left".into(),
                text_align_vertical: None,
                x: 0.0,
                y: 0.0,
                w: 15.0,
                h: 28.0,
                letter_spacing: None,
                line_height: None,
                paragraph_spacing: None,
                text_case: None,
                text_decoration: None,
                text_overflow: None,
                list_style: None,
                rich_text: None,
                open_type_features: None,
                variable_axes: None,
                text_mode: None,
                path_text_settings: None,
                path_shape: None,
            },
            fill: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        };
        let opts = PdfOptions {
            outline_text: true,
            font_data: Some(font_data),
            ..Default::default()
        };
        let bytes = export_pdf(&[node], &opts).expect("red outlined text");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    }

    #[test]
    fn export_pdf_outlines_text_multi_font() {
        let font_data = test_font_data();
        let nodes = vec![text_node(1, 10.0, 10.0, "Hello", 24.0)];
        let opts = PdfOptions {
            outline_text: true,
            fonts: vec![("DejaVu Sans".into(), font_data)],
            ..Default::default()
        };
        let bytes = export_pdf(&nodes, &opts).expect("multi-font outlined pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
        assert!(bytes.len() > 500, "should have outlined content");
    }

    // ── Unicode / non-WinAnsi fallback tests ────────────────────────────

    #[test]
    fn requires_outline_detects_non_winansi() {
        assert!(requires_outline("مرحبا"), "Arabic requires outline");
        assert!(requires_outline("שלום"), "Hebrew requires outline");
        assert!(requires_outline("नमस्ते"), "Devanagari requires outline");
        assert!(
            !requires_outline("Hello World"),
            "ASCII does not require outline"
        );
        assert!(
            !requires_outline("Café résumé"),
            "Latin-1 Supplement is WinAnsi"
        );
    }

    #[test]
    fn export_pdf_outlines_non_winansi_text() {
        // Arabic text cannot be encoded in WinAnsiEncoding. It MUST be
        // outlined into vector paths even when outline_text is false.
        let font_data = test_font_data();
        let nodes = vec![text_node(1, 10.0, 10.0, "مرحبا", 24.0)];
        let opts = PdfOptions {
            outline_text: false, // disabled — but non-WinAnsi forces outline
            font_data: Some(font_data),
            ..Default::default()
        };
        let bytes = export_pdf(&nodes, &opts).expect("non-winansi pdf");
        let s = String::from_utf8_lossy(&bytes);
        assert!(
            !s.contains("/Tj"),
            "non-WinAnsi text must not emit WinAnsi Tj operator"
        );
        // Outlined text produces PDF path operators
        assert!(
            s.contains('m') && s.contains('c'),
            "non-WinAnsi text should be outlined to path operators (m, c)"
        );
    }

    // ── CMYK export integration ────────────────────────────────────────

    #[test]
    fn export_pdf_with_cmyk_profile() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            ..Default::default()
        };
        let bytes = export_pdf(&[node], &opts).expect("cmyk pdf");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    }

    #[test]
    fn fill_to_color_string_icc_differs_from_analytical() {
        // When a print profile is set, CMYK conversion uses the ICC path,
        // which differs from the analytical (1-C)(1-K) formula.
        let color = varve_core::EngineColor::Rgb {
            r: 180.0,
            g: 100.0,
            b: 60.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
        let fill = varve_core::FillIR::Solid {
            color,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        };

        let analytical = fill_to_color_string(&fill, true, None, false);
        let icc = fill_to_color_string(&fill, true, Some(PrintProfile::Fogra39), false);

        // The ICC path produces different CMYK values than analytical
        assert_ne!(
            analytical, icc,
            "ICC and analytical CMYK conversion should differ for this color"
        );
        // Both should contain CMYK operators (end with 'k')
        assert!(
            analytical.ends_with('k'),
            "analytical should be CMYK: {analytical}"
        );
        assert!(icc.ends_with('k'), "icc should be CMYK: {icc}");
    }

    // ── Native CMYK emission (no RGB round trip) ───────────────────────

    fn cmyk_color(
        c: f64,
        m: f64,
        y: f64,
        k: f64,
        a: f64,
        bit_depth: Option<String>,
    ) -> EngineColor {
        EngineColor::Cmyk {
            c,
            m,
            y,
            k,
            a,
            bit_depth,
            profile: Some("fogra39".into()),
        }
    }

    #[test]
    fn color_to_cmyk_string_emits_native_channels() {
        // Pure K must stay (0 0 0 1) — never a four-color build.
        let pure_k = cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None);
        let s = color_to_cmyk_string(&pure_k, None);
        assert_eq!(s, "0.000 0.000 0.000 1.000 k");

        let rich = cmyk_color(60.0, 50.0, 50.0, 100.0, 255.0, None);
        let s = color_to_cmyk_string(&rich, None);
        assert_eq!(s, "0.235 0.196 0.196 0.392 k");
    }

    #[test]
    fn color_to_cmyk_string_bit_depth_scaled() {
        // uint16 channels scale by 65535.
        let u16 = cmyk_color(0.0, 0.0, 0.0, 65535.0, 65535.0, Some("uint16".into()));
        let s = color_to_cmyk_string(&u16, None);
        assert_eq!(s, "0.000 0.000 0.000 1.000 k");

        // float channels pass through unchanged.
        let f = cmyk_color(0.0, 0.5, 0.0, 1.0, 1.0, Some("float32".into()));
        let s = color_to_cmyk_string(&f, None);
        assert_eq!(s, "0.000 0.500 0.000 1.000 k");
    }

    #[test]
    fn color_to_stroke_cmyk_string_emits_native_channels() {
        let pure_k = cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None);
        let s = color_to_stroke_cmyk_string(&pure_k, None);
        assert_eq!(s, "0.000 0.000 0.000 1.000 K");
    }

    #[test]
    fn sample_gradient_cmyk_stops_stay_in_cmyk() {
        // Pure K → 0/0/0/255 gradient: every sample must be pure K.
        let stops = vec![
            GradientStop {
                position: 0.0,
                color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
                midpoint: None,
            },
            GradientStop {
                position: 1.0,
                color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
                midpoint: None,
            },
        ];
        for t in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let c = sample_gradient(&stops, t);
            match c {
                EngineColor::Cmyk { k, c, m, y, .. } => {
                    assert!((c - 0.0).abs() < 1e-6, "cyan must stay 0");
                    assert!((m - 0.0).abs() < 1e-6, "magenta must stay 0");
                    assert!((y - 0.0).abs() < 1e-6, "yellow must stay 0");
                    assert!((k - 1.0).abs() < 1e-6, "black must stay pure K");
                }
                _ => panic!("native CMYK stops must interpolate in CMYK space"),
            }
        }
    }

    #[test]
    fn gradient_samples_cmyk_preserve_pure_k() {
        // A pure-K gradient exported with use_cmyk must produce K=255 samples
        // (i.e. no four-color build from the naive formula).
        let stops = vec![
            GradientStop {
                position: 0.0,
                color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
                midpoint: None,
            },
            GradientStop {
                position: 1.0,
                color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
                midpoint: None,
            },
        ];
        let mut doc = Document::default();
        let id = create_sampled_function(&mut doc, &stops, true, None);
        assert_ne!(id, ObjectId::default(), "shading should be registered");
        // Extract the sampled stream and check the CMYK samples.
        if let Object::Stream(stream) = &doc.objects[&id] {
            let dict = &stream.dict;
            let size = dict
                .get(b"Size")
                .ok()
                .and_then(|v| match v {
                    Object::Array(a) => a.first().and_then(|o| match o {
                        Object::Integer(i) => Some(*i as usize),
                        _ => None,
                    }),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(size, 256, "gradient samples");
            let data = &stream.content;
            // Every 4th byte (K channel) must be 255 for a pure-K gradient.
            for i in (3..data.len()).step_by(4) {
                assert_eq!(data[i], 255, "K channel must stay pure");
            }
        }
    }
}
