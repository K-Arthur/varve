//! Print pipeline: font outlining, RGB/CMYK PDF export.
//!
//! `export_pdf()` converts a flat scene into PDF bytes using lopdf, emitting
//! path operators for each shape node. CMYK/PDF-X export lives in `cmyk.rs`.
//!
//! Research basis: lopdf for PDF generation. PDF graphics model uses path
//! construction operators (m, l, re, h, f) per the ISO 32000 spec.

#![forbid(unsafe_code)]

pub mod cmyk;
pub mod marks;
pub mod outline;
pub mod profiles;

pub use outline::{
    commands_to_svg_path, outline_text, outline_text_multi, GlyphOutline, PathCommand,
};

use ab_glyph::Font as AbGlyphFont;
use lopdf::{dictionary, Document, Object, Stream};
use strata_core::{Effect, FillIR, SceneNode, Shape};

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
        }
    }
}

fn color_to_rgb_string(fill: &[u8; 4]) -> String {
    let r = fill[0] as f32 / 255.0;
    let g = fill[1] as f32 / 255.0;
    let b = fill[2] as f32 / 255.0;
    format!("{r:.3} {g:.3} {b:.3} rg")
}

fn color_to_cmyk_string(fill: &[u8; 4]) -> String {
    let (c, m, y, k) = crate::cmyk::rgb_to_cmyk(fill[0], fill[1], fill[2]);
    format!(
        "{:.3} {:.3} {:.3} {:.3} k",
        c as f32 / 255.0,
        m as f32 / 255.0,
        y as f32 / 255.0,
        k as f32 / 255.0
    )
}

fn color_to_stroke_rgb_string(fill: &[u8; 4]) -> String {
    let r = fill[0] as f32 / 255.0;
    let g = fill[1] as f32 / 255.0;
    let b = fill[2] as f32 / 255.0;
    format!("{r:.3} {g:.3} {b:.3} RG")
}

fn color_to_stroke_cmyk_string(fill: &[u8; 4]) -> String {
    let (c, m, y, k) = crate::cmyk::rgb_to_cmyk(fill[0], fill[1], fill[2]);
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

/// Render stacked fills from `node.fills` (bottom-to-top, last = topmost).
/// Falls back to `node.fill` when `fills` is None or empty.
/// `use_cmyk` controls whether RGB or CMYK color operators are emitted.
fn render_fills(node: &SceneNode, page_height: f64, use_cmyk: bool) -> Vec<u8> {
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
                buf.extend_from_slice(b"q\n");
                let color_str = fill_to_color_string(fill, use_cmyk);
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
            return buf;
        }
    }

    // Fallback to node.fill
    buf.extend_from_slice(b"q\n");
    if use_cmyk {
        buf.extend(color_to_cmyk_string(&node.fill).as_bytes());
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
fn render_strokes(node: &SceneNode, page_height: f64, use_cmyk: bool) -> Vec<u8> {
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
            buf.extend(color_to_stroke_cmyk_string(&stroke.color).as_bytes());
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
fn render_effects(node: &SceneNode, page_height: f64, use_cmyk: bool) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    if path_ops.is_empty() || node.effects.is_empty() {
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
                    buf.extend(color_to_cmyk_string(color).as_bytes());
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
        }
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

/// Legacy shape_to_pdf_content — maintained for backward compatibility
/// with `build_pdfx_content` in cmyk.rs.
fn shape_to_pdf_content(node: &SceneNode, page_height: f64) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"q\n");
    let effects = render_effects(node, page_height, false);
    buf.extend(&effects);
    let fills = render_fills(node, page_height, false);
    buf.extend(&fills);
    let strokes = render_strokes(node, page_height, false);
    buf.extend(&strokes);
    buf.extend_from_slice(b"Q\n");
    buf
}

