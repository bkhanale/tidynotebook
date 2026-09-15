/**
 * Production server entry point.
 *
 * It starts the Fastify server with validated configuration and gives the stop
 * signals to the drain. The steps of the stop and their order live in
 * `lifecycle.ts`, which owns no signal and no exit, so a test drives them.
 */
import process from 'node:process';
import { createApp } from './app.ts';
import {
  ConfigError,
  loadProtectedEnvironment,
  loadServerConfig,
} from './config.ts';
import type { DrainEvent } from './lifecycle.ts';
import { createDrain, createServiceLifecycle } from './lifecycle.ts';

/**
 * Writes one step of the stop where the operator reads it.
 *
 * A failed stop also sets the exit code, so the process states the same result
 * that the message states. No message carries a failure object, because the
 * operator can act on the step alone.
 */
function reportStop(event: DrainEvent): void {
  switch (event.step) {
    case 'started':
      process.stdout.write(
        `notesapp: received ${event.signal}. The server reports that it is not ready. It then completes the open requests and stops.\n`,
      );
      return;
    case 'repeated':
      process.stdout.write(
        `notesapp: received ${event.signal} again. The server is already stopping. Send SIGKILL to end it at once.\n`,
      );
      return;
    case 'stopped':
      process.stdout.write('notesapp: the server stopped.\n');
      return;
    case 'failed':
      process.exitCode = 1;
      process.stderr.write('notesapp: the server did not stop cleanly.\n');
      return;
    case 'forced':
      process.stderr.write(
        'notesapp: a request did not complete inside the stop deadline. The server ends now.\n',
      );
      return;
  }
}

/** Starts the HTTP server and gives the stop signals to the drain. */
export async function main(): Promise<void> {
  let config;
  try {
    config = loadServerConfig(await loadProtectedEnvironment(process.env));
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(
        `notesapp: configuration error:\n${error.issues.join('\n')}\n`,
      );
    } else {
      process.stderr.write(
        `notesapp: configuration failure: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exit(1);
  }

  const host = process.env['NOTESAPP_HOST'] ?? '0.0.0.0';
  const defaultPort = new URL(config.origin).port;
  const port = Number(
    process.env['NOTESAPP_PORT'] ?? (defaultPort ? defaultPort : '3000'),
  );

  // The readiness answer reads this state, so the state is built before the
  // application and it reaches the handlers through the composition.
  const lifecycle = createServiceLifecycle();

  let app;
  try {
    app = await createApp(config, { lifecycle });
  } catch (error) {
    process.stderr.write(
      `notesapp: failed to initialize application: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  // One drain serves every stop signal. The first signal starts it, a later
  // signal joins it, and the deadline is the one escape hatch. Closing the
  // Fastify instance stops the listener, completes the open requests, and then
  // runs the close hooks that end the cleanup timer, the two identity pools,
  // the attachment store, and the content store.
  const drain = createDrain({
    lifecycle,
    close: () => app.close(),
    gracePeriodMs: config.shutdown.gracePeriodMs,
    deadlineMs: config.shutdown.deadlineMs,
    report: reportStop,
    forceExit: (code) => process.exit(code),
  });

  process.on('SIGTERM', () => void drain('SIGTERM'));
  process.on('SIGINT', () => void drain('SIGINT'));

  try {
    await app.listen({ host, port });
    process.stdout.write(
      `notesapp: listening on http://${host}:${port} (origin: ${config.origin})\n`,
    );
  } catch (error) {
    process.stderr.write(
      `notesapp: failed to bind port: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
