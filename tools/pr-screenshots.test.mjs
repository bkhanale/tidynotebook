import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkFiles,
  checkName,
  githubRepository,
  publishScreenshots,
  screenshotBranch,
  screenshotScheme,
  screenshotTable,
} from './pr-screenshots.mjs';

/** @param {string} cwd @param {readonly string[]} args */
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

await test('a name is one lowercase path segment', () => {
  assert.equal(checkName('audit-2026-10-02'), 'audit-2026-10-02');
  for (const name of ['', 'Audit', 'a/b', '../a', 'a b', '-a', 'a-'])
    assert.throws(() => checkName(name), /must be lowercase/);
});

await test('the files are PNGs with distinct lowercase names', () => {
  assert.deepEqual(checkFiles(['x/find-light.png']), ['x/find-light.png']);
  assert.throws(() => checkFiles([]), /at least one/);
  assert.throws(() => checkFiles(['find.jpg']), /must be a \.png/);
  assert.throws(() => checkFiles(['Find.png']), /must be a \.png/);
  assert.throws(
    () => checkFiles(['a/find-light.png', 'b/find-light.png']),
    /Two files/,
  );
});

await test('the repository comes from an HTTPS or an SSH remote', () => {
  for (const url of [
    'https://github.com/bkhanale/notesapp.git',
    'https://github.com/bkhanale/notesapp',
    'git@github.com:bkhanale/notesapp.git',
    'ssh://git@github.com/bkhanale/notesapp.git',
  ])
    assert.equal(githubRepository(url), 'bkhanale/notesapp');
  assert.throws(
    () => githubRepository('https://gitlab.com/a/b.git'),
    /not a GitHub/,
  );
});

await test('the scheme is the suffix of the base name', () => {
  assert.deepEqual(screenshotScheme('find-light.png'), {
    stem: 'find',
    scheme: 'light',
  });
  assert.deepEqual(screenshotScheme('tree-menu-dark.png'), {
    stem: 'tree-menu',
    scheme: 'dark',
  });
  assert.deepEqual(screenshotScheme('phone.png'), {
    stem: 'phone',
    scheme: null,
  });
});

await test('the table puts light and dark of one screen on one row', () => {
  const table = screenshotTable('o/r', 'abc', 'run', [
    'find-light.png',
    'find-dark.png',
    'phone.png',
    'menu-dark.png',
  ]);
  const base = 'https://github.com/o/r/blob/abc/run';
  assert.equal(
    table,
    [
      '| Screen | Light | Dark |',
      '| --- | --- | --- |',
      `| find | ![find, light](${base}/find-light.png?raw=true) | ![find, dark](${base}/find-dark.png?raw=true) |`,
      `| phone | ![phone](${base}/phone.png?raw=true) | |`,
      `| menu |  | ![menu, dark](${base}/menu-dark.png?raw=true) |`,
      '',
    ].join('\n'),
  );
});

await test('each run adds one commit on the branch and leaves the worktree alone', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pr-screenshots-test-'));
  try {
    const remote = join(directory, 'remote.git');
    const work = join(directory, 'work');
    git(directory, ['init', '--quiet', '--bare', remote]);
    git(directory, ['init', '--quiet', '-b', 'main', work]);
    git(work, ['config', 'user.email', 'test@notes.invalid']);
    git(work, ['config', 'user.name', 'Test']);
    git(work, ['remote', 'add', 'origin', remote]);
    writeFileSync(join(work, 'code.txt'), 'code\n');
    git(work, ['add', 'code.txt']);
    git(work, ['commit', '--quiet', '-m', 'chore: code']);
    const head = git(work, ['rev-parse', 'HEAD']);
    const shots = join(directory, 'shots');
    mkdirSync(shots);
    writeFileSync(join(shots, 'find-light.png'), 'light');
    writeFileSync(join(shots, 'find-dark.png'), 'dark');
    writeFileSync(join(work, 'draft.txt'), 'not staged\n');

    const first = publishScreenshots(
      'first',
      [join(shots, 'find-light.png'), join(shots, 'find-dark.png')],
      { cwd: work, repository: 'o/r' },
    );
    const tipOne = git(remote, ['rev-parse', screenshotBranch]);
    assert.match(first, new RegExp(`/o/r/blob/${tipOne}/first/find-light\\.png\\?raw=true`));
    assert.equal(git(remote, ['log', '--format=%P', '-1', tipOne]), '');

    publishScreenshots('second', [join(shots, 'find-dark.png')], {
      cwd: work,
      repository: 'o/r',
    });
    const tipTwo = git(remote, ['rev-parse', screenshotBranch]);
    assert.equal(git(remote, ['log', '--format=%P', '-1', tipTwo]), tipOne);
    assert.deepEqual(
      git(remote, ['ls-tree', '-r', '--name-only', tipTwo]).split('\n'),
      ['first/find-dark.png', 'first/find-light.png', 'second/find-dark.png'],
    );
    assert.equal(git(remote, ['show', `${tipTwo}:first/find-light.png`]), 'light');

    assert.throws(
      () =>
        publishScreenshots('first', [join(shots, 'find-dark.png')], {
          cwd: work,
          repository: 'o/r',
        }),
      /already has a directory "first"/,
    );
    assert.equal(git(remote, ['rev-parse', screenshotBranch]), tipTwo);

    assert.equal(git(work, ['rev-parse', 'HEAD']), head);
    assert.equal(git(work, ['branch', '--show-current']), 'main');
    assert.equal(git(work, ['status', '--porcelain']), '?? draft.txt');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
