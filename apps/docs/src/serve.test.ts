import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { route } from './serve.ts';

const folder = '/srv/site';

await test('an address under the base maps onto a file of the site', () => {
  assert.deepEqual(route('/notesapp/', folder, '/notesapp/llms.txt'), {
    kind: 'file',
    path: join(folder, 'llms.txt'),
    folder: '/notesapp/llms.txt/',
  });
  assert.deepEqual(route('/notesapp/', folder, '/notesapp/quickstart/'), {
    kind: 'folder',
    path: join(folder, 'quickstart/index.html'),
  });
  assert.deepEqual(route('/notesapp/', folder, '/notesapp/'), {
    kind: 'folder',
    path: join(folder, 'index.html'),
  });
  assert.deepEqual(route('/', folder, '/'), {
    kind: 'folder',
    path: join(folder, 'index.html'),
  });
});

await test('the base with no slash moves to the base', () => {
  assert.deepEqual(route('/notesapp/', folder, '/notesapp'), {
    kind: 'redirect',
    location: '/notesapp/',
  });
});

await test('an address outside the base or the folder answers nothing', () => {
  for (const pathname of [
    '/other/',
    '/notesapp/../secret',
    '/notesapp/%2e%2e/secret',
    '/notesapp/a%5cb',
    '/notesapp/%00',
    '/notesapp/%E0%A4%A',
  ])
    assert.deepEqual(route('/notesapp/', folder, pathname), {
      kind: 'missing',
    });
});

await test('the folder address of a path never names another host', () => {
  const answer = route('/', folder, '//settings');
  assert.equal(answer.kind, 'file');
  assert.equal(answer.kind === 'file' ? answer.folder : '', '/settings/');
  const nested = route('/notesapp/', folder, '/notesapp//quickstart');
  assert.equal(
    nested.kind === 'file' ? nested.folder : '',
    '/notesapp/quickstart/',
  );
});
