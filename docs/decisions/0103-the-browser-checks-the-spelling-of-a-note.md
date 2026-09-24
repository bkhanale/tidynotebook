# 0103. The browser checks the spelling of a note

- Status: Accepted
- Date: 2026-09-25

## Context

Issue 141 asks that a person find the spelling mistakes of the note they
write. Grammar is welcome but not required. CodeMirror turns the spell checker
of the browser off on its content element. The editor holds no dictionary.

Three kinds of engine exist. The browser engine uses the languages, the
personal dictionary and the suggestion menu of the device, and it costs no
download. A bundled engine, Hunspell dictionaries in JavaScript or a WASM
checker, adds megabytes for each language, a second suggestion interface and
a worker, and it knows fewer languages. A server engine sends the text of the
note to a service, which the editor package refuses (no network call).

## Decision

- The editor sets `spellcheck` on its content element from one compartment,
  `packages/editor/src/spell-check.ts`, so the setting changes with no rebuild.
- Text that is not prose is out of the check: code, a URL, an autolink, HTML,
  front matter and math. The rule reads the Lezer tree of record 0001 and
  marks those ranges with `spellcheck="false"`. It walks the visible ranges
  only, as the live preview does.
- The account stores `spellCheck`, on by default, beside the appearance. A
  person turns it off in Settings, and the choice follows them to every device.
- The members of the body of `updatePreferences` are optional. A member that
  the body leaves out keeps its stored value, so each setting writes only
  itself, and a client that does not know `spellCheck` cannot reset it.
- No grammar engine. A browser that checks grammar, for example Edge, does so
  through the same attribute when the person turns that on.

## Consequences

- The result follows the browser: its languages, its dictionary and its menu.
  A browser with its own check turned off shows no marks.
- A new kind of code syntax must join the exclusion list in `spell-check.ts`.
- `spell-check.test.ts` holds the ranges. `service.test.ts` in
  `packages/core/src/workspaces/` and `tests/integration/preferences.test.ts`
  hold the stored value and the kept member.
- Grammar that works offline in every language waits for an engine that can do
  it without the network.
