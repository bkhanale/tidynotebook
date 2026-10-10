/** Build proof, prepare a PR, read optional review feedback, and land an authorized head. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
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
      ? previous.gateResults.map(record)
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
              '--platform',
              'linux/amd64',
              '--tag',
              image,
              '--label',
              `org.opencontainers.image.revision=${input.commit}`,
              '--label',
              `org.opencontainers.image.source=https://github.com/${githubRepository(input.origin)}`,
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
        env: {
          ...process.env,
          ...(imageId ? { NOTESAPP_IMAGE: imageId } : {}),
        },
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

/** Landing needs a ready PR, passing checks, and resolved threads. A review stays optional.
 * @param {unknown} value @param {string} head */
export function landGate(value, head) {
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
  if (
    !Array.isArray(status.threads) ||
    status.threads.some((value) => record(value).isResolved !== true)
  )
    throw new Error('Resolve each review thread before landing.');
  return true;
}

/** A known completed row binds automatic approval to one reviewed commit. @param {unknown} value */
export function automaticReviewBody(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('<!-- codex-pull-request-review-summary -->')
  )
    return null;
  const rows = value
    .split(/\r?\n/)
    .filter((line) => /^\|[^|]*\*\*Code Review\*\*[^|]*\|/.test(line));
  if (rows.length !== 1) return null;
  const row = rows[0] ?? '';
  const match =
    /^\|[^|]*\*\*Code Review\*\*[^|]*\|\s*✅\s*\*\*Completed\*\*\s+<relative-time datetime="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)">[^<]*<\/relative-time>\s*\|\s*`([a-f0-9]{7,40})`\s*\|[^|]*\|\s*$/.exec(
      row,
    );
  const date = match?.[1],
    reference = match?.[2];
  if (!date || !reference) return null;
  const time = Date.parse(date);
  return Number.isFinite(time) ? { reference, time } : null;
}

