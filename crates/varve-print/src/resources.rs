use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ColorSpace {
    Rgb,
    Cmyk,
    Gray,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageResource {
    pub id: String,
    /// Original source URL (matches FillIR::Image.src). Enables Rust to
    /// look up the correct pixel data for each image fill in the manifest
    /// without requiring the TS side to maintain a separate id→src mapping.
    pub src: Option<String>,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    /// Raw pixel bytes (RGBA, or CMYK depending on `color_space`).
    ///
    /// Wire format accepts either a JSON byte array (serde default) or a
    /// base64 string (standard alphabet, padded): the TS print manifest
    /// sends base64 because a JSON number array of pixel bytes is ~4x
    /// larger and orders of magnitude slower to parse at the IPC boundary.
    #[serde(deserialize_with = "deserialize_data_bytes")]
    pub data: Vec<u8>,
    pub color_space: ColorSpace,
}

/// Accept `data` as base64 text or as a plain JSON byte array.
fn deserialize_data_bytes<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct DataVisitor;

    impl<'de> serde::de::Visitor<'de> for DataVisitor {
        type Value = Vec<u8>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a base64 string or an array of bytes")
        }

        fn visit_str<E>(self, value: &str) -> Result<Vec<u8>, E>
        where
            E: serde::de::Error,
        {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(E::custom)
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Vec<u8>, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            let mut bytes = Vec::with_capacity(seq.size_hint().unwrap_or(0));
            while let Some(byte) = seq.next_element::<u8>()? {
                bytes.push(byte);
            }
            Ok(bytes)
        }
    }

    deserializer.deserialize_any(DataVisitor)
}

impl ImageResource {
    pub fn is_valid(&self) -> bool {
        self.width > 0 && self.height > 0 && !self.data.is_empty()
    }

    pub fn pixel_count(&self) -> usize {
        (self.width * self.height) as usize
    }

    pub fn byte_count(&self) -> usize {
        self.pixel_count() * 4 // RGBA
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatternResource {
    pub id: String,
    pub tile_image_id: String, // References ImageResource.id
    pub spacing: f64,
    pub rotation: f64,
    pub tile_width: f64,
    pub tile_height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportManifest {
    pub images: Vec<ImageResource>,
    pub patterns: Vec<PatternResource>,
}

#[derive(Debug, Clone)]
pub struct ResourceError {
    pub resource_id: String,
    pub message: String,
}

impl std::fmt::Display for ResourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Resource '{}' not found: {}",
            self.resource_id, self.message
        )
    }
}

impl std::error::Error for ResourceError {}

