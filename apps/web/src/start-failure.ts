/**
 * The screen of a start that failed before the first render (record 0161).
 *
 * A route boundary holds a failure once React runs. A start can fail before
 * that: a module of the entry that does not arrive, or an error while the
 * entry runs. React never draws then, so the page stayed white. The build
 * draws the application screen of `lib/route-error.ts` here, with the page
 * and the button of `@notesapp/ui`, and writes it into two templates of
 * `index.html`. The script of that page shows one of them while the root is
 * still empty, and the first render of React takes the root back.
 *
 * This module runs in the build, so the screen of a failed start is the
 * screen of a failed render, from one source.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Page, PageHeader } from '@notesapp/ui';
import {
  reloadLabel,
  routeErrorScreen,
  type RouteErrorCause,
} from './lib/route-error.ts';

/** The error that each cause stands for, for the one rule of the words. */
function errorOf(cause: RouteErrorCause): Error {
  if (cause === 'stop') return new Error('The start stopped.');
  const failure = new Error('Importing a module script failed.');
  return failure;
}

/** The markup of the screen of one cause, with no script and no handler. */
export function startFailureMarkup(cause: RouteErrorCause): string {
  const screen = routeErrorScreen({
    scope: 'application',
    error: errorOf(cause),
    pathname: '/',
    workspaceId: null,
  });
  return renderToStaticMarkup(
    createElement(
      Page,
      null,
      createElement(PageHeader, {
        title: screen.title,
        description: screen.description,
        actions: createElement(Button, { type: 'button' }, reloadLabel),
      }),
    ),
  );
}
