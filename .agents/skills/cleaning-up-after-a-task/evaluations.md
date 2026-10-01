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
      "Removes every worktree but the main checkout, and every branch but main and the branches with an open pull request",
      "Deploys main to the local Docker deployment before it prunes the Docker data",
      "Takes no backup",
      "Reports what remains and each item that stayed and why"
    ]
  },
  {
    "skills": ["cleaning-up-after-a-task"],
    "query": "/cleaning-up-after-a-task. One worktree has a file that is not committed, and one branch on origin has a commit that is not in main.",
    "expected_behavior": [
      "Asks the owner about the worktree and the branch before it removes them",
      "Removes neither of them when the owner says no"
    ]
  },
  {
    "skills": ["build-it-right", "cleaning-up-after-a-task"],
    "query": "Fix the sort order of the note list, land it, and finish the task.",
    "expected_behavior": [
      "Removes only its own worktree and branch, as the feature workflow states",
      "Does not run the cleanup skill, because the owner did not invoke it"
    ]
  }
]
```
