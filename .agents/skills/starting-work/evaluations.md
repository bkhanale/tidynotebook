# Evaluations for starting-work

Each scenario states the request and the behaviour that the skill must
produce.

```json
[
  {
    "query": "Add a rename control to the note header in apps/web/src/features.",
    "expected_behavior": "Runs node tools/agent-context.mjs apps/web/src/features. Reads AGENTS.md, docs/README.md, docs/development/feature-workflow.md, docs/decisions/README.md, docs/releases/0.1.0.md, apps/web/AGENTS.md and every key file that the web guide lists. Writes five lines: the rename control as the change, apps/web/AGENTS.md as the directory guide, the decision records that the guide names, the release list row that the change closes, and the verification commands. Starts no edit before the five lines exist."
  },
  {
    "query": "Add a route that lists trashed notes in apps/server/src/http.",
    "expected_behavior": "Runs node tools/agent-context.mjs apps/server/src/http. Reads the core list, apps/server/AGENTS.md and every key file that the server guide lists. The restatement names the contract first order of docs/development/feature-workflow.md, the applicable decision records, the release list row, and the verification commands. Stops and asks when the request conflicts with a rule or a decision record."
  },
  {
    "query": "Correct the backup steps in docs/guide/self-hosting.md.",
    "expected_behavior": "Runs node tools/agent-context.mjs docs/guide/self-hosting.md. Reads the core list, because docs/guide has no directory guide. The restatement names the document rules of docs/README.md, no decision record when none applies, the release list row or none, and pnpm lint as the verification."
  }
]
```
