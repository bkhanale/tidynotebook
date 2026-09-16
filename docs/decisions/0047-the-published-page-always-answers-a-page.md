# 0047. The published page always answers a page

- Status: Accepted
- Date: 2026-09-16

## Context

[0030](0030-published-links-are-hashed-tokens-over-a-scope.md) asks that a link
that never existed, a revoked link, an expired link and a wrong password read
alike. The contract answered all four with one `404` problem document.

A problem document is the wrong medium for the one address that a person opens
in a browser. It shows an error code and a request identifier, which the root
`AGENTS.md` forbids in text that a person reads, and the boundary of
`apps/server/src/plugins/register.ts` serves one media type for one status, so
that `404` cannot also answer HTML. A status that differs between an unknown
token and a locked link is itself a signal, and a page that carries no form
gives a reader with a password no way in.

## Decision

Every address under `/published/` that a person opens answers `200 text/html`.

- `getPublishedPage` answers one document in every case. It shows the note, or
  one sentence that says the link is not available, or the password form. The
  sentence is the sentence of the refusal shape, and a wrong password shows the
  same form and the same sentence as a link that was never unlocked.
- The path parameter of a reader address takes any single segment, and the
  reading ticket takes any short text. A malformed secret is a secret that
  opens nothing, not a request that the boundary refuses, so it reads like an
  unknown one. The strict shape stays on the token that the create answer
  carries.
- `openPublishedPage` is the form of the page. A served document holds no
  script, so the password travels as `application/x-www-form-urlencoded`, and
  the answer is the page again.
- `getPublishedAttachment` and `unlockPublishedLink` keep the one refusal.
  A picture cannot show a sentence, and the unlock answers a program.

The page shows a form only where a password applies, which tells a reader that
one applies. That is a function of the feature and not a leak of a cause: the
four causes of 0030 stay indistinguishable, because a wrong password returns to
the same form with the same words.

This excludes a `404` for the page, a redirect after the form, a second
sentence for any cause, and a cookie or a script on the reader path.

## Consequences

`tests/integration/contract.test.ts` proves the page answers one status and the
subresources keep the refusal. The page carries `private, no-store`, so a
revocation that 0030 makes immediate is never served from a cache, and
`no-referrer`, so the address that 0046 calls a credential leaves no origin.
