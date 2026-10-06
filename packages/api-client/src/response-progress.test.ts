import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeResponseProgress,
  responseWithProgress,
  ResponseReadError,
} from './response-progress.ts';

await test('an unobserved response keeps its original body and metadata', async () => {
  const response = new Response('plain');
  assert.equal(responseWithProgress(response, undefined), response);
  assert.equal(
    responseWithProgress(response, new AbortController().signal),
    response,
  );
  assert.equal(await response.text(), 'plain');
});

await test('headers and each nonempty chunk report progress without changing the answer', async () => {
  const signal = new AbortController().signal;
  let count = 0;
  const remove = observeResponseProgress(signal, () => {
    count += 1;
  });
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array());
      controller.enqueue(new TextEncoder().encode('first'));
      controller.enqueue(new TextEncoder().encode('second'));
      controller.close();
    },
  });
  const response = responseWithProgress(
    new Response(source, {
      status: 201,
      statusText: 'Created',
      headers: { 'x-request-id': 'kept' },
    }),
    signal,
  );
  assert.equal(count, 1, 'headers report progress');
  assert.equal(await response.text(), 'firstsecond');
  assert.equal(count, 3, 'empty chunks do not keep an idle request alive');
  assert.equal(response.status, 201);
  assert.equal(response.statusText, 'Created');
  assert.equal(response.headers.get('x-request-id'), 'kept');
  remove();
});

await test('removing an observer stops callbacks for an already wrapped body', async () => {
  const signal = new AbortController().signal;
  let count = 0;
  const remove = observeResponseProgress(signal, () => {
    count += 1;
  });
  const original = new Response('after removal');
  const response = responseWithProgress(original, signal);
  remove();
  assert.equal(await response.text(), 'after removal');
  assert.equal(count, 1);
  const next = new Response('next');
  assert.equal(responseWithProgress(next, signal), next);
});

await test('a body failure remains a transport failure before parsing', async () => {
  const signal = new AbortController().signal;
  const remove = observeResponseProgress(signal, () => {});
  const cause = new Error('The connection ended.');
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(cause);
    },
  });
  const response = responseWithProgress(new Response(source), signal);
  await assert.rejects(
    response.text(),
    (error: unknown) =>
      error instanceof ResponseReadError && error.cause === cause,
  );
  assert.equal(source.locked, false);
  remove();
});

await test('cancelling the wrapper cancels and releases the original body', async () => {
  const signal = new AbortController().signal;
  const remove = observeResponseProgress(signal, () => {});
  let cancelled: unknown;
  const source = new ReadableStream<Uint8Array>({
    cancel(reason: unknown) {
      cancelled = reason;
    },
  });
  const response = responseWithProgress(new Response(source), signal);
  await response.body?.cancel('stop');
  assert.equal(cancelled, 'stop');
  assert.equal(source.locked, false);
  remove();
});

await test('an empty response proves headers without creating a body', () => {
  const signal = new AbortController().signal;
  let count = 0;
  const remove = observeResponseProgress(signal, () => {
    count += 1;
  });
  const original = new Response(null, { status: 204 });
  assert.equal(responseWithProgress(original, signal), original);
  assert.equal(count, 1);
  remove();
});
