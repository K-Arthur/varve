# Real font parser fixtures

Unmodified WOFF2 artifacts from Fontsource variable packages, version 5.3.0.
Each directory contains the package's original OFL-1.1 license, including its
copyright notice. Original byte hashes and expected metrics are recorded in
`provenance.json`. The parser tests require these checked-in files; they never
silently pass because a desktop dependency was not installed.

Sources:

- Geist: https://github.com/vercel/geist-font
- IBM Plex Sans: https://github.com/IBM/plex
- Fraunces: https://github.com/undercasetype/Fraunces
- Distribution metadata: https://github.com/fontsource/fontsource

The exact Fontsource payload names are retained. No font is presented under
another family's metadata. Fraunces covers a non-weight optical-size axis;
Geist and IBM Plex Sans cover different real weight ranges. Independent
opentype.js parsing confirmed the x-height/cap-height values. These files do
not yet cover static fonts, TTC/OTC collections, CJK, or color fonts.
