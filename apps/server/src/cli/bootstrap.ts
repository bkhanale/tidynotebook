/**
 * The one-time bootstrap command, `pnpm owner:bootstrap`.
 *
 * Public registration is disabled, so an installation needs one command that
 * creates the first account. The command refuses to run when an account
 * already exists, so it cannot be used a second time to add an account behind
 * the invitation rules.
 *
 * The password comes from a protected file or from a hidden prompt. It never
 * travels in a command argument and it is never written to standard output.
 */
import process from 'node:process';
import { openIdentityStore } from '@notesapp/storage-server';
import type { ServerConfig } from '../config.ts';
import { createAuth } from '../auth/better-auth.ts';
import { loadProtectedEnvironment, loadServerConfig } from '../config.ts';
import { readArgument, readSecret } from './prompt.ts';
import { readProperty } from '../values.ts';
import { WritePauseCoordinator } from '../write-pause.ts';

/** What the bootstrap command created. */
export type BootstrapResult = {
  /** Identifier of the account inside the identity provider. */
  readonly authUserId: string;
  /** Application account identifier. */
  readonly accountId: string;
  /** Sign-in address of the first account. */
  readonly email: string;
};

/** What the bootstrap command needs. */
export type BootstrapInput = {
  readonly config: ServerConfig;
  readonly email: string;
  readonly name: string;
  readonly password: string;
};

/** The shortest password that this installation accepts. */
export const minimumPasswordLength = 12;

/**
 * Creates the first account and its personal workspace.
 *
 * The account identifier, the map row, the personal workspace, its usage
 * record, its cursor, and the owner membership are written by one database
 * function, so a failure leaves no half created account.
 */
export async function bootstrapOwner(
  input: BootstrapInput,
): Promise<BootstrapResult> {
  if (input.config.oidcRequired)
    throw new Error(
      'notesapp: this installation requires the configured provider. The first account signs in through it.',
    );
  if (input.password.length < minimumPasswordLength)
    throw new Error(
      `notesapp: the password must have at least ${String(minimumPasswordLength)} characters.`,
    );
  const identity = openIdentityStore(input.config.databaseUrl, { poolSize: 2 });
  // Sign-up stays disabled in the running server. This command builds its own
  // instance with sign-up permitted, so the one-time path is here and nowhere
  // else.
  const auth = createAuth(input.config, { mail: null, allowSignUp: true });
  try {
    if (await identity.hasAccount())
      throw new Error(
        'notesapp: an account already exists. Invite further accounts instead.',
      );
    const created: unknown = await auth.auth.api.signUpEmail({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
      },
    });
    const authUserId = readProperty(readProperty(created, 'user'), 'id');
    if (typeof authUserId !== 'string' || authUserId === '')
      throw new Error('notesapp: the first account was not created.');
    const accountId = await identity.linkAccount({
      authUserId,
      workspaceName: 'Personal',
    });
    return { authUserId, accountId, email: input.email };
  } finally {
    await auth.close();
    await identity.close();
  }
}

/** The command entry point. */
export async function main(argv: readonly string[]): Promise<void> {
  const email = readArgument(argv, 'email');
  const name = readArgument(argv, 'name') ?? 'Owner';
  if (email === null)
    throw new Error('notesapp: pass --email <address> for the first account.');
  const password = await readSecret(
    {
      fileVariable: 'NOTESAPP_BOOTSTRAP_PASSWORD_FILE',
      label: 'Password for the first account: ',
    },
    process.env,
    { input: process.stdin, output: process.stderr },
  );
  const config = loadServerConfig(await loadProtectedEnvironment(process.env));
  const writePause = new WritePauseCoordinator(config.storageRoot);
  const release = writePause.beginWrite();
  if (release === null)
    throw new Error('notesapp: writes are paused for operator maintenance.');
  let result: BootstrapResult;
  try {
    result = await bootstrapOwner({ config, email, name, password });
  } finally {
    release();
  }
  // The address and the identifiers are operator data. The password is not
  // repeated anywhere.
  process.stdout.write(
    `notesapp: created the first account ${result.email} (${result.accountId}) and its personal workspace\n`,
  );
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'notesapp: the bootstrap failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
