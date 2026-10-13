# The documentation site

This page states what the documentation site is, which rules hold it, and how
a contributor builds, checks and hosts it.

## What it is

`apps/docs` builds `docs/guide/` into a folder of static files (record 0152). The API reference comes from the
merged client contract (record 0209).
The site has no server and no account. Search runs in the browser of the
reader against an index that the build writes, and the build writes the files
for agents next to the pages (record 0153). The site is hosted apart from the
application. The build settings select its address.

## Invariants

- **One source of guide text.** A guide page is a file of `docs/guide/`,
  and `docs/guide/README.md` is its contents and its reading order. The build
  refuses a guide file that the index does not list and a link to a page that
  does not exist.
- **One API contract.** `apps/docs/src/api-reference.ts` generates the API
  pages from `packages/api-contract/src/generated/openapi.json`, which the
  client generator emits after the authentication merge. Security comes from
  the effective requirement of each operation. The build publishes the same
  bundle for download and adds the pages to every site index. API reference
  content is never written by hand. The site sends no API request and stores
  no credential. See [record 0209](../decisions/0209-generated-api-reference.md).
- **One renderer.** `renderMarkdown` renders every page. `joinSoftBreaks` in
  `apps/docs/src/prose.ts` first joins the lines of a wrapped paragraph, the
  way GitHub reads the same file, because the renderer shows a new line of a
  note as a line break (record 0107).
- **One system.** A page loads the one built stylesheet of `apps/web` and its
  fonts, and every control reads a recipe of `packages/ui`. The root states
  no appearance, so the Default palette of the device paints it (record
  0151). `apps/web/src/tailwind.css` registers `apps/docs/src/page.ts` as a
  source, and `tools/check-design-rules.mjs` scans `apps/docs/src`.
- **Text, not markup.** The client script writes each search result as text
  and `mark` elements, and it imports only `apps/docs/src/client/`.
- **The reference pages follow the code.** `docs/guide/settings.md` has a
  heading for each section of `settingsSections`, `docs/guide/accounts.md`
  one for each section of `administrationSections`, both in
  `apps/web/src/lib/page-sections.ts`, and `docs/guide/configuration.md` names
  each variable of `serverVariables` in `apps/server/src/config.ts` and of
  `.env.example`, and no other.

## Build and read it

```sh
pnpm docs:build
pnpm docs:serve
```

`pnpm docs:build` runs `pnpm build`, which builds the web application first
and then the site into the `dist/site` folder of `apps/docs`.
`NOTESAPP_DOCS_BASE` names the base path and `NOTESAPP_DOCS_ORIGIN` the
origin. For example:

```sh
NOTESAPP_DOCS_BASE=/notesapp/ NOTESAPP_DOCS_ORIGIN=https://docs.example.test pnpm docs:build
```

`pnpm docs:serve` serves the folder under the same base path. Take the
screenshots of a changed page from it, in light and in dark.

## Proof

| What                                  | Evidence                                       |
| ------------------------------------- | ---------------------------------------------- |
| The contents, the links, the headings | `apps/docs/src/guide.test.ts`, `links.test.ts` |
| The page and the missing page         | `apps/docs/src/page.test.ts`                   |
| The files for agents                  | `apps/docs/src/agents.test.ts`                 |
| The rules of the client script        | `apps/docs/src/client/search-text.test.ts`     |
| The built site, as a host serves it   | `tests/integration/docs-site.test.ts`          |

## Hosting

Any web server that serves files can host the folder. Map the base path to the
folder, answer `index.html` for a folder address, and answer `404.html` for
an address with no file. The host of this project is a Caddy service of the
infrastructure repository of the owner, outside this repository.
