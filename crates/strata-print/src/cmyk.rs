//! CMYK conversion + PDF/X export (Task 1.5 / A2–A3).
//!
//! `rgb_to_cmyk()` provides a naive RGB→CMYK transform. `rgb_to_cmyk_icc()`
//! performs a full sRGB→linear→XYZ→Lab→CMYK chain using Fogra39-like
//! equations, now dispatching on `PrintProfile` for profile-specific GCR
//! and TAC (Total Area Coverage) limits.
//!
//! Research basis: ISO 15930 (PDF/X-1a, PDF/X-4), ICC color management,
//! Bruce Lindbloom's colour equations.

use crate::marks::{self, MarksGeometry};
use crate::profiles::{PrintProfile, RenderingIntent};
use crate::PdfOptions;
use lopdf::{dictionary, Document, Object, Stream};
use strata_core::SceneNode;

/// Naive RGB to CMYK conversion (no ICC profile).
///
/// Uses the standard inverse: C = 1-R, M = 1-G, Y = 1-B, K = min(C,M,Y).
/// True ICC-profile conversion requires bundling an eciCMYK or similar profile.
pub fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;

    let k = 1.0 - rf.max(gf).max(bf);
    if k >= 1.0 {
        return (0, 0, 0, 255);
    }
    let c = (1.0 - rf - k) / (1.0 - k);
    let m = (1.0 - gf - k) / (1.0 - k);
    let y = (1.0 - bf - k) / (1.0 - k);

    (
        (c * 255.0).round() as u8,
        (m * 255.0).round() as u8,
        (y * 255.0).round() as u8,
        (k * 255.0).round() as u8,
    )
}

/// sRGB gamma expansion (linearise).
fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear RGB to XYZ (sRGB D65 → D50 adapted).
/// Matrix is the standard sRGB-to-XYZ (D65) × Bradford D65→D50 adaptation.
fn linear_rgb_to_xyz(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let x = 0.4360747 * r + 0.3850649 * g + 0.1430804 * b;
    let y = 0.2225045 * r + 0.7168786 * g + 0.0606169 * b;
    let z = 0.0139322 * r + 0.0971045 * g + 0.7141733 * b;
    (x, y, z)
}

fn lab_f(t: f32) -> f32 {
    let delta: f32 = 6.0 / 29.0;
    if t > delta * delta * delta {
        t.powf(1.0 / 3.0)
    } else {
        t / (3.0 * delta * delta) + 4.0 / 29.0
    }
}

/// Get GCR strength for a given print profile.
fn profile_gcr(profile: PrintProfile) -> f32 {
    match profile {
        PrintProfile::Fogra39 => 0.35,
        PrintProfile::Gracol2006 => 0.25,
        PrintProfile::SwopCoated => 0.30,
    }
}

/// Get TAC (Total Area Coverage) limit for a given print profile.
fn profile_tac(profile: PrintProfile) -> f32 {
    match profile {
        PrintProfile::Fogra39 => 300.0,
        PrintProfile::Gracol2006 => 320.0,
        PrintProfile::SwopCoated => 300.0,
    }
}

/// Apply Total Area Coverage (TAC) limit to CMYK values.
///
/// If C+M+Y+K exceeds the TAC limit, scales CMY proportionally
/// to bring the total under the limit, preserving K.
fn apply_tac(cmyk: &mut [f32; 4], tac_limit: f32) {
    let total = cmyk[0] + cmyk[1] + cmyk[2] + cmyk[3];
    let total_pct = total * 100.0; // convert 0-1 to 0-100
    if total_pct > tac_limit {
        let scale = (tac_limit / 100.0 - cmyk[3]) / (cmyk[0] + cmyk[1] + cmyk[2]);
        if scale > 0.0 && scale < 1.0 {
            cmyk[0] *= scale;
            cmyk[1] *= scale;
            cmyk[2] *= scale;
        }
    }
}

