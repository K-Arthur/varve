# Varve patch to little_exif 0.6.23

The source and license files come from the published crate archive:

- Upstream: <https://github.com/TechnikTobi/little_exif>
- Source revision: `2d6d73acea033630a1cf0056d23b9da81e0638c8`
- Archive SHA-256: `21eeb58b22d31be8dc5c625004fcd4b9b385cd3c05df575f523bcca382c51122`
- License: MIT OR Apache-2.0, with both upstream license files retained.

The normalized Cargo manifest's `quick-xml` requirement changes from
`0.37.5` to `0.41.0`, and its Rust minimum becomes 1.79 to reflect the parser's
requirement. No published little_exif release currently contains this
upgrade. The original manifest remains in `Cargo.toml.orig`; production Rust
source is unchanged. The package remains at its real upstream version.

quick-xml 0.41.0 fixes [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194.html)
(quadratic duplicate-attribute checks) and
[RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195.html)
(unbounded namespace declarations). Default duplicate checks and namespace
limits remain enabled. little_exif uses the ordinary XML Reader for XMP
cleanup; its attribute iterator reaches the first affected path. It does not
use NsReader, but the vulnerable parser dependency is removed entirely.

The manifest also declares an independent test workspace and the
`xml_security` integration test. These tests exercise the actual upstream XMP
implementation, a large attribute set, duplicate rejection, the parser's
default namespace limit, and PNG EXIF/XMP preservation through the public
metadata API. Run from the repository root:

```sh
node scripts/quality/heavy-lease.mjs "little_exif security regression" -- \
  cargo test --manifest-path vendor/little_exif/Cargo.toml --test xml_security
```

The independent test lock and target directory are generated local artifacts;
the production dependency resolution is recorded in the root `Cargo.lock`.
Remove this vendor patch when a supported upstream release includes the fixed
XML parser, preserving the regression coverage during that update.
