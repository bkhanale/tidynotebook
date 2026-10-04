---
name: releasing-a-version
description: Releases one version of tidy notebook from end to end, and repairs a release that missed a step. It covers the changelog entry, the prepare commit, the signed tag, the tag push that builds the container image, the GitHub release, and the milestone, and it proves each one with tools/release-check.mjs. Use it for any request to release, to cut or bump a version, to tag a version, to publish release notes, or to check that a release is complete.
---

# Releasing a version

A release is one chain. Each link is a separate action, and a missed link is
silent: a pushed tag builds the image but publishes no GitHub release, and a
release with hand written notes does not match the changelog. Two commands
read the real state and name the missing link, so run them and believe them,
not the memory of what was done.

- The one record of a release is the `CHANGELOG.md` entry.
- The version string is `X.Y.Z`. The tag is `vX.Y.Z`. The release title is
  `tidy notebook X.Y.Z`. The prepare commit is `chore(release): prepare X.Y.Z`.
- A pushed tag is final. It is never moved, never deleted, and never forced. A
  fault after the push becomes the next patch version.

## The checklist

Copy this into the answer and mark each step when the step is done.

```
Release X.Y.Z:
- [ ] 1. Choose the version
- [ ] 2. Write the entry and the status line
- [ ] 3. Pass pnpm verify
- [ ] 4. Land the prepare commit on main
- [ ] 5. Pass the before gate
- [ ] 6. Tag, push, and watch the image build
- [ ] 7. Publish the GitHub release
- [ ] 8. Close the milestone
- [ ] 9. Pass the after gate
```

## 1. Choose the version

Read what landed since the last tag, then choose the step.

```sh
git tag --sort=-creatordate | head -3
git log --oneline v<previous>..main
```

The product is below 1.0, so the first number stays 0. A release that only
repairs a defect takes the next patch number. A release that gives a person
something new takes the next minor number. Ask the owner when the two rules
both fit.

## 2. Write the entry and the status line

Write the new entry at the top of `CHANGELOG.md`, above the previous entry.
See [reference/changelog-entry.md](reference/changelog-entry.md) for the shape,
the words, and a worked example.

Set the status line of `README.md` to the new version:

```
**Status:** X.Y.Z is the current release. See
```

Change nothing else. A release commit holds these two files only.

## 3. Pass pnpm verify

```sh
pnpm verify
```

The gate must pass before the commit lands. A release never ships a red gate.
It does not build the container image. The before gate does that in step 5.

## 4. Land the prepare commit on main

Work in a worktree on a short-lived branch, then land it by fast-forward, as
`docs/development/feature-workflow.md` states. The commit holds `CHANGELOG.md`
and `README.md`, and its subject is exact:

```sh
git commit -m "chore(release): prepare X.Y.Z" CHANGELOG.md README.md
git rebase main
git -C <main checkout> merge --ff-only <branch>
```

Stay in the worktree for the rest of the release. Its `HEAD` is now the tip of
`main`, and every command below runs there.

## 5. Pass the before gate

```sh
node tools/release-check.mjs before X.Y.Z
```

It reads that `HEAD` is the tip of `main` and holds `origin/main`, the working
tree, the commit subject, the entry, its date, its sections, the status line,
the free tag, and tag signing. Then it builds the image from the committed tree,
as the release workflow does, so a fault of the image build stops the release
before the tag (record 0204). The build needs Docker and takes some minutes.
Repair every `FAIL` and run it again. Do not tag while one line fails.

## 6. Tag, push, and watch the image build

The tag message opens with the release title, states the release in one
sentence, and points at the changelog.

```sh
git push origin main
git tag -s vX.Y.Z -m "tidy notebook X.Y.Z" -m "<one sentence about this release>" -m "See CHANGELOG.md for the whole entry."
git push origin vX.Y.Z
```

The tag push starts `.github/workflows/release.yml`, which builds the image and
pushes `ghcr.io/tidynotebook/tidynotebook:X.Y.Z` and `:latest`. Watch it to the end:

```sh
gh run watch "$(gh run list --workflow=release.yml --branch vX.Y.Z --limit 1 --json databaseId --jq '.[0].databaseId')"
```

## 7. Publish the GitHub release

**The tag push does not publish a release.** This step creates it, and its body
comes from the changelog, never from the keyboard.

```sh
node tools/release-notes.mjs X.Y.Z \
  | gh release create vX.Y.Z --verify-tag --latest --title "tidy notebook X.Y.Z" --notes-file -
```

## 8. Close the milestone

A milestone named `X.Y.Z` holds the rows that the release ships. Move an open
row to the next milestone, then close the milestone.

```sh
gh issue list --milestone X.Y.Z --state open
number=$(gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --jq '.[] | select(.title == "X.Y.Z") | .number')
gh api --method PATCH "repos/{owner}/{repo}/milestones/$number" -f state=closed
```

A patch release can carry no milestone. The gate then reports `skip`, which is
the expected result.

## 9. Pass the after gate

```sh
node tools/release-check.mjs after X.Y.Z
```

It reads the tag, its signature, the commit it names, the pushed tag, the image
build, the GitHub release, its title, its body, its latest mark, the milestone,
and the image tags. Every line must read `ok` or `skip`.

Report the result with the release address, the run address, and the one line
that each `skip` states.

## When a step fails

See [reference/recovery.md](reference/recovery.md). It states the repair for a
faulty entry, a failed image build, a missing release, wrong notes, a wrong
title, a tag on the wrong commit, and a milestone that stays open.
