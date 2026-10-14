import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDocumentService } from '@notesapp/storage-server';
import { mcpTools, type ContractCall } from './registry.ts';
import { record, maxToolResultBytes } from './read-support.ts';

const documents = createDocumentService();
const workspaceId = randomUUID();
const fileId = randomUUID();
const version = randomUUID();
const source = documents.start('Keep old text.');
const head = {
  fileId,
  path: 'Note.md',
  kind: 'note',
  head: {
    revisionId: version,
    kind: 'note',
    deleted: false,
    epoch: 1,
    text: 'Keep old text.',
    document: Buffer.from(source).toString('base64'),
  },
};
function tool(name: string) {
  const found = mcpTools.find((entry) => entry.definition.name === name);
  assert.ok(found, `The ${name} tool must exist.`);
  return found;
}
const existing = { workspaceId, fileId, version };

await test('each write maps only to the operations of plan 022', () => {
  for (const [name, operations] of [
    ['create_note', ['createFile']],
    ['edit_note', ['getFile', 'updateFile']],
    ['move_note', ['getFile', 'updateFile']],
    ['move_note_to_trash', ['getFile', 'deleteFile']],
  ] as const) {
    const entry = tool(name);
    assert.equal(entry.scope, 'notes:write');
    assert.deepEqual(entry.operations, operations);
    assert.equal(entry.definition.annotations?.readOnlyHint, false);
    assert.equal(
      entry.definition.annotations?.destructiveHint,
      name === 'move_note_to_trash',
    );
    assert.equal(entry.definition.annotations?.openWorldHint, false);
    assert.equal(entry.definition.outputSchema?.type, 'object');
  }
});

await test('edit validates its mode and version before contract work', async () => {
  for (const input of [
    { workspaceId, fileId, text: 'New' },
    { ...existing },
    { ...existing, oldText: '', newText: 'New' },
    { ...existing, text: 'New', oldText: 'old', newText: 'New' },
    { ...existing, oldText: 'old' },
    { ...existing, text: 1 },
    { ...existing, text: 'New', extra: true },
  ]) {
    let calls = 0;
    const result = await tool('edit_note').run(input, {
      call: async () => {
        calls += 1;
        return { status: 200, body: head };
      },
    });
    assert.equal(result.isError, true);
    assert.equal(calls, 0);
  }
});

await test('exact edit refuses zero and several matches without a write', async () => {
  for (const oldText of ['missing', 'e']) {
    const calls: string[] = [];
    const result = await tool('edit_note').run(
      { ...existing, oldText, newText: 'new' },
      {
        call: async (id) => {
          calls.push(id);
          return { status: 200, body: head };
        },
      },
    );
    assert.equal(result.isError, true);
    assert.deepEqual(calls, ['getFile']);
    assert.match(JSON.stringify(result.content), /Read the note again/);
  }
});

await test('exact and whole edits send a delta that yields only the expected text', async () => {
  for (const [input, expected] of [
    [{ ...existing, oldText: 'old', newText: 'new old' }, 'Keep new old text.'],
    [{ ...existing, text: 'Whole text 😀' }, 'Whole text 😀'],
    [{ ...existing, text: '' }, ''],
  ] as const) {
    let writes = 0;
    const call: ContractCall = async (id, request) => {
      if (id === 'getFile') return { status: 200, body: head };
      assert.equal(id, 'updateFile');
      assert.equal(request?.expectedVersion, version);
      const body = request?.body;
      assert.ok(body && typeof body === 'object' && 'document' in body);
      const save = body.document;
      assert.ok(
        save &&
          typeof save === 'object' &&
          'update' in save &&
          'observed' in save &&
          'epoch' in save,
      );
      assert.equal(save.epoch, 1);
      assert.ok(
        typeof save.update === 'string' && typeof save.observed === 'string',
      );
      assert.deepEqual(
        Buffer.from(save.observed, 'base64'),
        Buffer.from(documents.observe(source)),
      );
      const applied = documents.apply(
        source,
        Buffer.from(save.update, 'base64'),
      );
      assert.ok(applied.ok);
      assert.equal(applied.value.text, expected);
      writes += 1;
      return {
        status: 200,
        body: {
          revision: {
            fileId,
            path: 'Note.md',
            revisionId: randomUUID(),
            deleted: false,
          },
        },
      };
    };
    const result = await tool('edit_note').run(input, { call });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(writes, 1);
  }
});

