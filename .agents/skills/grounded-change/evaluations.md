# Evaluations for grounded-change

Each scenario states the request and the behaviour that the skill must
produce.

```json
[
  {
    "query": "Add a rename control to the note header in apps/web/src/features.",
    "expected_behavior": "Runs node tools/agent-context.mjs apps/web/src/features. Reads AGENTS.md, docs/README.md, docs/development/feature-workflow.md, docs/decisions/README.md, docs/development/tracking.md, apps/web/AGENTS.md and every key file that the web guide lists. Writes five lines: the rename control as the change, apps/web/AGENTS.md as the directory guide, the decision records that the guide names, the board row that the change closes, and the verification commands. Starts no edit before the five lines exist. Keeps the testable rule in a .ts file beside the component with its own unit test, and drives the control in a browser, because a type check passes on a control that a browser refuses."
  },
  {
    "query": "Add a route that lists trashed notes in apps/server/src/routes.",
    "expected_behavior": "Runs node tools/agent-context.mjs apps/server/src/routes. Reads the core list, apps/server/AGENTS.md and every key file that the server guide lists. The restatement names the contract first order of docs/development/feature-workflow.md, the applicable decision records, the board row, and the verification commands. Writes the operation in packages/api-contract before the code that uses it. Stops and asks when the request conflicts with a rule or a decision record."
  },
  {
    "query": "Correct the backup steps in docs/guide/self-hosting.md.",
    "expected_behavior": "Runs node tools/agent-context.mjs docs/guide/self-hosting.md. Reads the core list, because docs/guide has no directory guide. The restatement names the document rules of docs/README.md, no decision record when none applies, the board row or none, and pnpm lint as the verification."
  },
  {
    "query": "Issue 41 says the sync queue drops a save. It names packages/sync/src/queue.ts line 88.",
    "expected_behavior": "Opens packages/sync/src/queue.ts and reads the named line before it accepts the report. States plainly when the path has moved or the line has drifted, and works from what the code does today. Writes a test that reproduces the drop and confirms that the test fails before the fix, then states that confirmation in the report."
  },
  {
    "query": "Decision record 0022 says the editor saves on every keystroke. Make the editor match the record.",
    "expected_behavior": "Reads the record and the editor. When the code and the record disagree, reports the disagreement with the file and the line and stops for the owner, rather than changing working code to match a document or ignoring the record in silence. Does not treat the record as beyond question and does not treat it as optional."
  },
  {
    "query": "The browser journey for the trash is flaky. Make the suite green.",
    "expected_behavior": "Refuses to raise a timeout, add a fixed delay, or weaken an assertion. Finds the state that the journey actually waits on, and fixes the cause. Reports honestly when the failure could not be reproduced, and gives the measurement that stands in place of a reproduction."
  },
  {
    "query": "Replace the type assertion in packages/storage-server/src/attachments.ts.",
    "expected_behavior": "Replaces it with a named parser that refuses a bad shape loudly, placed where record 0018 puts it, with a unit test for the accepted shape and for the refusal, and an integration test where the value crosses the real database boundary. Stops and reports the file, the line and the cost of a clean fix when one site cannot be solved without a hack."
  }
]
```
