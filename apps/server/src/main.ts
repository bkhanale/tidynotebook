/**
 * Production server entry point.
 *
 * Starts the Fastify server with validated configuration and registers
 * process signal handlers for clean teardown.
 */
import process from 'node:process';
import { createApp } from './app.ts';
import {
  ConfigError,
  loadProtectedEnvironment,
  loadServerConfig,
} from './config.ts';

/** Starts the HTTP server and registers signal handlers. */
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

  let app;
  try {
    app = await createApp(config);
  } catch (error) {
    process.stderr.write(
      `notesapp: failed to initialize application: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`notesapp: received ${signal}, closing server...\n`);
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      process.stderr.write(
        `notesapp: error during shutdown: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

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
