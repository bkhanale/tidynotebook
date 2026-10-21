import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadArtifacts } from './download-core-artifacts.mjs';

// Stored ZIP fixtures each contain exactly one named image archive.
const fixtures = {
  amd64:
    'UEsDBBQAAAAAADOZVV2zinbECwAAAAsAAAAPAAAAaW1hZ2UtYW1kNjQudGFyYW1kNjQgaW1hZ2VQSwECFAMUAAAAAAAzmVVds4p2xAsAAAALAAAADwAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtYW1kNjQudGFyUEsFBgAAAAABAAEAPQAAADgAAAAAAA==',
  arm64:
    'UEsDBBQAAAAAADOZVV2N5nC+CwAAAAsAAAAPAAAAaW1hZ2UtYXJtNjQudGFyYXJtNjQgaW1hZ2VQSwECFAMUAAAAAAAzmVVdjeZwvgsAAAALAAAADwAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtYXJtNjQudGFyUEsFBgAAAAABAAEAPQAAADgAAAAAAA==',
};

/** @param {import('node:test').TestContext} context
 * @param {string} [fault] */
async function fixture(context, fault = '') {
  const directory = await mkdtemp(join(tmpdir(), 'core-artifacts-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    GITHUB_REPOSITORY: 'tidynotebook/tidynotebook',
    GITHUB_RUN_ID: '100',
    SOURCE_SHA: 'a'.repeat(40),
    GITHUB_TOKEN: 'fake',
    RUNNER_TEMP: directory,
    AMD64_ARTIFACT_ID: '1',
    ARM64_ARTIFACT_ID: '2',
    AMD64_ARTIFACT_DIGEST: createHash('sha256')
      .update(Buffer.from(fixtures.amd64, 'base64'))
      .digest('hex'),
    ARM64_ARTIFACT_DIGEST: createHash('sha256')
      .update(Buffer.from(fixtures.arm64, 'base64'))
      .digest('hex'),
  };
  /** @type {typeof fetch} */
  const request = async (input, options) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith('https://storage.example/')) {
      assert.equal(
        options?.headers,
        undefined,
        'The token must not reach storage.',
      );
      const arch = url.endsWith('/1') ? 'amd64' : 'arm64';
      const bytes =
        fault === 'corrupt' && arch === 'arm64'
          ? Buffer.from('changed')
          : Buffer.from(fixtures[arch], 'base64');
      return new Response(bytes);
    }
    const id = url.includes('/1') ? '1' : '2';
    if (url.endsWith('/zip'))
      return new Response(null, {
        status: 302,
        headers: {
          location: `${fault === 'http' ? 'http' : 'https'}://storage.example/${id}`,
        },
      });
    return Response.json({
      id: Number(fault === 'id' ? '3' : id),
      name: `image-${id === '1' ? 'amd64' : 'arm64'}`,
      expired: fault === 'expired',
      workflow_run: {
        id: fault === 'run' ? 101 : 100,
        head_sha: fault === 'sha' ? 'b'.repeat(40) : env.SOURCE_SHA,
      },
    });
  };
  return { env, request, directory };
}

await test('exact build IDs and ZIP SHA-256 bind both extracted archives', async (context) => {
  const { env, request, directory } = await fixture(context);
  await downloadArtifacts(env, request);
  for (const arch of ['amd64', 'arm64'])
    assert.equal(
      await readFile(
        join(directory, 'core-images', `image-${arch}.tar`),
        'utf8',
      ),
      `${arch} image`,
    );
});

await test('corrupt artifact bytes stop before either image is extracted', async (context) => {
  const { env, request, directory } = await fixture(context, 'corrupt');
  await assert.rejects(
    downloadArtifacts(env, request),
    /SHA-256 does not match/,
  );
  assert.ok(
    !(await readdir(join(directory, 'core-images'))).some((name) =>
      name.endsWith('.tar'),
    ),
  );
});

await test('artifact identity, run, source and safe storage redirect fail closed', async (context) => {
  for (const fault of ['id', 'expired', 'run', 'sha', 'http']) {
    const { env, request } = await fixture(context, fault);
    await assert.rejects(downloadArtifacts(env, request));
  }
});

await test('missing build outputs fail closed', async (context) => {
  const { env, request } = await fixture(context);
  await assert.rejects(
    downloadArtifacts({ ...env, ARM64_ARTIFACT_ID: '' }, request),
  );
});
