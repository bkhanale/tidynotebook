# 0187. The product is Tidy Notebook on two domains

- Status: Accepted
- Date: 2026-10-04

## Context

NotesApp is generic: no office registers it, and its domains are taken. The
code writes it two ways, NotesApp in `apps/server/src/auth/messages.ts` and
Notesapp in `apps/web/index.html`, the manifest and the wordmark. Published
pages need a registrable domain apart from the application (record 0118). See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The product is **Tidy Notebook**. The editions are Tidy Notebook Cloud and
  Tidy Notebook self-hosted. The short name of the manifest is Tidy.
- `productName` in `packages/core/src/product.ts` is the one source of the
  name. The web title, the manifest, the wordmark, the mail, the site and the
  guide read it or are checked against it.
- The package scope `@notesapp`, the `NOTESAPP_` variables, the database
  roles and the SQL names stay. A person never reads them, and a rename would
  break every installation.
- The cloud hosts:
  - `tidynotebook.com`: the landing site (record 0195).
  - `app.tidynotebook.com`: the application.
  - `docs.tidynotebook.com`: the guide, which moves from the personal domain
    of the owner.
  - `tidynotebook.page`: published pages and nothing else.
  - `mail.tidynotebook.com`: the custom sending domain of SES.
  - Staging uses the `staging.` subdomain of each name.
- `tidynotebook.app` is held only to protect the name. The GitHub
  organization `tidynotebook` holds the repository from its opening, and the
  image becomes `ghcr.io/tidynotebook/tidynotebook`.

## Consequences

- One constant changes the name. A unit test fails when a visible surface
  writes another spelling.
- A same-site attack from a published page and a block list on one page
  cannot reach the application.
- The owner buys three domains and claims one organization before the
  infrastructure work starts.
