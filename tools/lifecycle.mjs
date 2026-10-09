/** Build proof, prepare a PR, read review feedback, and land an authorized head. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { diffImpact } from './agent-context.mjs';
import {
  command,
  digest,
  git,
  lock,
  readState,
  save,
  snapshot,
  stateDirectory,
  validProof,
} from './lifecycle-state.mjs';
import {
  githubRepository,
  publishScreenshots,
  screenshotScheme,
} from './pr-screenshots.mjs';
import { record, root } from './workspace.mjs';

/** @param {string} cwd @param {string[]} gates */
export function prove(cwd, gates = ['verify']) {
  const releaseLock = lock(cwd, 'proof');
  try {
    const input = snapshot(cwd),
      file = join(stateDirectory(cwd), 'proof.json');
    save(join(stateDirectory(cwd), 'input.json'), input);
    const previous = readState(file);
    if (validProof(previous, input, gates, cwd)) return previous;
    const passed =
      validProof(previous, input, [], cwd) && Array.isArray(previous.gates)
        ? previous.gates.filter((value) => typeof value === 'string')
        : [];
    const gateResults = Array.isArray(previous.gateResults)
      ? [...previous.gateResults]
      : [];
    for (const gate of gates) {
      if (!['verify', 'test:image'].includes(gate))
        throw new Error('Unknown proof gate.');
      if (passed.includes(gate)) continue;
      let image;
      let imageId;
      if (gate === 'test:image') {
        const context = mkdtempSync(join(stateDirectory(cwd), 'image-'));
        try {
          const archive = spawnSync('git', ['archive', input.commit], {
            cwd,
            maxBuffer: 64 * 1024 * 1024,
          });
          if (archive.status !== 0)
            throw new Error('The exact image source cannot be read.');
          const extract = spawnSync('tar', ['-xf', '-', '-C', context], {
            input: archive.stdout,
          });
          if (extract.status !== 0)
            throw new Error('The exact image source cannot be opened.');
          image = `notesapp:proof-${input.commit}`;
          const build = spawnSync(
            'docker',
            [
              'build',
              '--tag',
              image,
              '--label',
              `org.opencontainers.image.revision=${input.commit}`,
              context,
            ],
            { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
          );
          writeFileSync(
            join(stateDirectory(cwd), `image-build-${input.commit}.log`),
            (build.stdout ?? '') + (build.stderr ?? ''),
            { mode: 0o600 },
          );
          if (build.status !== 0)
            throw new Error('The exact image build fails.');
          imageId = command(cwd, 'docker', [
            'image',
            'inspect',
            '--format',
            '{{.Id}}',
            image,
          ]);
        } finally {
          rmSync(context, { recursive: true, force: true });
        }
      }
      const logFile = join(
        stateDirectory(cwd),
        `${gate.replace(':', '-')}-${input.commit}.log`,
      );
      const result = spawnSync('pnpm', [gate], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ...(image ? { NOTESAPP_IMAGE: image } : {}) },
      });
      writeFileSync(logFile, (result.stdout ?? '') + (result.stderr ?? ''), {
        mode: 0o600,
      });
      if (result.status !== 0)
        throw new Error(
          `The ${gate} gate fails. Fix it before the next stage.`,
        );
      if (snapshot(cwd).inputDigest !== input.inputDigest)
        throw new Error('The inputs change during proof. Run proof again.');
      passed.push(gate);
      gateResults.push({
        gate,
        exitCode: result.status,
        inputDigest: input.inputDigest,
        command: `pnpm ${gate}`,
        logFile,
        logDigest: digest(readFileSync(logFile)),
      });
      save(file, {
        schemaVersion: 1,
        ...input,
        result: 'passed',
        gates: passed,
        ...(imageId
          ? { image: { reference: image, id: imageId, commit: input.commit } }
          : {}),
        gateResults,
      });
    }
    return readState(file);
  } finally {
    releaseLock();
  }
}

