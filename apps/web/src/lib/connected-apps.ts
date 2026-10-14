/** A client name is a claim. No stored identifier or instant is shown. */
import type { ConnectedApp } from '@notesapp/api-client';
import { oauthClientIdentity } from '@notesapp/core';
import { relativeTime } from './relative-time.ts';

export function connectedAppName(app: ConnectedApp): string {
  return app.clientName?.trim() || 'Unnamed app';
}

export function connectedAppIdentity(app: ConnectedApp): string {
  const identity = oauthClientIdentity(app.clientId);
  return identity.kind === 'cimd'
    ? `Client identity: ${identity.host}.`
    : 'Client identity: Not verified.';
}

export function connectedAppFacts(app: ConnectedApp, now: number): string {
  const access = app.scopes.includes('notes:write') ? 'Read and Write' : 'Read';
  const use =
    app.lastUsedAt === null
      ? 'Not used yet'
      : `Last used ${relativeTime(app.lastUsedAt, now)}`;
  return `${access} access to all your workspaces. ${use}.`;
}

export function connectedAppRevokeText(name: string): string {
  return `The app that claims the name ${name} loses access at once. You can connect it again later.`;
}

/** Close returns to the invoking row. A removed row gives way to the first row. */
export function connectedAppFocusOrder(
  apps: readonly ConnectedApp[],
  grantId: string,
): readonly string[] {
  return [
    grantId,
    ...apps.filter((app) => app.grantId !== grantId).map((app) => app.grantId),
  ];
}
