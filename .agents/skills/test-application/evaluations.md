# Evaluations for test-application

Each scenario states the request and the behaviour that the skill must
produce. The shape follows the Agent Skills evaluation structure: the skills
under test, the query, and the expected behaviour as a list of checks.

```json
[
  {
    "skills": ["test-application"],
    "query": "Take the light and dark screenshots of the Trash screen before this branch lands.",
    "expected_behavior": [
      "Runs scripts/app.mjs start, or reads scripts/app.mjs status and uses the application that already runs",
      "Runs scripts/browser.mjs before the first drive script",
      "Writes the drive script in .local-app/ and imports session.mjs by its relative path",
      "Takes both screenshots with screenshotBoth, so each scheme opens in its own context",
      "Opens each screenshot and states what it shows",
      "Runs scripts/app.mjs stop at the end"
    ]
  },
  {
    "skills": ["test-application"],
    "query": "Reproduce the report that a task box toggled on two devices loses its state.",
    "expected_behavior": [
      "Opens two devices with two openDevice calls, never two pages of one context",
      "Uses setVisibility where the report has a person switch away from a device",
      "Reads the Markdown on the server with readNoteText and waits with until, not with a fixed delay",
      "Leaves the choice of what counts as the defect to the task, not to the skill",
      "Runs scripts/app.mjs restart after a code change before it drives the application again"
    ]
  },
  {
    "skills": ["test-application"],
    "query": "Another worktree already runs the application. Check the new sidebar in this one.",
    "expected_behavior": [
      "Starts the application of this worktree with scripts/app.mjs start and a free port, and never reads the .local-app/ of the other worktree",
      "Leaves the PostgreSQL container of the Compose project notesapp-test running",
      "Opens every device of this run against the origin of this worktree only",
      "Stops only the application of this worktree"
    ]
  }
]
```
