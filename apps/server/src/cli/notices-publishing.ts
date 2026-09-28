/**
 * The operator command of the notice publishing switch,
 * `pnpm notices:publishing` (record 0129).
 *
 * The switch is shared by every server process. Off stops every notice at its
 * trigger and every stream at its gateway, and the feed and the HTTP saves go
 * on as before. On lets a process that admits streams open them again. Every
 * listening process hears the change at once and checks the switch on a timer
 * as well, so a stop does not depend on one hint.
 */
import process from 'node:process';
import { openCoordination } from '@notesapp/storage-server';
import type { ServerConfig } from '../config.ts';
import { loadProtectedEnvironment, loadServerConfig } from '../config.ts';
import { readArgument } from './prompt.ts';

/** Sets the switch and answers its state after the write. */
export async function setNoticesPublishing(input: {
  readonly config: ServerConfig;
  readonly publishing: boolean;
}): Promise<boolean> {
  const coordination = openCoordination(input.config.databaseUrl, {
    poolSize: 1,
  });
  try {
    await coordination.setNoticesPublishing(input.publishing);
    return await coordination.noticesPublishing();
  } finally {
    await coordination.close();
  }
}

/** The command entry point. */
export async function main(argv: readonly string[]): Promise<void> {
  const state = readArgument(argv, 'state');
  if (state !== 'on' && state !== 'off')
    throw new Error('notesapp: pass --state on or --state off.');
  const config = loadServerConfig(await loadProtectedEnvironment(process.env));
  const publishing = await setNoticesPublishing({
    config,
    publishing: state === 'on',
  });
  process.stdout.write(
    `notesapp: notice publishing is ${publishing ? 'on' : 'off'} now\n`,
  );
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'notesapp: the switch did not change.'}\n`,
    );
    process.exitCode = 1;
  }
}
