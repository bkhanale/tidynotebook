# 0146. A closed link page says what to do next

- Status: Accepted
- Date: 2026-10-01

## Context

Record 0047 gives a link that opens nothing one sentence, and a link that asks
for a password one sentence and the form. It excludes a second sentence for any
cause, so the four causes of record 0030 read alike. Each page was one line at
the top of an empty column, and it told the reader nothing to do next. The root
`AGENTS.md` asks that a message state what happened and what the person can do
next. The owner chose a second sentence that is the same for every cause, on
2026-10-01.

## Decision

- The sentence of each state is the heading of one short block in the middle
  of the screen, in `apps/server/src/routes/published-document.ts`.
- Under the heading, the page shows one more sentence that tells the reader
  what to do next. A link that opens nothing asks the reader to get a new link
  from the person who sent it. A link that asks for a password asks for the
  password that came with the link.
- Each sentence is a constant of that module. No view of the page carries a
  cause, so no sentence can change with one.
- A wrong password still answers the same form and the same two sentences.

This excludes a sentence that names a cause, a sentence that changes after a
failed password, and a sentence on any subresource of the reader path.

## Consequences

- A reader of a closed link knows what to do next, and still learns nothing
  about why the link opens nothing.
- `published-document.test.ts` holds each sentence to its state, and
  `tests/integration/published-page.test.ts` and
  `tests/integration/contract.test.ts` hold the served answer, before and after
  a wrong password.
- This refines record 0047.