/** @param {unknown} value @param {string} head */
export function reviewGate(value, head) {
  const status = record(value);
  if (
    status.headRefOid !== head ||
    status.baseRefName !== 'main' ||
    status.state !== 'OPEN' ||
    status.isDraft !== false ||
    status.mergeable !== 'MERGEABLE' ||
    status.mergeStateStatus !== 'CLEAN'
  )
    throw new Error(
      'The PR head or base is not ready. Read the PR state again.',
    );
  if (
    !Array.isArray(status.statusCheckRollup) ||
    status.statusCheckRollup.length === 0 ||
    !status.statusCheckRollup.every((value) => {
      const check = record(value);
      return check.conclusion === 'SUCCESS' || check.state === 'SUCCESS';
    })
  )
    throw new Error('The PR checks are not complete.');
  if (status.reviewDecision === 'CHANGES_REQUESTED')
    throw new Error('The PR has changes to make.');
  if (!Array.isArray(status.reviews))
    throw new Error('The PR review state is missing.');
  // Codex uses COMMENTED. The commit, author, and observed content must match.
  const reviews = status.reviews
    .map(record)
    .filter(
      (review) =>
        record(review.user).login === 'chatgpt-codex-connector[bot]' &&
        review.commit_id === head &&
        review.state === 'COMMENTED',
    );
  const clean = reviews.some((review) => cleanReviewBody(review.body));
  const comments = Array.isArray(status.comments)
    ? status.comments.map(record)
    : [];
  const cleanComment = comments.some(
    (comment) =>
      record(comment.user).login === 'chatgpt-codex-connector[bot]' &&
      comment.reviewedCommit === head &&
      cleanReviewBody(comment.body),
  );
  if (!clean && !cleanComment)
    throw new Error(
      'Codex has no clear completed review for this head. Request @codex review and read its feedback.',
    );
  if (
    !Array.isArray(status.threads) ||
    status.threads.some((value) => record(value).isResolved !== true)
  )
    throw new Error('Resolve each review thread before landing.');
  return true;
}

/** @param {unknown} value */
export function cleanReviewBody(value) {
  return (
    typeof value === 'string' &&
    /(?:^|\n)\s*(?:Codex Review:\s*)?(?:Didn't find any major issues\.|Did not find any issues\.|No findings\.)(?: Keep them coming!)?\s*(?:\n|$)/i.test(
      value,
    ) &&
    !/\bP[0-3]\b|(?:^|\n)\s*(?:findings?|issues?)\s*:/i.test(value)
  );
}

/** @param {string} cwd @param {string} pr @returns {Record<string, unknown>} */
export function readPull(cwd, pr) {
  const view = record(
    JSON.parse(
      command(cwd, 'gh', [
        'pr',
        'view',
        pr,
        '--json',
        'number,headRefOid,baseRefName,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,reviews,body',
      ]),
    ),
  );
  const repository = githubRepository(
    git(cwd, ['config', '--get', 'remote.origin.url']),
  );
  const [owner = '', name = ''] = repository.split('/');
  const response = record(
    JSON.parse(
      command(cwd, 'gh', [
        'api',
        'graphql',
        '-f',
        `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${view.number}`,
      ]),
    ),
  );
  const connection = record(
    record(record(record(response.data).repository).pullRequest).reviewThreads,
  );
  if (record(connection.pageInfo).hasNextPage === true)
    throw new Error('The PR has more review threads than this gate can read.');
  const reviews = JSON.parse(
    command(cwd, 'gh', [
      'api',
      `repos/${repository}/pulls/${view.number}/reviews?per_page=100`,
    ]),
  );
  const comments = JSON.parse(
    command(cwd, 'gh', [
      'api',
      `repos/${repository}/issues/${view.number}/comments?per_page=100`,
    ]),
  );
  if (
    !Array.isArray(reviews) ||
    !Array.isArray(comments) ||
    reviews.length === 100 ||
    comments.length === 100
  )
    throw new Error(
      'The review history is incomplete. Read all pages before landing.',
    );
  const actor = command(cwd, 'gh', ['api', 'user', '--jq', '.login']);
  const boundComments = comments.map((value) => {
    const comment = record(value),
      body = comment.body;
    const reference =
      typeof body === 'string'
        ? /Reviewed commit:\*{0,2}\s*`?([a-f0-9]{7,40})`?/i.exec(body)?.[1]
        : undefined;
    let reviewedCommit;
    if (reference) {
      try {
        reviewedCommit = git(cwd, [
          'rev-parse',
          '--verify',
          `${reference}^{commit}`,
        ]);
      } catch {
        reviewedCommit = null;
      }
    }
    return { ...comment, reviewedCommit };
  });
  return {
    ...view,
    threads: connection.nodes,
    reviews,
    comments: boundComments,
    actor,
  };
}

