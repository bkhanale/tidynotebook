/**
 * Role and grant decisions.
 *
 * The tests cover every role and action pair, a grant that is missing while
 * the role permits the action, and a grant that names another workspace.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorize,
  verifyActor,
  type Action,
  type Actor,
  type Role,
} from './actor.ts';

const workspace = 'workspace-1';
const other = 'workspace-2';
const roles: readonly Role[] = ['viewer', 'editor', 'admin', 'owner'];
const actions: readonly Action[] = [
  'read',
  'write',
  'history',
  'share',
  'members',
  'purge',
];
const permitted: Readonly<Record<Role, readonly Action[]>> = {
  viewer: ['read', 'history'],
  editor: ['read', 'history', 'write'],
  admin: ['read', 'history', 'write', 'share', 'members'],
  owner: ['read', 'history', 'write', 'share', 'members', 'purge'],
};

/** An actor whose verified grants cover every action in one workspace. */
function fullActor(workspaceId: string = workspace): Actor {
  return verifyActor('account-1', [{ workspaceId, actions }]);
}

await test('the role matrix decides every role and action pair', () => {
  for (const role of roles) {
    for (const action of actions) {
      const result = authorize(fullActor(), workspace, role, action);
      const expected = permitted[role].includes(action);
      assert.equal(
        result.ok,
        expected,
        `${role} and ${action} must be ${String(expected)}`,
      );
      if (!result.ok) {
        assert.equal(result.error.code, 'forbidden');
        assert.deepEqual(result.error.fileIds, []);
      }
    }
  }
});

await test('a missing grant denies an action that the role permits', () => {
  const actor = verifyActor('account-1', [
    { workspaceId: workspace, actions: ['read', 'history'] },
  ]);
  assert.equal(authorize(actor, workspace, 'owner', 'read').ok, true);
  const denied = authorize(actor, workspace, 'owner', 'write');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'forbidden');
});

await test('an actor without any grant is denied', () => {
  const actor = verifyActor('account-1', []);
  assert.equal(authorize(actor, workspace, 'owner', 'read').ok, false);
});

await test('a grant for another workspace does not apply', () => {
  const actor = fullActor(other);
  assert.equal(authorize(actor, other, 'editor', 'write').ok, true);
  assert.equal(authorize(actor, workspace, 'editor', 'write').ok, false);
});

await test('a grant cannot widen what the role permits', () => {
  const actor = fullActor();
  assert.equal(authorize(actor, workspace, 'viewer', 'purge').ok, false);
  assert.equal(authorize(actor, workspace, 'editor', 'members').ok, false);
  assert.equal(authorize(actor, workspace, 'admin', 'purge').ok, false);
});

await test('a verified actor copies the grants it was given', () => {
  const grants = [{ workspaceId: workspace, actions: ['read'] as Action[] }];
  const actor = verifyActor('account-1', grants);
  grants[0]?.actions.push('purge');
  assert.equal(authorize(actor, workspace, 'owner', 'purge').ok, false);
  assert.equal(actor.accountId, 'account-1');
});
