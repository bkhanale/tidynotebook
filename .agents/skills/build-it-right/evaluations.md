# Evaluations for build-it-right

Each scenario states the request and the behaviour that the skill must
produce. The shape follows the Agent Skills evaluation structure: the skills
under test, the query, and the expected behaviour as a list of checks.

```json
[
  {
    "skills": ["build-it-right"],
    "query": "Add a rename control to the note header in apps/web/src/features.",
    "expected_behavior": [
      "Runs node tools/agent-context.mjs apps/web/src/features before the first edit",
      "Reads the core list and apps/web/AGENTS.md and the key files that the web guide names",
      "Writes the five line restatement, naming the directory guide, the records, the board row and the verification",
      "Makes no edit before the restatement exists",
      "Keeps the testable rule in a .ts file beside the component with its own unit test",
      "Opens the screen and reads the control, because a type check passes on a control that a browser refuses"
    ]
  },
  {
    "skills": ["build-it-right"],
    "query": "Add a route that lists trashed notes in apps/server/src/routes.",
    "expected_behavior": [
      "Runs node tools/agent-context.mjs apps/server/src/routes and reads apps/server/AGENTS.md",
      "Writes the operation in packages/api-contract before any code that uses it",
      "Names the contract first order of the feature workflow in the restatement",
      "Adds an integration test against real PostgreSQL",
      "Stops and asks when the request conflicts with a rule or a decision record"
    ]
  },
  {
    "skills": ["build-it-right"],
    "query": "Correct the backup steps in docs/guide/self-hosting.md.",
    "expected_behavior": [
      "Runs node tools/agent-context.mjs docs/guide/self-hosting.md",
      "Reads the core list, because docs/guide has no directory guide",
      "Names the document rules of docs/README.md in the restatement",
      "Names no decision record, because none applies",
      "Names pnpm lint as the verification"
    ]
  },
  {
    "skills": ["build-it-right"],
    "query": "Issue 41 says the sync queue drops a save. It names packages/sync/src/queue.ts line 88.",
    "expected_behavior": [
      "Opens packages/sync/src/queue.ts and reads the named line before it accepts the report",
      "States plainly when the path has moved or the line has drifted, and works from the code",
      "Writes a test that reproduces the drop",
      "Restores the old behaviour, confirms the test fails, then puts the fix back",
      "States in the report that the failure before the fix was confirmed"
    ]
  },
  {
    "skills": ["build-it-right"],
    "query": "Decision record 0022 says the editor saves on every keystroke. Make the editor match the record.",
    "expected_behavior": [
      "Reads the record and the editor code",
      "Reports the disagreement with the file and the line",
      "Stops for the owner rather than changing working code to match a document",
      "Does not ignore the record in silence either"
    ]
  },
  {
    "skills": ["build-it-right"],
    "query": "The integration test for the trash is flaky. Make the suite green.",
    "expected_behavior": [
      "Refuses to raise a timeout, add a fixed delay, or weaken an assertion",
      "Finds the state that the test actually waits on and fixes the cause",
      "Reports honestly when the failure could not be reproduced",
      "Gives a measurement that stands in place of a reproduction"
    ]
  },
  {
    "skills": ["build-it-right"],
    "query": "Replace the type assertion in packages/storage-server/src/attachments.ts.",
    "expected_behavior": [
      "Replaces it with a named parser that refuses a bad shape loudly",
      "Places the parser where decision record 0018 puts it",
      "Adds a unit test for the accepted shape and for the refusal",
      "Adds an integration test where the value crosses the real database boundary",
      "Stops and reports the file, the line and the cost when a site needs a hack"
    ]
  }
]
```
