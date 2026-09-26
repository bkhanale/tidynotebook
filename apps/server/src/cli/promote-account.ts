/**
 * The operator promotion command, `pnpm account:promote`.
 *
 * An installation keeps one enabled administrator (record 0110), but an
 * administrator can forget a password on an installation with no mail
 * transport, or leave. This command makes the account of one address an
 * enabled administrator again, from a shell.
 */
import process from 'node:process';
import { openIdentityStore } from '@notesapp/storage-server';
import type { ServerConfig } from '../config.ts';
import { loadProtectedEnvironment, loadServerConfig } from '../config.ts';
import { readArgument } from './prompt.ts';

/** Makes the account of one address an enabled administrator. */
export async function promoteAccount(input: {
  readonly config: ServerConfig;
  readonly email: string;
}): Promise<string> {
  const identity = openIdentityStore(input.config.databaseUrl, { poolSize: 1 });
  try {
    const promoted = await identity.operatorPromote(input.email);
    if (promoted === null)
      throw new Error('notesapp: no account uses that address.');
    return promoted;
  } finally {
    await identity.close();
  }
}

/** The command entry point. */
export async function main(argv: readonly string[]): Promise<void> {
  const email = readArgument(argv, 'email');
  if (email === null)
    throw new Error('notesapp: pass --email <address> of the account.');
  const config = loadServerConfig(await loadProtectedEnvironment(process.env));
  await promoteAccount({ config, email });
  process.stdout.write(`notesapp: ${email} is an enabled administrator now\n`);
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'notesapp: the promotion failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
