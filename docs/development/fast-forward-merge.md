# Fast forward merge

This document owns the manual workflow that moves `main` to the reviewed head
of one pull request, and the limits of that workflow.

## Intent

A person starts `.github/workflows/ff-only-merge.yml` by hand with a pull
request number and the full head SHA that they reviewed. The workflow uses the
checks that already ran on the pull request. It runs no test again.
`tools/ff-only-merge.mjs` holds every gate, and
`tools/ff-only-merge.test.mjs` proves each gate with a fake GitHub API.
`tools/ci-workflow.test.mjs` holds the shape of the workflow file.

## Trust

- The workflow runs only from `main`, and only the code of the workflow
  commit. It checks out three files of that commit, keeps no credential in
  the checkout, and installs no package. It never reads the code of the pull
  request.
- The condition on the ref stops a run from another branch by mistake. A
  branch can change its own copy of the workflow, so the rules on `main`, and
  not this condition, protect `main` from such a copy.
- The two inputs are data. They reach the script through the environment, and
  the script refuses anything but a positive integer and a full lowercase SHA.
- The job uses `GITHUB_TOKEN` with write access to contents and read access to
  pull requests, checks and statuses. It uses no other credential.
- One concurrency group holds every run, and a run never cancels another.

## Gates

The script reads the pull request first and freezes its head H. Then it reads
the current `main` B. Each gate holds on exactly H:

- The pull request is open, not a draft, into `main`, and its head branch is
  in this repository. H is the expected SHA.
- The latest review of the CodeRabbit account approves H. The script matches
  the login, the account type and the user ID. A CodeRabbit comment and a
  green CodeRabbit status are not an approval.
- The newest CodeRabbit status on H is a success, and no other account wrote a
  status of that name.
- Every required status check of the effective rules for `main` succeeded on
  H. A check that names an app counts only a check run from that app.
- No reviewer requests changes in their latest review.
- No review thread is open, also an outdated thread.
- B is an ancestor of H, and no commit after B is a merge commit.

A rule on `main` that the script does not evaluate stops it. So does a pull
request rule that requires approvals or named reviewers. Every list is read
to its last page, and a list that GitHub does not return in full stops the
script.

## The write

The script reads everything a second time and stops if any value changed. Then
it sends one `updateRefs` mutation for `refs/heads/main` with `beforeOid` B,
`afterOid` H and no force. GitHub applies it only if `main` still points to B,
so the write is a compare and swap on the server. The REST update has no
expected old value, so the script does not use it. The script never uses the
pull request merge endpoint, never forces, and never retries. After the write
it reads `main` back and writes the actual result to the job summary. When the
answer is lost, that read decides the report.

References:

- [updateRefs mutation](https://docs.github.com/en/graphql/reference/mutations#updaterefs)
  and [Git objects in GraphQL](https://docs.github.com/en/graphql/reference/git)
- [REST references](https://docs.github.com/en/rest/git/refs)
- [Rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)

## Limits

- The ruleset "Public main" (ruleset 25134765) holds the rules for `main`:
  no deletion, no non fast forward update, linear history, the required check
  `Lint` from the GitHub Actions app, a pull request with resolved threads and
  rebase merges only, no required approval, and no bypass actor. Classic branch
  protection answers "not found", which does not mean that `main` is open.
- The pull request rule can refuse a direct ref update. Then the job fails and
  shows the refusal. Nobody relaxes a rule to make it pass. The direct update
  is not proven until the owner allows a real run.
- The API cannot bind the reviews, the checks and the head to the ref update in
  one atomic step. The second read and the compare and swap on B make the
  window small, and the frozen H blocks new code that nobody reviewed. A
  review that changes inside the window is not seen.
- A push with `GITHUB_TOKEN` starts no `push` workflow and no Pages build.
  CI runs on pull requests only, so nothing runs after the update.
- The workflow does not close the pull request and does not delete a branch.