impl ExportManifest {
    pub fn validate(&self) -> Result<(), Vec<ResourceError>> {
        let mut errors = Vec::new();
        for img in &self.images {
            if !img.is_valid() {
                errors.push(ResourceError {
                    resource_id: img.id.clone(),
                    message: format!("Invalid image: {}x{}", img.width, img.height),
                });
            }
        }
        for pat in &self.patterns {
            if !self.images.iter().any(|i| i.id == pat.tile_image_id) {
                errors.push(ResourceError {
                    resource_id: pat.tile_image_id.clone(),
                    message: format!("Pattern tile image '{}' not found", pat.tile_image_id),
                });
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    pub fn resolve_image(&self, id: &str) -> Result<&ImageResource, ResourceError> {
        self.images
            .iter()
            .find(|i| i.id == id)
            .ok_or_else(|| ResourceError {
                resource_id: id.to_string(),
                message: "Image not found in manifest".to_string(),
            })
    }

    /// Resolve an image by its original source URL. Images from the export
    /// pipeline carry the original URL in `src`, matching `FillIR::Image.src`.
    /// Falls back to id-based lookup when `src` is None (backward compat with
    /// manifests that don't set src, e.g. pattern-only manifests).
    pub fn resolve_image_by_src(&self, src: &str) -> Result<&ImageResource, ResourceError> {
        self.images
            .iter()
            .find(|i| i.src.as_deref() == Some(src))
            .or_else(|| self.images.iter().find(|i| i.id == src))
            .ok_or_else(|| ResourceError {
                resource_id: src.to_string(),
                message: format!("Image with src '{src}' not found in manifest"),
            })
    }

    pub fn resolve_pattern(&self, id: &str) -> Result<&PatternResource, ResourceError> {
        self.patterns
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| ResourceError {
                resource_id: id.to_string(),
                message: "Pattern not found in manifest".to_string(),
            })
    }

    pub fn deduplicate_images(&mut self) {
        use std::collections::HashMap;
        let mut seen: HashMap<&[u8], usize> = HashMap::new();
        let mut id_map: HashMap<String, String> = HashMap::new();

        for (idx, img) in self.images.iter().enumerate() {
            if let Some(&existing_idx) = seen.get(img.data.as_slice()) {
                let existing_id = self.images[existing_idx].id.clone();
                id_map.insert(img.id.clone(), existing_id);
            } else {
                seen.insert(img.data.as_slice(), idx);
            }
        }

        // Remove duplicates (keep first occurrence)
        self.images.retain(|img| !id_map.contains_key(&img.id));

        // Update pattern references
        for pat in &mut self.patterns {
            if let Some(new_id) = id_map.get(&pat.tile_image_id) {
                pat.tile_image_id = new_id.clone();
            }
        }
    }
}

#[cfg(test)]
mod resource_tests {
    use super::*;

    #[test]
    fn manifest_data_deserializes_from_base64_string() {
        use base64::Engine as _;
        let raw: Vec<u8> = (0u8..64).collect();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&raw);
        let json = format!(
            r#"{{"images":[{{"id":"img_0","src":"data:image/png;base64,AAAA","mime_type":"image/raw-rgba","width":4,"height":4,"data":"{b64}","color_space":"Rgb"}}],"patterns":[]}}"#
        );
        let manifest: ExportManifest = serde_json::from_str(&json).expect("base64 manifest parses");
        assert_eq!(manifest.images[0].data, raw);
        assert_eq!(manifest.images[0].color_space, ColorSpace::Rgb);
        assert!(manifest.images[0].is_valid());
    }

    #[test]
    fn manifest_data_still_deserializes_from_json_byte_array() {
        let json = r#"{"images":[{"id":"img_0","src":null,"mime_type":"image/raw-rgba","width":1,"height":1,"data":[1,2,3,4],"color_space":"Rgb"}],"patterns":[]}"#;
        let manifest: ExportManifest = serde_json::from_str(json).expect("array manifest parses");
        assert_eq!(manifest.images[0].data, vec![1, 2, 3, 4]);
    }

    #[test]
    fn manifest_data_rejects_malformed_base64() {
        let json = r#"{"images":[{"id":"img_0","src":null,"mime_type":"image/raw-rgba","width":1,"height":1,"data":"!!!not-base64!!!","color_space":"Rgb"}],"patterns":[]}"#;
        let err = serde_json::from_str::<ExportManifest>(json)
            .unwrap_err()
            .to_string();
        assert!(
            err.to_ascii_lowercase().contains("base64")
                || err.to_ascii_lowercase().contains("invalid")
                || err.to_ascii_lowercase().contains("symbol"),
            "unexpected parse error: {err}"
        );
    }

    #[test]
    fn resource_manifest_roundtrip() {
        let manifest = ExportManifest {
            images: vec![ImageResource {
                id: "img_0".into(),
                src: None,
                mime_type: "image/png".into(),
                width: 100,
                height: 50,
                data: vec![255u8; 100 * 50 * 4],
                color_space: ColorSpace::Rgb,
            }],
            patterns: vec![PatternResource {
                id: "pat_0".into(),
                tile_image_id: "img_0".into(),
                spacing: 10.0,
                rotation: 45.0,
                tile_width: 32.0,
                tile_height: 32.0,
            }],
        };

        let json = serde_json::to_string(&manifest).unwrap();
        let restored: ExportManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.images.len(), 1);
        assert_eq!(restored.patterns.len(), 1);
        assert_eq!(restored.images[0].id, "img_0");
        assert_eq!(restored.patterns[0].tile_image_id, "img_0");
    }

