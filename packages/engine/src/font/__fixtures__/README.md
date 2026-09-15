# Real font parser fixtures

This corpus contains unmodified, redistributable font artifacts and one TTC
assembled from two unmodified faces. Each directory contains the applicable
OFL-1.1 license, including its copyright notice. Original byte hashes and
expected metadata are recorded in `provenance.json`. The parser tests require
these checked-in files; they never silently pass because a desktop dependency
was not installed.

Sources:

- Geist: https://github.com/vercel/geist-font
- IBM Plex Sans: https://github.com/IBM/plex
- Fraunces: https://github.com/undercasetype/Fraunces
- Distribution metadata: https://github.com/fontsource/fontsource
- Liberation fonts: https://github.com/liberationfonts/liberation
- Noto fonts: https://github.com/notofonts/noto-fonts
- Noto Sans JP Fontsource package: https://github.com/fontsource/font-files

The exact Fontsource payload names are retained. No font is presented under
another family's metadata. Fraunces covers a non-weight optical-size axis;
Geist and IBM Plex Sans cover different real weight ranges. Independent
opentype.js parsing confirmed the x-height/cap-height values.

The additional corpus covers:

- a static Liberation Sans TrueType face;
- a real TTC with Liberation Sans and Liberation Serif members. The TTC is a
  reproducible test container built from the two original licensed faces; its
  table offsets are adjusted for the collection boundary and both source faces
  remain identifiable;
- Noto Arabic and Noto Devanagari cmap/script coverage;
- an unmodified Fontsource Noto Sans JP Japanese WOFF2 subset;
- Noto Znamenny Musical Notation COLR/CPAL colour glyph metadata.

The Japanese subset's embedded name table calls the face `Noto Sans JP Thin`
even though the package path is the 400-weight Japanese subset. The test keeps
that source metadata intact and asserts the family prefix rather than
rewriting the name.
