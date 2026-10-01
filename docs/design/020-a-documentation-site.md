# A documentation site

Status: complete

## The problem

The guide in `docs/guide/` is good text, and a person can only read it on
GitHub. GitHub shows one file at a time. It has no navigation between the
pages, no search across them, and no view that follows the product. A person
who runs a server must know that the guide exists and where it sits in the
tree. An agent that helps a person must load the files one by one from the
repository, and it has no index that states which page answers which
question.

The owner asked for documentation of the first class: a site that a person and
an agent can both read and search, that covers self-hosting, every setting and
every feature, and that is hosted apart from the application. The owner also
asked that the site follow the design rules of the application and use the
Default light and dark palettes.

A second request rides with the first. A change must carry its tests without a
person who asks for them. Today the rule "add a regression test for each fixed
defect" lives in `AGENTS.md` and in the review, and nothing checks it.

## What a modern documentation site gives

The open source projects of 2025 and 2026 converged on one shape. Starlight
(Astro), VitePress, Docusaurus, Nextra and Fumadocs all build static files
from Markdown, and Mintlify and GitBook host the same shape as a service. The
shared parts are:

- A sidebar of the pages in groups, a list of the headings of the open page,
  and a link to the previous and the next page.
- A search that runs in the browser of the reader against an index that the
  build writes. Starlight ships Pagefind for this, VitePress ships MiniSearch,
  and Docusaurus defers to Algolia DocSearch, which is a hosted service.
- A light and a dark palette that follow the device.
- Files for agents. The `llms.txt` proposal (llmstxt.org) puts one Markdown
  index at the root of the site, with a link and one sentence for each page.
  `llms-full.txt` holds every page in one file. Mintlify, Fumadocs,
  Starlight (through a plugin) and the documentation of Anthropic, Cloudflare
  and Vercel also serve each page as Markdown at the address of the page with
  `.md` added, and offer a control that copies the page as Markdown.
- Static output that any web server serves under any base path, with no
  process of its own.

## Options for the build

**Starlight, VitePress or Docusaurus.** Each one gives the whole shape above in
an afternoon. Each one also brings a second Markdown renderer into the
repository, its own stylesheet, its own family and its own colours. The rules
of this repository refuse each of those: one renderer in `packages/markdown`,
one stylesheet in `apps/web/src/tailwind.css`, one family (record 0061), and
colour from the registry in `packages/ui/src/themes` only. Starlight can take
custom CSS variables, but the variables would hold colour values outside the
registry, and its components would hold their own classes for a button and a
row, which record 0065 refuses. The cost is a site that looks like every other
Starlight site and not like the product, and a second system to keep in step
with the first.

**A hosted service such as Mintlify or GitBook.** It removes the build and adds
an account, a vendor and a copy of the text outside the repository. The text
then drifts from the code, which `docs/README.md` exists to prevent.

**A build on the stack of the product.** A small generator in a new package
reads `docs/guide/`, renders each page with `renderMarkdown`, writes each page
with the class recipes and icons of `packages/ui`, and loads the one built
stylesheet, as the published page of record 0031 already does. The site then
reads like the product by construction: one family, one type scale, the
Default palettes of the device (record 0151), one recipe for each control.
The cost is the navigation, the list of headings and the search, which this
repository must write and test itself. The navigation and the headings are
small pure functions. The search is the part that is not small.

## Options for the search

**A hosted index (Algolia DocSearch).** It gives a strong search and needs an
application, a crawler and a key. It also sends each query of a reader to a
third party, which the security model of this product avoids elsewhere.

**A handwritten index.** A list of sections in one JSON file, and a scorer in
the browser. It is easy to test and weak at what a reader expects: stems,
typing errors, ranking and an excerpt with the match marked.

**Pagefind.** A static index that the build writes from the built HTML. The
browser loads a small script and only the parts of the index that a query
needs. It gives stems, ranking, sub results for each heading and a marked
excerpt. It is the search of Starlight, so it is the nearest thing to a
standard for a static site. The cost is one dependency with a binary for each
platform, and a script that the page loads from the site itself.

## Options for agents

`llms.txt`, `llms-full.txt` and a Markdown file for each page are three static
files that the same build writes from the same source, so they cost nothing to
keep true. A Model Context Protocol server would let an agent search the site
with a tool call. It needs a process and a host, which the site does not have,
and an agent with web access already reads `llms.txt`. It is left for later.

## Options for the coverage of the settings

The guide states the settings of the server across several pages, and it
states no page for the Settings screen of the application. Two lists in the
code already name every setting: `settingsSections` and
`administrationSections` in `apps/web/src/lib/page-sections.ts` name every
section of the two settings screens, and `apps/server/src/config.ts` names
every variable that the server reads. A reference page that a person writes
from those lists can drift from them. A test that reads both the list and the
page and names each missing entry cannot drift, and it costs one integration
test.

## Options for the test loop

**A rule in `AGENTS.md`.** It is there today and an agent can forget it.

**A Git hook.** It runs at a commit, a person can skip it with one flag, and
this repository installs no hook.

**A check in the gate.** A step of `pnpm lint` compares the branch with
`main`. When the branch changes the source of a package and changes no test
of that package and no integration test, the step fails and names the
package. A commit can state why a change has no test with a trailer, and the
step then names that reason instead of failing. `pnpm verify` runs it before
every landing, so no change lands without a test or a stated reason.

**A hook of the agent.** Claude Code runs a command when an agent tries to end
its turn, and an answer of "block" sends the agent back to work with the
message of the command. A hook that runs the same check as the gate tells the
agent to write the test before it reports, with no prompt from a person.

The check in the gate is the rule, and the hook of the agent makes the rule
act at once. The two read one module, so they cannot disagree.

## Hosting

The site is a folder of static files, so the host is any web server. The build
takes the base path and the origin as two settings, so the same build serves
`https://docs.bhu.sh/notesapp/` and a folder on a laptop. The deployment of the
owner lives in the infrastructure repository of the owner, outside this one.

## Decisions

- [0152, the guide is a static site of its own](../decisions/0152-the-guide-is-a-static-site-of-its-own.md)
- [0153, the site answers search and agents from its build](../decisions/0153-the-site-answers-search-and-agents-from-its-build.md)
- [0154, a change carries its test](../decisions/0154-a-change-carries-its-test.md)
