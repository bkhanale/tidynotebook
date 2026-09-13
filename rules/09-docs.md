# Documents

- Before you write a document, read `docs/README.md`. It states the audience,
  the purpose, and the required header of each documentation directory.
- A document points at code by path and never copies it. Do not copy source, a
  configuration value, a schema, a column list, SQL, TypeScript, YAML, a
  version number, or a measured result.
- The one allowed code block is a shell command that the reader runs. Any other
  fenced language fails `pnpm lint`, except in a document whose status line
  says that it is superseded.
- Every `.md` file under `docs/` sits in `guide`, `development`, `design`,
  `decisions`, `audits`, or `plans`.
- A file in `docs/plans/` or `docs/design/` carries `Status: active`,
  `Status: complete`, or `Status: superseded by <relative link>` directly under
  its title.
- `docs/guide/` is public and flat. Each page starts with the title line and
  one sentence that states who the page is for.
- `docs/development/` holds the intent, the invariants, and the pointers of one
  area. Keep a page under 150 lines. Link a decision record rather than
  restating the decision.
- A new architectural choice gets a record in `docs/decisions/` from the
  template, before the code.
- The [GitHub project board](https://github.com/users/bkhanale/projects/2) is
  the one prioritized list of open work. See `docs/development/tracking.md`. The
  repository holds no release list.
- An audit in `docs/audits/<date>/` names its date and its commit and is never
  edited after it lands.
- A document that no longer describes the product stays with its kind. Set its
  status to superseded and point at the document that replaced it. Do not edit
  it again, except its status line.

A large task runs through five stages:

1. A design in `docs/design/` states the problem, the options, and the cost of
   each option. Write it in prose for a person who reads it once.
2. The design concludes in one or more records in `docs/decisions/`. The design
   and each record link each other.
3. A plan in `docs/plans/` turns those records into ordered work, and links the
   design and the records. Write it terse, structured, and full of pointers,
   for an agent that loads it many times.
4. The rows of the plan become issues on the
   [GitHub project board](https://github.com/users/bkhanale/projects/2), one row
   per issue, each with a milestone, a priority label, and an area label.
5. When the plan completes, its status becomes `complete`, and the status of
   the design becomes `complete` or superseded.

A small task skips the design, and it can skip the plan. No task skips the
decision record when it makes an architectural choice.
