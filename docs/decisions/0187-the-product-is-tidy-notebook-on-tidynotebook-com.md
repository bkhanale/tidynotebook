# 0187. The product is Tidy Notebook on tidynotebook.com

- Status: Accepted
- Date: 2026-10-04

## Context

NotesApp is generic: no office registers it, and its domains are taken. The
code writes it two ways, NotesApp in `apps/server/src/auth/messages.ts` and
Notesapp in `apps/web/index.html`, the manifest and the wordmark. The owner
bought `tidynotebook.com` at Cloudflare, and Cloudflare Registrar requires
Cloudflare DNS. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- The product is **Tidy Notebook**. The editions are Tidy Notebook Cloud and
  Tidy Notebook self-hosted. The short name of the manifest is Tidy.
- `productName` in `packages/core/src/product.ts` is the one source of the
  name. The web title, the manifest, the wordmark, the mail and the guide read
  it or are checked against it.
- The package scope `@notesapp`, the `NOTESAPP_` variables, the database
  roles and the SQL names stay. A person never reads them, and a rename would
  break every installation.
- One registrable domain, `tidynotebook.com`, on Cloudflare DNS:
  - `tidynotebook.com`: the landing site.
  - `app.tidynotebook.com`: the application and its published pages (record
    0191).
  - `billing.tidynotebook.com`: the billing service (record 0186).
  - `docs.tidynotebook.com`: the guide, which moves from the personal domain
    of the owner.
  - `mail.tidynotebook.com`: the sending domain of the mail provider.
  - Staging uses `app-staging` and `billing-staging`, one level deep, so the
    free certificate of Cloudflare covers each name.
- No `.page` and no `.app` domain. The GitHub organization `tidynotebook`
  holds the repository from its opening, and the image becomes
  `ghcr.io/tidynotebook/tidynotebook`.

## Consequences

- One constant changes the name. A unit test fails when a visible surface
  writes another spelling.
- The owner pays for one domain.
- A block list that acts on a published page acts on the application host
  (record 0191).
