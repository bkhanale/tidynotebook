import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openNotesLabel,
  reloadLabel,
  routeErrorCause,
  routeErrorLog,
  routeErrorName,
  routeErrorScreen,
  type RouteErrorScope,
} from './route-error.ts';

/** An error whose message holds the text of a note. */
const private_ = new TypeError(
  "Cannot read properties of undefined (reading 'Salary review with Dana')",
);

const scopes: readonly RouteErrorScope[] = ['application', 'page'];

await test('a screen never shows the message, a stack or a code', () => {
  const failures: readonly unknown[] = [
    private_,
    new RangeError('Invalid time value'),
    'thrown text',
    { status: 500, statusText: 'Internal Server Error' },
    null,
  ];
  for (const scope of scopes)
    for (const error of failures) {
      const screen = routeErrorScreen({
        scope,
        error,
        pathname: '/w/w1/notes/f1',
        workspaceId: 'w1',
      });
      const words = `${screen.title} ${screen.description}`;
      assert.doesNotMatch(words, /Salary|undefined|Invalid|thrown|500/);
      assert.doesNotMatch(words, /Error|error code|stack/);
      assert.doesNotMatch(words, /[–—]/);
      assert.ok(screen.description.endsWith('.'));
    }
});

await test('a failure inside the frame names the page and keeps the frame', () => {
  const screen = routeErrorScreen({
    scope: 'page',
    error: private_,
    pathname: '/w/w1/notes/f1',
    workspaceId: 'w1',
  });
  assert.equal(screen.title, 'This page stopped');
  assert.equal(
    screen.description,
    'An error stopped this page. Your saved work did not change. Reload the page to try again.',
  );
  assert.equal(screen.notesPath, '/w/w1');
});

await test('a failure of the application names the application', () => {
  const screen = routeErrorScreen({
    scope: 'application',
    error: private_,
    pathname: '/login',
    workspaceId: null,
  });
  assert.equal(screen.title, 'Tidy Notebook stopped');
  assert.match(screen.description, /^An error stopped Tidy Notebook\./);
  assert.equal(screen.notesPath, '/');
});

await test('no link goes to the page that failed', () => {
  assert.equal(
    routeErrorScreen({
      scope: 'page',
      error: private_,
      pathname: '/w/w1/',
      workspaceId: 'w1',
    }).notesPath,
    null,
  );
  assert.equal(
    routeErrorScreen({
      scope: 'application',
      error: private_,
      pathname: '/',
      workspaceId: null,
    }).notesPath,
    null,
  );
});

await test('a module that did not load asks for a connection and a reload', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://notes.example/assets/note-view.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://notes.example/a.js',
    'Unable to preload CSS for /assets/note-view.css',
  ]) {
    const error = new TypeError(message);
    assert.equal(routeErrorCause(error), 'load', message);
    const screen = routeErrorScreen({
      scope: 'page',
      error,
      pathname: '/w/w1/trash',
      workspaceId: 'w1',
    });
    assert.equal(screen.title, 'This page did not load');
    assert.match(screen.description, /connection, then reload the page\.$/);
    assert.doesNotMatch(screen.description, /notes\.example|assets/);
  }
  const chunk = new Error('Loading chunk 4 failed.');
  chunk.name = 'ChunkLoadError';
  assert.equal(routeErrorCause(chunk), 'load');
  assert.equal(routeErrorCause(private_), 'stop');
  assert.equal(routeErrorCause('Failed to fetch dynamically imported'), 'stop');
});

await test('the log names the boundary, the cause and the error name only', () => {
  assert.deepEqual(routeErrorLog('page', private_), {
    scope: 'page',
    cause: 'stop',
    errorName: 'TypeError',
  });
  const odd = new Error('x');
  odd.name = 'Salary review with Dana';
  assert.equal(routeErrorName(odd), 'Error');
  assert.equal(routeErrorName('text'), 'unknown');
  assert.equal(routeErrorName(new RangeError('y')), 'RangeError');
});

await test('the actions are one reload and one link in sentence case', () => {
  assert.equal(reloadLabel, 'Reload');
  assert.equal(openNotesLabel, 'Open all notes');
});
