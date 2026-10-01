/**
 * The settings of a member on this device (records 0099 and 0149).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cachedObject,
  memberSettingsKey,
  memberSettingsUnsent,
  refusalSentence,
  settingsAnswer,
  type MemberSettingsSource,
} from './member-settings.ts';

await test('one key names one setting of one member in one workspace', () => {
  assert.equal(
    memberSettingsKey('templates', 'account', 'workspace'),
    'notesapp.templates:account:workspace',
  );
  assert.notEqual(
    memberSettingsKey('templates', 'account', 'one'),
    memberSettingsKey('templates', 'account', 'two'),
  );
});

await test('a kept copy is an object, or no copy at all', () => {
  assert.deepEqual(cachedObject('{"folder":"Templates"}'), {
    folder: 'Templates',
  });
  for (const source of [null, '', 'not json', 'null', '[]', '3', '"text"'])
    assert.equal(cachedObject(source), null, String(source));
});

await test('a result with data is stored, and every other result is refused', () => {
  const folderOf = (data: { readonly folder: string }): string => data.folder;
  assert.deepEqual(
    settingsAnswer(
      { data: { folder: 'A' }, response: { status: 200 } },
      folderOf,
    ),
    { kind: 'stored', settings: 'A' },
  );
  const problem = { code: 'invalid_path' };
  assert.deepEqual(
    settingsAnswer({ error: problem, response: { status: 422 } }, folderOf),
    { kind: 'refused', status: 422, error: problem },
  );
  // No response at all is the status 0, which the sentence of an unsent
  // change reads.
  assert.deepEqual(settingsAnswer({ error: problem }, folderOf), {
    kind: 'refused',
    status: 0,
    error: problem,
  });
  assert.deepEqual(settingsAnswer({ response: { status: 204 } }, folderOf), {
    kind: 'refused',
    status: 204,
    error: undefined,
  });
});

await test('a change that reached no server has the one sentence of every setting', () => {
  const source: MemberSettingsSource<string> = {
    name: 'test',
    read: () => Promise.resolve({ kind: 'stored', settings: '' }),
    write: () => Promise.resolve({ kind: 'stored', settings: '' }),
    encode: (settings) => settings,
    decode: (text) => text,
    refusal: (status) => `refused ${String(status)}`,
  };
  assert.equal(
    refusalSentence(source, { status: 0, error: undefined }),
    memberSettingsUnsent,
  );
  // An answer that the server gave keeps the sentence of its setting.
  assert.equal(
    refusalSentence(source, { status: 422, error: {} }),
    'refused 422',
  );
});
