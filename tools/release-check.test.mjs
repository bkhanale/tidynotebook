import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterChecks,
  beforeChecks,
  compareVersions,
  imagePackage,
  packageVersionsPath,
  isoDate,
  parseVersion,
} from './release-check.mjs';

const changelog = `# Changelog

## 0.4.0 - 2026-10-01

This release gives the notes one gate.

### Added

- The release check reads every link of the chain.

## 0.3.3 - 2026-09-19

This patch release simplifies the Trash delete flow.

### Changed

- Trash uses Delete for the remove action.
`;

/** A prepare commit that passes every check before the tag. */
const before = {
  version: '0.4.0',
  today: '2026-10-01',
  changelog,
  readme: '**Status:** 0.4.0 is the current release. See\n',
  branch: 'main',
  headSubject: 'chore(release): prepare 0.4.0',
  pending: '',
  localTag: false,
  remoteTag: false,
  signsTags: true,
};

/** A published release that passes every check after the push. */
const after = {
  version: '0.4.0',
  changelog,
  tagKind: 'tag',
  tagSigned: true,
  tagSubject: 'Tidy Notebook 0.4.0',
  tagCommitSubject: 'chore(release): prepare 0.4.0',
  localTagSha: 'abc123',
  remoteTagSha: 'abc123',
  mainHoldsTagCommit: true,
  runStatus: 'completed',
  runConclusion: 'success',
  runUrl: 'https://example.test/run/1',
  releaseName: 'Tidy Notebook 0.4.0',
  releaseTag: 'v0.4.0',
  releaseDraft: false,
  releasePrerelease: false,
  releaseBody:
    'This release gives the notes one gate.\n\n### Added\n\n- The release check reads every link of the chain.\n',
  latestTag: 'v0.4.0',
  milestoneState: 'closed',
  milestoneOpenIssues: 0,
  imageOwner: 'tidynotebook',
  imageOwnerType: 'Organization',
  imageTags: ['0.4.0', 'latest'],
};

/** @param {{ name: string; status: string; detail: string }[]} checks */
const failures = (checks) =>
  checks
    .filter((check) => check.status === 'failed')
    .map((check) => check.name);

await test('a version is three numbers, and they order', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.equal(parseVersion('v1.2.3'), null);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(compareVersions('0.4.0', '0.3.3'), 1);
  assert.equal(compareVersions('0.3.3', '0.4.0'), -1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
});

await test('a whole prepare commit passes the before gate', () => {
  assert.deepEqual(failures(beforeChecks(before)), []);
});

await test('the before gate names each missing step', () => {
  assert.deepEqual(failures(beforeChecks({ ...before, branch: 'fix-trash' })), [
    'the branch',
  ]);
  assert.deepEqual(
    failures(beforeChecks({ ...before, pending: ' M README.md' })),
    ['the working tree'],
  );
  assert.deepEqual(
    failures(beforeChecks({ ...before, headSubject: 'fix(web): a row' })),
    ['the prepare commit'],
  );
  assert.deepEqual(failures(beforeChecks({ ...before, today: '2026-10-02' })), [
    'the changelog entry',
  ]);
  assert.deepEqual(
    failures(beforeChecks({ ...before, readme: '**Status:** 0.3.3' })),
    ['the README status'],
  );
  assert.deepEqual(failures(beforeChecks({ ...before, localTag: true })), [
    'the tag is free',
  ]);
  assert.deepEqual(failures(beforeChecks({ ...before, signsTags: false })), [
    'tag signing',
  ]);
});

await test('an entry that is not written yet reports one cause', () => {
  const checks = beforeChecks({ ...before, version: '0.5.0', localTag: false });
  assert.deepEqual(failures(checks), [
    'the prepare commit',
    'the changelog entry',
    'the README status',
  ]);
  assert.deepEqual(
    checks
      .filter((check) => check.status === 'skipped')
      .map((check) => check.name),
    ['the entry summary', 'the entry sections', 'the release notes'],
  );
});

