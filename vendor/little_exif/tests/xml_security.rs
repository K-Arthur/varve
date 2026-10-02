use little_exif::{exif_tag::ExifTag, filetype::FileExtension, metadata::Metadata};
use quick_xml::{
    events::attributes::AttrError, events::Event, name::NamespaceError, NsReader, Reader,
};

// Exercise the production implementation without changing upstream source.
#[path = "../src/xmp.rs"]
mod xmp;

#[test]
fn xmp_cleanup_preserves_non_exif_metadata_and_escaped_text() {
    let input = br#"<rdf:Description xmlns:exif="urn:exif" xmlns:dc="urn:dc" exif:ImageWidth="1" dc:title="Art &amp; design"><exif:UserComment>old</exif:UserComment><dc:description>Keep &lt;this&gt;</dc:description></rdf:Description>"#;
    let output = String::from_utf8(xmp::remove_exif_from_xmp(input).unwrap()).unwrap();

    assert!(output.contains("dc:title=\"Art &amp; design\""));
    assert!(output.contains("<dc:description>Keep &lt;this&gt;</dc:description>"));
    assert!(!output.contains("exif:ImageWidth"));
    assert!(!output.contains("exif:UserComment"));
}

#[test]
fn xmp_cleanup_retains_a_large_distinct_attribute_set() {
    let mut input = String::from("<rdf:Description exif:ImageWidth=\"1\"");
    for index in 0..10_000 {
        input.push_str(&format!(" a{index}=\"value\""));
    }
    input.push_str("/>");

    let output = xmp::remove_exif_from_xmp(input.as_bytes()).unwrap();
    let mut reader = Reader::from_reader(output.as_slice());
    let Event::Empty(element) = reader.read_event().unwrap() else {
        panic!("expected the preserved empty element");
    };
    assert_eq!(element.attributes().count(), 10_000);
    assert!(element.try_get_attribute("a9999").unwrap().is_some());
    assert!(element
        .try_get_attribute("exif:ImageWidth")
        .unwrap()
        .is_none());
}

#[test]
fn duplicate_attributes_remain_rejected_above_the_hash_threshold() {
    let mut input = String::from("<root");
    for index in 0..1_000 {
        input.push_str(&format!(" a{index}=\"first\""));
    }
    input.push_str(" a42=\"duplicate\"/>");
    let mut reader = Reader::from_str(&input);
    let Event::Empty(element) = reader.read_event().unwrap() else {
        panic!("expected an empty element");
    };
    let failure = element.attributes().find_map(Result::err);
    assert!(matches!(failure, Some(AttrError::Duplicated(_, _))));
}

#[test]
fn namespace_reader_rejects_excess_declarations_by_default() {
    let mut input = String::from("<root");
    for index in 0..257 {
        input.push_str(&format!(" xmlns:n{index}=\"urn:n{index}\""));
    }
    input.push_str("/>");
    let mut reader = NsReader::from_str(&input);
    assert!(matches!(
        reader.read_event(),
        Err(quick_xml::Error::Namespace(
            NamespaceError::TooManyDeclarations(256)
        ))
    ));
}

fn append_png_chunk(bytes: &mut Vec<u8>, name: &[u8; 4], data: &[u8]) {
    bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
    bytes.extend_from_slice(name);
    bytes.extend_from_slice(data);
    let crc = crc::Crc::<u32>::new(&crc::CRC_32_ISO_HDLC);
    let mut digest = crc.digest();
    digest.update(name);
    digest.update(data);
    bytes.extend_from_slice(&digest.finalize().to_be_bytes());
}

#[test]
fn png_exif_write_reopen_preserves_pixels_and_non_exif_xmp() {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = Vec::from(1u32.to_be_bytes());
    header.extend_from_slice(&1u32.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    append_png_chunk(&mut bytes, b"IHDR", &header);
    let xmp = b"XML:com.adobe.xmp\0\0\0\0\0<rdf:Description xmlns:exif=\"urn:exif\" xmlns:dc=\"urn:dc\" exif:ImageWidth=\"1\" dc:title=\"Keep title\"/>";
    append_png_chunk(&mut bytes, b"iTXt", xmp);
    let pixels = miniz_oxide::deflate::compress_to_vec_zlib(&[0, 255, 0, 0, 255], 6);
    append_png_chunk(&mut bytes, b"IDAT", &pixels);
    append_png_chunk(&mut bytes, b"IEND", &[]);
    let description = ExifTag::ImageDescription("Varve generation parameters".to_owned());
    let mut metadata = Metadata::new();
    metadata.set_tag(description.clone());
    let format = FileExtension::PNG {
        as_zTXt_chunk: false,
    };

    metadata.write_to_vec(&mut bytes, format.clone()).unwrap();
    let reopened = Metadata::new_from_vec(&bytes, format).unwrap();

    assert_eq!(reopened.get_tag(&description).next(), Some(&description));
    assert!(bytes.windows(pixels.len()).any(|window| window == pixels));
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("dc:title=\"Keep title\""));
    assert!(!text.contains("exif:ImageWidth"));
}
