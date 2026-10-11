import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosticImage,
  publicationImage,
  registryImage,
  releaseImage,
} from './release-registry.mjs';

await test('future image uses the repository owner and the core package', () => {
  assert.equal(
    releaseImage('https://github.com/Example/notebook.git'),
    'ghcr.io/example/core',
  );
  assert.equal(
    releaseImage('git@github.com:Example/notebook.git'),
    'ghcr.io/example/core',
  );
  assert.throws(() => releaseImage('https://example.com/owner/repository'));
});

await test('registry image accepts fixed package addresses only', () => {
  assert.deepEqual(registryImage('ghcr.io/example/notebook'), {
    reference: 'ghcr.io/example/notebook',
    owner: 'example',
    name: 'notebook',
  });
  for (const reference of [
    undefined,
    {},
    'docker.io/example/core',
    'ghcr.io/example/core:latest',
    'ghcr.io/example/core@sha256:abc',
    'ghcr.io/example/core/child',
  ])
    assert.throws(() => registryImage(reference), /image address is invalid/);
});

await test('publication refuses a legacy draft and keeps a published legacy identity', () => {
  const origin = 'https://github.com/example/notebook';
  assert.equal(
    publicationImage(origin, 'ghcr.io/example/core', false).legacy,
    false,
  );
  assert.throws(
    () => publicationImage(origin, 'ghcr.io/example/notebook', false),
    /old image package/,
  );
  assert.equal(
    publicationImage(origin, 'ghcr.io/example/notebook', true).legacy,
    true,
  );
});

await test('read-only checks choose the fixed manifest before the workflow or future policy', () => {
  const origin = 'https://github.com/example/notebook';
  assert.equal(
    diagnosticImage(
      origin,
      'IMAGE: ghcr.io/example/core',
      'ghcr.io/example/old-notebook',
    ).reference,
    'ghcr.io/example/old-notebook',
  );
  assert.equal(
    diagnosticImage(origin, 'IMAGE: ghcr.io/example/notebook').reference,
    'ghcr.io/example/notebook',
  );
  assert.equal(diagnosticImage(origin, '').reference, 'ghcr.io/example/core');
  assert.throws(
    () => diagnosticImage(origin, 'IMAGE: ghcr.io/example/core', 'bad'),
    /image address is invalid/,
  );
});
