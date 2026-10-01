# Evaluations for cleaning-up-after-a-task

Each scenario states the request and the behaviour that the skill must
produce. The shape follows the Agent Skills evaluation structure: the skills
under test, the query, and the expected behaviour as a list of checks.

```json
[
  {
    "skills": ["cleaning-up-after-a-task"],
    "query": "/cleaning-up-after-a-task",
    "expected_behavior": [
      "Runs scripts/cleanup.mjs plan before it changes anything",
      "Runs scripts/cleanup.mjs apply with no --also when the plan has no ask line",
      "Takes no backup of the database or of the stored files",
      "Reports the state that apply prints, and names each item that stayed and why"
    ]
  },
  {
    "skills": ["cleaning-up-after-a-task"],
    "query": "/cleaning-up-after-a-task. One worktree still has a file that is not committed, and one branch on origin has a commit that is not in main.",
    "expected_behavior": [
      "Lists the two ask items with the reason that the plan prints",
      "Asks the owner which of them to remove before it runs apply",
      "Passes --also only for the items that the owner named",
      "Leaves each branch that has an open pull request in place"
    ]
  },
  {
    "skills": ["build-it-right", "cleaning-up-after-a-task"],
    "query": "Fix the sort order of the note list, land it, and finish the task.",
    "expected_behavior": [
      "Lands the change and removes only its own worktree and branch, as the feature workflow states",
      "Never runs scripts/cleanup.mjs, because the owner did not invoke the skill",
      "Leaves the other worktrees, the other branches, the test database and the Docker data in place"
    ]
  }
]
```
