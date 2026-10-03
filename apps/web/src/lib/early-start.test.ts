import assert from 'node:assert/strict';
import test from 'node:test';
import type { RouteObject } from 'react-router';
import { createEarlyStart } from './early-start.ts';

/** A table of the shape of the router: the frame, its pages and the rest. */
function table(): {
  readonly routes: RouteObject[];
  readonly started: string[];
  readonly start: (pathname: string) => number;
} {
  const early = createEarlyStart();
  const started: string[] = [];
  const load = (name: string) => (): Promise<unknown> => {
    started.push(name);
    return Promise.resolve();
  };
  const routes: RouteObject[] = [
    {
      children: [
        { path: '/login' },
        early.mark(
          {
            path: '/w/:workspaceId',
            children: [
              {
                children: [
                  early.mark({ index: true }, load('home')),
                  early.mark({ path: 'notes/:fileId' }, load('note')),
                  { path: 'notes/:fileId/history' },
                  { path: '*' },
                ],
              },
            ],
          },
          load('frame'),
        ),
        early.mark({ path: '*' }, load('workspace home')),
      ],
    },
  ];
  return {
    routes,
    started,
    start: (pathname) => early.start(routes, pathname),
  };
}

await test('a note address starts the frame and the note screen at once', () => {
  const subject = table();
  assert.equal(subject.start('/w/one/notes/two'), 2);
  assert.deepEqual(subject.started, ['frame', 'note']);
});

await test('the root address of an installed application starts its home', () => {
  // The start address of the manifest is the root, which matched no route
  // that started early, so an installed application started nothing.
  const subject = table();
  assert.equal(subject.start('/'), 1);
  assert.deepEqual(subject.started, ['workspace home']);
});

await test('an address with no early module starts nothing', () => {
  const subject = table();
  assert.equal(subject.start('/login'), 0);
  assert.equal(subject.start('/w/one/notes/two/history'), 1);
  assert.deepEqual(subject.started, ['frame']);
});

await test('a module that does not arrive is left to its route boundary', async () => {
  const early = createEarlyStart();
  const route = early.mark({ path: '/' }, () =>
    Promise.reject(new Error('Importing a module script failed.')),
  );
  assert.equal(early.start([route], '/'), 1);
  // No rejection is left unhandled.
  await Promise.resolve();
});
