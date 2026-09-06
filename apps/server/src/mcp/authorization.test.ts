import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  findRegisteredClient,
  McpAuthorizationServer,
  registerOAuthClient,
  sha256Hex,
  verifyPkce,
} from './authorization.ts';
import { loadServerConfig, type ServerConfig } from '../config.ts';

const testConfig: ServerConfig = loadServerConfig({
  NOTESAPP_ORIGIN: 'http://127.0.0.1:8080',
  NOTESAPP_DATABASE_URL: 'postgres://notesapp:notesapp@127.0.0.1:5432/notesapp',
  NOTESAPP_AUTH_DATABASE_URL:
    'postgres://notesapp_auth:notesapp_auth@127.0.0.1:5432/notesapp',
  NOTESAPP_STORAGE_ROOT: '/tmp/notesapp-test',
  NOTESAPP_AUTH_SECRET: 'test-secret-value-for-authorization-checks',
  NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
  NOTESAPP_LOG_LEVEL: 'silent',
  NOTESAPP_MAX_BODY_BYTES: '1048576',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '5000',
});

import type { IdentityStoreHandle } from '@notesapp/storage-server';

const stubIdentity = {
  findAgentTokenByHash: async () => null,
  memberships: async () => [],
} as unknown as IdentityStoreHandle;

void test('sha256Hex computes exact hex digest', () => {
  const expected = createHash('sha256').update('hello', 'utf8').digest('hex');
  assert.equal(sha256Hex('hello'), expected);
});

void test('verifyPkce validates S256 code verifier and challenge', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64url');

  assert.equal(verifyPkce(verifier, challenge, 'S256'), true);
  assert.equal(verifyPkce('wrong-verifier', challenge, 'S256'), false);
  assert.equal(verifyPkce(verifier, challenge, 'plain'), false);
});

void test('registerOAuthClient and findRegisteredClient', () => {
  registerOAuthClient({
    clientId: 'test-client-id',
    clientName: 'Test Client',
    redirectUris: ['http://localhost:3000/callback'],
  });

  const found = findRegisteredClient('test-client-id');
  assert.ok(found !== undefined);
  assert.equal(found.clientName, 'Test Client');
  assert.equal(findRegisteredClient('non-existent'), undefined);
});

void test('McpAuthorizationServer generates RFC 9728 and RFC 8414 metadata', () => {
  const server = new McpAuthorizationServer({
    config: testConfig,
    identity: stubIdentity,
    resolveSessionActor: async () => null,
  });

  const resourceMeta = server.getProtectedResourceMetadata();
  assert.equal(resourceMeta.resource, 'http://127.0.0.1:8080/mcp');
  assert.deepEqual(resourceMeta.authorization_servers, [
    'http://127.0.0.1:8080',
  ]);
  assert.deepEqual(resourceMeta.scopes_supported, [
    'notes:read',
    'notes:write',
    'notes:share',
    'notes:admin',
  ]);

  const authMeta = server.getAuthorizationServerMetadata();
  assert.equal(authMeta.issuer, 'http://127.0.0.1:8080');
  assert.equal(
    authMeta.authorization_endpoint,
    'http://127.0.0.1:8080/oauth/authorize',
  );
  assert.equal(authMeta.token_endpoint, 'http://127.0.0.1:8080/oauth/token');
  assert.deepEqual(authMeta.code_challenge_methods_supported, ['S256']);
});
