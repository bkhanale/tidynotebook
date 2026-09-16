# 0005. Workspace becomes an implicit container

- Status: Superseded by 0049
- Date: 2026-09-10

## Context

NotesApp is a self hosted application for one person. The interface still
carried a workspace switcher, a create screen, a settings screen, role
badges, read only states, and viewer notices. None of them has a second
actor to serve.

## Decision

The server keeps `workspaceId` in the API and in the URL, because row access
control and the storage schema are built on it. The interface removes the
switcher, the create screen, the settings screen, the role badges, the read
only states, and the viewer notices. The single personal workspace is the
only one.

## Consequences

- Sharing can return later without a data migration.
- A screen must not ask the person to choose a workspace.
- `packages/core` keeps the role and action matrix, so the server invariant
  stays whole while the interface hides it.
