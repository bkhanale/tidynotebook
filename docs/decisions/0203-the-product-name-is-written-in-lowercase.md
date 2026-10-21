# 0203. The product name is written in lowercase

- Status: Logo choice superseded by 0230; product name remains accepted
- Date: 2026-10-04

## Context

[Record 0187](0187-the-product-is-tidy-notebook-on-tidynotebook-com.md) names
the product Tidy Notebook and makes `productName` in
`packages/core/src/product.ts` the one source of the name. The code still
writes Notesapp, because item 1 of
[plan 019](../plans/019-tidy-notebook-cloud.md) is not done. The install icon
in `apps/web/icons/icon.svg` now carries a lowercase tn monogram. The owner
chose to write the whole name in the same lowercase, as a design choice.

## Decision

- The product name is **tidy notebook**, in lowercase, on every surface that
  a person reads: the web title, the manifest, the wordmark, the mail, the
  guide, the README and the install icon. The editions are tidy notebook cloud
  and tidy notebook self-hosted. The short name of the manifest is tidy.
- The name keeps its lowercase at the start of a sentence, in a heading and in
  a label. The root rule keeps a product name in its own case, so sentence
  case does not capitalize it.
- `productName` holds the lowercase string. The rest of record 0187 stands:
  the domains, the organization, the image and the internal names.
- The monogram of the install icon is tn, from the outlines of Quicksand at
  weight 700, drawn as SVG paths with a round stroke that makes them a little
  fatter. Quicksand is under the SIL Open Font License, which permits its
  shapes in a logo. The icon names no family and loads no face, so record 0061
  still allows only the one application stylesheet to declare a face, and the
  application text stays in Geist. Each colour of the icon is a Default theme
  token.
- A document written before this record keeps its text. A new document, and
  any document that is edited, writes the lowercase name.

## Consequences

- Item 1 of plan 019 writes the lowercase name, and its unit test refuses
  Tidy Notebook and Notesapp on a visible surface.
- The name reads the same in the icon, the wordmark and the text.
- `tests/integration/app-icon.test.ts` holds the title of the install icon and
  each of its colours to a Default theme token.
