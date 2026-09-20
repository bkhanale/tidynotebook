# 0074. The build names every asset that a browser may pin

- Status: Accepted
- Date: 2026-09-20

## Context

`apps/server/src/plugins/static-assets.ts` reads a content hash out of a file
name and answers a year of `immutable` when it finds one. The name is a guess,
so the rule pinned `apple-touch-icon.png` and every vendored face. Those
addresses are fixed, so a browser held bytes that a later deployment replaced
and never asked for the file again.

The guess is corrected, but the shape of the problem stays: the server infers
from a name what only the build knows. The icons of the shell and of the
installed manifest are the files that change most often and that a person sees
first, and `apps/web/public/` gives each one a fixed address for ever.

## Decision

The build gives every asset that a browser may pin a name that follows its
bytes. `apps/web/icons/` holds the icon sources, and the `notesapp-app-icons`
plugin of `apps/web/vite.config.ts` emits each one under a hashed name, writes
those addresses into the shell document, and builds the icon list of the
manifest from the same array.

`apps/web/public/` keeps only the files whose address a caller may not choose:
the vendored faces. Every file it holds is revalidated on each load.

This refines [0013](0013-delivery-and-headers-belong-to-the-app.md), which
gives the caching rules to the application, and it follows
[0045](0045-the-build-names-the-precache.md), where the build already names
the cache of the worker from the bytes of the build.

## Consequences

A new icon reaches every browser at once, because it arrives at an address
that no cache holds. The old address answers nothing, so an entry that an
earlier deployment pinned can never serve it again.

An icon is no longer reachable under a fixed name, so nothing may link one by
hand. The development server answers the source addresses under `/icons/`, and
the two consumers read the one array.

`apps/server/src/plugins/static-assets.test.ts` refuses a fixed address that
reads as hashed. `tests/integration/web-build.test.ts` reads the real build and
refuses an emitted asset that is not hashed, a public file that is, and a shell
or a manifest that names an icon the build did not write.