/** @param {string} cwd @param {{title:string;summary:string;compatibility:string;releaseType:string;releaseNote:string;screenshots:string[];execute:boolean}} options */
export async function prepareReview(cwd, options) {
  const input = snapshot(cwd),
    proof = readState(join(stateDirectory(cwd), 'proof.json'));
  if (!validProof(proof, input, ['verify'], cwd))
    throw new Error('Current verify proof is required.');
  if (!['none', 'patch', 'minor', 'major'].includes(options.releaseType))
    throw new Error('Give a release type.');
  if (
    !options.summary.trim() ||
    !options.compatibility.trim() ||
    !options.releaseNote.trim()
  )
    throw new Error('Give the result, compatibility effect, and release note.');
  const impact = await diffImpact(cwd, 'origin/main');
  let screenshots = 'No screen changes.';
  if (impact.ui) {
    const pairs = new Map();
    for (const file of options.screenshots) {
      const item = screenshotScheme(basename(file));
      const pair = pairs.get(item.stem) ?? new Set();
      if (item.scheme !== null) pair.add(item.scheme);
      pairs.set(item.stem, pair);
    }
    if (pairs.size === 0 || [...pairs.values()].some((pair) => pair.size !== 2))
      throw new Error(
        'Give a light and dark screenshot for each changed screen.',
      );
    screenshots = options.execute
      ? publishScreenshots(`review-${input.commit}`, options.screenshots, {
          cwd,
        })
      : 'Screenshots await publication.\n' + options.screenshots.join('\n');
  }
  const body = `${options.summary}\n\n## Verification\n\nThe verify gate passes for commit ${input.commit}. Input: ${input.inputDigest}.\n\n## Compatibility\n\n${options.compatibility}\n\n## Release\n\nRelease-Type: ${options.releaseType}\nRelease-Note: ${options.releaseNote}\n\n## Screenshots\n\n${screenshots}\n`;
  const file = join(stateDirectory(cwd), 'pr-body.md');
  writeFileSync(file, body);
  let prUrl;
  if (options.execute) {
    const branch = git(cwd, ['branch', '--show-current']);
    if (!branch || branch === 'main')
      throw new Error('Review needs a change branch.');
    command(cwd, 'git', ['push', '-u', 'origin', branch]);
    const existing = command(cwd, 'gh', [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'number',
    ]);
    const list = JSON.parse(existing);
    if (!Array.isArray(list)) throw new Error('The PR list is invalid.');
    const first = record(list[0]);
    if (typeof first.number === 'number')
      command(cwd, 'gh', [
        'pr',
        'edit',
        String(first.number),
        '--title',
        options.title,
        '--body-file',
        file,
      ]);
    else
      command(cwd, 'gh', [
        'pr',
        'create',
        '--base',
        'main',
        '--head',
        branch,
        '--title',
        options.title,
        '--body-file',
        file,
      ]);
    const pull = record(
      JSON.parse(
        command(cwd, 'gh', ['pr', 'view', '--json', 'number,url,headRefOid']),
      ),
    );
    if (pull.headRefOid !== input.commit || typeof pull.url !== 'string')
      throw new Error('The published PR head differs.');
    prUrl = pull.url;
    const repository = githubRepository(input.origin);
    const comments = JSON.parse(
      command(cwd, 'gh', [
        'api',
        `repos/${repository}/issues/${pull.number}/comments?per_page=100`,
      ]),
    );
    if (!Array.isArray(comments) || comments.length === 100)
      throw new Error('The review request history is incomplete.');
    if (
      !comments
        .map(record)
        .some(
          (comment) =>
            typeof comment.body === 'string' &&
            comment.body.includes(`Lifecycle review head: ${input.commit}`),
        )
    )
      command(cwd, 'gh', [
        'pr',
        'comment',
        String(pull.number),
        '--body',
        `@codex review\n\nLifecycle review head: ${input.commit}`,
      ]);
  }
  return { commit: input.commit, bodyFile: file, impact, prUrl };
}

