import assert from 'node:assert/strict';
import test from 'node:test';
import { breadcrumbParts, type BreadcrumbRoute } from './breadcrumb.ts';

/** One route of the frame, with the parts a test wants to change. */
function route(over: Partial<BreadcrumbRoute> = {}): BreadcrumbRoute {
  return {
    workspaceId: 'w1',
    workspaceName: 'Personal',
    notePath: null,
    leaf: 'All notes',
    ...over,
  };
}

await test('a page yields the workspace and the page', () => {
  assert.deepEqual(breadcrumbParts(route({ leaf: 'Trash' })), [
    { label: 'Personal', to: '/w/w1', folder: '' },
    { label: 'Trash', to: null, folder: null },
  ]);
});

await test('the last part is where the person is, so it goes nowhere', () => {
  for (const leaf of ['All notes', 'Trash', 'Published links'])
    assert.equal(breadcrumbParts(route({ leaf })).at(-1)?.to, null);
});

await test('a note at the top of the workspace yields two parts', () => {
  const parts = breadcrumbParts(
    route({ notePath: 'Roadmap.md', leaf: 'Roadmap' }),
  );
  assert.deepEqual(
    parts.map((part) => part.label),
    ['Personal', 'Roadmap'],
  );
});

await test('a note in a folder yields one part for each folder above it', () => {
  const parts = breadcrumbParts(
    route({ notePath: 'Work/Plans/Roadmap.md', leaf: 'Roadmap' }),
  );
  assert.deepEqual(parts, [
    { label: 'Personal', to: '/w/w1', folder: '' },
    { label: 'Work', to: '/w/w1', folder: 'Work' },
    { label: 'Plans', to: '/w/w1', folder: 'Work/Plans' },
    { label: 'Roadmap', to: null, folder: null },
  ]);
});

await test('a folder part names the whole path of that folder', () => {
  // The defect this would cover: a part that names the segment alone selects
  // the wrong folder as soon as two folders share a name.
  const parts = breadcrumbParts(
    route({ notePath: 'Work/Plans/Work/Note.md', leaf: 'Note' }),
  );
  assert.deepEqual(
    parts.map((part) => part.folder),
    ['', 'Work', 'Work/Plans', 'Work/Plans/Work', null],
  );
});

await test('the workspace part opens the note list of that workspace', () => {
  const parts = breadcrumbParts(
    route({ workspaceId: 'w2', workspaceName: 'Work' }),
  );
  assert.deepEqual(parts[0], { label: 'Work', to: '/w/w2', folder: '' });
});

await test('the history of a note keeps the folders of that note', () => {
  const parts = breadcrumbParts(
    route({ notePath: 'Work/Roadmap.md', leaf: 'History of Roadmap' }),
  );
  assert.deepEqual(
    parts.map((part) => part.label),
    ['Personal', 'Work', 'History of Roadmap'],
  );
});

await test('a path with a repeated separator yields no empty part', () => {
  const parts = breadcrumbParts(
    route({ notePath: 'Work//Roadmap.md', leaf: 'Roadmap' }),
  );
  assert.deepEqual(
    parts.map((part) => part.label),
    ['Personal', 'Work', 'Roadmap'],
  );
});

await test('a workspace with no name yet yields no part of its own', () => {
  // The workspace list fills after the first paint, and a link with no word
  // is one that nobody can read and nobody can name.
  const parts = breadcrumbParts(route({ workspaceName: '' }));
  assert.deepEqual(parts, [{ label: 'All notes', to: null, folder: null }]);
  for (const part of breadcrumbParts(
    route({ workspaceName: '', notePath: 'Work/Note.md', leaf: 'Note' }),
  ))
    assert.notEqual(part.label, '');
});
