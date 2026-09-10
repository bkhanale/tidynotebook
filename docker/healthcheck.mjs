/**
 * Container health check.
 *
 * It asks the local listener for readiness. The Host header names the host of
 * the configured origin, because the deployment answers that host only.
 */
import http from 'node:http';

const origin = process.env['NOTESAPP_ORIGIN'] ?? '';
const port = Number(process.env['NOTESAPP_PORT'] ?? '3000');

let host;
try {
  host = new URL(origin).host;
} catch {
  process.stderr.write('notesapp: NOTESAPP_ORIGIN is not a usable URL.\n');
  process.exit(1);
}

const request = http.request(
  { host: '127.0.0.1', port, path: '/ready', method: 'GET', headers: { host } },
  (response) => {
    response.resume();
    response.on('end', () => {
      process.exit(response.statusCode === 200 ? 0 : 1);
    });
  },
);
request.on('error', () => process.exit(1));
request.end();
