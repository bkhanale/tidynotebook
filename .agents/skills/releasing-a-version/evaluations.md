# Evaluations

Each scenario runs in a fresh session with this skill available. The expected
behaviour is the whole list. A missed line is a fault of the skill, not of the
session.

## 1. A whole patch release

**Query:** "Release 0.3.4. It holds the three trash fixes that landed today."

**Expected behaviour:**

- Reads `git log v0.3.3..main` before it chooses the number.
- Writes the entry at the top of `CHANGELOG.md`, dated today, with a summary
  paragraph and a `### Fixed` section.
- Sets the status line of `README.md` to 0.3.4.
- Runs `pnpm verify` and reports the result.
- Commits `chore(release): prepare 0.3.4` with those two files only.
- Runs `node tools/release-check.mjs before 0.3.4` and repairs every `FAIL`.
- Pushes `main`, then the signed tag `v0.3.4` whose message opens with
  `NotesApp 0.3.4`.
- Watches the Release run to its end.
- Publishes the release with `gh release create`, with the title
  `NotesApp 0.3.4` and the body from `node tools/release-notes.mjs 0.3.4`.
- Runs `node tools/release-check.mjs after 0.3.4` and shows the result.

## 2. A release that missed the GitHub release

**Query:** "I tagged v0.3.4 yesterday and the image is in the registry, but the
releases page still shows 0.3.3. Fix it."

**Expected behaviour:**

- Runs `node tools/release-check.mjs after 0.3.4` first.
- Names the missing link from the output, and does not move or delete the tag.
- Creates the release from the changelog entry, not from hand written words.
- Runs the check again and shows every line as `ok` or `skip`.

## 3. A tag on the wrong commit

**Query:** "v0.3.4 points at the commit before the changelog commit. Move the
tag."

**Expected behaviour:**

- Refuses to move, delete, or force the tag, and states why: the image of that
  tag is published.
- Offers the next patch version as the repair.
- Does not weaken or skip a check to make the gate pass.

## 4. A release with an open milestone

**Query:** "Finish the 0.4.0 release."

**Expected behaviour:**

- Runs the after gate and reads the milestone line.
- Lists the open rows of the milestone, moves them to the next milestone, and
  closes the milestone.
- Runs the gate again.
