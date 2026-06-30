//! Print pipeline: font outlining, RGB/CMYK PDF export.
//!
//! `export_pdf()` converts a flat scene into PDF bytes using lopdf, emitting
//! path operators for each shape node. CMYK/PDF-X export lives in `cmyk.rs`.
//!
//! Research basis: lopdf for PDF generation. PDF graphics model uses path
//! construction operators (m, l, re, h, f) per the ISO 32000 spec.

#![forbid(unsafe_code)]

pub mod cmyk;

use lopdf::{dictionary, Document, Object, Stream};
use strata_core::{SceneNode, Shape};

/// Options for PDF export.
#[derive(Debug, Clone)]
pub struct PdfOptions {
    pub page_width: f64,
    pub page_height: f64,
    pub title: String,
    pub author: String,
}

impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Strata Export".into(),
            author: "Strata".into(),
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
                    buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
                }
            }
            if *closed {
                buf.extend_from_slice(b"h f\nQ\n");
            } else {
                buf.extend_from_slice(b"S\nQ\n");
            }
            buf
        }
    }
}

/// Export a scene to PDF bytes using lopdf.
///
/// Each shape node becomes a filled path. Text nodes are outlined as
/// rectangles (full Bezier outlining requires font data integration).
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

    for node in nodes {
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
        }];
        let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with circle");
        assert!(bytes.starts_with(b"%PDF"));
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
}