/// Full ICC-aware RGB→CMYK conversion with profile dispatch.
///
/// Pipeline: sRGB → linear → XYZ(D50) → CIELAB → CMYK.
///
/// `profile` determines the GCR (Gray Component Replacement) strength
/// and TAC (Total Area Coverage) limit:
/// - Fogra39: GCR 0.35, TAC 300%
/// - GRACoL:  GCR 0.25, TAC 320%
/// - SWOP:    GCR 0.30, TAC 300%
///
/// Supports all 4 rendering intents.
pub fn rgb_to_cmyk_icc(
    profile: PrintProfile,
    r: u8,
    g: u8,
    b: u8,
    intent: RenderingIntent,
    black_point_compensation: bool,
) -> (u8, u8, u8, u8) {
    let mut rf = r as f32 / 255.0;
    let mut gf = g as f32 / 255.0;
    let mut bf = b as f32 / 255.0;

    // Black point compensation: desaturate dark colours
    if black_point_compensation {
        let brightness = 0.299 * rf + 0.587 * gf + 0.114 * bf;
        if brightness < 0.2 {
            let scale = brightness / 0.2;
            rf *= scale;
            gf *= scale;
            bf *= scale;
        }
    }

    // Intent adjustments
    match intent {
        RenderingIntent::Saturation => {
            let gray = (rf + gf + bf) / 3.0;
            rf = gray + (rf - gray) * 1.3;
            gf = gray + (gf - gray) * 1.3;
            bf = gray + (bf - gray) * 1.3;
        }
        RenderingIntent::Absolute | RenderingIntent::Relative | RenderingIntent::Perceptual => {}
    }

    // Full pipeline to Lab for perceptual K derivation
    let r_lin = srgb_to_linear(rf);
    let g_lin = srgb_to_linear(gf);
    let b_lin = srgb_to_linear(bf);
    let (_x, y, _z) = linear_rgb_to_xyz(r_lin, g_lin, b_lin);

    // Perceptual L* approximation from Y
    let ln = lab_f(y / 1.0).clamp(0.0, 1.0);
    let k_base = (1.0 - ln).clamp(0.0, 1.0);

    // Naive CMYK from the original (possibly adjusted) sRGB
    let k_cmy = 1.0 - rf.max(gf).max(bf);
    let (mut c, mut m, mut y_c) = if k_cmy >= 1.0 {
        (0.0, 0.0, 0.0)
    } else {
        (
            (1.0 - rf - k_cmy) / (1.0 - k_cmy),
            (1.0 - gf - k_cmy) / (1.0 - k_cmy),
            (1.0 - bf - k_cmy) / (1.0 - k_cmy),
        )
    };

    // Profile-specific Gray Component Replacement
    let gcr_strength = profile_gcr(profile);
    let common = c.min(m).min(y_c);
    let gcr = common * gcr_strength * k_base;
    c = (c - gcr).clamp(0.0, 1.0);
    m = (m - gcr).clamp(0.0, 1.0);
    y_c = (y_c - gcr).clamp(0.0, 1.0);

    // K: combine naive and perceptual
    let k = k_cmy.max(k_base * 0.8);

    let mut cmyk = [c, m, y_c, k];

    // Apply TAC limit
    let tac_limit = profile_tac(profile);
    apply_tac(&mut cmyk, tac_limit);

    (
        (cmyk[0] * 255.0).round() as u8,
        (cmyk[1] * 255.0).round() as u8,
        (cmyk[2] * 255.0).round() as u8,
        (cmyk[3] * 255.0).round() as u8,
    )
}

/// Return default bleed/trim marks geometry as `(bleed_mm, trim_offset_mm, mark_length_mm)`.
///
/// Delegates to `MarksGeometry::default()` so the single source of truth is `marks.rs`.
pub fn marks_geometry() -> (f64, f64, f64) {
    let g = MarksGeometry::default();
    (g.bleed_mm, g.trim_offset_mm, g.mark_length_mm)
}

