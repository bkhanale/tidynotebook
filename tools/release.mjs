/** Explicit, locked, resumable core release. Remote writes are read before retry. */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import {
  compareVersions,
  parseVersion,
  prepareSubject,
  releaseTitle,
  statusLine,
} from './release-check.mjs';
import { changelogEntries, releaseNotes } from './release-notes.mjs';
import { land, prepareReview, prove } from './lifecycle.mjs';
import {
  command,
  digest,
  git,
  lock,
  readState,
  save,
  snapshot,
  stateDirectory,
} from './lifecycle-state.mjs';
import {
  createReleaseManifest,
  generateOperatorContract,
  publishedRelease,
  checkReleaseAssets,
} from './release-manifest.mjs';
import { githubRepository } from './pr-screenshots.mjs';
import { record, root } from './workspace.mjs';

/** @typedef {'none' | 'patch' | 'minor' | 'major'} ReleaseType */
/** @param {string} previous @param {ReleaseType[]} types */
export function nextVersion(previous, types) {
  const [major = 0, minor = 0, patch = 0] = parseVersion(previous) ?? [];
  if (
    parseVersion(previous) === null ||
    types.length === 0 ||
    types.every((type) => type === 'none')
  )
    throw new Error('There are no release changes.');
  if (types.includes('major'))
    return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (types.includes('minor')) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
/** @param {string} body @returns {{type:ReleaseType;note:string}} */
export function releaseChange(body) {
  const type = /^Release-Type: (none|patch|minor|major)\s*$/m.exec(body)?.[1];
  const note = /^Release-Note: (.+)$/m.exec(body)?.[1]?.trim();
  if (
    (type !== 'none' &&
      type !== 'patch' &&
      type !== 'minor' &&
      type !== 'major') ||
    !note ||
    /[\r\n\u2013\u2014]/.test(note)
  )
    throw new Error('The merged PR needs reviewed release metadata.');
  return { type, note };
}

/** @param {unknown} value */
function savedReleaseChange(value) {
  const change = record(value);
  if (typeof change.type !== 'string' || typeof change.note !== 'string')
    throw new Error('The saved release metadata is invalid.');
  return releaseChange(
    `Release-Type: ${change.type}\nRelease-Note: ${change.note}`,
  );
}
/** @param {string} cwd @param {string} previous */
export function changesSince(cwd, previous) {
  const repository = githubRepository(
    git(cwd, ['config', '--get', 'remote.origin.url']),
  );
  const commits = git(cwd, ['rev-list', '--reverse', `v${previous}..HEAD`])
    .split('\n')
    .filter(Boolean);
  const seen = new Set();
  const changes = [];
  for (const commit of commits) {
    /** @type {unknown} */
    const result = JSON.parse(
      command(cwd, 'gh', [
        'api',
        `repos/${repository}/commits/${commit}/pulls`,
      ]),
    );
    if (!Array.isArray(result))
      throw new Error('The commit PR list is invalid.');
    const pulls = result
      .map(record)
      .filter((pull) => pull.merged_at && record(pull.base).ref === 'main');
    if (pulls.length !== 1)
      throw new Error(
        'Each release commit needs one merged PR with release metadata.',
      );
    const pull = pulls[0];
    if (
      !pull ||
      typeof pull.number !== 'number' ||
      typeof pull.body !== 'string'
    )
      throw new Error('The merged PR is invalid.');
    if (seen.has(pull.number)) continue;
    seen.add(pull.number);
    changes.push({ pr: pull.number, ...releaseChange(pull.body) });
  }
  return changes;
}
/** @param {string} changelog @param {string} version @param {{type:ReleaseType;note:string}[]} changes @param {string} date */
export function releaseEntry(changelog, version, changes, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseVersion(version) === null)
    throw new Error('The release date or version is invalid.');
  const eligible = changes.filter((change) => change.type !== 'none');
  if (eligible.length === 0) throw new Error('There are no release notes.');
  /** @type {[string, {type:ReleaseType;note:string}[]][]} */
  const sections = [
    ['Added', eligible.filter((change) => change.type === 'minor')],
    ['Changed', eligible.filter((change) => change.type === 'major')],
    ['Fixed', eligible.filter((change) => change.type === 'patch')],
  ];
  const body =
    `## ${version} - ${date}\n\nThis release updates tidy notebook.\n\n` +
    sections
      .filter(([, values]) => Array.isArray(values) && values.length > 0)
      .map(
        ([title, values]) =>
          `### ${title}\n\n${Array.isArray(values) ? values.map((change) => (typeof change === 'object' ? '- ' + change.note : '')).join('\n') : ''}\n`,
      )
      .join('\n');
  const start = changelog.search(/^## /m);
  if (start < 0) throw new Error('The changelog has no release entry.');
  return changelog.slice(0, start) + body + '\n' + changelog.slice(start);
}

/** @typedef {{cwd:string;version?:string;execute?:boolean;resume?:boolean;status?:boolean;autoReviewOnReady?:boolean}} ReleaseOptions */
/** @param {ReleaseOptions} options */
export async function release(options) {
  const cwd = options.cwd;
  const unlock = lock(cwd, 'release');
  try {
    const directory = stateDirectory(cwd),
      file = join(directory, 'release.json');
    let state = readState(file);
    if (options.status) return state;
    if (
      Object.keys(state).length > 0 &&
      !options.resume &&
      state.stage !== 'complete'
    )
      throw new Error(
        'An unfinished release exists. Read its status, then resume it.',
      );
    if (!options.resume) {
      const input = snapshot(cwd);
      command(cwd, 'git', ['fetch', '--quiet', 'origin', 'main', '--tags']);
      if (input.commit !== git(cwd, ['rev-parse', 'origin/main']))
        throw new Error('Start a release at the current published main.');
      const entries = changelogEntries(
        readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'),
      );
      const previous = entries[0]?.version;
      if (!previous) throw new Error('The previous version is missing.');
      const changes = changesSince(cwd, previous);
      const minimum = nextVersion(
        previous,
        changes.map((change) => change.type),
      );
      const version = options.version ?? minimum;
      if (
        parseVersion(version) === null ||
        compareVersions(version, minimum) < 0 ||
        (parseVersion(previous)?.[0] === 0 && parseVersion(version)?.[0] !== 0)
      )
        throw new Error(
          'The version is below the release step or breaks the pre-stable policy.',
        );
      state = {
        schemaVersion: 1,
        stage: 'planned',
        version,
        previous,
        changes,
        sourceCommit: input.commit,
        origin: input.origin,
        date: new Date().toISOString().slice(0, 10),
        autoReviewOnReady: options.autoReviewOnReady === true,
      };
      if (!options.execute) return state;
      save(file, state);
    }
    if (!options.execute) return state;
    const version = typeof state.version === 'string' ? state.version : '';
    if (
      parseVersion(version) === null ||
      (options.version && options.version !== version)
    )
      throw new Error('The resume version does not match.');
    if (git(cwd, ['config', '--get', 'remote.origin.url']) !== state.origin)
      throw new Error('The release repository identity changes.');
    /** @param {string} stage @param {Record<string,unknown>} [extra] */
    const advance = (stage, extra = {}) => {
      state = {
        ...state,
        ...extra,
        stage,
        phase: stage,
        selectedCommit: state.sourceCommit,
        preparedCommit: extra.prepareCommit ?? state.prepareCommit,
        lastError: null,
      };
      save(file, state);
    };
    if (state.stage === 'planned') {
      const source = String(state.sourceCommit),
        branch = `release/${version}-${source}`;
      const changes = Array.isArray(state.changes)
        ? state.changes.map((value) => savedReleaseChange(value))
        : [];
      const originalChangelog =
        git(cwd, ['show', `${source}:CHANGELOG.md`]) + '\n';
      const originalReadme = git(cwd, ['show', `${source}:README.md`]) + '\n';
      if (!/^\*\*Status:\*\* .* is the current release\./m.test(originalReadme))
        throw new Error('The README status line is missing.');
      const expected = {
        'CHANGELOG.md': releaseEntry(
          originalChangelog,
          version,
          changes,
          String(state.date),
        ),
        'README.md': originalReadme.replace(
          /^\*\*Status:\*\* .* is the current release\./m,
          statusLine(version),
        ),
      };
      advance('planned', {
        prepareIntent: Object.fromEntries(
          Object.entries(expected).map(([name, bytes]) => [
            name,
            digest(bytes),
          ]),
        ),
      });
      const head = git(cwd, ['rev-parse', 'HEAD']);
      if (head !== source) {
        if (
          git(cwd, ['log', '-1', '--format=%s']) !== prepareSubject(version) ||
          git(cwd, ['rev-parse', 'HEAD^']) !== source ||
          Object.entries(expected).some(
            ([name, bytes]) =>
              git(cwd, ['show', `HEAD:${name}`]).trimEnd() !== bytes.trimEnd(),
          ) ||
          git(cwd, ['status', '--porcelain']) !== ''
        )
          throw new Error('The prepare source changes.');
      } else {
        const pending = git(cwd, ['status', '--porcelain', '-z'])
          .split('\0')
          .filter(Boolean);
        if (
          pending.some(
            (line) => !['README.md', 'CHANGELOG.md'].includes(line.slice(3)),
          )
        )
          throw new Error('The prepare worktree has other pending files.');
        for (const [name, bytes] of Object.entries(expected)) {
          const current = readFileSync(join(cwd, name), 'utf8').trimEnd();
          const original = (
            name === 'README.md' ? originalReadme : originalChangelog
          ).trimEnd();
          if (current !== original && current !== bytes.trimEnd())
            throw new Error(
              'The prepare file differs from its recorded intent.',
            );
        }
        const currentBranch = git(cwd, ['branch', '--show-current']);
        if (currentBranch !== branch) {
          if (git(cwd, ['branch', '--list', branch])) {
            if (git(cwd, ['rev-parse', branch]) !== source)
              throw new Error(
                'The prepare branch holds another commit. Read its saved release before a new selection.',
              );
            git(cwd, ['switch', branch]);
          } else git(cwd, ['switch', '-c', branch, source]);
        }
        for (const [name, bytes] of Object.entries(expected))
          writeFileSync(join(cwd, name), bytes);
        git(cwd, ['add', '--', 'README.md', 'CHANGELOG.md']);
        git(cwd, [
          'commit',
          '--signoff',
          '-m',
          prepareSubject(version),
          '-m',
          'Release-Type: none\nRelease-Note: Prepare the release notes.',
        ]);
      }
      advance('prepared', { prepareCommit: git(cwd, ['rev-parse', 'HEAD']) });
    }
    if (state.stage === 'prepared') {
      if (snapshot(cwd).commit !== state.prepareCommit)
        throw new Error('The prepare source changes.');
      prove(cwd, ['verify']);
      await prepareReview(cwd, {
        autoReviewOnReady: state.autoReviewOnReady === true,
        title: prepareSubject(version),
        summary: 'Prepare the release notes and current status.',
        compatibility: 'The prepare change has no product effect.',
        releaseType: 'none',
        releaseNote: 'Prepare the release notes.',
        screenshots: [],
        execute: true,
      });
      advance('review');
    }
    if (state.stage === 'review') {
      const pr = record(
        JSON.parse(
          command(cwd, 'gh', [
            'pr',
            'view',
            '--json',
            'number,state,mergeCommit',
          ]),
        ),
      );
      if (snapshot(cwd).commit !== state.prepareCommit)
        throw new Error('The prepare source changes.');
      land(cwd, String(pr.number), true);
      command(cwd, 'git', ['fetch', '--quiet', 'origin', 'main']);
      const merged = record(
        JSON.parse(
          command(cwd, 'gh', [
            'pr',
            'view',
            String(pr.number),
            '--json',
            'state,mergeCommit',
          ]),
        ),
      );
      const commit = record(merged.mergeCommit).oid;
      if (merged.state !== 'MERGED' || commit !== state.prepareCommit)
        throw new Error(
          'The prepare merge is not yet proved. Resume after a read.',
        );
      git(cwd, ['merge-base', '--is-ancestor', commit, 'origin/main']);
      git(cwd, ['switch', '--detach', commit]);
      advance('landed', { releaseCommit: commit });
    }
    const releaseCommit = snapshot(cwd).commit;
    if (releaseCommit !== state.releaseCommit)
      throw new Error('The release source changes.');
    const tag = `v${version}`;
    if (state.stage === 'landed') {
      const proof = prove(cwd, ['verify', 'test:image']);
      // The before gate reuses this exact image proof and checks the chain.
      command(cwd, process.execPath, [
        'tools/release-check.mjs',
        'before',
        version,
      ]);
      advance('before', { proof });
    }
    if (state.stage === 'before') {
      const remote = git(cwd, [
        'ls-remote',
        'origin',
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ]);
      const local = git(cwd, ['tag', '--list', tag]);
      if (remote && !local)
        throw new Error(
          'The remote tag exists without its local source. Read it before recovery.',
        );
      if (!local)
        git(cwd, [
          'tag',
          '-s',
          tag,
          '-m',
          releaseTitle(version),
          String(state.releaseCommit),
        ]);
      git(cwd, ['verify-tag', tag]);
      if (git(cwd, ['rev-parse', `${tag}^{commit}`]) !== state.releaseCommit)
        throw new Error('The immutable tag source differs.');
      if (
        remote &&
        !remote
          .split('\n')
          .some(
            (line) =>
              line.startsWith(releaseCommit + '\t') && line.endsWith('^{}'),
          )
      )
        throw new Error('The remote tag identity differs.');
      advance('tag-write', { tagObject: git(cwd, ['rev-parse', tag]) });
    }
    if (state.stage === 'tag-write') {
      git(cwd, ['verify-tag', tag]);
      const tagObject = git(cwd, ['rev-parse', tag]);
      if (
        tagObject !== state.tagObject ||
        git(cwd, ['rev-parse', `${tag}^{commit}`]) !== state.releaseCommit
      )
        throw new Error('The fixed local tag identity changes.');
      const remote = git(cwd, [
        'ls-remote',
        'origin',
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ]);
      if (!remote) {
        const attempts =
          typeof state.tagAttempts === 'number' ? state.tagAttempts : 0;
        if (attempts >= 2)
          throw new Error(
            'The tag write remains absent after bounded recovery. Keep its identity and inspect the remote.',
          );
        advance('tag-write', {
          uncertain: true,
          tagAttempts: attempts + 1,
          absenceRead: true,
        });
        git(cwd, ['push', 'origin', `refs/tags/${tag}`]);
      } else if (
        !remote.split('\n').includes(`${tagObject}\trefs/tags/${tag}`) ||
        !remote.split('\n').includes(`${releaseCommit}\trefs/tags/${tag}^{}`)
      )
        throw new Error('The remote tag object or source differs.');
      advance('image', { uncertain: false });
    }
    if (state.stage === 'image') {
      const repository = githubRepository(String(state.origin));
      const image = `ghcr.io/${repository.toLowerCase()}`;
      const target = `${image}:${version}`;
      const proofImage = record(record(state.proof).image);
      if (
        typeof proofImage.id !== 'string' ||
        proofImage.commit !== state.releaseCommit
      )
        throw new Error('The tested image proof is missing.');
      // A failed registry read is not evidence that an immutable tag is absent.
      const pull = spawnSync('docker', ['pull', target], {
        cwd,
        encoding: 'utf8',
      });
      if (pull.status !== 0) {
        if (
          !/manifest unknown|manifest.*not found|not found.*manifest/i.test(
            pull.stderr ?? '',
          )
        )
          throw new Error(
            'The registry image cannot be read. Check registry access.',
          );
        const attempts =
          typeof state.imageAttempts === 'number' ? state.imageAttempts : 0;
        if (attempts >= 2)
          throw new Error(
            'The image write remains absent after bounded recovery.',
          );
        command(cwd, 'docker', ['tag', proofImage.id, target]);
        advance('image', { imageAttempts: attempts + 1, uncertain: true });
        command(cwd, 'docker', ['push', target]);
        command(cwd, 'docker', ['pull', target]);
      }
      /** @type {unknown} */
      const inspection = JSON.parse(
        command(cwd, 'docker', ['image', 'inspect', target]),
      );
      const inspected = Array.isArray(inspection) ? record(inspection[0]) : {};
      const labels = record(record(inspected.Config).Labels);
      const digests = inspected.RepoDigests;
      /** @type {unknown} */
      const reference = Array.isArray(digests)
        ? digests.find(
            (value) =>
              typeof value === 'string' && value.startsWith(image + '@sha256:'),
          )
        : undefined;
      if (
        inspected.Id !== proofImage.id ||
        labels['org.opencontainers.image.revision'] !== state.releaseCommit ||
        typeof reference !== 'string'
      )
        throw new Error('The published image differs from the tested image.');
      // The latest alias can move. The fixed version tag cannot move.
      if (state.latestPublished !== true) {
        const latest = `${image}:latest`;
        const observed = spawnSync('docker', ['pull', latest], {
          cwd,
          encoding: 'utf8',
        });
        if (
          observed.status !== 0 &&
          !/manifest unknown|manifest.*not found|not found.*manifest/i.test(
            observed.stderr ?? '',
          )
        )
          throw new Error(
            'The latest image cannot be read. Check registry access.',
          );
        const currentId =
          observed.status === 0
            ? command(cwd, 'docker', [
                'image',
                'inspect',
                '--format',
                '{{.Id}}',
                latest,
              ])
            : '';
        if (currentId !== proofImage.id) {
          command(cwd, 'docker', ['tag', proofImage.id, latest]);
          advance('image', { uncertain: true });
          command(cwd, 'docker', ['push', latest]);
          command(cwd, 'docker', ['pull', latest]);
          if (
            command(cwd, 'docker', [
              'image',
              'inspect',
              '--format',
              '{{.Id}}',
              latest,
            ]) !== proofImage.id
          )
            throw new Error('The latest alias differs from the tested image.');
        }
        advance('image', { latestPublished: true, uncertain: false });
      }
      const proof = record(state.proof);
      const contractFile = join(
        directory,
        'releases',
        version,
        'operator-contract.json',
      );
      save(contractFile, {});
      generateOperatorContract(cwd, contractFile);
      const manifest = await createReleaseManifest(
        cwd,
        repository,
        version,
        image,
        reference.split('@')[1] ?? '',
        contractFile,
        proof,
      );
      const manifestFile = join(
        directory,
        'releases',
        version,
        'release-manifest.json',
      );
      save(manifestFile, manifest);
      advance('publish', {
        manifestFile,
        contractFile,
        imageDigest: manifest.image.digest,
        assetDigests: {
          'release-manifest.json': digest(readFileSync(manifestFile)),
          'operator-contract.json': digest(readFileSync(contractFile)),
        },
        uncertain: false,
      });
    }
    if (state.stage === 'publish') {
      const notes = releaseNotes(
        readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'),
        version,
      );
      if (notes === null) throw new Error('The release notes are missing.');
      const notesFile = join(directory, 'releases', version, 'notes.md');
      writeFileSync(notesFile, notes);
      const files = {
        'release-manifest.json': String(state.manifestFile),
        'operator-contract.json': String(state.contractFile),
      };
      for (const [name, file] of Object.entries(files))
        if (digest(readFileSync(file)) !== record(state.assetDigests)[name])
          throw new Error('The fixed release asset differs.');
      const observed = publishedRelease(cwd, tag),
        existing = observed.release;
      if (!existing) {
        const attempts =
          typeof state.publishAttempts === 'number' ? state.publishAttempts : 0;
        if (attempts >= 2)
          throw new Error(
            'The release write remains absent after bounded recovery. Inspect the release state.',
          );
        advance('publish', {
          uncertain: true,
          publishAttempts: attempts + 1,
          absenceRead: true,
        });
        command(cwd, 'gh', [
          'release',
          'create',
          tag,
          '--verify-tag',
          '--title',
          releaseTitle(version),
          '--notes-file',
          notesFile,
          files['release-manifest.json'],
          files['operator-contract.json'],
        ]);
      } else {
        if (
          existing.name !== releaseTitle(version) ||
          String(existing.body).trim() !== notes.trim() ||
          existing.draft !== false ||
          existing.prerelease !== false
        )
          throw new Error('The published release identity differs.');
        // Validate every existing asset before filling a missing asset.
        for (const [name, file] of Object.entries(files)) {
          const bytes = observed.assets.get(name);
          if (bytes && !bytes.equals(readFileSync(file)))
            throw new Error('The published release asset differs.');
        }
        for (const [name, file] of Object.entries(files)) {
          if (observed.assets.has(name)) continue;
          const attempts = record(state.assetAttempts);
          const savedCount = attempts[name];
          const count = typeof savedCount === 'number' ? savedCount : 0;
          if (count >= 2)
            throw new Error(
              'The asset write remains absent after bounded recovery. Inspect publication.',
            );
          advance('publish', {
            uncertain: true,
            assetAttempts: { ...attempts, [name]: count + 1 },
            absenceRead: true,
          });
          command(cwd, 'gh', ['release', 'upload', tag, file]);
        }
      }
      const readback = publishedRelease(cwd, tag);
      if (
        !readback.release ||
        readback.release.name !== releaseTitle(version) ||
        String(readback.release.body).trim() !== notes.trim() ||
        readback.release.draft !== false ||
        readback.release.prerelease !== false
      )
        throw new Error(
          'The publication result is missing or differs. Read it before another write.',
        );
      checkReleaseAssets(readback.assets, files);
      advance('milestone', { uncertain: false });
    }
    if (state.stage === 'milestone') {
      /** @type {unknown} */
      const milestones = JSON.parse(
        command(cwd, 'gh', [
          'api',
          'repos/{owner}/{repo}/milestones?state=all&per_page=100',
        ]),
      );
      const milestone = Array.isArray(milestones)
        ? milestones
            .map(record)
            .find((milestone) => milestone.title === version)
        : undefined;
      if (!milestone) {
        const created = record(
          JSON.parse(
            command(cwd, 'gh', [
              'api',
              '--method',
              'POST',
              'repos/{owner}/{repo}/milestones',
              '-f',
              `title=${version}`,
              '-f',
              'state=closed',
            ]),
          ),
        );
        if (typeof created.number !== 'number' || created.state !== 'closed')
          throw new Error(
            'The milestone create result is uncertain. Read it before another write.',
          );
        advance('after');
      } else if (typeof milestone.number !== 'number')
        throw new Error('The milestone identity is invalid.');
      if (milestone && milestone.open_issues !== 0)
        throw new Error(
          'The release milestone has open work. Close or move it, then resume.',
        );
      if (milestone && milestone.state !== 'closed') {
        const number = milestone.number;
        if (typeof number !== 'number')
          throw new Error('The milestone identity is invalid.');
        command(cwd, 'gh', [
          'api',
          '--method',
          'PATCH',
          `repos/{owner}/{repo}/milestones/${number}`,
          '-f',
          'state=closed',
        ]);
      }
      advance('after');
    }
    if (state.stage === 'after') {
      command(cwd, process.execPath, [
        'tools/release-check.mjs',
        'after',
        version,
      ]);
      advance('complete');
    }
    return state;
  } finally {
    unlock();
  }
}
if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean' },
        'auto-review-on-ready': { type: 'boolean' },
        resume: { type: 'boolean' },
        status: { type: 'boolean' },
        execute: { type: 'boolean' },
        json: { type: 'boolean' },
      },
    });
    if (positionals.length > 1)
      throw new Error('Give at most one release version.');
    const version = positionals[0];
    process.stdout.write(
      JSON.stringify(
        await release({
          cwd: root,
          autoReviewOnReady: values['auto-review-on-ready'] === true,
          ...(version ? { version } : {}),
          execute: !values['dry-run'] && !values.status,
          resume: values.resume ?? false,
          status: values.status ?? false,
        }),
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const file = join(stateDirectory(root), 'release.json'),
      state = readState(file);
    if (Object.keys(state).length > 0) {
      save(file, { ...state, phase: state.stage, lastError: message });
      if (process.argv.includes('--json'))
        process.stdout.write(
          JSON.stringify({ ...state, phase: state.stage, lastError: message }) +
            '\n',
        );
    }
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  }
}
