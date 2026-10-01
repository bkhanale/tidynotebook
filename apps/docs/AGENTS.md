# apps/docs

Read the root [AGENTS.md](../../AGENTS.md), then the
[design guide](../../docs/development/design.md) and
[docs/README.md](../../docs/README.md). This package builds the guide in
`docs/guide/` into a static documentation site that is hosted apart from the
application (records 0152 and 0153).

## What lives here and what does not

- The text lives in `docs/guide/`, never here. `docs/guide/README.md` is the
  home page, and its groups are the contents and the reading order. A new
  page is a guide file and one row of that index, and the build refuses a page
  that the index does not list.
- `src/guide.ts`, `src/links.ts`, `src/prose.ts`, `src/page.ts`,
  `src/agents.ts`, `src/assets.ts` and `src/site.ts` are pure: they read text
  and answer text. `src/build.ts` is the one module that reads and writes
  files. `src/serve.ts` serves a build on this machine.
- `renderMarkdown` of `packages/markdown` renders every page, after
  `joinSoftBreaks` reads the wrapped guide the way GitHub does. No second
  renderer, no front matter, no copy of the text.
- The page loads the one built stylesheet of `apps/web` and its fonts.
  `apps/web/src/tailwind.css` registers `src/page.ts` as a source, so a class
  of a page lives in that file and nowhere else here.
- `src/client/` is the one browser script: the search dialog, the contents on
  a phone and the two copy controls. It imports only its own folder, and
  `src/client/search-index.ts` alone computes an import, the address of the
  Pagefind script.

## Allowed imports

`@notesapp/markdown` and `@notesapp/ui`, plus `react`, `react-dom/server`,
`pagefind` and Node modules in the build. `@notesapp/web` is a development
dependency for the order of the build alone. `src/client/` imports nothing
outside `src/client/`.

## How to add a common thing here

- **A guide page.** Write it in `docs/guide/` and list it in
  `docs/guide/README.md`. Nothing here changes.
- **A part of the frame.** Add it to `src/page.ts` with the recipes of
  `packages/ui`, then prove it in `src/page.test.ts` and read it in light and
  dark.
- **A behaviour of the browser.** Put the rule in `src/client/search-text.ts`
  with its test, and the effect in `src/client/docs.ts`.

## Testing conventions here

`node --test` through `pnpm test:unit`, with each test beside its module.
`tests/integration/docs-site.test.ts` builds the site and proves the served
result: every page and link, every class in the stylesheet, the search index,
the files for agents, and the reference pages against the lists of the code.

## Forbidden here

- No colour value, no family name, no arbitrary value, no off-scale class and
  no control class outside the recipes. `tools/check-design-rules.mjs` scans
  `src/` like `apps/web/src`.
- No `innerHTML` in the client. A result of the search is text and `mark`.
- No request to a third party, and no request of the application.

## Key files

| File                         | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `src/build.ts`               | The build of the site and `pnpm docs:build`    |
| `src/guide.ts`               | The contents and the pages of the guide        |
| `src/links.ts`               | The address of every link                      |
| `src/page.ts`                | The document of a page and of a missing page   |
| `src/agents.ts`              | `llms.txt`, `llms-full.txt`, the sitemap       |
| `src/site.ts`                | The base path and the origin of a build        |
| `src/serve.ts`               | `pnpm docs:serve`, a build on this machine     |
| `src/client/docs.ts`         | The search, the contents and the copy controls |
| `src/client/search-text.ts`  | The rules of the client script                 |
| `src/client/search-index.ts` | The one computed import, of the search script  |
