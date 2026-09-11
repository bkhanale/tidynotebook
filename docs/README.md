# Documentation

Read this page before you write or move a document.

## The code is the source of truth

A document holds intent, a decision, an invariant, and a pointer. It names the
code by path and lets the reader open it. It never copies source, a
configuration value, a schema, a column list, SQL, TypeScript, YAML, a version
number, or a measured result. A copy goes stale in silence, because no check
fails when the code moves away from it.

The one exception is a shell command that the reader runs. A quick start and a
backup procedure need the command, so a fenced `sh` block is allowed. A fenced
block with any other language is refused, except in a file whose status line
says that it is superseded. That content is frozen, so no check holds it.

`tools/check-docs.mjs` runs inside `pnpm lint` and holds the rules on this
page.

## Tone

- Write in ASD-STE100 Simplified Technical English. One idea per sentence, the
  active voice, the present tense.
- Do not use an em dash or an en dash.
- Use sentence case for every heading.
- Say what a thing is and why it is that way. Do not narrate the task that
  made it.

Every file starts with one `#` title line.

A file in `plans/`, `design/` or `releases/` carries a status line directly
under the title:

    Status: active | complete | superseded by <relative link>

A superseded file stays where it is, with its kind. Nobody edits it again,
except its status line.

## Files at the repository root

- `AGENTS.md` holds every rule. `rules/link.sh` writes it from `rules/`.
- `CLAUDE.md` imports `AGENTS.md` for Claude Code and holds nothing else.
- `.claude/skills/` links to `.agents/skills/`, so one skill file serves every
  agent harness.

## Lifecycle of a large task

1. A design in `design/` explores the problem, the options, and the trade-offs.
   It names the questions that somebody must decide.
2. The design concludes in one or more records in `decisions/`. The design
   links each record that it produced, and each record links its design.
3. A plan in `plans/` turns those records into ordered work. It links the
   design and the records.
4. The rows of the plan go into the release list in `releases/` that ships
   them.
5. When the plan completes, the status of the plan becomes `complete` and the
   status of the design becomes `complete` or `superseded by <link>`.

A small task skips the design, and it can skip the plan. No task skips the
decision record when it makes an architectural choice.

Each stage has its own audience. A design is for a person: it argues in prose
that a reviewer reads end to end. A decision record and a plan are for an
agent: they are terse, structured, and full of pointers, because an agent
loads them many times.

## guide/

**Audience:** the person who writes notes, and the person who runs a server.
Public. This directory is published.

**Purpose:** how to use the product and how to host it. It is written from the
visible behaviour of the application, not from a design document.

`guide/README.md` is the landing page. It lists the pages in two groups,
"Writing notes" and "Hosting a server", so the audience split lives in the
index and not in a folder.

**Belongs:** a short task page. What the person sees, what they select, what
happens next. A shell command the host runs.

**Does not belong:** an internal rule, a package name, a file path, a planned
feature, or an operation that the product does not have today.

**Header:** the title line, then one sentence that starts with "This page is
for" and names the reader, for example "This page is for the person who writes
notes." A guide page with no such sentence fails the check.

## development/

**Audience:** contributors and agents.

**Purpose:** the design intent, the invariants, and the rules of one area,
with pointers into the code.

**Belongs:** why a boundary exists, what a rule refuses, which file or
function or table carries it, and which command proves it.

**Does not belong:** a copied schema, a pinned version list, a per task log, a
measured number, or a restated decision. Link the decision record instead.

**Header:** the title line, then the sentence that states what the document
owns.

Keep a page under 150 lines. A page that grows past that is two pages.

## design/

**Audience:** a person who reviews the problem before the work starts.

**Purpose:** one long exploration of one problem. It states the problem, the
options, and the cost of each option. A design that concludes produces one or
more decision records.

**Belongs:** the problem, the options, the trade-offs, and the open questions.
Prose and a diagram belong here, because a reviewer reads the page once, end
to end, and argues with it.

**Does not belong:** a task list, and a choice that no record holds.

**Header:** the title line, then the status line. A `## Decisions` heading
links every record that the design produced.

## decisions/

**Audience:** contributors and agents.

**Purpose:** one architectural choice each, with its context and its cost. A
record does not change after it is accepted.

**Belongs:** the choice, the facts that forced it, and what it excludes.

**Does not belong:** a plan, a task list, or a status report.

**Header:** the template in `decisions/0000-template.md`. The status line, the
date, and the `Context`, `Decision` and `Consequences` headings are required.
`decisions/README.md` holds the index and the rule for when a choice needs a
record.

**Tone:** structured and minimal. An agent reads a record many times, so give
it paths, record numbers and release rows, not a story.

## releases/

**Audience:** the owner and the contributors of one release.

**Purpose:** the single prioritized list for that release. One file per
release, named after its version.

**Belongs:** what is not finished, in the owner's priority order, with the
evidence that proves the state of each row.

**Does not belong:** a second list of the same work anywhere else.

**Header:** the title line, then the status line.

## audits/

**Audience:** the owner.

**Purpose:** a read only report of the state of the product at one moment. An
audit is evidence, so it is never edited after it lands.

One directory per audit date, `audits/YYYY-MM-DD/`.

**Belongs:** findings with their file and line evidence.

**Does not belong:** a fix. A finding becomes a row in `releases/`.

**Header:** the title line, then a date and the commit that was read, both
inside the first ten lines.

## plans/

**Audience:** an agent that does the work.

**Purpose:** the ordered work that follows from the decision records of one
design. A plan stays here after it ships, with the status `complete`.

**Belongs:** the items, in order, with the record and the release row that each
item answers.

**Does not belong:** the argument that chose the approach. That is the design.

**Header:** the title line, then the status line, then the pointer to the live
list in `releases/`. A `## Decisions` heading links into `decisions/`.

**Tone:** structured and minimal, like a decision record. An agent reads a plan
many times.
