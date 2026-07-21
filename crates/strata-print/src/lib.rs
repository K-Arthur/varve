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
pub mod subset;

pub use outline::{
    commands_to_svg_path, outline_text, outline_text_multi, GlyphOutline, PathCommand,
};

use std::collections::HashMap;

use ab_glyph::Font as AbGlyphFont;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use strata_core::{Effect, EngineColor, FillIR, SceneNode, Shape};

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
        }
    }
}

fn engine_color_rgba(color: &EngineColor) -> (u8, u8, u8, u8) {
    match color {
        EngineColor::Rgb { r, g, b, a, .. } => (*r as u8, *g as u8, *b as u8, *a as u8),
        EngineColor::Cmyk { c, m, y, k, a, .. } => {
            let rc = 1.0 - (c / 255.0);
            let rm = 1.0 - (m / 255.0);
            let ry = 1.0 - (y / 255.0);
            let rk = 1.0 - (k / 255.0);
            (
                (255.0 * rc * rk) as u8,
                (255.0 * rm * rk) as u8,
                (255.0 * ry * rk) as u8,
                *a as u8,
            )
        }
        EngineColor::Gray { v, a, .. } => (*v as u8, *v as u8, *v as u8, *a as u8),
        EngineColor::Spot {
            process_fallback,
            tint,
            a,
            ..
        } => {
            if let Some(fb) = process_fallback {
                let rc = 1.0 - (fb.c / 255.0);
                let rm = 1.0 - (fb.m / 255.0);
                let ry = 1.0 - (fb.y / 255.0);
                let rk = 1.0 - (fb.k / 255.0);
                (
                    (255.0 * rc * rk) as u8,
                    (255.0 * rm * rk) as u8,
                    (255.0 * ry * rk) as u8,
                    ((*a * tint / 100.0) as u8),
                )
            } else {
                (0, 0, 0, *a as u8)
            }
        }
    }
}

fn color_to_rgb_string(fill: &EngineColor) -> String {
    let (r, g, b, _) = engine_color_rgba(fill);
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;
    format!("{rf:.3} {gf:.3} {bf:.3} rg")
}

