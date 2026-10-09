/** Saves public task context and routes explicit internal work to its owner. */
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { readingList, missingFiles, diffImpact } from './agent-context.mjs';
import {
  command,
  digest,
  git,
  save,
  stateDirectory,
} from './lifecycle-state.mjs';
import { root } from './workspace.mjs';

export const phases = [
  'prepare',
  'design',
  'build',
  'prove',
  'review',
  'land',
  'release',
  'operate',
  'recover',
  'maintain',
  'credentials',
  'setup',
  'retire',
];
/** @param {{cwd:string;task:string;paths:string[];phase:string;internal?:boolean;cloudRoot?:string}} options */
export async function prepare(options) {
  const cwd = realpathSync(options.cwd);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.task) ||
    !phases.includes(options.phase)
  )
    throw new Error('Give a task name and a known phase.');
  for (const path of options.paths) {
    const target = resolve(cwd, path);
    if (target !== cwd && !target.startsWith(cwd + sep))
      throw new Error('A task path must stay in its repository.');
  }
  if (options.internal) {
    const cloud = options.cloudRoot ?? process.env.TIDYNOTEBOOK_CLOUD_DIR;
    if (!cloud)
      throw new Error(
        'Internal work needs its private repository. Set TIDYNOTEBOOK_CLOUD_DIR.',
      );
    const owner = realpathSync(cloud);
    if (owner === cwd)
      throw new Error('The private owner must be a separate repository.');
    return JSON.parse(
      command(cwd, process.execPath, [
        join(owner, 'tools/task-prepare.mjs'),
        '--cloud-root',
        owner,
        '--core-root',
        cwd,
        '--internal',
        '--task',
        options.task,
        '--phase',
        options.phase,
        ...options.paths.flatMap((path) => ['--core-path', path]),
      ]),
    );
  }
  const entries = await readingList(cwd, options.paths);
  const missing = await missingFiles(cwd, entries);
  if (missing.length)
    throw new Error(
      'The task context has a missing file: ' + missing.join(', '),
    );
  const context = entries.map((entry) => {
    const file = resolve(cwd, entry.file),
      bytes = readFileSync(file);
    const owned = file.startsWith(cwd + sep);
    // Private contents never enter a public context archive.
    if (owned)
      save(
        join(
          stateDirectory(cwd),
          'tasks',
          options.task,
          'guides',
          entry.file + '.json',
        ),
        {
          file: entry.file,
          text: bytes.toString('utf8'),
          digest: digest(bytes),
        },
      );
    return {
      ...entry,
      owner: owned ? 'core' : 'optional consumer',
      digest: digest(bytes),
    };
  });
  const impact = await diffImpact(cwd, 'main');
  const result = {
    schemaVersion: 1,
    task: options.task,
    phase: options.phase,
    repositoryRoot: cwd,
    repository: git(cwd, ['remote', 'get-url', 'origin']),
    commit: git(cwd, ['rev-parse', 'HEAD']),
    paths: options.paths.map((path) => relative(cwd, resolve(cwd, path))),
    context,
    impact,
    nextSkill:
      options.phase === 'release'
        ? 'release-core'
        : ['operate', 'recover', 'retire'].includes(options.phase)
          ? `${options.phase}-host`
          : options.phase === 'maintain'
            ? 'maintain-project'
            : options.phase === 'credentials'
              ? 'manage-host-credentials'
              : options.phase === 'setup'
                ? 'setup-project'
                : `${options.phase}-change`,
  };
  const file = join(stateDirectory(cwd), 'tasks', options.task, 'context.json');
  save(file, result);
  return { ...result, contextFile: file };
}
if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        task: { type: 'string' },
        path: { type: 'string', multiple: true },
        phase: { type: 'string', default: 'prepare' },
        internal: { type: 'boolean' },
        'cloud-root': { type: 'string' },
        'core-root': { type: 'string' },
      },
    });
    const result = await prepare({
      cwd: values['core-root'] ?? root,
      task: values.task ?? '',
      paths: values.path ?? [],
      phase: values.phase ?? 'prepare',
      internal: values.internal ?? false,
      ...(values['cloud-root'] ? { cloudRoot: values['cloud-root'] } : {}),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
