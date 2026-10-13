# A documentation site

Status: complete

The [GitHub project board](https://github.com/users/bkhanale/projects/2) owns
priority and release assignment. This plan follows
[design 020](../design/020-a-documentation-site.md).

## Decisions

- [0152](../decisions/0152-the-guide-is-a-static-site-of-its-own.md): `apps/docs` builds `docs/guide/` with the one renderer, stylesheet and recipes.
- [0153](../decisions/0153-the-site-answers-search-and-agents-from-its-build.md): Pagefind, `llms.txt`, `llms-full.txt`, a Markdown copy of each page.
- [0154](../decisions/0154-a-change-carries-its-test.md): `tools/check-change-tests.mjs` in `pnpm lint` and as a Stop hook.

## Ordered work

| Item | Work                                                | Depends on | Board issue                                                  |
| ---- | --------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| 1    | The test gate and the Stop hook                     | None       | [Issue 228](https://github.com/bkhanale/notesapp/issues/228) |
| 2    | `apps/docs`: pages, sidebar, headings, links, style | None       | [Issue 225](https://github.com/bkhanale/notesapp/issues/225) |
| 3    | Search, the files for agents, the sitemap           | Item 2     | [Issue 226](https://github.com/bkhanale/notesapp/issues/226) |
| 4    | The settings page and the configuration reference   | Item 2     | [Issue 227](https://github.com/bkhanale/notesapp/issues/227) |

## Item notes

1. Pure rule in `tools/check-change-tests.mjs` with
   `tools/check-change-tests.test.mjs`. Add it to `pnpm lint`. Add the Stop
   hook to `.claude/settings.json`. State the rule in `rules/06-testing.md`
   and run `rules/link.sh`.
2. Register `apps/docs` in `tools/check-boundaries.mjs`,
   `tools/check-design-rules.mjs`, `tsconfig.build.json` and
   `.dockerignore`. Register the source in `apps/web/src/tailwind.css`. Pure
   modules: the sidebar from `docs/guide/README.md`, the page from one guide
   file, the address of a link, the page document. Build entry
   `apps/docs/src/build.ts`, root script `pnpm docs:build`.
3. Pagefind through its Node API at the end of the build. One client script
   in `apps/docs/src/client/` for the dialog, the sidebar on a phone and the
   copy control.
4. `docs/guide/settings.md` and `docs/guide/configuration.md`, both listed in
   `docs/guide/README.md`. `tests/integration/docs-site.test.ts` reads the
   lists of the code against them.

The documentation site deployment belongs to the
infrastructure repository of the owner and is not an item here. Issue 232
records the defect of the offline choices that the review of item 4 found.
