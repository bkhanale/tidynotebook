# 0152. The guide is a static site of its own

- Status: Accepted
- Date: 2026-10-02

## Context

`docs/guide/` is the public guide, and a person reads it only as files on
GitHub. [Design 020](../design/020-a-documentation-site.md) compares the
documentation frameworks with a build on the stack of the product. A framework
brings a second renderer, a second stylesheet, a second family and colour
values outside `packages/ui/src/themes`, and each one breaks a rule of
`AGENTS.md`. The published page of record 0031 already shows a page with no
application behind it, built from `renderMarkdown` and the one stylesheet.

## Decision

- `apps/docs` is a new package. It builds the guide into a folder of static
  files and runs no process of its own. It is hosted apart from the
  application.
- `docs/guide/` stays the one source of the text. `docs/guide/README.md` is
  the home page, and its two lists are the groups and the order of the
  sidebar. A relative link between two guide pages becomes the address of
  the page. A link out of the guide becomes the file on GitHub.
- `renderMarkdown` of `packages/markdown` renders every page. No second
  renderer enters the tree.
- The page loads the one built stylesheet of `apps/web` and its fonts, as the
  published page does (record 0060). `apps/web/src/tailwind.css` registers the
  source of the site, so the build emits its classes. The page states no
  appearance, so it takes the Default palette of the device (record 0151).
- Every control reads its classes from `packages/ui/src/control-classes.ts`,
  every page column from `layout-classes.ts`, and every icon from
  `icons.tsx`. `tools/check-design-rules.mjs` scans the site source like the
  screens of `apps/web`.
- The base path and the origin are two settings of the build.
- The Docker image of the application holds no part of the site.

## Consequences

- The site reads like the product, and a theme or a recipe change reaches it
  with the next build.
- The sidebar, the list of headings and the links are pure modules of
  `apps/docs/src` with unit tests. `tests/integration/docs-site.test.ts`
  builds the site and proves the served result: every page, every link, the
  classes in the stylesheet, and the reference pages against the lists of the
  code.
- A guide page keeps the rules of `docs/README.md`, and it needs no front
  matter.
