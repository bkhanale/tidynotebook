import type { ConnectedAppRecord } from '@notesapp/core';

export type ConnectedAppRow = {
  grant_id: string;
  client_id: string;
  client_name: string | null;
  scopes: string[];
  last_used_at: Date | null;
};

/** The narrow function returns metadata only. An unknown scope is a fault. */
export function connectedAppOf(row: ConnectedAppRow): ConnectedAppRecord {
  return {
    grantId: row.grant_id,
    clientId: row.client_id,
    clientName: row.client_name,
    scopes: row.scopes.map((scope) => {
      if (scope !== 'notes:read' && scope !== 'notes:write')
        throw new Error('The connected app has unknown access.');
      return scope;
    }),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}
