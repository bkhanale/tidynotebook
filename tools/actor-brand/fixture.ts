/**
 * Compile-time proof that a verified actor cannot be built by hand.
 *
 * `packages/core` marks an `Actor` with a symbol that only `verifyActor`
 * creates, and the package entry point does not export that symbol. A parsed
 * HTTP request body therefore cannot be used where a permission decision
 * expects a verified actor, even when it carries the same members.
 *
 * `tools/check-actor-brand.test.mjs` compiles this file and fails when the
 * expected errors disappear.
 */
import { authorize, type Actor } from '@notesapp/core';

declare const request: {
  accountId: string;
  grants: { workspaceId: string; actions: 'read'[] }[];
};

// Expected: TS2739 or TS2741. The plain object has no verified actor marker.
export const forged: Actor = request;

// Expected: TS2345. The same object is not an argument for a decision.
export const decision = authorize(request, 'workspace-1', 'owner', 'read');
