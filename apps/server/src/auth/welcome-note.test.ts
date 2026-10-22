import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDocumentService } from '@notesapp/storage-server';
import type { WelcomeNoteStore } from '@notesapp/core';
import { seedWelcomeNote } from './welcome-note.ts';

await test('an unexpected welcome note failure reports only a fixed safe code', async () => {
  const reported: string[] = [];
  const completed = await seedWelcomeNote(
    {
      pendingWelcomeNote() {
        throw new Error('Private connection details must not reach a log.');
      },
      welcomeNote() {
        throw new Error(
          'A private database address and note text must not reach a log.',
        );
      },
    },
    randomUUID(),
    randomUUID(),
    (code) => reported.push(code),
  );
  assert.equal(completed, false);
  assert.deepEqual(reported, ['unexpected']);
});

await test('a completed welcome note does no database work on later requests', async () => {
  let probes = 0;
  let transactions = 0;
  const store: WelcomeNoteStore = {
    async pendingWelcomeNote() {
      probes += 1;
      return true;
    },
    async welcomeNote(_actor, _workspaceId, run) {
      transactions += 1;
      return run({
        async state() {
          return {
            completed: true,
            existing: true,
            retryReady: true,
            standing: 'active',
          };
        },
        content: {
          documents: createDocumentService(),
          async transact() {
            throw new Error('Completed work must not write content.');
          },
        },
        async record() {
          throw new Error('Completed work must not change state.');
        },
      });
    },
  };
  const accountId = randomUUID();
  const workspaceId = randomUUID();
  const errors: string[] = [];
  const seed = () =>
    seedWelcomeNote(store, accountId, workspaceId, (code) => errors.push(code));
  assert.equal(await seed(), true);
  await Promise.all(Array.from({ length: 8 }, seed));
  assert.equal(probes, 1);
  assert.equal(transactions, 1);
  assert.deepEqual(errors, []);
});

await test('an unavailable workspace does not report a welcome note error', async () => {
  const errors: string[] = [];
  const result = await seedWelcomeNote(
    {
      async pendingWelcomeNote() {
        return false;
      },
      async welcomeNote() {
        throw new Error('An unavailable workspace must not start a write.');
      },
    },
    randomUUID(),
    randomUUID(),
    (code) => errors.push(code),
  );
  assert.equal(result, true);
  assert.deepEqual(errors, []);
});
