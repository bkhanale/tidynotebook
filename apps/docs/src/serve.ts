/**
 * Serves a built site on this machine, under its base path.
 *
 * The site needs no server (record 0152). This one exists so that a person
 * and a drive script read the build at the address it was built for, with
 * the answer of a static host: the file of an address, `index.html` for a
 * folder, a redirect that adds the slash of a folder, and `404.html` for
 * everything else. Run it with `pnpm docs:serve` after `pnpm docs:build`.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { defaultOutput } from './build.ts';
import { readSiteSettings } from './site.ts';

/** The media type of each extension that the site holds. */
export const mediaTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pf_meta': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.pagefind': 'application/octet-stream',
};

/** The answer of the server for one address. */
export type Route =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'folder'; readonly path: string }
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'missing' };

/**
 * Maps the path of an address onto a file of the site.
 *
 * A path outside the base, a path that leaves the folder of the site, and a
 * path with an encoded separator answer nothing.
 */
export function route(base: string, folder: string, pathname: string): Route {
  if (pathname === base.slice(0, -1) && base !== '/')
    return { kind: 'redirect', location: base };
  if (!pathname.startsWith(base)) return { kind: 'missing' };
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(base.length));
  } catch {
    return { kind: 'missing' };
  }
  if (relative.includes('\0') || relative.includes('\\'))
    return { kind: 'missing' };
  const root = resolve(folder);
  const path = normalize(join(root, relative));
  if (path !== root && !path.startsWith(`${root}${sep}`))
    return { kind: 'missing' };
  if (relative === '' || relative.endsWith('/'))
    return { kind: 'folder', path: join(path, 'index.html') };
  return { kind: 'file', path };
}

/** Starts the server and answers its address. */
export async function serve(
  folder: string,
  base: string,
  port: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const send = async (
    path: string,
    status: number,
  ): Promise<{ status: number; type: string; body: Buffer } | null> => {
    const body = await readFile(path).catch(() => null);
    if (body === null) return null;
    return {
      status,
      type: mediaTypes[extname(path)] ?? 'application/octet-stream',
      body,
    };
  };
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const answer = route(base, folder, pathname);
      if (answer.kind === 'redirect') {
        response.writeHead(301, { location: answer.location }).end();
        return;
      }
      let found =
        answer.kind === 'missing' ? null : await send(answer.path, 200);
      if (found === null && answer.kind === 'file') {
        const info = await stat(answer.path).catch(() => null);
        if (info?.isDirectory() === true) {
          response.writeHead(301, { location: `${pathname}/` }).end();
          return;
        }
      }
      found ??= await send(join(folder, '404.html'), 404);
      if (found === null) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(found.status, {
          'content-type': found.type,
          'cache-control': 'no-cache',
        })
        .end(found.body);
    })();
  });
  await new Promise<void>((done) => {
    server.listen(port, '127.0.0.1', done);
  });
  const address = server.address();
  const actual = typeof address === 'object' && address !== null ? address.port : port;
  return {
    url: `http://127.0.0.1:${String(actual)}${base}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      }),
  };
}

if (import.meta.main) {
  const { base } = readSiteSettings(process.env);
  const port = Number(process.env['NOTESAPP_DOCS_PORT'] ?? '4321');
  const folder = resolve(process.argv[2] ?? defaultOutput);
  const { url } = await serve(folder, base, port);
  process.stdout.write(`Docs: serving ${folder} at ${url}\n`);
}
