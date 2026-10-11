# Evaluations for prepare-change

Each case checks the preparation unit in a fresh owned worktree. The unit saves
context and names the next skill. Later units own implementation and proof.

## A public feature

Request: Add a rename control in the web application.

- Runs the task command with the owned root, task name, phase, and web paths.
- Reads every public guide and the design guide before an edit.
- Saves the scope, current diff, guide digests, owner, and next skill.
- Writes the five line restatement. Stops on a real rule conflict.
- Selects build-change when preparation is complete. It gives no new write
  permission and does not start a release or live deploy.

## A saved task

Request: Resume a saved task without a new phase or path list.

- Keeps the saved phase, paths, user context, dependencies, and remaining work.
- Refreshes the current commit and public guides. It does not reuse old proof.
- Uses a new phase or path list only when the caller supplies it.
- Leaves omitted internal phase and paths to the private owner.
- Gives no new permission from the saved context.

## A report with a stale path

Request: Fix the save defect at the path and line in an issue.

- Reads the reported code before it accepts the report.
- Names a moved path or changed line and uses the current code.
- Saves the corrected owned paths and the public guides.
- Selects the next unit without copying an old task result into current proof.

## An internal task

Request: Resume private consumer work at the review phase with named core paths.

- Requires the private owner before it can continue internal preparation.
- Passes the owned core root, each core path, task name, and review phase to
  the private task command.
- Saves private context only under that owner. Public context keeps no private
  guide contents.
- Standalone core work succeeds when no private checkout exists.

## A document fix

Request: Correct the backup guide.

- Reads docs/README.md and every listed public guide.
- Saves the document scope and names the required document check.
- Does not run a host operation from a request to edit its guide.

The fixture tests in tools/lifecycle.test.mjs check owner refusal, path bounds,
and the internal phase and path handoff. The context tests in
tools/agent-context.test.mjs check the public reading list and optional owner.