await test('each existing-note write refuses another head before a write', async () => {
  for (const [name, input] of [
    ['edit_note', { ...existing, text: 'New' }],
    ['move_note', { ...existing, path: 'Moved.md' }],
    ['move_note_to_trash', existing],
  ] as const) {
    let calls = 0;
    const result = await tool(name).run(input, {
      call: async (id) => {
        calls += 1;
        assert.equal(id, 'getFile');
        return {
          status: 200,
          body: { ...head, head: { ...head.head, revisionId: randomUUID() } },
        };
      },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /Read the note again/);
    assert.equal(calls, 1);
  }
});

await test('an unchanged edit or move returns its version without a write', async () => {
  for (const [name, input] of [
    ['edit_note', { ...existing, text: head.head.text }],
    ['edit_note', { ...existing, oldText: 'old', newText: 'old' }],
    ['move_note', { ...existing, path: head.path }],
  ] as const) {
    const calls: string[] = [];
    const result = await tool(name).run(input, {
      call: async (id) => {
        calls.push(id);
        return { status: 200, body: head };
      },
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(record(result.structuredContent).version, version);
    assert.equal(record(result.structuredContent).changed, false);
    assert.deepEqual(calls, ['getFile']);
  }
});

await test('Trash sends only the observed state of the head and no text update', async () => {
  const result = await tool('move_note_to_trash').run(existing, {
    call: async (id, request) => {
      if (id === 'getFile') return { status: 200, body: head };
      assert.equal(id, 'deleteFile');
      assert.equal(request?.expectedVersion, version);
      const body = request?.body;
      assert.ok(body && typeof body === 'object' && 'document' in body);
      assert.deepEqual(body.document, {
        update: null,
        epoch: 1,
        observed: Buffer.from(documents.observe(source)).toString('base64'),
      });
      return {
        status: 200,
        body: {
          revision: {
            fileId,
            path: 'Note.md',
            revisionId: randomUUID(),
            deleted: true,
          },
        },
      };
    },
  });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(record(result.structuredContent).deleted, true);
});

await test('write errors keep safe words and no contract detail', async () => {
  for (const status of [400, 401, 403, 404, 409, 412, 413, 422, 423, 500]) {
    const result = await tool('create_note').run(
      { workspaceId, path: 'New.md', text: 'Text' },
      {
        call: () =>
          Promise.resolve({
            status,
            body: { detail: 'private-engine-notice' },
          }),
      },
    );
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /private-engine-notice/);
  }
});

await test('write input bounds refuse work before a contract call and safe answers stay bounded', async () => {
  const { maxWriteTextUnits } = await import('./write-tools.ts');
  for (const [name, input] of [
    ['create_note', { workspaceId, path: 'Not a note', text: 'Text' }],
    [
      'create_note',
      { workspaceId, path: 'New.md', text: 'x'.repeat(maxWriteTextUnits + 1) },
    ],
    ['create_note', { workspaceId: 'not-an-id', path: 'New.md', text: 'Text' }],
    ['move_note', { ...existing, path: 'x'.repeat(1024) + '.md' }],
    ['move_note_to_trash', { ...existing, text: 'extra' }],
  ] as const) {
    let calls = 0;
    const answer = await tool(name).run(input, {
      call: () => {
        calls += 1;
        return Promise.resolve({ status: 200, body: head });
      },
    });
    assert.equal(answer.isError, true);
    assert.equal(calls, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(answer)) <= maxToolResultBytes);
  }
  const result = await tool('create_note').run(
    { workspaceId, path: 'New.md', text: 'New' },
    {
      call: async (id, input) => {
        assert.equal(id, 'createFile');
        const body = record(input?.body);
        const save = record(body.document);
        assert.equal(save.epoch, 1);
        assert.ok(typeof save.update === 'string');
        const applied = documents.apply(
          documents.start(''),
          Buffer.from(save.update, 'base64'),
        );
        assert.ok(applied.ok);
        assert.equal(applied.value.text, 'New');
        return {
          status: 201,
          body: {
            revision: {
              fileId,
              path: 'New.md',
              revisionId: version,
              deleted: false,
            },
          },
        };
      },
    },
  );
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= maxToolResultBytes);
});

await test('an attachment or a malformed contract result never starts a note write', async () => {
  for (const value of [
    { ...head, kind: 'attachment' },
    { ...head, head: null },
    { ...head, head: { ...head.head, epoch: null } },
    { ...head, head: { ...head.head, document: null } },
    { ...head, head: { ...head.head, text: 'A different text' } },
  ]) {
    const calls: string[] = [];
    const result = await tool('edit_note').run(
      { ...existing, text: 'New' },
      {
        call: async (id) => {
          calls.push(id);
          return { status: 200, body: value };
        },
      },
    );
    assert.equal(result.isError, true);
    assert.deepEqual(calls, ['getFile']);
    assert.doesNotMatch(
      JSON.stringify(result),
      /epoch|document|different text/,
    );
  }
});