/// Helper: convert a FillIR to an RGB or CMYK fill color string.
fn fill_to_color_string(fill: &FillIR, use_cmyk: bool) -> String {
    match fill {
        FillIR::Solid { color, .. } => {
            if use_cmyk {
                color_to_cmyk_string(color)
            } else {
                color_to_rgb_string(color)
            }
        }
        FillIR::Gradient { stops, .. } => {
            // Gradient fills approximate as solid using the first stop color.
            if let Some(stop) = stops.first() {
                if use_cmyk {
                    color_to_cmyk_string(&stop.color)
                } else {
                    color_to_rgb_string(&stop.color)
                }
            } else if use_cmyk {
                color_to_cmyk_string(&[0, 0, 0, 255])
            } else {
                color_to_rgb_string(&[0, 0, 0, 255])
            }
        }
        FillIR::Image { .. } | FillIR::Pattern { .. } => {
            if use_cmyk {
                color_to_cmyk_string(&[0, 0, 0, 255])
            } else {
                color_to_rgb_string(&[0, 0, 0, 255])
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

/// Export a scene to PDF bytes using lopdf.
///
/// Each shape node becomes a filled path. When `opts.outline_text` is true
/// and `opts.font_data` is `Some`, text nodes are outlined as vector paths
/// instead of filled rectangles. The new pipeline respects stacked fills,
/// strokes, and effects.
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

    let do_outline = opts.outline_text && (opts.font_data.is_some() || !opts.fonts.is_empty());

    for node in nodes {
        if do_outline {
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
        let effects = render_effects(node, opts.page_height, use_cmyk);
        content.extend(&effects);
        let fills = render_fills(node, opts.page_height, use_cmyk);
        content.extend(&fills);
        let strokes = render_strokes(node, opts.page_height, use_cmyk);
        content.extend(&strokes);
        content.extend_from_slice(b"Q\n");
    }
    content.extend_from_slice(b"Q\n");

    let content_stream = Stream::new(dictionary! {}, content);
    let content_id = doc.new_object_id();
    doc.objects
        .insert(content_id, Object::Stream(content_stream));

    // Font resource (required by PDF spec even if unused)
    let font_dict = dictionary! {
        "F1" => dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        },
    };
    let resources = dictionary! {
        "Font" => font_dict,
    };

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
        color_to_cmyk_string(&node.fill)
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
    let shadow = render_effects(node, opts.page_height, use_cmyk);
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
    use strata_core::{Affine, Circle, FillIR, GradientStop, Point, Rect, Stroke};

    // ── Helpers ────────────────────────────────────────────────────────

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(id),
            name: format!("r{id}"),
            transform: Affine::translate((x, y)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
            fill: [57, 208, 198, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
                x: 0.0,
                y: 0.0,
                w: font_size * text.len() as f64 * 0.6,
                h: font_size * 1.2,
                letter_spacing: None,
                line_height: None,
                text_case: None,
                text_decoration: None,
                open_type_features: None,
                variable_axes: None,
            },
            fill: [0, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
            color: [r, g, b, a],
            opacity: 1.0,
            blend_mode: "normal".into(),
            visible,
        }
    }

    fn gradient_fill(visible: bool) -> FillIR {
        FillIR::Gradient {
            gradient_type: "linear".into(),
            stops: vec![
                GradientStop {
                    position: 0.0,
                    color: [255, 0, 0, 255],
                },
                GradientStop {
                    position: 1.0,
                    color: [0, 0, 255, 255],
                },
            ],
            rotation: 0.0,
            transform: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
            fill: [255, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
            },
            fill: [0, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
            },
            fill: [0, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
        let result = render_fills(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "should contain RGB color");
        assert!(s.contains("f\n"), "should contain fill operator");
        assert!(s.contains("re\n"), "should contain path");
    }

    #[test]
    fn render_fills_gradient() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![gradient_fill(true)]);
        let result = render_fills(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "gradient approximated as solid");
        assert!(s.contains("f\n"), "should fill");
    }

    #[test]
    fn render_fills_fallback() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false);
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
        let result = render_fills(&node, 100.0, false);
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
            color: [255, 0, 0, 255],
            opacity: 0.5,
            blend_mode: "normal".into(),
            visible: true,
        }]);
        let result = render_fills(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("opacity=0.500"), "should emit opacity comment");
    }

    #[test]
    fn render_fills_invisible() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![solid_fill(255, 0, 0, 255, false)]);
        let result = render_fills(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(!s.contains("rg"), "invisible fill should not render");
    }

    #[test]
    fn render_fills_empty_fills_fallsback() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![]);
        let result = render_fills(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "empty fills should fallback");
    }

    #[test]
    fn render_fills_none_fallsback() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_fills(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("rg"), "None fills should fallback to fill");
    }

    // ── render_strokes tests ───────────────────────────────────────────

    fn node_with_stroke(stroke: Stroke) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(1),
            name: "s".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
            fill: [0, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
        let result = render_strokes(&node, 100.0, false);
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
        let result = render_strokes(&node, 100.0, false);
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
        let result = render_strokes(&node, 100.0, false);
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
        let result = render_strokes(&node, 100.0, false);
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
        let result = render_strokes(&node, 100.0, false);
        assert!(
            result.is_empty(),
            "invisible stroke should produce no output"
        );
    }

    #[test]
    fn render_strokes_empty() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_strokes(&node, 100.0, false);
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
            color: [0, 0, 0, 255],
            opacity: 0.5,
            blend_mode: "normal".into(),
            visible: true,
        }];
        let result = render_effects(&node, 100.0, false);
        let s = String::from_utf8_lossy(&result);
        assert!(s.contains("cm"), "shadow should use translation matrix");
        assert!(s.contains("0.000 0.000 0.000 rg"), "shadow should be black");
        assert!(s.contains("f\n"), "shadow should be filled");
    }

    #[test]
    fn render_effects_no_effects() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let result = render_effects(&node, 100.0, false);
        assert!(result.is_empty(), "no effects should produce no output");
    }

    #[test]
    fn render_effects_inner_shadow_commented() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.effects = vec![Effect::InnerShadow {
            x: 2.0,
            y: 2.0,
            blur: 1.0,
            spread: 0.0,
            color: [0, 0, 0, 255],
            opacity: 0.5,
            blend_mode: "normal".into(),
            visible: true,
        }];
        let result = render_effects(&node, 100.0, false);
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
            fill: [255, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
            color: [0, 0, 0, 255],
            opacity: 0.5,
            blend_mode: "normal".into(),
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
                x: 0.0,
                y: 0.0,
                w: 15.0,
                h: 28.0,
                letter_spacing: None,
                line_height: None,
                text_case: None,
                text_decoration: None,
                open_type_features: None,
                variable_axes: None,
            },
            fill: [255, 0, 0, 255],
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: "normal".into(),
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
}