await test('the before gate refuses a section that the format does not hold', () => {
  const broken = changelog.replace('### Added', '### Notes');
  assert.deepEqual(failures(beforeChecks({ ...before, changelog: broken })), [
    'the entry sections',
  ]);
});

await test('a whole release passes the after gate', () => {
  assert.deepEqual(failures(afterChecks(after)), []);
});

await test('the after gate names each missing step', () => {
  assert.deepEqual(
    failures(afterChecks({ ...after, tagCommitSubject: 'fix(web): a row' })),
    ['the tagged commit'],
  );
  assert.deepEqual(failures(afterChecks({ ...after, tagKind: '' })), [
    'the tag',
  ]);
  assert.deepEqual(failures(afterChecks({ ...after, tagSigned: false })), [
    'the tag',
  ]);
  assert.deepEqual(failures(afterChecks({ ...after, remoteTagSha: '' })), [
    'the pushed tag',
  ]);
  assert.deepEqual(
    failures(afterChecks({ ...after, mainHoldsTagCommit: false })),
    ['the pushed commit'],
  );
  assert.deepEqual(
    failures(
      afterChecks({
        ...after,
        runStatus: 'completed',
        runConclusion: 'failure',
      }),
    ),
    ['the image build'],
  );
  assert.deepEqual(
    failures(afterChecks({ ...after, releaseTag: '', releaseName: '' })),
    ['the GitHub release'],
  );
  assert.deepEqual(failures(afterChecks({ ...after, releaseDraft: true })), [
    'the release state',
  ]);
  assert.deepEqual(
    failures(
      afterChecks({
        ...after,
        releaseBody: 'This release gives the notes one gate.',
      }),
    ),
    ['the release notes'],
  );
  assert.deepEqual(failures(afterChecks({ ...after, latestTag: 'v0.3.3' })), [
    'the latest release',
  ]);
  assert.deepEqual(
    failures(afterChecks({ ...after, milestoneState: 'open' })),
    ['the milestone'],
  );
  assert.deepEqual(
    failures(afterChecks({ ...after, milestoneOpenIssues: 2 })),
    ['the milestone'],
  );
  assert.deepEqual(failures(afterChecks({ ...after, imageTags: ['0.4.0'] })), [
    'the image tags',
  ]);
});

await test('a release with no milestone and no package scope skips those checks', () => {
  const checks = afterChecks({ ...after, milestoneState: '', imageTags: null });
  assert.deepEqual(failures(checks), []);
  assert.deepEqual(
    checks
      .filter((check) => check.status === 'skipped')
      .map((check) => check.name),
    ['the milestone', 'the image tags'],
  );
});

await test('an image owner that GitHub does not know fails the image check', () => {
  // A failed lookup of the owner read the address of the user, found no
  // package, and reported a skip, so a release with no image looked complete.
  assert.deepEqual(
    failures(afterChecks({ ...after, imageOwnerType: '', imageTags: null })),
    ['the image tags'],
  );
});

await test('the image package comes from the release workflow', () => {
  assert.deepEqual(
    imagePackage('    env:\n      IMAGE: ghcr.io/tidynotebook/tidynotebook\n'),
    { owner: 'tidynotebook', name: 'tidynotebook' },
  );
  assert.deepEqual(imagePackage('no image here\n'), { owner: '', name: '' });
});

await test('the versions of an organization package are read from the organization', () => {
  // The repository moved to an organization (record 0187). The package of
  // the image belongs to that organization, and the address of the user
  // finds no package there.
  const image = { owner: 'tidynotebook', name: 'tidynotebook' };
  assert.equal(
    packageVersionsPath(image, 'Organization'),
    'orgs/tidynotebook/packages/container/tidynotebook/versions?per_page=100',
  );
  assert.equal(
    packageVersionsPath({ owner: 'someone', name: 'notes' }, 'User'),
    'user/packages/container/notes/versions?per_page=100',
  );
});

await test('the date of a release is the local day', () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
});
