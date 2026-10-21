# 0230. The notebook is the official mark

- Status: Accepted
- Date: 2026-10-21

## Context

The landing page shows a notebook. Other product icons show a different mark.
Some public pages have no icon.

## Decision

Use the notebook from `AppMarkIcon` as the single official mark.
`packages/ui/assets/notebook.svg` holds its geometry. The existing design
check compares the component paths and every generated asset.
Only colour, contrast and padding change between icon uses.
Use Default theme colours and keep the maskable mark inside the safe circle.
Use the same mark in the social card and on every document surface.

This supersedes the tn logo choice in [record 0203](0203-the-product-name-is-written-in-lowercase.md).
The lowercase product name stays unchanged.

## Consequences

`tools/generate-icons.mjs` writes the committed icon set and social card.
Hashed icon addresses and manifest generation stay in place.
Root icon copies use revalidation. Public documents and docs link the icons
without adding a manifest. Cloud copies the pinned SVG, ICO and Apple files.
No API contract, stored data, operator setting or image command changes.
