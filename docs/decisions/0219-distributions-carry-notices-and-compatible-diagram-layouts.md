# 0219. Distributions carry notices and compatible diagram layouts

- Status: Accepted
- Date: 2026-10-11

## Context

Record 0188 licenses the core under AGPL. The image omits its license text.
The browser build combines Mermaid and ELK inside one script. ELK states EPL
without a secondary license grant. The [EPL terms](https://www.eclipse.org/legal/epl/epl-v20.html)
do not grant that choice from a copy of the license alone.

## Decision

- Builds carry the core license, third-party license texts, notices and source
  links. The inventory states its scope and reads the installed packages.
  The runner keeps the licenses of its deployed packages and base image.
  Exact Debian source descriptors and archives, and Node source, travel with
  the image. The source inventory matches the pinned image and its binaries.
- The runner removes unused npm and npx tools from its active filesystem.
  The builder keeps its package tools. Original base layer terms and source
  stay with the image. The inventory separates those layers from the active
  runtime. The operator commands still use Node directly.
- The runner installs only the fixed Debian security packages named in
  `tools/runner-sources.json`. Their exact source and terms travel with the
  original base source. The image test refuses other package changes.
- The runner clears elevation bits on mount and umount. This removes an
  elevation precondition without changing their program bytes. The image
  check holds the default nonroot user and Docker capabilities. Custom root
  or privileged use is outside that proof.
- A narrow Mermaid patch excludes only the ELK layout loader. All diagram
  types stay available. An ELK layout request takes Mermaid's standard Dagre
  fallback, as the upstream small build does. The graph stays the same;
  node placement can change. No second renderer or network loader is added.
- The image keeps the shared native libraries replaceable. It includes their
  preferred source archives, build scripts and patches. The full librsvg
  crate lock graph travels with them, including build and test dependencies.
- The documentation search Wasm carries its own GPL terms and source bundle.
  The bundle includes the Pagefind build scripts, its Wasm crate lock graph
  and the source of the generated Snowball algorithms.

## Consequences

- Integration and image tests read actual distribution notices and refuse ELK
  code in browser assets, including the inline frame document.
- Mermaid updates must preserve the layout patch and its regression proof.
- A license inventory identifies source duties. It does not replace a review
  of new dependency terms. Distribution source links must be public before
  the image becomes public.
