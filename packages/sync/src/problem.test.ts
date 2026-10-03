/** The reading of a failed service call at the boundary of the client. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { toProblem } from './problem.ts';
import { transportFailedCode } from './queue.ts';

await test('a refused note keeps the limit that the server names', () => {
  // Record 0182. Every limit of the grammar answers one code, so the device
  // reads the limit from its own member to keep the cause of a parked save.
  const problem = toProblem(
    {
      status: 422,
      code: 'unrenderable_note',
      fileIds: ['file-a'],
      noteRefusal: 'note_too_many_marks',
    },
    undefined,
  );
  assert.deepEqual(problem, {
    status: 422,
    code: 'unrenderable_note',
    fileIds: ['file-a'],
    noteRefusal: 'note_too_many_marks',
  });
});

await test('a limit that no release names, or of another type, reads as no cause', () => {
  for (const noteRefusal of ['note_too_wide', 42, null, ['note_too_deep']]) {
    const problem = toProblem(
      { status: 422, code: 'unrenderable_note', noteRefusal },
      undefined,
    );
    assert.equal('noteRefusal' in problem, false, String(noteRefusal));
  }
});

await test('a failure with no problem reads its status from the answer', () => {
  assert.deepEqual(toProblem(undefined, new Response(null, { status: 401 })), {
    status: 401,
    code: 'unauthorized',
    fileIds: [],
  });
  assert.equal(toProblem(null, undefined).code, transportFailedCode);
});
