---
name: setup-project
description: Checks and sets up a core contributor worktree or named self-hosted installation. Use for initial setup or a missing prerequisite. It does not rotate credentials, restore data, or publish a release.
---

# Setup project

Start with the named target and setup scope. For development, read
`CONTRIBUTING.md`, install frozen dependencies, and run the test service commands.
For hosting, read [hosting](../../../docs/guide/self-hosting.md) and the configuration
guide. Check protected secret files without printing their contents. Generate
credentials only for the named new target. Save their locations privately.
End when the target readiness check passes. Credential rotation needs explicit
scope, an existing target check, and a rollback path before a write.
