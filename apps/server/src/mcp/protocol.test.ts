import assert from 'node:assert/strict';
import test from 'node:test';
import { INVALID_REQUEST, ProtocolError } from '@modelcontextprotocol/server';
import type { OAuthTokenIdentity } from '@notesapp/storage-server';
import { createToolHandler } from './protocol.ts';
import type { McpTool } from './registry.ts';

const grant: OAuthTokenIdentity = {
  accountId: '00000000-0000-4000-8000-000000000001',
  authUserId: 'test-user',
  standing: 'active',
  grantId: 'test-grant',
  scopes: ['notes:read'],
};

await test('the exact registered handler refuses a write before tool or contract execution', async () => {
  let executions = 0;
  let contractCalls = 0;
  const tool: McpTool = {
    definition: { name: 'test_write', inputSchema: { type: 'object' } },
    scope: 'notes:write',
    operations: ['listWorkspaces'],
    run: async (_input, context) => {
      executions += 1;
      await context.call('listWorkspaces');
      return { content: [] };
    },
  };
  const handler = createToolHandler(grant, [tool], () => {
    contractCalls += 1;
    return Promise.resolve({ status: 200, body: {} });
  });
  await assert.rejects(
    handler({
      method: 'tools/call',
      params: { name: 'test_write', arguments: {} },
    }),
    (error: unknown) =>
      error instanceof ProtocolError && error.code === INVALID_REQUEST,
  );
  assert.equal(executions, 0);
  assert.equal(contractCalls, 0);
});