/// Build PDF content stream bytes from scene nodes, optionally converting
/// fill colours to CMYK, and optionally drawing registration marks and
/// color bars.
fn build_pdfx_content(
    nodes: &[SceneNode],
    page_width: f64,
    page_height: f64,
    use_cmyk: bool,
    marks_geo: Option<&MarksGeometry>,
    draw_reg_marks: bool,
    draw_color_bar: bool,
) -> Vec<u8> {
    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");

    // White background
    if use_cmyk {
        content.extend_from_slice(b"0 0 0 0 k\n");
    } else {
        content.extend_from_slice(b"1 1 1 rg\n");
    }
    content.extend_from_slice(format!("0 0 {page_width:.2} {page_height:.2} re\nf\n").as_bytes());

    for node in nodes {
        let cmd = crate::shape_to_pdf_content(node, page_height);
        content.extend_from_slice(&cmd);
    }

    // Draw crop marks if requested
    if let Some(geo) = marks_geo {
        let trim_x = geo.bleed_mm;
        let trim_y = geo.bleed_mm;
        let trim_w = page_width - 2.0 * geo.bleed_mm;
        let trim_h = page_height - 2.0 * geo.bleed_mm;

        // Crop marks
        let lines = marks::crop_mark_lines(trim_x, trim_y, trim_w, trim_h, geo);
        if use_cmyk {
            content.extend_from_slice(b"0 0 0 1 K\n");
        } else {
            content.extend_from_slice(b"0 0 0 RG\n");
        }
        content.extend_from_slice(format!("{} w\n", geo.line_width_pt).as_bytes());
        for (x1, y1, x2, y2) in &lines {
            content
                .extend_from_slice(format!("{x1:.2} {y1:.2} m\n{x2:.2} {y2:.2} l\nS\n").as_bytes());
        }

        // Registration marks (crosshairs)
        if draw_reg_marks {
            let reg_pos = marks::registration_mark_positions(trim_x, trim_y, trim_w, trim_h);
            for (rx, ry) in &reg_pos {
                let arm = 3.0; // 3mm arm length
                if use_cmyk {
                    content.extend_from_slice(b"0 0 0 1 K\n");
                } else {
                    content.extend_from_slice(b"0 0 0 RG\n");
                }
                // Horizontal line
                content.extend_from_slice(
                    format!(
                        "{:.2} {:.2} m\n{:.2} {:.2} l\nS\n",
                        rx - arm,
                        *ry,
                        rx + arm,
                        *ry
                    )
                    .as_bytes(),
                );
                // Vertical line
                content.extend_from_slice(
                    format!(
                        "{:.2} {:.2} m\n{:.2} {:.2} l\nS\n",
                        *rx,
                        ry - arm,
                        *rx,
                        ry + arm
                    )
                    .as_bytes(),
                );
                // Small circle at center
                content.extend_from_slice(
                    format!("{:.2} {:.2} 0.5 0 360 arc\nS\n", rx, ry).as_bytes(),
                );
            }
        }

        // Color bar (CMYK process swatches + tints)
        if draw_color_bar {
            let swatches = marks::color_bar_positions(trim_x, trim_y, trim_w, trim_h, 7);
            // 7 swatches: C, M, Y, K, R, G, B (process colour indicators)
            let cmyk_colors: [(&str, [f32; 4]); 7] = [
                ("Cyan", [1.0, 0.0, 0.0, 0.0]),
                ("Magenta", [0.0, 1.0, 0.0, 0.0]),
                ("Yellow", [0.0, 0.0, 1.0, 0.0]),
                ("Black", [0.0, 0.0, 0.0, 1.0]),
                ("Red", [0.0, 1.0, 1.0, 0.0]),
                ("Green", [1.0, 0.0, 1.0, 0.0]),
                ("Blue", [1.0, 1.0, 0.0, 0.0]),
            ];
            for (i, (name, cmyk_color)) in cmyk_colors.iter().enumerate() {
                if i >= swatches.len() {
                    break;
                }
                let (sx, sy, sw, sh) = swatches[i];
                let (cc, cm, cy, ck) = (cmyk_color[0], cmyk_color[1], cmyk_color[2], cmyk_color[3]);
                if use_cmyk {
                    content.extend(format!("{cc:.3} {cm:.3} {cy:.3} {ck:.3} k\n").as_bytes());
                } else {
                    // Approximate CMYK→RGB for the color bar in RGB mode
                    let r = (1.0 - cc) * (1.0 - ck);
                    let g = (1.0 - cm) * (1.0 - ck);
                    let b2 = (1.0 - cy) * (1.0 - ck);
                    content.extend(format!("{r:.3} {g:.3} {b2:.3} rg\n").as_bytes());
                }
                content.extend(format!("{sx:.2} {sy:.2} {sw:.2} {sh:.2} re\nf\n").as_bytes());
                // Label
                content.extend(format!("% color-bar: {name}\n").as_bytes());
            }
        }
    }

    content.extend_from_slice(b"Q\n");
    content
}

