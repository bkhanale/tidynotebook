/**
 * Local MCP stdio adapter for notesapp.
 *
 * Runs as a child process communicating over stdin and stdout.
 * Diagnostics and errors are written strictly to stderr so stdout
 * remains reserved for JSON-RPC messages.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { configureClient } from '@notesapp/api-client';
import { registerStdioTools } from './tools.ts';

/**
 * Parses the origin URL from environment variables or command arguments.
 */
function resolveOrigin(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string {
  const originIndex = argv.indexOf('--origin');
  if (originIndex !== -1 && originIndex + 1 < argv.length) {
    const candidate = argv[originIndex + 1];
    if (candidate) return candidate;
  }
  return env.NOTESAPP_ORIGIN ?? 'http://127.0.0.1:3000';
}

/**
 * Resolves the bearer agent token from protected environment variables.
 * Command-line arguments must not contain tokens to prevent credential leaks.
 */
function resolveToken(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  for (const arg of argv) {
    if (arg.startsWith('--token=') || arg === '--token') {
      process.stderr.write(
        'Error: Passing tokens via command arguments is forbidden for security. Use NOTESAPP_TOKEN.\n',
      );
      process.exit(1);
    }
  }

  const token = env.NOTESAPP_TOKEN ?? env.NOTESAPP_AGENT_TOKEN;
  if (!token || token.trim() === '') {
    process.stderr.write(
      'Error: NOTESAPP_TOKEN or NOTESAPP_AGENT_TOKEN environment variable must be set.\n',
    );
    process.exit(1);
  }

  return token.trim();
}

/**
 * Starts the local MCP stdio server.
 */
export async function runStdioServer(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const origin = resolveOrigin(argv, env);
  const token = resolveToken(argv, env);

  configureClient(origin, () => Promise.resolve(token));

  const server = new McpServer({
    name: 'notesapp-stdio',
    version: '0.1.0',
  });

  registerStdioTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('notesapp local stdio server ready.\n');
}

// Auto-run if executed directly as script
const entry = process.argv[1];
if (entry && (entry.endsWith('main.js') || entry.endsWith('main.ts'))) {
  runStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Fatal error: ${message}\n`);
    process.exit(1);
  });
}