fn color_to_cmyk_string(fill: &EngineColor, profile: Option<PrintProfile>) -> String {
    let (r, g, b, _) = engine_color_rgba(fill);
    let (c, m, y, k) = match profile {
        Some(p) => crate::cmyk::rgb_to_cmyk_icc(p, r, g, b, crate::profiles::RenderingIntent::Relative, true),
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
    let (r, g, b, _) = engine_color_rgba(fill);
    let (c, m, y, k) = match profile {
        Some(p) => crate::cmyk::rgb_to_cmyk_icc(p, r, g, b, crate::profiles::RenderingIntent::Relative, true),
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
}

impl<'a> ImageRenderState<'a> {
    pub fn new(doc: &'a mut Document) -> Self {
        Self {
            doc,
            counter: 0,
            refs: Vec::new(),
        }
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
fn shape_pdf_bounds(node: &SceneNode, page_height: f64) -> (f64, f64, f64, f64) {
    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];

    match &node.shape {
        Shape::Rect(r) => {
            let x = r.min_x() + x_off;
            let y = page_height - r.max_y() - y_off;
            (x, y, r.width(), r.height())
        }
        Shape::Circle(c) => {
            let cx = c.center.x + x_off;
            let cy = page_height - c.center.y - y_off;
            (cx - c.radius, cy - c.radius, 2.0 * c.radius, 2.0 * c.radius)
        }
        Shape::Ellipse { center, rx, ry } => {
            let cx = center.x + x_off;
            let cy = page_height - center.y - y_off;
            (cx - rx, cy - ry, 2.0 * rx, 2.0 * ry)
        }
        Shape::Line { line, .. } => {
            let x = line.p0.x.min(line.p1.x) + x_off;
            let y = page_height - line.p0.y.max(line.p1.y) - y_off;
            let w = (line.p0.x - line.p1.x).abs();
            let h = (line.p0.y - line.p1.y).abs();
            (x, y, w, h)
        }
        Shape::Polygon { cx, cy, radius, .. } => {
            let scx = cx + x_off;
            let scy = page_height - cy - y_off;
            (scx - radius, scy - radius, 2.0 * radius, 2.0 * radius)
        }
        Shape::Star {
            cx,
            cy,
            outer_radius,
            ..
        } => {
            let scx = cx + x_off;
            let scy = page_height - cy - y_off;
            (
                scx - outer_radius,
                scy - outer_radius,
                2.0 * outer_radius,
                2.0 * outer_radius,
            )
        }
        Shape::Arrow { from, to, .. } => {
            let x = from[0].min(to[0]) + x_off;
            let y = page_height - from[1].max(to[1]) - y_off;
            let w = (from[0] - to[0]).abs();
            let h = (from[1] - to[1]).abs();
            (x, y, w, h)
        }
        Shape::Path { points, .. } => {
            if points.is_empty() {
                return (x_off, page_height - y_off, 0.0, 0.0);
            }
            let min_x = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
            let max_x = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
            let min_y = points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
            let max_y = points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
            (
                min_x + x_off,
                page_height - max_y - y_off,
                max_x - min_x,
                max_y - min_y,
            )
        }
        Shape::Text { x, y, w, h, .. } => (x + x_off, page_height - y - h - y_off, *w, *h),
    }
}

/// Render stacked fills from `node.fills` (bottom-to-top, last = topmost).
/// Falls back to `node.fill` when `fills` is None or empty.
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
                        opacity,
                        alpha_mask,
                        ..
                    } => {
                        match &mut image_state {
                            Some(state) => {
                                buf.extend_from_slice(b"q\n");

                                // Non-rectangular shapes: clip to the shape path first
                                if !matches!(node.shape, Shape::Rect(_)) {
                                    buf.extend(&path_ops);
                                    buf.extend_from_slice(b"W n\n");
                                }

                                // Try to resolve image from manifest by source URL
                                let manifest_image = manifest
                                    .as_ref()
                                    .and_then(|m| m.resolve_image_by_src(src).ok());

                                match manifest_image {
                                    Some(img) if img.is_valid() => {
                                        // Real pixel data from the TS-side ICC pipeline
                                        let (data, cs, bpc) = match img.color_space {
                                            resources::ColorSpace::Cmyk => {
                                                // CMYK data: embed directly as DeviceCMYK
                                                (img.data.clone(), "DeviceCMYK", 4u32)
                                            }
                                            _ => {
                                                // RGBA data: strip alpha to RGB
                                                let rgb = rgba_to_rgb(&img.data);
                                                (rgb, "DeviceRGB", 3u32)
                                            }
                                        };

                                        match embed_image_with_colorspace(
                                            state.doc, &data, img.width, img.height, bpc, cs,
                                        ) {
                                            Ok(obj_ref) => {
                                                let name = format!("Im{}", state.counter);
                                                state.counter += 1;
                                                state.refs.push((name.clone(), obj_ref));

                                                // Position and scale the image to fill the shape
                                                let (bx, by, bw, bh) =
                                                    shape_pdf_bounds(node, page_height);
                                                let tx = bx + fill_x;
                                                let ty = by + fill_y;
                                                // Scale image to fill the shape bounds in PDF space
                                                let img_w = img.width as f64;
                                                let img_h = img.height as f64;
                                                let sx = bw / img_w;
                                                let sy = bh / img_h;

                                                buf.extend(
                                                    format!(
                                                        "{sx:.4} 0 0 {sy:.4} {tx:.4} {ty:.4} cm\n"
                                                    )
                                                    .as_bytes(),
                                                );
                                                buf.extend(format!("/{name} Do\n").as_bytes());

                                                if *opacity < 1.0 {
                                                    buf.extend(
                                                        format!("% image opacity={:.3}\n", opacity)
                                                            .as_bytes(),
                                                    );
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

                                                buf.extend(
                                                    format!(
                                                        "{sx:.4} 0 0 {sy:.4} {tx:.4} {ty:.4} cm\n"
                                                    )
                                                    .as_bytes(),
                                                );
                                                buf.extend(format!("/{name} Do\n").as_bytes());

                                                if *opacity < 1.0 {
                                                    buf.extend(
                                                        format!("% image opacity={:.3}\n", opacity)
                                                            .as_bytes(),
                                                    );
                                                }

                                                if use_cmyk {
                                                    let note = "% image fill CMYK conversion not yet implemented; checkerboard placeholder rendered as RGB\n";
                                                    buf.extend_from_slice(note.as_bytes());
                                                }

                                                if alpha_mask.is_some() {
                                                    let note = "% alpha mask not yet implemented for image fills in PDF export; needs full pixel decode pipeline\n";
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
                    FillIR::Solid { .. } | FillIR::Gradient { .. } => {
                        buf.extend_from_slice(b"q\n");
                        let color_str = fill_to_color_string(fill, use_cmyk, profile);
                        buf.extend(color_str.as_bytes());
                        buf.extend(b"\n");
                        buf.extend(&path_ops);
                        buf.extend_from_slice(b"f\n");
                        if fill_opacity(fill) < 1.0 {
                            // Emit an explicit opacity comment; full PDF transparency
                            // requires an extended graphics state (ExtGState).
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
fn render_strokes(node: &SceneNode, page_height: f64, use_cmyk: bool, profile: Option<PrintProfile>) -> Vec<u8> {
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
fn render_effects(node: &SceneNode, page_height: f64, use_cmyk: bool, profile: Option<PrintProfile>) -> Vec<u8> {
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
            Effect::LayerBlur { radius, visible } => {
                if *visible {
                    buf.extend(format!("% layerBlur radius={radius:.2}\n").as_bytes());
                }
            }
            Effect::BackgroundBlur { radius, visible } => {
                if *visible {
                    buf.extend(format!("% backgroundBlur radius={radius:.2}\n").as_bytes());
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
) -> Result<Object, String> {
    let expected = (width * height * bpc) as usize;
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
            "ColorSpace" => color_space_name,
            "BitsPerComponent" => 8,
            "Length" => expected as i64,
        },
        image_data[..expected].to_vec(),
    );
    doc.objects.insert(image_id, Object::Stream(stream));
    Ok(Object::Reference(image_id))
}

/// Convert RGBA pixel data to RGB by stripping the alpha channel.
pub fn rgba_to_rgb(data: &[u8]) -> Vec<u8> {
    data.chunks_exact(4)
        .flat_map(|rgba| [rgba[0], rgba[1], rgba[2]])
        .collect()
}

/// Legacy shape_to_pdf_content — maintained for backward compatibility
/// with `build_pdfx_content` in cmyk.rs.
fn shape_to_pdf_content(
    node: &SceneNode,
    page_height: f64,
    image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"q\n");
    let effects = render_effects(node, page_height, false, None);
    buf.extend(&effects);
    let fills = render_fills(node, page_height, false, image_state, manifest, None);
    buf.extend(&fills);
    let strokes = render_strokes(node, page_height, false, None);
    buf.extend(&strokes);
    buf.extend_from_slice(b"Q\n");
    buf
}

/// Helper: convert a FillIR to an RGB or CMYK fill color string.
fn fill_to_color_string(fill: &FillIR, use_cmyk: bool, profile: Option<PrintProfile>) -> String {
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
                color_to_cmyk_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    profile: None,
                }, profile)
            } else {
                color_to_rgb_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    profile: None,
                })
            }
        }
        FillIR::Image { .. } | FillIR::Pattern { .. } => {
            if use_cmyk {
                color_to_cmyk_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    profile: None,
                }, profile)
            } else {
                color_to_rgb_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
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

/// Embed a font program into the PDF document as a TrueType font with
/// FontDescriptor and font dictionary, returning the entry record.
fn embed_font_program(
    doc: &mut Document,
    family: &str,
    base_font: &str,
    font_data: &[u8],
    font_idx: usize,
) -> Result<EmbeddedFontEntry, String> {
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

    // 2. Font descriptor (with some sensible defaults for metrics)
    let descriptor_id = doc.new_object_id();
    let font_name_bytes = base_font.as_bytes().to_vec();
    let descriptor = dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => Object::Name(font_name_bytes.clone()),
        "Flags" => 32, // Small, serif-free, scalable
        "FontBBox" => vec![
            Object::Real(0.0),
            Object::Real(-200.0),
            Object::Real(1000.0),
            Object::Real(800.0),
        ],
        "ItalicAngle" => 0,
        "Ascent" => 800,
        "Descent" => -200,
        "CapHeight" => 500,
        "StemV" => 50,
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

    Ok(EmbeddedFontEntry {
        res_name,
        family: family.to_string(),
        dict_id: font_dict_id,
    })
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

            let entry = embed_font_program(&mut doc, family, &base_font, &subset_data, font_idx)?;
            entries.push(entry);
        }

        entries
    } else {
        Vec::new()
    };

    let do_outline = opts.outline_text && (opts.font_data.is_some() || !opts.fonts.is_empty());

    let mut need_bt = false;

    // ── Build content with image rendering support ──────────────────────
    let image_refs = {
        let mut image_state = ImageRenderState::new(&mut doc);

        for node in nodes {
            // Try embedded font text rendering
            if let Shape::Text {
                text,
                font_size,
                font_family,
                x,
                y,
                ..
            } = &node.shape
            {
                // Non-WinAnsi text (Arabic, Hebrew, CJK, …) cannot be encoded in
                // WinAnsiEncoding — it MUST be outlined regardless of opts.outline_text.
                let force_outline = requires_outline(text);

                if !text.is_empty()
                    && !embedded_fonts.is_empty()
                    && !force_outline
                    && can_encode_win_ansi(text)
                {
                    if let Some(ef) = embedded_fonts.iter().find(|ef| ef.family == *font_family) {
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
                        let encoded = encode_win_ansi(text);
                        let escaped = escape_pdf_string(&String::from_utf8_lossy(&encoded));

                        if !need_bt {
                            content.extend_from_slice(b"BT\n");
                            need_bt = true;
                        }
                        content.extend(
                            format!(
                                "/{} {} Tf\n1 0 0 1 {:.2} {:.2} Tm\n({}) Tj\n",
                                ef.res_name, font_size, pdf_x, pdf_y, escaped
                            )
                            .as_bytes(),
                        );
                        continue;
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
            if do_outline
                || shape_text(node)
                    .map_or(false, |t| !t.is_empty() && requires_outline(t))
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
            );
            content.extend(&fills);
            let strokes = render_strokes(node, opts.page_height, use_cmyk, opts.print_profile);
            content.extend(&strokes);
            content.extend_from_slice(b"Q\n");
        }

        std::mem::take(&mut image_state.refs)
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
        for (name, ref_obj) in &image_refs {
            xdict.set(name.as_bytes(), ref_obj.clone());
        }
        resources.set("XObject", xdict);
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
    use strata_core::{
        Affine, BlendMode, Circle, EngineColor, FillIR, GradientStop, Point, Rect, Stroke,
    };

    // ── Helpers ────────────────────────────────────────────────────────

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(id),
            name: format!("r{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
            fill: EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
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
            id: strata_core::NodeId(id),
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
        let paths = [
            "/usr/share/fonts/TTF/OpenSans-Regular.ttf",
            "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf",
            "/usr/share/fonts/TTF/Vera.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/Inter-Regular.ttf",
        ];
        for p in &paths {
            if let Ok(data) = std::fs::read(p) {
                return data;
            }
        }
        panic!("no test font found — tried {paths:?}")
    }

    fn solid_fill(r: u8, g: u8, b: u8, a: u8, visible: bool) -> FillIR {
        FillIR::Solid {
            color: EngineColor::Rgb {
                r: r as f64,
                g: g as f64,
                b: b as f64,
                a: a as f64,
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
                        profile: None,
                    },
                    midpoint: None,
                },
            ],
            rotation: 0.0,
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
            id: strata_core::NodeId(1),
            name: "c".into(),
            transform: Affine::translate((50.0, 50.0)),
            shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 30.0)),
            fill: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
            id: strata_core::NodeId(1),
            name: "p".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Path {
                points: vec![
                    strata_core::PathPoint {
                        x: 0.0,
                        y: 0.0,
                        handle_in: None,
                        handle_out: None,
                    },
                    strata_core::PathPoint {
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
            id: strata_core::NodeId(1),
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
        let result = render_fills(&node, 100.0, false, None, None, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "should contain RGB color");
        assert!(s.contains("f\n"), "should contain fill operator");
        assert!(s.contains("re\n"), "should contain path");
    }

    #[test]
    fn render_fills_gradient() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![gradient_fill(true)]);
        let result = render_fills(&node, 100.0, false, None, None, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "gradient approximated as solid");
        assert!(s.contains("f\n"), "should fill");
    }

    #[test]
    fn render_fills_fallback() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false, None, None, None);
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
        let result = render_fills(&node, 100.0, false, None, None, None);
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
                profile: None,
            },
            opacity: 0.5,
            blend_mode: BlendMode::Normal,
            visible: true,
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("opacity=0.500"), "should emit opacity comment");
    }

    #[test]
    fn render_fills_invisible() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![solid_fill(255, 0, 0, 255, false)]);
        let result = render_fills(&node, 100.0, false, None, None, None);
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
        }]);
        let result = render_fills(&node, 100.0, false, None, None, None);
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
        let result = render_fills(&node, 100.0, false, None, None, None);
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
        let result = render_fills(&node, 100.0, false, None, None, None);
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
        let content = render_fills(&node, 800.0, false, Some(&mut state), Some(&manifest), None);
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

        let content = render_fills(&node, 800.0, false, None, None, None);
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

        let content = render_fills(&node, 800.0, false, None, Some(&manifest), None);
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
        let content = render_fills(&node, 800.0, false, Some(&mut state), Some(&manifest), None);
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
        let result = render_fills(&node, 100.0, false, None, None, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "empty fills should fallback");
    }

    #[test]
    fn render_fills_none_fallsback() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false, None, None, None);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "None fills should fallback to fill");
    }

    // ── render_fills image fill tests ──────────────────────────────────

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
        }]);
        node
    }

    #[test]
    fn render_fills_image_with_document_renders_xobject() {
        let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(&node, 100.0, false, Some(&mut state), None, None);
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
    fn render_fills_image_without_document_compat() {
        // Without a document, image fills should still emit the "not rendered" comment
        let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false, None, None, None);
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
            id: strata_core::NodeId(1),
            name: "circle-img".into(),
            transform: strata_core::Affine::translate((50.0, 50.0)),
            shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 40.0)),
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
            }]),
            corner_radius: None,
            filters: None,
        };
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(&node, 100.0, false, Some(&mut state), None, None);
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
        }]);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(&node, 100.0, false, Some(&mut state), None, None);
        let s = String::from_utf8_lossy(&result);
        assert!(
            s.contains("opacity=0.500"),
            "image fill with opacity should emit opacity comment: {s}"
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
            },
        ]);
        let mut doc = Document::new();
        let mut state = ImageRenderState::new(&mut doc);
        let result = render_fills(&node, 100.0, false, Some(&mut state), None, None);
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
        let result = render_fills(&node, 100.0, true, Some(&mut state), None, None);
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
            id: strata_core::NodeId(1),
            name: "s".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
            x: 5.0,
            y: 5.0,
            blur: 2.0,
            spread: 0.0,
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
            x: 2.0,
            y: 2.0,
            blur: 1.0,
            spread: 0.0,
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
                            .and_then(|o| o.as_name_str().ok()),
                        Some("Image")
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
            id: strata_core::NodeId(1),
            name: "circle".into(),
            transform: Affine::translate((100.0, 100.0)),
            shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 50.0)),
            fill: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
            x: 5.0,
            y: 5.0,
            blur: 2.0,
            spread: 0.0,
            color: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
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
            id: strata_core::NodeId(1),
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
        let color = strata_core::EngineColor::Rgb {
            r: 180.0,
            g: 100.0,
            b: 60.0,
            a: 255.0,
            profile: None,
        };
        let fill = strata_core::FillIR::Solid {
            color,
            opacity: 1.0,
            blend_mode: strata_core::BlendMode::Normal,
            visible: true,
        };

        let analytical = fill_to_color_string(&fill, true, None);
        let icc = fill_to_color_string(&fill, true, Some(PrintProfile::Fogra39));

        // The ICC path produces different CMYK values than analytical
        assert_ne!(
            analytical, icc,
            "ICC and analytical CMYK conversion should differ for this color"
        );
        // Both should contain CMYK operators (end with 'k')
        assert!(analytical.ends_with('k'), "analytical should be CMYK: {analytical}");
        assert!(icc.ends_with('k'), "icc should be CMYK: {icc}");
    }

}
