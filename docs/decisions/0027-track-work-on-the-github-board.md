# 0027. Track work on the GitHub board

- Status: Accepted, work-list guidance replaced by
  [0232](0232-public-issues-are-the-work-entry-point.md)
- Date: 2026-09-13

## Context

The open work lived in `docs/releases/`, one file per version. Two release
files, `0.1.0.md` and `0.2.0.md`, held the prioritized rows. Each row also had a
GitHub issue with the `0.2.0` milestone, so the state lived in two places. The
two copies drifted, and a row that closed on the board stayed open in the file.
The check in `tools/check-docs.mjs` proved the file format, not the truth of a
row.

## Decision

The [GitHub project board](https://github.com/users/bkhanale/projects/2) is the
single prioritized list of open work. Each row is an issue with a milestone, a
priority label, and an area label. The repository holds no release list.
`docs/releases/` is removed. `docs/development/tracking.md` states where the work
lives and how a row is shaped. The rules, the document index in
`docs/README.md`, and the `coreReadingList` in `tools/agent-context.mjs` point at
the board and the tracking page.

## Consequences

- One list holds the state of the work, so the copies cannot drift.
- The doc-kind check in `tools/check-docs.mjs` drops `releases`, so a stray
  release file now fails the placement rule.
- A plan points at the board for its live rows, not at a file in the tree.
- The board is outside the repository, so an offline reader sees the tracking
  page but not the current rows.