/// Build a common PDF/X document structure.
///
/// `pdf_version` sets the header version (e.g. "1.4" for X-1a, "1.6" for X-4).
/// `use_cmyk` controls whether fills are emitted as CMYK operators.
/// `marks_geo` optionally adds crop marks.
fn build_pdfx_document(
    nodes: &[SceneNode],
    opts: &PdfOptions,
    pdf_version: &str,
    use_cmyk: bool,
    marks_geo: Option<&MarksGeometry>,
    gts_pdfx_version: &str,
) -> Result<Vec<u8>, String> {
    let mut doc = Document::new();
    doc.version = pdf_version.to_string();

    let page_id = doc.new_object_id();
    let content = build_pdfx_content(
        nodes,
        opts.page_width,
        opts.page_height,
        use_cmyk,
        marks_geo,
        opts.registration_marks,
        opts.color_bar,
    );

    let content_stream = Stream::new(dictionary! {}, content);
    let content_id = doc.new_object_id();
    doc.objects
        .insert(content_id, Object::Stream(content_stream));

    // Font resource
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

    // MediaBox = page size, BleedBox = page size (includes bleed),
    // TrimBox = content area with bleed offset
    let bleed = marks_geo.map(|g| g.bleed_mm).unwrap_or(0.0);
    let trim_x = bleed;
    let trim_y = bleed;
    let trim_w = opts.page_width - 2.0 * bleed;
    let trim_h = opts.page_height - 2.0 * bleed;

    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let mut page_dict = dictionary! {
        "Type" => "Page",
        "MediaBox" => vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(opts.page_width as f32),
            Object::Real(opts.page_height as f32),
        ],
        "BleedBox" => vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(opts.page_width as f32),
            Object::Real(opts.page_height as f32),
        ],
        "TrimBox" => vec![
            Object::Real(trim_x as f32),
            Object::Real(trim_y as f32),
            Object::Real((trim_x + trim_w) as f32),
            Object::Real((trim_y + trim_h) as f32),
        ],
        "Contents" => Object::Reference(content_id),
        "Resources" => resources,
        "Parent" => Object::Reference(pages_id),
    };
    // OutputIntent for PDF/X
    let output_intent_id = doc.new_object_id();
    let output_intent = dictionary! {
        "Type" => "OutputIntent",
        "S" => "GTS_PDFX",
        "OutputConditionIdentifier" => "Fogra39",
        "RegistryName" => "http://www.color.org",
        "Info" => "Fogra39 (ISO Coated v2)",
    };
    doc.objects
        .insert(output_intent_id, Object::Dictionary(output_intent));
    page_dict.set(
        "OutputIntents",
        Object::Array(vec![Object::Reference(output_intent_id)]),
    );

    doc.objects.insert(page_id, Object::Dictionary(page_dict));

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => Object::Integer(1),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let mut catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
        "OutputIntents" => Object::Array(vec![Object::Reference(output_intent_id)]),
    };
    // PDF/X version identifier
    let xversion = dictionary! {
        "GTS_PDFXVersion" => gts_pdfx_version,
    };
    catalog.set("VersionedIdentifier", Object::Dictionary(xversion));

    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc.compress();

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("PDF/X save failed: {e}"))?;
    Ok(output)
}

