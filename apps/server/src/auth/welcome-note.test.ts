import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
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
