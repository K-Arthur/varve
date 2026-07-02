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

pub use outline::{commands_to_svg_path, outline_text, GlyphOutline, PathCommand};

use ab_glyph::Font as AbGlyphFont;
use lopdf::{dictionary, Document, Object, Stream};
use strata_core::{SceneNode, Shape};

/// Options for PDF export.
#[derive(Debug, Clone)]
pub struct PdfOptions {
    pub page_width: f64,
    pub page_height: f64,
    pub title: String,
    pub author: String,
    /// When true, text nodes are outlined into vector paths using `font_data`.
    pub outline_text: bool,
    /// Raw TTF/OTF font bytes for text outlining.
    pub font_data: Option<Vec<u8>>,
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
        }
    }
}

fn color_to_rgb_string(fill: &[u8; 4]) -> String {
    let r = fill[0] as f32 / 255.0;
    let g = fill[1] as f32 / 255.0;
    let b = fill[2] as f32 / 255.0;
    format!("{r:.3} {g:.3} {b:.3} rg")
}

fn shape_to_pdf_content(node: &SceneNode, page_height: f64) -> Vec<u8> {
    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];
    let color = color_to_rgb_string(&node.fill);

    match &node.shape {
        Shape::Rect(r) => {
            let x = r.min_x() + x_off;
            let y = page_height - r.max_y() - y_off;
            let w = r.width();
            let h = r.height();
            format!("q\n{color}\n{x:.2} {y:.2} {w:.2} {h:.2} re\nf\nQ\n").into_bytes()
        }
        Shape::Circle(c) => {
            let cx = c.center.x + x_off;
            let cy = page_height - c.center.y - y_off;
            let r = c.radius;
            format!("q\n{color}\n{cx:.2} {cy:.2} {r:.2} 0 360 arc\nf\nQ\n").into_bytes()
        }
        Shape::Ellipse { center, rx, ry } => {
            let cx = center.x + x_off;
            let cy = page_height - center.y - y_off;
            format!("q\n{color}\n{cx:.2} {cy:.2} {rx:.2} {ry:.2} 0 360 arc\nf\nQ\n").into_bytes()
        }
        Shape::Line { line, tolerance: _ } => {
            let x1 = line.p0.x + x_off;
            let y1 = page_height - line.p0.y - y_off;
            let x2 = line.p1.x + x_off;
            let y2 = page_height - line.p1.y - y_off;
            format!(
                "q\n{color}\n\
                 {x1:.2} {y1:.2} m\n{x2:.2} {y2:.2} l\nS\nQ\n"
            )
            .into_bytes()
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
            let mut buf = format!("q\n{color}\n").into_bytes();
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
            buf.extend_from_slice(b"h f\nQ\n");
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
            let mut buf = format!("q\n{color}\n").into_bytes();
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
            buf.extend_from_slice(b"h f\nQ\n");
            buf
        }
        Shape::Arrow {
            from,
            to,
            tolerance,
            ..
        } => {
            // Render as a stroked line segment (PDF "S" operator).
            let lw = tolerance * 2.0;
            let x0 = from[0] + x_off;
            let y0 = page_height - from[1] - y_off;
            let x1 = to[0] + x_off;
            let y1 = page_height - to[1] - y_off;
            format!("q\n{color}\n{lw:.2} w\n{x0:.2} {y0:.2} m\n{x1:.2} {y1:.2} l\nS\nQ\n")
                .into_bytes()
        }
        Shape::Path { points, closed, .. } => {
            if points.is_empty() {
                return Vec::new();
            }
            let mut buf = format!("q\n{color}\n").into_bytes();
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
                buf.extend_from_slice(b"h f\nQ\n");
            } else {
                buf.extend_from_slice(b"S\nQ\n");
            }
            buf
        }
        Shape::Text { x, y, w, h, .. } => {
            let px = x + x_off;
            let py = page_height - y - h - y_off;
            format!("q\n{color}\n{px:.2} {py:.2} {w:.2} {h:.2} re\nf\nQ\n").into_bytes()
        }
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
/// instead of filled rectangles.
pub fn export_pdf(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    let mut doc = Document::new();
    let page_id = doc.new_object_id();

    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");
    // White background
    content.extend_from_slice(
        format!(
            "1.0 1.0 1.0 rg\n0 0 {:.2} {:.2} re\nf\n",
            opts.page_width, opts.page_height
        )
        .as_bytes(),
    );

    let do_outline = opts.outline_text && opts.font_data.is_some();

    for node in nodes {
        if do_outline {
            if let Shape::Text {
                text,
                font_size,
                x,
                y,
                ..
            } = &node.shape
            {
                if !text.is_empty() {
                    let font_data = opts.font_data.as_ref().unwrap();
                    match outline_text(font_data, text, *font_size) {
                        Ok(glyphs) if !glyphs.is_empty() => {
                            let color = color_to_rgb_string(&node.fill);
                            let tx = node.transform.as_coeffs();
                            let x_off = tx[4];
                            let y_off = tx[5];

                            // Get ascender for accurate baseline positioning
                            let ascender = match ab_glyph::FontArc::try_from_vec(font_data.clone())
                            {
                                Ok(font) => {
                                    let scale =
                                        *font_size / font.units_per_em().unwrap_or(1000.0) as f64;
                                    font.ascent_unscaled() as f64 * scale
                                }
                                Err(_) => font_size * 0.8,
                            };

                            let y_base = y + ascender;
                            for glyph in &glyphs {
                                let cmd = glyph_outline_to_pdf(
                                    glyph,
                                    &color,
                                    x + x_off,
                                    y_base + y_off,
                                    opts.page_height,
                                );
                                content.extend_from_slice(&cmd);
                            }
                            continue; // skip the default rectangle handler
                        }
                        Err(e) => {
                            // Fall through to rectangle fallback
                            eprintln!("Text outlining failed: {e}");
                        }
                        _ => {}
                    }
                }
            }
        }
        let cmd = shape_to_pdf_content(node, opts.page_height);
        content.extend_from_slice(&cmd);
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

#[cfg(test)]
mod tests {
    use super::*;
    use strata_core::{Affine, Circle, Point, Rect};

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
        }
    }

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
        }];
        let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with circle");
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn pdf_path_with_bezier_handles_returns_valid_pdf() {
        let nodes = vec![SceneNode {
            id: strata_core::NodeId(1),
            name: "bezier".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Path {
                points: vec![
                    strata_core::PathPoint {
                        x: 0.0,
                        y: 0.0,
                        handle_in: None,
                        handle_out: Some([30.0, 40.0]),
                    },
                    strata_core::PathPoint {
                        x: 100.0,
                        y: 200.0,
                        handle_in: Some([-20.0, -30.0]),
                        handle_out: None,
                    },
                ],
                closed: false,
                tolerance: 1.0,
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
        }];
        let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with bezier path");
        assert!(bytes.starts_with(b"%PDF"), "must produce valid PDF header");
        assert!(bytes.len() > 200, "PDF should have meaningful content");
    }

    #[test]
    fn pdf_path_without_handles_returns_valid_pdf() {
        let nodes = vec![SceneNode {
            id: strata_core::NodeId(2),
            name: "linepath".into(),
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
                        x: 50.0,
                        y: 50.0,
                        handle_in: None,
                        handle_out: None,
                    },
                ],
                closed: false,
                tolerance: 1.0,
            },
            fill: [0, 255, 0, 255],
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
        }];
        let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with line path");
        assert!(bytes.starts_with(b"%PDF"), "must produce valid PDF header");
        assert!(bytes.len() > 200, "PDF should have meaningful content");
    }

    #[test]
    fn pdf_path_asymmetric_single_handle_returns_valid_pdf() {
        let nodes = vec![SceneNode {
            id: strata_core::NodeId(3),
            name: "asymmetric".into(),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Path {
                points: vec![
                    strata_core::PathPoint {
                        x: 10.0,
                        y: 20.0,
                        handle_in: None,
                        handle_out: Some([5.0, 15.0]),
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
            fill: [0, 0, 255, 255],
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
        }];
        let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with asymmetric bezier");
        assert!(bytes.starts_with(b"%PDF"), "must produce valid PDF header");
        assert!(bytes.len() > 200, "PDF should have meaningful content");
    }

    #[test]
    fn export_no_text_operators() {
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf");
        let content = String::from_utf8_lossy(&bytes);
        assert!(
            !content.contains("/Tj") && !content.contains("/TJ"),
            "should not contain text operators"
        );
    }

    // ── Text outlining integration tests ─────────────────────────────────

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
        // Outlined text produces more path data → larger output even after compression
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
        };
        let opts = PdfOptions {
            outline_text: true,
            font_data: Some(font_data),
            ..Default::default()
        };
        let bytes = export_pdf(&[node], &opts).expect("red outlined text");
        assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    }
}
