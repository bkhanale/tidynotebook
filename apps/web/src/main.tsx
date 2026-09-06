/**
 * Web application entry point.
 *
 * Points the generated client at the serving origin, so the application,
 * REST, authentication, and sync share one origin with cookie sessions.
 * Theme paint is already handled by the inline page script; the provider in
 * `app.tsx` keeps it in sync from here on.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureClient } from '@notesapp/api-client';
import { AppProviders } from './app.tsx';
import { AppRouter } from './router.tsx';

configureClient(window.location.origin, undefined);

const root = document.getElementById('root');
if (root === null) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);