    #[test]
    fn image_resource_validates_dimensions() {
        let valid = ImageResource {
            id: "ok".into(),
            src: None,
            mime_type: "image/png".into(),
            width: 10,
            height: 20,
            data: vec![0; 800],
            color_space: ColorSpace::Rgb,
        };
        assert!(valid.is_valid());
        assert_eq!(valid.pixel_count(), 200);
        assert_eq!(valid.byte_count(), 800);

        let zero_w = ImageResource {
            id: "bad".into(),
            src: None,
            mime_type: "image/png".into(),
            width: 0,
            height: 10,
            data: vec![0; 400],
            color_space: ColorSpace::Rgb,
        };
        assert!(!zero_w.is_valid());

        let empty_data = ImageResource {
            id: "empty".into(),
            src: None,
            mime_type: "image/png".into(),
            width: 10,
            height: 10,
            data: vec![],
            color_space: ColorSpace::Rgb,
        };
        assert!(!empty_data.is_valid());
    }

    #[test]
    fn missing_resource_produces_structured_error() {
        let manifest = ExportManifest {
            images: vec![],
            patterns: vec![],
        };

        let err = manifest.resolve_image("nonexistent").unwrap_err();
        assert_eq!(err.resource_id, "nonexistent");
        assert!(err.message.contains("not found"));

        let err = manifest.resolve_pattern("nonexistent").unwrap_err();
        assert_eq!(err.resource_id, "nonexistent");
        assert!(err.message.contains("not found"));
    }

    #[test]
    fn deduplicate_merges_identical_images() {
        let data = vec![128u8; 400];
        let mut manifest = ExportManifest {
            images: vec![
                ImageResource {
                    id: "img_0".into(),
                    src: None,
                    mime_type: "image/png".into(),
                    width: 10,
                    height: 10,
                    data: data.clone(),
                    color_space: ColorSpace::Rgb,
                },
                ImageResource {
                    id: "img_1".into(),
                    src: None,
                    mime_type: "image/png".into(),
                    width: 10,
                    height: 10,
                    data: data.clone(),
                    color_space: ColorSpace::Rgb,
                },
                ImageResource {
                    id: "img_2".into(),
                    src: None,
                    mime_type: "image/png".into(),
                    width: 5,
                    height: 5,
                    data: vec![0; 100],
                    color_space: ColorSpace::Rgb,
                },
            ],
            patterns: vec![PatternResource {
                id: "pat_0".into(),
                tile_image_id: "img_1".into(),
                spacing: 0.0,
                rotation: 0.0,
                tile_width: 10.0,
                tile_height: 10.0,
            }],
        };

        manifest.deduplicate_images();
        assert_eq!(manifest.images.len(), 2);
        assert_eq!(manifest.images[0].id, "img_0");
        assert_eq!(manifest.images[1].id, "img_2");
        assert_eq!(manifest.patterns[0].tile_image_id, "img_0");
    }

    #[test]
    fn pattern_references_valid_image() {
        let manifest = ExportManifest {
            images: vec![ImageResource {
                id: "tile".into(),
                src: None,
                mime_type: "image/png".into(),
                width: 32,
                height: 32,
                data: vec![0; 32 * 32 * 4],
                color_space: ColorSpace::Rgb,
            }],
            patterns: vec![PatternResource {
                id: "pat".into(),
                tile_image_id: "tile".into(),
                spacing: 5.0,
                rotation: 0.0,
                tile_width: 32.0,
                tile_height: 32.0,
            }],
        };

        assert!(manifest.validate().is_ok());

        let broken = ExportManifest {
            images: vec![],
            patterns: vec![PatternResource {
                id: "pat".into(),
                tile_image_id: "missing".into(),
                spacing: 5.0,
                rotation: 0.0,
                tile_width: 32.0,
                tile_height: 32.0,
            }],
        };

        let errors = broken.validate().unwrap_err();
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("not found"));
    }
}
