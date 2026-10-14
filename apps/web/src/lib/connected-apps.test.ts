import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConnectedApp } from '@notesapp/api-client';
import {
  connectedAppName,
  connectedAppIdentity,
  connectedAppFacts,
  connectedAppRevokeText,
  connectedAppFocusOrder,
} from './connected-apps.ts';
const app: ConnectedApp = {
  grantId: 'private-grant',
  clientId: 'private-client',
  clientName: 'My app',
  scopes: ['notes:read'],
  lastUsedAt: null,
};
const now = Date.parse('2026-10-14T12:00:00Z');

await test('a grant shows its access and no use without its identifiers', () => {
  assert.equal(connectedAppName(app), 'My app');
  assert.equal(
    connectedAppFacts(app, now),
    'Read access to all your workspaces. Not used yet.',
  );
  assert.equal(connectedAppIdentity(app), 'Client identity: Not verified.');
  assert.equal(connectedAppName({ ...app, clientName: null }), 'Unnamed app');
  assert.equal(connectedAppName({ ...app, clientName: ' ' }), 'Unnamed app');
});
await test('a used write grant shows relative use and only the metadata host', () => {
  assert.equal(
    connectedAppFacts(
      {
        ...app,
        scopes: ['notes:read', 'notes:write'],
        lastUsedAt: '2026-10-14T11:00:00Z',
      },
      now,
    ),
    'Read and Write access to all your workspaces. Last used 1 hour ago.',
  );
  assert.equal(
    connectedAppIdentity({
      ...app,
      clientId: 'https://client.example/private/client.json',
    }),
    'Client identity: client.example.',
  );
  assert.equal(
    connectedAppIdentity({ ...app, clientId: 'http://client.example/private' }),
    'Client identity: Not verified.',
  );
  assert.equal(
    connectedAppIdentity({
      ...app,
      clientId: 'https://client.example:8443/private/client.json',
    }),
    'Client identity: client.example:8443.',
  );
  for (const clientId of [
    'https://',
    'https://brand.example@evil.example/client',
    'https://client.example/private#claim',
  ])
    assert.equal(
      connectedAppIdentity({ ...app, clientId }),
      'Client identity: Not verified.',
    );
});
await test('revoke says what stops and how to connect again', () => {
  assert.equal(
    connectedAppRevokeText('My app'),
    'The app that claims the name My app loses access at once. You can connect it again later.',
  );
});

await test('dialog close prefers its own row, then the remaining rows in page order', () => {
  const other = { ...app, grantId: 'other' };
  assert.deepEqual(connectedAppFocusOrder([other, app], app.grantId), [
    app.grantId,
    other.grantId,
  ]);
  assert.deepEqual(connectedAppFocusOrder([other], app.grantId), [
    app.grantId,
    other.grantId,
  ]);
  assert.deepEqual(connectedAppFocusOrder([], app.grantId), [app.grantId]);
});
