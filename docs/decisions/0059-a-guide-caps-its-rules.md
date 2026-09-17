# 0059. A directory guide caps its rules and not its index

- Status: Accepted
- Date: 2026-09-17

## Context

`tools/check-agents-md.mjs` capped a whole directory guide at 80 lines, so a
guide stays short enough to read before an edit. Seven of the thirteen guides
then sat at exactly 80 lines and three more within three lines of it, so a
change that added a rule had to delete a rule first.

A guide holds two different things. Above `## Key files` it states the rules of
the directory: what lives there, what may be imported, what is forbidden, and
how the directory is tested. Under that heading it holds an index of the key
files, which `tools/agent-context.mjs` reads and prints as the reading list. The
index states no rule and its length follows how many files the directory holds,
so a directory that gains a file lost room for its next rule.

## Decision

The cap covers the rules of a guide and ends at the `## Key files` heading. A
guide with no such heading is all rules, so the whole file counts. The number
stays 80.

The index stays in the guide, because `tools/agent-context.mjs` reads it there
and one file states one directory.

## Consequences

- Every guide has room for the next rule, and a directory that grows does not
  spend that room on its index.
- A guide that fills with prose still fails, which is what the cap is for.
- `tools/check-agents-md.test.mjs` proves both: rules over the cap fail, and an
  index under the heading does not count.
