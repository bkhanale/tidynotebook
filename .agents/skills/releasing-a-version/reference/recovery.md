# Repairing a release

One rule holds above the rest: **a pushed tag is final.** It is never moved,
never deleted, and never forced. The image of that tag is already in the
registry, and a moved tag makes the image a lie. A fault that a repair cannot
reach becomes the next patch version.

## Contents

- Before the tag is pushed
- After the tag is pushed
- The image build failed
- The GitHub release is missing or wrong
- The milestone stays open
- The gate cannot read the image tags

## Before the tag is pushed

Nothing is public yet, so repair the commit itself.

- The prepare commit is not pushed: correct the file and amend the commit.
- The prepare commit is on `origin/main`: do not amend and do not force. Correct
  the file and commit it again with the same subject,
  `chore(release): prepare X.Y.Z`. The gate reads the newest commit, and the tag
  then names the corrected one.

Run `node tools/release-check.mjs before X.Y.Z` again after each repair.

## After the tag is pushed

| The fault                                 | The repair                                                       |
| ----------------------------------------- | ---------------------------------------------------------------- |
| The tag names the wrong commit            | Leave it. Release the next patch.                                |
| The tag message is wrong                  | Leave it. The release body is the record.                        |
| The tag is not signed                     | Leave it. Sign the next tag.                                     |
| The changelog entry states the wrong fact | Correct the entry on `main`, then edit the release body from it. |

A wrong tag stays in place with its image. The next patch version carries the
correction, and its entry states what changed.

## The image build failed

Read the run, then decide the cause.

```sh
gh run view "$(gh run list --workflow=release.yml --branch vX.Y.Z --limit 1 --json databaseId --jq '.[0].databaseId')" --log-failed
```

- A registry error or a network error is not a fault of the code. Run the job
  again: `gh run rerun <run id>`.
- A fault in the source cannot be repaired under the same tag. Fix it on `main`
  and release the next patch version.

## The GitHub release is missing or wrong

The tag push builds the image. It publishes no release. This is the step that
is missed most often.

```sh
# It is missing.
node tools/release-notes.mjs X.Y.Z \
  | gh release create vX.Y.Z --verify-tag --latest --title "Tidy Notebook X.Y.Z" --notes-file -

# The body does not match the changelog.
node tools/release-notes.mjs X.Y.Z | gh release edit vX.Y.Z --notes-file -

# The title is wrong.
gh release edit vX.Y.Z --title "Tidy Notebook X.Y.Z"

# GitHub calls an older release the latest one.
gh release edit vX.Y.Z --latest

# It is still a draft.
gh release edit vX.Y.Z --draft=false
```

## The milestone stays open

```sh
gh issue list --milestone X.Y.Z --state open
number=$(gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --jq '.[] | select(.title == "X.Y.Z") | .number')
gh api --method PATCH "repos/{owner}/{repo}/milestones/$number" -f state=closed
```

Move an open row to the next milestone first. A closed milestone with an open
row hides work.

## The gate cannot read the image tags

The container package is private, so the check needs one more scope.

```sh
gh auth refresh -s read:packages
```

Without the scope the gate reports `skip` for that one line, and the successful
image build is the evidence that the image exists.
