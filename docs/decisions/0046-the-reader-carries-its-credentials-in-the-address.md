# 0046. The reader carries its credentials in the address

- Status: Accepted
- Date: 2026-09-16

## Context

Decision 0030 gives a published link an opaque token and a reading ticket, and
it refuses a cookie for the reader. It does not say where in a request the two
values sit. Decision 0031 answers the published page as one HTML document that
the server builds. A picture inside such a document is a plain `img` element,
so the browser sends a bare request for it: it sets no header and it runs no
script. `apps/web/AGENTS.md` bans injected HTML, and plan 007 item 35 adds no
reader route, so there is no client that could set one. A header therefore
cannot carry a credential on the one request that the page needs most.

## Decision

Both values of the reader travel in the address, and every reader address sits
under one prefix.

- The token is a path segment. `packages/api-contract/paths/published_token.yaml`
  and its two neighbours declare `/published/{token}`,
  `/published/{token}/unlock` and
  `/published/{token}/attachments/{fileId}/{revisionId}`.
- The reading ticket is the query parameter `ticket`, declared once in
  `packages/api-contract/components/parameters/ReadingTicket.yaml` and used by
  the page and by the picture. The unlock answer states it in its body, and the
  server sets no cookie.
- `/published/` is the whole reader boundary. One prefix states it, so a log
  rule, a proxy rule and a header rule each match one shape.

This excludes a cookie, a header, and a second address for the same answer.

## Consequences

The ticket adds no disclosure that the token does not already carry, because
both sit in one address and a reader that holds the address holds the token
anyway. The cost is that the whole address is a credential. A log must not
keep it: `redactUrl` in `apps/server/src/request-log.ts` already drops every
query string, and it gains the reader path beside the password reset path. The
referrer policy of the published page must send no address to another origin.
A person who pastes the address into a chat gives the link away, which is what
a published link is for.

The published page holds no script, so the server builds every address on the
page and repeats the ticket in each one. A picture and an in-scope note link
both resolve through the renderer options of `packages/markdown/src/render.ts`.

`tests/integration/contract.test.ts` proves that the three reader operations
declare an empty security requirement and that each one answers the one
refusal of decision 0030.
