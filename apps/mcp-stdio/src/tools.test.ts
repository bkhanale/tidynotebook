import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/server';
import { mcpTools } from '@notesapp/api-contract';
import { registerStdioTools } from './tools.ts';

await test('registerStdioTools registers all contract domain tools', () => {
  const server = new McpServer({
    name: 'test-stdio',
    version: '0.1.0',
  });

  registerStdioTools(server);

  assert.equal(mcpTools.length, 14);
  const registered = (
    server as unknown as { _registeredTools: Record<string, unknown> }
  )._registeredTools;
  for (const toolDef of mcpTools) {
    assert.ok(
      registered[toolDef.name] !== undefined,
      `Tool ${toolDef.name} should be registered`,
    );
  }
});
