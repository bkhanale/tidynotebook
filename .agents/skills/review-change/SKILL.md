---
name: review-change
description: Publishes a standard core PR and handles Codex feedback for its current head. Use when a proved change is ready for PR review or when review asks for a fix. It does not merge.
---

# Review change

Start with current proof. Write short files for the title, result,
compatibility effect, and release note under `.tooling/`. Select one release
type: none for no released effect, patch for a fix, minor for a new feature,
major for a breaking change. The strongest change wins. A mixed feature and fix
is minor. The pre-stable breaking step is minor. Name public consumer effects.

```sh
pnpm lifecycle review --title-file .tooling/title.md --summary-file .tooling/summary.md --compatibility-file .tooling/compatibility.md --release-type patch --release-note-file .tooling/release-note.md --execute
```

For UI changes, pass each screen with `--screenshot`, once for light and once for
dark. The command publishes them through `tools/pr-screenshots.mjs`.
Return the PR URL at once. When `link_pull_request` is available, link the PR to this session at once.
Then use `watch_pull_request`. End the turn while review is pending so its
event can resume work. Use `unwatch_pull_request` before final handback.
A portable session reads status with a bound. It needs no new credential.

Read feedback with `pnpm lifecycle review-status <PR>`. Fix all findings. A
rejected finding needs evidence in its thread. Resolve a thread only after its
cause is fixed or its conclusion is supported. Prove the new commit and request
a new review. Wait for its event or use a bounded read, then continue. End when
Codex completes review of the final head and all threads are resolved.
