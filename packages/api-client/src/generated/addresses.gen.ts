/*
 * Generated from packages/api-contract/openapi.yaml by tools/sdk-codegen.
 * Do not edit by hand. Run `pnpm generate` after a contract change.
 */

import { client } from './client.gen.js';

/** One path parameter of an address, encoded. */
const segment = (value: string): string => encodeURIComponent(value);

/**
 * The address of `exportWorkspace`, which a browser reads itself (record
 * 0178), from the base URL of the client.
 */
export function exportWorkspaceAddress(path: { readonly workspaceId: string }): string {
  return `${client.getConfig().baseUrl ?? ''}/api/workspaces/${segment(path.workspaceId)}/export`;
}
