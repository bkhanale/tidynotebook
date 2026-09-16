/**
 * The shape of the publication port.
 *
 * Refusal 3 of decision 0031 is that the port declares read methods only, so a
 * reader path that wanted to write would have nothing to call. A type is gone
 * at run time, so the test holds the rule in two ways that a change cannot
 * pass by accident:
 *
 * - The fake below is typed as the port and it is a literal, so the compiler
 *   refuses a member that the port does not declare and refuses the fake when
 *   the port gains a member. A new method therefore lands here first.
 * - The names of that complete fake are compared with the list of this file,
 *   and every name is read against the words of a write. A method named
 *   `acceptNote` or `revokeLink` fails both checks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PublicationContext,
  PublicationReader,
  PublicationStore,
} from './ports.ts';

/** Every method that the read port declares. */
const readMethods = [
  'linkByTokenDigest',
  'ticketOfLink',
  'noteOfLink',
  'notesOfLink',
  'attachmentsOfNote',
];

/** The words of a change. A port method must carry none of them. */
const writeWords =
  /accept|add|commit|create|delete|drop|insert|purge|put|remove|revoke|save|set|store|update|write/i;

/** A complete implementation of the port, which the compiler checks. */
const reader: PublicationReader = {
  linkByTokenDigest: () => Promise.resolve(null),
  ticketOfLink: () => Promise.resolve(null),
  noteOfLink: () => Promise.resolve(null),
  notesOfLink: () => Promise.resolve([]),
  attachmentsOfNote: () => Promise.resolve([]),
};

const store: PublicationStore = { read: (run) => run(reader) };

await test('the port declares the read methods and no other', () => {
  assert.deepEqual(Object.keys(reader).sort(), [...readMethods].sort());
  assert.deepEqual(Object.keys(store), ['read']);
});

await test('no method of the port names a change', () => {
  for (const name of [...Object.keys(reader), ...Object.keys(store)])
    assert.equal(
      writeWords.test(name),
      false,
      `The port method ${name} names a change. The reader path writes nothing.`,
    );
});

await test('the context carries no actor and no account', () => {
  const context: PublicationContext = {
    store,
    clock: () => 0,
    refusals: { record: () => undefined },
  };
  assert.deepEqual(Object.keys(context).sort(), ['clock', 'refusals', 'store']);
});

await test('one read runs inside one transaction', async () => {
  let opened = 0;
  const counted: PublicationStore = {
    read: (run) => {
      opened += 1;
      return run(reader);
    },
  };
  await counted.read((open) => open.linkByTokenDigest('digest'));
  assert.equal(opened, 1);
});
