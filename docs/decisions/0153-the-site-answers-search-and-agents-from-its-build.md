# 0153. The site answers search and agents from its build

- Status: Accepted
- Date: 2026-10-02

## Context

The site of record 0152 has no server, so a search and an answer for an agent
must come from files that the build writes. [Design 020](../design/020-a-documentation-site.md)
compares a hosted index, a handwritten index and Pagefind, and it reads the
`llms.txt` proposal and the Markdown copy of a page that current
documentation sites serve.

## Decision

- Pagefind indexes the built pages at the end of the build. The index covers
  the article of each page and nothing of the frame, and it lives in the site
  under `pagefind/`. A query runs in the browser of the reader and leaves the
  site for no third party.
- The search is one dialog that `/` and Ctrl + K (Command + K on a Mac) open
  and Escape closes. A result is a row of the recipe of
  `packages/ui/src/control-classes.ts`, and the client script writes its text
  as text, never as markup.
- The build writes `llms.txt`, an index in Markdown with a link and one
  sentence for each page in the order of the sidebar, and `llms-full.txt`,
  every page in that order in one file.
- Each page is also a Markdown file at its address with `.md` added. The page
  links it in its head as an alternate, and it carries a control that copies
  the Markdown. Each Markdown copy holds the links of the site, not the links
  of the repository.
- The build writes `sitemap.xml` when the origin setting names the site.

## Consequences

- A person searches with no account and no service, and an agent reads one
  file to find the page it needs.
- `pagefind` is a dependency of `apps/docs` alone, with its binary for each
  platform.
- `tests/integration/docs-site.test.ts` proves that the index covers every
  page and that each file for agents names every page.