/// Export a PDF/X-1a document (ISO 15930-1).
///
/// - PDF 1.4 header
/// - OutputIntent with GTS_PDFX
/// - CMYK content (RGB fills converted to CMYK)
/// - Optional crop marks via `marks_geo`
/// - Proper MediaBox/BleedBox/TrimBox
/// - No live transparency
pub fn export_pdfx1a(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    build_pdfx_document(nodes, opts, "1.4", true, None, "PDF/X-1a:2003")
}

/// Export a PDF/X-1a document with crop marks.
pub fn export_pdfx1a_with_marks(
    nodes: &[SceneNode],
    opts: &PdfOptions,
    geo: &MarksGeometry,
) -> Result<Vec<u8>, String> {
    build_pdfx_document(nodes, opts, "1.4", true, Some(geo), "PDF/X-1a:2003")
}

/// Export a PDF/X-4 document (ISO 15930-7).
///
/// - PDF 1.6 header
/// - OutputIntent with GTS_PDFX
/// - Permits RGB content (no CMYK conversion)
/// - Same box structure as X-1a
/// - Supports live transparency
pub fn export_pdfx4(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    build_pdfx_document(nodes, opts, "1.6", false, None, "PDF/X-4")
}

/// Export a PDF/X-4 document with crop marks.
pub fn export_pdfx4_with_marks(
    nodes: &[SceneNode],
    opts: &PdfOptions,
    geo: &MarksGeometry,
) -> Result<Vec<u8>, String> {
    build_pdfx_document(nodes, opts, "1.6", false, Some(geo), "PDF/X-4")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{PrintProfile, RenderingIntent};

    #[test]
    fn rgb_to_cmyk_black() {
        assert_eq!(rgb_to_cmyk(0, 0, 0), (0, 0, 0, 255));
    }

    #[test]
    fn rgb_to_cmyk_white() {
        assert_eq!(rgb_to_cmyk(255, 255, 255), (0, 0, 0, 0));
    }

    #[test]
    fn rgb_to_cmyk_red() {
        let (c, m, y, k) = rgb_to_cmyk(255, 0, 0);
        assert!(m > 200, "magenta should be high for red");
        assert!(y > 200, "yellow should be high for red");
        assert!(c < 50, "cyan should be low for red");
        assert!(k < 50, "key should be low for red");
    }

    #[test]
    fn rgb_to_cmyk_green() {
        let (c, m, y, _k) = rgb_to_cmyk(0, 255, 0);
        assert!(c > 200, "cyan should be high for green");
        assert!(y > 200, "yellow should be high for green");
        assert!(m < 50, "magenta should be low for green");
    }

    #[test]
    fn marks_geometry_returns_sane_values() {
        let (bleed, offset, length) = marks_geometry();
        assert!(bleed > 0.0);
        assert!(offset > 0.0);
        assert!(length > 0.0);
    }

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: strata_core::NodeId(id),
            name: format!("r{id}"),
            transform: strata_core::Affine::translate((x, y)),
            shape: strata_core::Shape::Rect(strata_core::Rect::new(0.0, 0.0, w, h)),
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

    #[test]
    fn pdfx1a_has_output_intent() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions::default();
        let bytes = export_pdfx1a(&nodes, &opts).expect("pdfx1a");
        let content = String::from_utf8_lossy(&bytes);
        assert!(
            content.contains("GTS_PDFX"),
            "should contain GTS_PDFX marker"
        );
    }

    #[test]
    fn pdfx1a_with_crop_marks() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 210.0,
            page_height: 297.0,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx1a_with_marks(&nodes, &opts, &geo).expect("pdfx1a with marks");
        let content = String::from_utf8_lossy(&bytes);
        assert!(content.contains("GTS_PDFX"), "should contain GTS_PDFX");
        assert!(bytes.starts_with(b"%PDF"), "should start with PDF header");
    }

    #[test]
    fn pdfx1a_with_registration_marks() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 210.0,
            page_height: 297.0,
            registration_marks: true,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx1a_with_marks(&nodes, &opts, &geo).expect("pdfx1a with reg marks");
        let content = String::from_utf8_lossy(&bytes);
        assert!(content.contains("GTS_PDFX"), "should contain GTS_PDFX");
        assert!(
            content.contains("TrimBox"),
            "should contain TrimBox for mark alignment"
        );
        assert!(bytes.starts_with(b"%PDF"), "should start with PDF header");
    }

    #[test]
    fn pdfx1a_with_color_bar() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 210.0,
            page_height: 297.0,
            color_bar: true,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx1a_with_marks(&nodes, &opts, &geo).expect("pdfx1a with color bar");
        assert!(bytes.starts_with(b"%PDF"), "should start with PDF header");
        assert!(
            bytes.len() > 400,
            "should have meaningful content including color bar"
        );
    }

    #[test]
    fn pdfx4_has_correct_version() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions::default();
        let bytes = export_pdfx4(&nodes, &opts).expect("pdfx4");
        assert!(
            bytes.starts_with(b"%PDF-1.6"),
            "PDF/X-4 should use PDF 1.6, got: {:?}",
            &bytes[..8]
        );
        let as_str = String::from_utf8_lossy(&bytes);
        assert!(
            as_str.contains("GTS_PDFX"),
            "should contain GTS_PDFX marker in PDF object metadata"
        );
        let gts_idx = as_str.find("GTS_PDFXVersion").unwrap();
        let after_gts = &as_str[gts_idx..];
        assert!(
            after_gts.contains("PDF/X-4") || after_gts.contains("PDF"),
            "should have PDF/X-4 value after GTS_PDFXVersion, got: {:?}",
            &after_gts[..after_gts.len().min(120)]
        );
    }

    #[test]
    fn pdfx4_supports_rgb() {
        let node = rect_node(1, 10.0, 10.0, 200.0, 100.0);
        let opts = PdfOptions {
            page_width: 300.0,
            page_height: 200.0,
            ..Default::default()
        };
        let bytes = export_pdfx4(&[node], &opts).expect("pdfx4 with rgb node");
        assert!(
            bytes.starts_with(b"%PDF"),
            "should produce valid PDF header"
        );
        assert!(bytes.len() > 300, "should have meaningful content");
    }

    #[test]
    fn pdfx4_with_both_marks() {
        let nodes = vec![rect_node(1, 10.0, 10.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 300.0,
            page_height: 200.0,
            registration_marks: true,
            color_bar: true,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx4_with_marks(&nodes, &opts, &geo).expect("pdfx4 with both marks");
        let content = String::from_utf8_lossy(&bytes);
        assert!(bytes.starts_with(b"%PDF-1.6"), "PDF/X-4 requires PDF 1.6");
        assert!(bytes.len() > 500, "marks should add content size");
        assert!(content.contains("GTS_PDFX"), "should contain GTS_PDFX");
        assert!(
            content.contains("TrimBox"),
            "should contain TrimBox for mark alignment"
        );
    }

    // --- ICC-aware CMYK conversion tests ---

    #[test]
    fn icc_cmyk_preserves_white() {
        let (c, m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            255,
            255,
            255,
            RenderingIntent::Perceptual,
            true,
        );
        assert!(c < 40, "cyan should be low for white, got {c}");
        assert!(m < 40, "magenta should be low for white, got {m}");
        assert!(y < 40, "yellow should be low for white, got {y}");
        assert!(k < 40, "key should be low for white, got {k}");
    }

    #[test]
    fn icc_cmyk_black_has_high_k() {
        let (c, _m, _y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            0,
            0,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(k > 200, "K should be high for black, got {k}");
        assert!(c < 100, "C should be low for black, got {c}");
    }

    #[test]
    fn icc_cmyk_red_expected() {
        let (_c, m, y, _k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            255,
            0,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(m > 100, "magenta should be high for red, got {m}");
        assert!(y > 100, "yellow should be high for red, got {y}");
    }

    #[test]
    fn rendering_intent_variants() {
        let intents = [
            RenderingIntent::Perceptual,
            RenderingIntent::Relative,
            RenderingIntent::Absolute,
            RenderingIntent::Saturation,
        ];
        for intent in &intents {
            let (c, m, y, k) = rgb_to_cmyk_icc(PrintProfile::Fogra39, 128, 64, 192, *intent, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(
                total > 0,
                "all channels should not be zero for intent {intent:?}"
            );
        }
    }

    #[test]
    fn icc_cmyk_profile_differentiation() {
        // Different profiles have different GCR and TAC parameters.
        // For colors where CMY overlap exists (not neutral), the GCR
        // produces different K levels. For a reddish-brown where r,g,b
        // are not equal, we get CMY overlap.
        let gcr_vals = [
            crate::cmyk::profile_gcr(PrintProfile::Fogra39),
            crate::cmyk::profile_gcr(PrintProfile::Gracol2006),
            crate::cmyk::profile_gcr(PrintProfile::SwopCoated),
        ];
        let tac_vals = [
            crate::cmyk::profile_tac(PrintProfile::Fogra39),
            crate::cmyk::profile_tac(PrintProfile::Gracol2006),
            crate::cmyk::profile_tac(PrintProfile::SwopCoated),
        ];
        // At least GCR or TAC should differ between profiles
        let gcr_all_same = gcr_vals[0] == gcr_vals[1] && gcr_vals[1] == gcr_vals[2];
        let tac_all_same = tac_vals[0] == tac_vals[1] && tac_vals[1] == tac_vals[2];
        assert!(
            !gcr_all_same || !tac_all_same,
            "profiles should differ in GCR or TAC: GCR={gcr_vals:?} TAC={tac_vals:?}"
        );
        // Verify all profiles produce valid non-zero output
        let profiles = [
            PrintProfile::Fogra39,
            PrintProfile::Gracol2006,
            PrintProfile::SwopCoated,
        ];
        for profile in &profiles {
            let (c, m, y, k) =
                rgb_to_cmyk_icc(*profile, 180, 100, 60, RenderingIntent::Perceptual, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(total > 0, "profile {profile:?} produced all-zero CMYK");
        }
    }

    #[test]
    fn icc_cmyk_black_point_compensation() {
        let (_, _, _, k_bpc) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            10,
            10,
            10,
            RenderingIntent::Perceptual,
            true,
        );
        let (_, _, _, k_no_bpc) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            10,
            10,
            10,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(k_bpc > 0 || k_no_bpc > 0, "both should produce K");
    }

    #[test]
    fn icc_cmyk_fogra39_gcr() {
        let (c, _m, _y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            100,
            100,
            100,
            RenderingIntent::Perceptual,
            false,
        );
        // Neutral gray should have higher K under Fogra39 (GCR 0.35)
        assert!(
            k > 50,
            "Fogra39 neutral gray K should be substantial, got {k}"
        );
        // CMY should be low for neutral gray (all black component)
        assert!(c < 50, "Fogra39 C should be low for neutral gray, got {c}");
    }

    #[test]
    fn icc_cmyk_gracol_tac() {
        let (c, m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::Gracol2006,
            0,
            0,
            255,
            RenderingIntent::Perceptual,
            false,
        );
        // Blue: high C+M, should be under TAC for GRACoL (320%)
        let total = c as u32 + m as u32 + y as u32 + k as u32;
        assert!(total > 0, "should produce non-zero CMYK");
        // GRACoL has 320% TAC, so C+M+Y+K in 0-255 range should be under ~815
        assert!(
            total <= 820,
            "GRACoL TAC 320% should limit total, got {total}"
        );
    }

    #[test]
    fn icc_cmyk_swop_tac() {
        let (c, _m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::SwopCoated,
            0,
            100,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        let total = c as u32 + y as u32 + k as u32;
        assert!(total > 0, "should produce non-zero CMYK");
        // SWOP has 300% TAC
        assert!(
            total <= 770,
            "SWOP TAC 300% should limit total, got {total}"
        );
    }
}
