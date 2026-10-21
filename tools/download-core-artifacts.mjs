/** Bind each downloaded ZIP to the immutable build job outputs before extraction. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository } from './release-workflow.mjs';
import { record } from './workspace.mjs';

/** @param {Record<string, string | undefined>} env
 * @param {typeof fetch} request */
export async function downloadArtifacts(env, request = fetch) {
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9]\d*$/);
  assert.match(env.SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.ok(env.GITHUB_TOKEN);
  assert.ok(env.RUNNER_TEMP);
  const directory = join(env.RUNNER_TEMP, 'core-images');
  await mkdir(directory, { recursive: true });
  // No image is extracted until both ZIP digests and identities pass.
  for (const arch of ['amd64', 'arm64']) {
    const id = env[`${arch.toUpperCase()}_ARTIFACT_ID`] ?? '';
    const digest = env[`${arch.toUpperCase()}_ARTIFACT_DIGEST`] ?? '';
    assert.match(id, /^[1-9]\d*$/);
    assert.match(digest, /^[a-f0-9]{64}$/);
    const url = `https://api.github.com/repos/${repository}/actions/artifacts/${id}`;
    const headers = {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const metadata = await request(url, { headers, redirect: 'error' });
    assert.equal(metadata.status, 200, 'Cannot read the expected artifact.');
    const artifact = record(await metadata.json());
    assert.equal(String(artifact.id), id);
    assert.equal(artifact.name, `image-${arch}`);
    assert.equal(artifact.expired, false);
    assert.equal(String(record(artifact.workflow_run).id), env.GITHUB_RUN_ID);
    assert.equal(record(artifact.workflow_run).head_sha, env.SOURCE_SHA);
    const redirect = await request(`${url}/zip`, {
      headers,
      redirect: 'manual',
    });
    assert.equal(
      redirect.status,
      302,
      'Cannot download the expected artifact.',
    );
    const location = redirect.headers.get('location');
    assert.ok(location && new URL(location).protocol === 'https:');
    // The storage URL is signed. Never send GITHUB_TOKEN to the storage host.
    const response = await request(location, { redirect: 'error' });
    assert.equal(response.status, 200, 'Cannot read artifact storage.');
    assert.ok(response.body);
    const file = await open(join(directory, `${arch}.zip`), 'wx');
    const hash = createHash('sha256');
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        await file.writeFile(chunk);
      }
    } finally {
      await file.close();
    }
    assert.equal(
      hash.digest('hex'),
      digest,
      `The ${arch} artifact SHA-256 does not match the build output.`,
    );
  }
  for (const arch of ['amd64', 'arm64']) {
    const archive = join(directory, `${arch}.zip`);
    const name = `image-${arch}.tar`;
    assert.equal(
      execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim(),
      name,
      'The artifact must contain only the expected image archive.',
    );
    const destination = openSync(join(directory, name), 'wx');
    try {
      execFileSync('unzip', ['-p', archive, name], {
        stdio: ['ignore', destination, 'pipe'],
      });
    } finally {
      closeSync(destination);
    }
    await rm(archive);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await downloadArtifacts(process.env);