/** @param {unknown} value */
export function cleanReviewBody(value) {
  return (
    typeof value === 'string' &&
    /(?:^|\n)[\t ]*(?:Codex Review:[\t ]*)?(?:Didn't find any major issues\.|Did not find any issues\.|No findings\.)(?:[\t ]+[^\r\n]*)?[\t ]*(?:\r?\n|$)/i.test(
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
  if (
    typeof view.number !== 'number' ||
    !Number.isSafeInteger(view.number) ||
    view.number <= 0
  )
    throw new Error('The PR number is invalid.');
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
  /** @type {unknown} */
  const reviews = JSON.parse(
    command(cwd, 'gh', [
      'api',
      `repos/${repository}/pulls/${view.number}/reviews?per_page=100`,
    ]),
  );
  /** @type {unknown} */
  const comments = JSON.parse(
    command(cwd, 'gh', [
      'api',
      `repos/${repository}/issues/${view.number}/comments?per_page=100`,
    ]),
  );
  /** @type {unknown} */
  const reactions = JSON.parse(
    command(cwd, 'gh', [
      'api',
      `repos/${repository}/issues/${view.number}/reactions?per_page=100`,
    ]),
  );
  if (
    !Array.isArray(reviews) ||
    !Array.isArray(comments) ||
    !Array.isArray(reactions) ||
    reviews.length === 100 ||
    comments.length === 100 ||
    reactions.length === 100
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
        ? (/Reviewed commit:\*{0,2}\s*`?([a-f0-9]{7,40})`?/i.exec(body)?.[1] ??
          automaticReviewBody(body)?.reference)
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
    reactions,
    actor,
  };
}

/** @param {string} cwd @param {{title:string;summary:string;compatibility:string;releaseType:string;releaseNote:string;screenshots:string[];execute:boolean;autoReviewOnReady?:boolean;requestReview?:boolean}} options */
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
    /** @type {Map<string, Set<string>>} */
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
    /** @type {unknown} */
    const list = JSON.parse(existing);
    if (!Array.isArray(list)) throw new Error('The PR list is invalid.');
    const first = record(list[0]);
    const automaticFile = join(stateDirectory(cwd), 'automatic-review.json');
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
    else {
      if (options.autoReviewOnReady)
        save(automaticFile, {
          origin: input.origin,
          branch,
          head: input.commit,
        });
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
    }
    const pull = record(
      JSON.parse(
        command(cwd, 'gh', ['pr', 'view', '--json', 'number,url,headRefOid']),
      ),
    );
    if (
      pull.headRefOid !== input.commit ||
      typeof pull.url !== 'string' ||
      typeof pull.number !== 'number' ||
      !Number.isSafeInteger(pull.number) ||
      pull.number <= 0
    )
      throw new Error('The published PR head differs.');
    prUrl = pull.url;
    const automatic = readState(automaticFile);
    if (
      options.requestReview === true &&
      (automatic.origin !== input.origin ||
        automatic.branch !== branch ||
        automatic.head !== input.commit)
    ) {
      const repository = githubRepository(input.origin);
      /** @type {unknown} */
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
    const pull = readPull(cwd, pr),
      file = join(stateDirectory(cwd), 'land.json');
    let validatedReview;
    if (pull.state === 'MERGED') {
      const attempt = readState(file);
      if (
        !['merge-write', 'landed'].includes(String(attempt.stage)) ||
        attempt.pr !== pr ||
        attempt.inputDigest !== input.inputDigest ||
        attempt.commit !== input.commit ||
        attempt.reviewDigest !== digest(JSON.stringify(attempt.validatedReview))
      )
        throw new Error(
          'The merged PR has no validated merge attempt for this source.',
        );
      landGate(attempt.validatedReview, input.commit);
      validatedReview = attempt.validatedReview;
      if (pull.headRefOid !== input.commit)
        throw new Error('The merged PR head differs.');
      git(cwd, ['merge-base', '--is-ancestor', input.commit, 'origin/main']);
    } else {
      git(cwd, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
      landGate(pull, input.commit);
      validatedReview = pull;
    }
    if (execute && pull.state !== 'MERGED') {
      save(file, {
        schemaVersion: 1,
        ...input,
        stage: 'merge-write',
        pr,
        validatedReview,
        reviewDigest: digest(JSON.stringify(validatedReview)),
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
        record(merged.mergeCommit).oid !== input.commit)
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
      validatedReview,
      reviewDigest: digest(JSON.stringify(validatedReview)),
      mergedCommit: record(merged.mergeCommit).oid,
      prUrl: merged.url,
    };
    if (execute) save(join(stateDirectory(cwd), 'land.json'), result);
    return result;
  } finally {
    releaseLock();
  }
}

/** Reject extra arguments before a unit can write.
 * @param {string[]} args @param {string} cwd
 */
export function parseLifecycle(args, cwd) {
  const [unit, ...rest] = args;
  /** @type {Record<string, import('node:util').ParseArgsOptionsConfig>} */
  const definitions = {
    prove: { image: { type: 'boolean' } },
    land: { execute: { type: 'boolean' } },
    'review-status': {},
    status: {},
    review: {
      execute: { type: 'boolean' },
      'auto-review-on-ready': { type: 'boolean' },
      'request-review': { type: 'boolean' },
      'title-file': { type: 'string' },
      'summary-file': { type: 'string' },
      'compatibility-file': { type: 'string' },
      'release-type': { type: 'string' },
      'release-note-file': { type: 'string' },
      screenshot: { type: 'string', multiple: true },
    },
  };
  if (!unit || !Object.hasOwn(definitions, unit))
    throw new Error('Use prove, review, review-status, land, or status.');
  const options = definitions[unit];
  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options,
  });
  const values = record(parsed.values),
    positionals = parsed.positionals;
  const prUnit = unit === 'land' || unit === 'review-status';
  if (
    positionals.length !== (prUnit ? 1 : 0) ||
    (prUnit && !/^[1-9]\d*$/.test(positionals[0] ?? ''))
  )
    throw new Error(
      prUnit
        ? 'Give one PR number.'
        : 'This unit takes no positional arguments.',
    );
  if (unit !== 'review')
    return {
      unit,
      pr: positionals[0] ?? '',
      execute: values.execute === true,
      image: values.image === true,
    };
  /** @param {string} name */
  const text = (name) => {
    const value = values[name];
    if (typeof value !== 'string' || !value || value.startsWith('--'))
      throw new Error(`Give --${name} and its file.`);
    return readFileSync(resolve(cwd, value), 'utf8').trim();
  };
  const releaseType = values['release-type'];
  if (
    typeof releaseType !== 'string' ||
    !['none', 'patch', 'minor', 'major'].includes(releaseType)
  )
    throw new Error('Give --release-type and its value.');
  const screenshots = values.screenshot;
  return {
    unit,
    pr: '',
    execute: values.execute === true,
    image: false,
    review: {
      autoReviewOnReady: values['auto-review-on-ready'] === true,
      requestReview: values['request-review'] === true,
      title: text('title-file'),
      summary: text('summary-file'),
      compatibility: text('compatibility-file'),
      releaseType,
      releaseNote: text('release-note-file'),
      screenshots: Array.isArray(screenshots)
        ? screenshots
            .filter((file) => typeof file === 'string')
            .map((file) => resolve(cwd, file))
        : [],
      execute: values.execute === true,
    },
  };
}
if (import.meta.main) {
  const cwd = resolve(root);
  try {
    const options = parseLifecycle(process.argv.slice(2), cwd);
    const value =
      options.unit === 'prove'
        ? prove(cwd, options.image ? ['verify', 'test:image'] : ['verify'])
        : options.unit === 'land'
          ? land(cwd, options.pr, options.execute)
          : options.unit === 'review-status'
            ? readPull(cwd, options.pr)
            : options.unit === 'status'
              ? {
                  input: snapshot(cwd),
                  proof: readState(join(stateDirectory(cwd), 'proof.json')),
                  land: readState(join(stateDirectory(cwd), 'land.json')),
                }
              : options.review
                ? await prepareReview(cwd, options.review)
                : {};
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
