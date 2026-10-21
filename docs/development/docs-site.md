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

Cloudflare Worker `tidynotebook-docs` serves the built files at
`https://docs.tidynotebook.com`. The private cloud repository owns its Wrangler
configuration and pinned CLI. It uses a custom domain, with workers.dev and
preview URLs disabled. The guide needs no Railway service or database.

Core main does not deploy the guide automatically. The former cloud deploy
workflow is removed. Publish the guide manually after an approved core change.
The cloud deploy and secrets runbooks own the provider credentials.

## Publish the guide

Use a clean core worktree at the approved commit and the pinned tools. Export
`CLOUDFLARE_ACCOUNT_ID` with the approved account ID. The commands assume a
cloud checkout beside the core. A temporary worktree holds Wrangler state.

```sh
CORE_DIR="$PWD"
SOURCE_SHA="$(git rev-parse HEAD)"
CLOUD_DIR="$(git -C ../cloud rev-parse --show-toplevel)"
CLOUD_WORKTREE="$(mktemp -d)"
pnpm install --frozen-lockfile
NOTESAPP_DOCS_BASE=/ NOTESAPP_DOCS_ORIGIN=https://docs.tidynotebook.com pnpm docs:build
git -C "$CLOUD_DIR" fetch origin main
git -C "$CLOUD_DIR" worktree add --detach "$CLOUD_WORKTREE" origin/main
pnpm --dir "$CLOUD_WORKTREE" install --frozen-lockfile
DOCS_CONFIG="$CLOUD_WORKTREE/infra/docs/wrangler.jsonc"
docs_wrangler() (
  set +x
  set -a
  . "$HOME/.config/tidynotebook/infisical.env"
  set +a
  cd "$CLOUD_WORKTREE"
  pnpm secrets:run --environment production -- \
    pnpm --filter @cloud/infra exec wrangler "$@"
)
docs_wrangler whoami
docs_wrangler deployments list --config "$DOCS_CONFIG" --json
```

Check that the account and custom domain match the approved target. Record
the current live version as `ROLLBACK_VERSION`. Check that Cloudflare retains
it before publication. Stop if the live settings differ from the configuration.

```sh
docs_wrangler versions view "$ROLLBACK_VERSION" --config "$DOCS_CONFIG" --json
docs_wrangler deploy --config "$DOCS_CONFIG" --assets "$CORE_DIR/apps/docs/dist/site" --dry-run
docs_wrangler deploy --config "$DOCS_CONFIG" --assets "$CORE_DIR/apps/docs/dist/site" \
  --tag "$SOURCE_SHA" --message "Docs release $SOURCE_SHA"
docs_wrangler deployments list --config "$DOCS_CONFIG" --json
```

The dry run uploads nothing. Confirm that the new version serves all traffic
and names the approved commit. Compare the live favicon, touch icon, and head
links with the build. Check their bytes and content types. Compare CSP headers
and meta tags with the saved baseline. Check guide and API pages in a browser,
with desktop light and dark screenshots. Use a browser User-Agent and a unique
query for HTTP checks. Cloudflare can block Python clients with a 403 response.
Keep zone security unchanged.

If verification fails, restore the recorded version and its static assets.

```sh
docs_wrangler rollback "$ROLLBACK_VERSION" --config "$DOCS_CONFIG" \
  --message "Restore previous docs version" --yes
```

Check the restored pages. Then remove the temporary worktree and Wrangler state:

```sh
git -C "$CLOUD_DIR" worktree remove --force "$CLOUD_WORKTREE"
```
