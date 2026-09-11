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
block with any other language is refused outside `history/`.

`tools/check-docs.mjs` runs inside `pnpm lint` and holds the rules on this
page.

## Tone

- Write in ASD-STE100 Simplified Technical English. One idea per sentence, the
  active voice, the present tense.
- Do not use an em dash or an en dash.
- Use sentence case for every heading.
- Say what a thing is and why it is that way. Do not narrate the task that
  made it.

Every file starts with one `#` title line, except a file in `history/`, which
starts with its superseded note.

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

**Header:** the title line, then one sentence that states who the page is for,
for example "This page is for the person who writes notes." A guide page with
no such sentence fails the check.

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

## releases/

**Audience:** the owner and the contributors of one release.

**Purpose:** the single prioritized list for that release. One file per
release, named after its version.

**Belongs:** what is not finished, in the owner's priority order, with the
evidence that proves the state of each row.

**Does not belong:** a second list of the same work anywhere else.

**Header:** the title line, then a status line that starts with `Status:`.

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

**Audience:** contributors.

**Purpose:** a plan that is still running. A plan leaves this directory when
its work ships.

**Header:** the title line, then the status and the pointer to the live list in
`releases/`.

## history/

**Audience:** nobody. It is provenance.

A document moves here when it no longer describes the product, and a newer
document replaced it. Move the file with `git mv`, keep the content, and add
two lines at the top:

    > Superseded by `docs/<new path>`. It describes an earlier product.
    > It is kept for provenance only. Do not use it as a reference.

Nothing links to a history file as an answer. The language and the fenced
block rules are relaxed here, because the content is frozen.