/** @param {string} cwd @param {string} pr @param {boolean} execute */
export function land(cwd, pr, execute) {
  const releaseLock = lock(cwd, 'land');
  try {
    const input = snapshot(cwd);
    if (
      !validProof(
        readState(join(stateDirectory(cwd), 'proof.json')),
        input,
        ['verify'],
        cwd,
      )
    )
      throw new Error('Current verify proof is required.');
    command(cwd, 'git', ['fetch', '--quiet', 'origin', 'main']);
    if (git(cwd, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']) !== '')
      throw new Error('Rebase onto the current main.');
    const pull = readPull(cwd, pr);
    if (pull.state !== 'MERGED') reviewGate(pull, input.commit);
    else if (pull.headRefOid !== input.commit)
      throw new Error('The merged PR head differs.');
    if (execute && pull.state !== 'MERGED') {
      save(join(stateDirectory(cwd), 'land.json'), {
        schemaVersion: 1,
        ...input,
        stage: 'merge-write',
        pr,
      });
      command(cwd, 'git', [
        'push',
        'origin',
        `${input.commit}:refs/heads/main`,
      ]);
    }
    const merged = execute
      ? record(
          JSON.parse(
            command(cwd, 'gh', [
              'pr',
              'view',
              pr,
              '--json',
              'state,headRefOid,mergeCommit,url',
            ]),
          ),
        )
      : {};
    if (
      execute &&
      (merged.state !== 'MERGED' ||
        merged.headRefOid !== input.commit ||
        typeof record(merged.mergeCommit).oid !== 'string')
    )
      throw new Error(
        'The merge result is pending or differs. Read the PR before another write.',
      );
    if (execute) {
      command(cwd, 'git', ['fetch', '--quiet', 'origin', 'main']);
      const mergedCommit = record(merged.mergeCommit).oid;
      if (
        typeof mergedCommit !== 'string' ||
        git(cwd, ['rev-parse', `${mergedCommit}^{tree}`]) !== input.tree
      )
        throw new Error(
          'The merged source differs from proved source. Save the state and prove the actual source before repair.',
        );
    }
    const result = {
      schemaVersion: 1,
      ...input,
      stage: execute ? 'landed' : 'ready',
      pr,
      mergedCommit: record(merged.mergeCommit).oid,
      prUrl: merged.url,
    };
    save(join(stateDirectory(cwd), 'land.json'), result);
    return result;
  } finally {
    releaseLock();
  }
}

if (import.meta.main) {
  const [unit, ...args] = process.argv.slice(2),
    cwd = resolve(root);
  try {
    const value =
      unit === 'prove'
        ? prove(
            cwd,
            args.includes('--image') ? ['verify', 'test:image'] : ['verify'],
          )
        : unit === 'land'
          ? land(cwd, args[0] ?? '', args.includes('--execute'))
          : unit === 'review-status'
            ? readPull(cwd, args[0] ?? '')
            : unit === 'status'
              ? {
                  input: snapshot(cwd),
                  proof: readState(join(stateDirectory(cwd), 'proof.json')),
                  land: readState(join(stateDirectory(cwd), 'land.json')),
                }
              : unit === 'review'
                ? await prepareReview(cwd, {
                    ...parseReview(args),
                    execute: args.includes('--execute'),
                  })
                : (() => {
                    throw new Error('Use prove, review, land, or status.');
                  })();
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
/** @param {string[]} args */
function parseReview(args) {
  /** @param {string} key */
  const text = (key) => {
    const index = args.indexOf(key);
    return index < 0
      ? ''
      : readFileSync(resolve(root, args[index + 1] ?? ''), 'utf8').trim();
  };
  const typeIndex = args.indexOf('--release-type');
  if (
    typeIndex < 0 ||
    !args[typeIndex + 1] ||
    args[typeIndex + 1]?.startsWith('--')
  )
    throw new Error('Give --release-type and its value.');
  return {
    title: text('--title-file'),
    summary: text('--summary-file'),
    compatibility: text('--compatibility-file'),
    releaseType: args[typeIndex + 1] ?? '',
    releaseNote: text('--release-note-file'),
    screenshots: args.flatMap((arg, index) =>
      arg === '--screenshot' ? [resolve(root, args[index + 1] ?? '')] : [],
    ),
  };
}
