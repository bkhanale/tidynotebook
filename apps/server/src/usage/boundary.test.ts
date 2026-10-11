import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import { countedStream, payloadBytes } from './boundary.ts';

await test('a body that the framework sends at once counts its bytes', () => {
  assert.equal(payloadBytes('abc'), 3);
  // A character outside ASCII takes more than one byte on the wire.
  assert.equal(payloadBytes('é'), 2);
  assert.equal(payloadBytes(Buffer.from([1, 2, 3, 4])), 4);
  assert.equal(payloadBytes(new Uint8Array(5)), 5);
  assert.equal(payloadBytes(undefined), null);
  assert.equal(payloadBytes(null), null);
  assert.equal(payloadBytes({ a: 1 }), null);
});

await test('a stream passes every byte and counts each chunk', async () => {
  const counts: number[] = [];
  const counted = countedStream(Readable.from(['ab', 'cde', 'f']), (bytes) => {
    counts.push(bytes);
  });
  assert.equal(await text(counted), 'abcdef');
  assert.equal(
    counts.reduce((sum, bytes) => sum + bytes, 0),
    6,
  );
});

await test('a stream that fails ends the copy with its failure', async () => {
  const source = new Readable({
    read() {
      this.destroy(new Error('the store stopped'));
    },
  });
  const counted = countedStream(source, () => undefined);
  await assert.rejects(text(counted), /the store stopped/);
});
