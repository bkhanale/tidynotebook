import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseNameOf,
  cleanNoteBaseName,
  cleanNoteName,
  displayNoteName,
  duplicateNameProblem,
  folderOf,
  folderPaths,
  joinNotePath,
  noteBaseNameProblem,
  noteNameProblem,
  rewriteFolder,
  storageNotePath,
} from './note-name.ts';

await test('the interface hides the Markdown storage suffix', () => {
  assert.equal(displayNoteName('projects/roadmap.md'), 'projects/roadmap');
  assert.equal(displayNoteName('projects/roadmap.MD'), 'projects/roadmap');
});

await test('a visible note name gets one canonical storage suffix', () => {
  assert.equal(storageNotePath('projects/roadmap'), 'projects/roadmap.md');
  assert.equal(storageNotePath('projects/roadmap.md'), 'projects/roadmap.md');
  assert.equal(storageNotePath('projects/roadmap.MD'), 'projects/roadmap.md');
});

await test('a folder and a base name split at the last separator', () => {
  assert.equal(folderOf('projects/plans/roadmap.md'), 'projects/plans');
  assert.equal(folderOf('roadmap.md'), '');
  assert.equal(baseNameOf('projects/plans/roadmap.md'), 'roadmap.md');
  assert.equal(baseNameOf('roadmap.md'), 'roadmap.md');
  assert.equal(joinNotePath('', 'roadmap.md'), 'roadmap.md');
  assert.equal(joinNotePath('plans', 'roadmap.md'), 'plans/roadmap.md');
});

await test('edge spaces of every part are removed before a save', () => {
  assert.equal(cleanNoteName('trailing space name '), 'trailing space name');
  assert.equal(cleanNoteName('  plans / roadmap  '), 'plans/roadmap');
  assert.equal(cleanNoteName('plans/roadmap.md'), 'plans/roadmap');
});

await test('a trailing space alone is not a refusal', () => {
  assert.equal(noteNameProblem('trailing space name '), null);
  assert.equal(storageNotePath(cleanNoteName('name ')), 'name.md');
});

await test('each refusal cause has its own message', () => {
  const messages = [
    noteNameProblem(''),
    noteNameProblem('   '),
    noteNameProblem('a\\b'),
    noteNameProblem('ab'),
    noteNameProblem('/leading'),
    noteNameProblem('a//b'),
    noteNameProblem('../escape'),
    noteNameProblem('x'.repeat(300)),
  ];
  for (const message of messages) assert.notEqual(message, null);
  assert.equal(messages[0], messages[1]);
  const distinct = new Set(messages.slice(1).map((value) => String(value)));
  assert.equal(distinct.size, 7 - 1 + 1);
  for (const message of messages)
    assert.ok(!String(message).includes('invalid_path'));
});

await test('a valid name and unicode names are accepted', () => {
  assert.equal(noteNameProblem('roadmap'), null);
  assert.equal(noteNameProblem('projects/roadmap'), null);
  assert.equal(noteNameProblem('日本語のノート'), null);
  assert.equal(noteNameProblem('note 🎉'), null);
});

await test('a file name keeps its slash for the refusal', () => {
  assert.equal(
    cleanNoteBaseName('trailing space name '),
    'trailing space name',
  );
  assert.equal(cleanNoteBaseName('plans/roadmap.md'), 'plans/roadmap');
  assert.equal(cleanNoteBaseName('  spaced  '), 'spaced');
});

await test('a slash in the file name is refused with one sentence', () => {
  assert.equal(
    noteBaseNameProblem('Work/New note'),
    'A note name cannot contain a slash. Use Move to folder.',
  );
  assert.equal(
    noteBaseNameProblem('/leading'),
    'A note name cannot contain a slash. Use Move to folder.',
  );
  assert.equal(noteBaseNameProblem('roadmap'), null);
});

await test('each file name refusal has its own message', () => {
  const messages = [
    noteBaseNameProblem(''),
    noteBaseNameProblem('   '),
    noteBaseNameProblem('a\\b'),
    noteBaseNameProblem('ab'),
    noteBaseNameProblem('Work/New note'),
    noteBaseNameProblem('.'),
    noteBaseNameProblem('..'),
    noteBaseNameProblem('x'.repeat(300)),
  ];
  for (const message of messages) assert.notEqual(message, null);
  assert.equal(messages[0], messages[1]);
  assert.equal(messages[5], messages[6]);
  const distinct = new Set(messages.slice(1).map((value) => String(value)));
  assert.equal(distinct.size, 6);
  for (const message of messages)
    assert.ok(!String(message).includes('invalid_path'));
});

await test('a rename keeps the note in its folder', () => {
  assert.equal(
    joinNotePath(folderOf('Work/Old.md'), storageNotePath('New')),
    'Work/New.md',
  );
});

await test('a duplicate name is named before the save', () => {
  const files = [
    { fileId: 'a', path: 'thing.md' },
    { fileId: 'b', path: 'other.md' },
  ];
  assert.equal(duplicateNameProblem('other.md', files, 'b'), null);
  assert.equal(duplicateNameProblem('fresh.md', files, 'b'), null);
  const clash = duplicateNameProblem('thing.md', files, 'b');
  assert.ok(String(clash).includes('thing'));
  assert.ok(!String(clash).includes('.md'));
  assert.ok(String(clash).includes('already named'));
});

await test('folder paths come from the note paths, sorted and unique', () => {
  assert.deepEqual(
    folderPaths(['a/b/one.md', 'a/two.md', 'root.md', 'a/b/three.md']),
    ['a', 'a/b'],
  );
  assert.deepEqual(folderPaths(['root.md']), []);
});

await test('a folder rewrite moves only the notes inside it', () => {
  assert.equal(rewriteFolder('a/b/one.md', 'a', 'z'), 'z/b/one.md');
  assert.equal(rewriteFolder('a/b/one.md', 'a/b', ''), 'one.md');
  assert.equal(rewriteFolder('ab/one.md', 'a', 'z'), null);
  assert.equal(rewriteFolder('one.md', 'a', 'z'), null);
  assert.equal(rewriteFolder('a/one.md', '', 'z'), null);
});
