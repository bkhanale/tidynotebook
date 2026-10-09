---
name: build-change
description: Implements an approved core change with tests in its owned worktree. Use after task preparation and required design. It does not publish a PR, release, or deploy.
---

# Build change

Start with prepared context and any accepted decision. Follow the feature
workflow from contract to domain, storage, handler, client, and proof. Keep
boundaries strict. Fix each defect with a regression test. Confirm that the test
fails with the old behavior. Run focused tests while changes are in progress.
Commit clean boundaries. End with implemented code, focused tests, and a clear
list of claims for `prove-change`.
