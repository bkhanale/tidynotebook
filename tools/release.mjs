/** Explicit, locked, resumable core release. Remote writes are read before retry. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
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
import {
  publishPreparedImage,
  release,
  remoteImage,
} from './release-publish.mjs';
export { release } from './release-publish.mjs';
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
import { releaseImage } from './release-registry.mjs';
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

/** Exact source bytes, including final whitespace.
 * @param {string} cwd @param {string} commit @param {string} name
 */
function sourceBytes(cwd, commit, name) {
  return execFileSync('git', ['show', `${commit}:${name}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Only local state moves. Remote reads must prove that preparation has no upload.
 * @param {string} cwd @param {string} file @param {Record<string, unknown>} state @param {boolean} execute
 */
function abandonRelease(cwd, file, state, execute) {
  if (
    parseVersion(typeof state.version === 'string' ? state.version : '') ===
      null ||
    typeof state.origin !== 'string' ||
    git(cwd, ['config', '--get', 'remote.origin.url']) !== state.origin ||
    typeof state.sourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(state.sourceCommit)
  )
    throw new Error('The saved release identity is invalid.');
  const remote = publishedRelease(cwd, `v${state.version}`);
  if (
    remote.release &&
    (remote.release.draft !== true ||
      !Array.isArray(remote.release.assets) ||
      remote.release.assets.length > 0)
  )
    throw new Error('Remote release assets exist. Resume preparation.');
  const image = releaseImage(state.origin);
  for (const commit of new Set([
    state.sourceCommit,
    state.prepareCommit,
    state.releaseCommit,
  ])) {
    if (commit === undefined) continue;
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit))
      throw new Error('The saved release source is invalid.');
    if (remoteImage(cwd, `${image}:source-${commit}`) !== null)
      throw new Error('A remote source image exists. Resume preparation.');
  }
  if (!execute) return { stage: 'abandonable', version: state.version };
  const parent = join(stateDirectory(cwd), 'abandoned-releases');
  mkdirSync(parent, { recursive: true });
  const archiveFile = join(
    mkdtempSync(join(parent, 'release-')),
    'release.json',
  );
  renameSync(file, archiveFile);
  return { stage: 'abandoned', version: state.version, archiveFile };
}

/** @typedef {{cwd:string;version?:string;execute?:boolean;resume?:boolean;status?:boolean;autoReviewOnReady?:boolean;abandon?:boolean}} ReleaseOptions */
/** @param {ReleaseOptions} options @returns {Promise<Record<string, unknown>>} */
export async function prepareRelease(options) {
  const cwd = options.cwd;
  const unlock = lock(cwd, 'release');
  try {
    const directory = stateDirectory(cwd),
      file = join(directory, 'release.json');
    let state = readState(file);
    if (
      options.abandon &&
      (options.status || options.resume || options.version)
    )
      throw new Error('Use abandon on its own.');
    if (options.abandon)
      return abandonRelease(cwd, file, state, options.execute === true);
    if (options.status) return state;
    if (
      Object.keys(state).length > 0 &&
      !options.resume &&
      state.stage !== 'ready'
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
      const tagged = git(cwd, ['tag', '--list', 'v*'])
        .split('\n')
        .map((tag) => tag.slice(1))
        .filter((version) => parseVersion(version) !== null)
        .sort(compareVersions);
      const previous = tagged.at(-1);
      const top = entries[0];
      const unpublished = top && !tagged.includes(top.version) ? top : null;
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
        unpublishedVersion: unpublished?.version ?? null,
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
      const originalChangelog = sourceBytes(cwd, source, 'CHANGELOG.md');
      const originalReadme = sourceBytes(cwd, source, 'README.md');
      let priorChangelog = originalChangelog;
      if (typeof state.unpublishedVersion === 'string') {
        const start = originalChangelog.search(/^## /m);
        const end = originalChangelog.indexOf('\n## ', start + 1);
        if (
          start < 0 ||
          end < 0 ||
          changelogEntries(originalChangelog)[0]?.version !==
            state.unpublishedVersion
        )
          throw new Error('The unpublished release entry changes.');
        priorChangelog =
          originalChangelog.slice(0, start) + originalChangelog.slice(end + 1);
      }
      if (!/^\*\*Status:\*\* .* is the current release\./m.test(originalReadme))
        throw new Error('The README status line is missing.');
      const expected = {
        'CHANGELOG.md': releaseEntry(
          priorChangelog,
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
      const reuseSource =
        head === source &&
        Object.entries(expected).every(
          ([name, bytes]) => sourceBytes(cwd, source, name) === bytes,
        );
      if (reuseSource) {
        if (snapshot(cwd).commit !== source)
          throw new Error('The prepare source changes.');
        advance('landed', { prepareCommit: source, releaseCommit: source });
      } else if (head !== source) {
        if (
          git(cwd, ['log', '-1', '--format=%s']) !== prepareSubject(version) ||
          git(cwd, ['rev-parse', 'HEAD^']) !== source ||
          Object.entries(expected).some(
            ([name, bytes]) => sourceBytes(cwd, 'HEAD', name) !== bytes,
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
          const current = readFileSync(join(cwd, name), 'utf8');
          const original =
            name === 'README.md' ? originalReadme : originalChangelog;
          if (current !== original && current !== bytes)
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
      if (!reuseSource)
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
      const repository = githubRepository(String(state.origin));
      const image = releaseImage(String(state.origin));
      const prepared = await publishPreparedImage(
        cwd,
        image,
        releaseCommit,
        record(record(state.proof).image),
      );
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
        prepared.split('@')[1] ?? '',
        contractFile,
        record(state.proof),
      );
      const manifestFile = join(
        directory,
        'releases',
        version,
        'release-manifest.json',
      );
      save(manifestFile, manifest);
      const notes = releaseNotes(
        readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'),
        version,
      );
      if (notes === null) throw new Error('The release notes are missing.');
      const notesFile = join(directory, 'releases', version, 'notes.md');
      writeFileSync(notesFile, notes);
      const files = {
        'release-manifest.json': manifestFile,
        'operator-contract.json': contractFile,
      };
      const remote = publishedRelease(cwd, tag);
      if (!remote.release) {
        command(cwd, 'gh', [
          'release',
          'create',
          tag,
          '--draft',
          '--target',
          releaseCommit,
          '--title',
          releaseTitle(version),
          '--notes-file',
          notesFile,
          manifestFile,
          contractFile,
        ]);
      } else {
        if (
          remote.release.name !== releaseTitle(version) ||
          String(remote.release.body).trim() !== notes.trim() ||
          remote.release.prerelease !== false
        )
          throw new Error(
            'The prepared release identity differs. Never replace it.',
          );
        for (const [name, file] of Object.entries(files)) {
          const bytes = remote.assets.get(name);
          if (bytes && !bytes.equals(readFileSync(file)))
            throw new Error('The prepared release asset differs.');
        }
        for (const [name, file] of Object.entries(files)) {
          if (!remote.assets.has(name))
            command(cwd, 'gh', ['release', 'upload', tag, file]);
        }
      }
      checkReleaseAssets(publishedRelease(cwd, tag).assets, files);
      advance('ready', {
        manifestFile,
        contractFile,
        imageDigest: manifest.image.digest,
        assetDigests: Object.fromEntries(
          Object.entries(files).map(([name, file]) => [
            name,
            digest(readFileSync(file)),
          ]),
        ),
      });
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
        abandon: { type: 'boolean' },
        status: { type: 'boolean' },
        execute: { type: 'boolean' },
        json: { type: 'boolean' },
        prepare: { type: 'boolean' },
      },
    });
    if (positionals.length > 1)
      throw new Error('Give at most one release version.');
    if (values.abandon && !values.prepare)
      throw new Error('Abandon belongs to release preparation.');
    const version = positionals[0];
    process.stdout.write(
      JSON.stringify(
        await (values.prepare ? prepareRelease : release)({
          cwd: root,
          autoReviewOnReady: values['auto-review-on-ready'] === true,
          ...(version ? { version } : {}),
          execute: !values['dry-run'] && !values.status,
          resume: values.resume ?? false,
          status: values.status ?? false,
          abandon: values.abandon ?? false,
        }),
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const file = join(stateDirectory(root), 'release.json'),
      state = readState(file);
    if (Object.keys(state).length > 0 && !process.argv.includes('--abandon')) {
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
