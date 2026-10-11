import type { ApiKeyRecord } from '@notesapp/core';

/** Public columns of a key. SQL never answers its digest. */
export type ApiKeyRow = {
  key_id: string;
  name: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
};

export function apiKeyOf(row: ApiKeyRow): ApiKeyRecord {
  return {
    keyId: row.key_id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}
