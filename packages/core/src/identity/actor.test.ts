/**
 * Role and grant decisions.
 *
 * The tests cover every role and action pair, a grant that is missing while
 * the role permits the action, a grant that names another workspace, and the
 * run time checks of `verifyActor`. One role is left, so the matrix is small,
 * but the intersection of the role and the verified grant is still the rule.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorize,
  verifyActor,
  type Action,
  type Actor,
  type Grant,
  type Role,
} from './actor.ts';

const workspace = 'workspace-1';
const other = 'workspace-2';
const roles: readonly Role[] = ['owner'];
const actions: readonly Action[] = ['read', 'write', 'history', 'purge'];
const permitted: Readonly<Record<Role, readonly Action[]>> = {
  owner: ['read', 'history', 'write', 'purge'],
};

/**
 * A value outside its union, as an unvalidated storage read could return it.
 * The assertion is stated once here, so no test repeats it.
 */
function stored<T>(value: string): T {
  return value as unknown as T;
}

/** The verified actor, or a test failure when the input was rejected. */
function actorOf(accountId: string, grants: readonly Grant[]): Actor {
  const result = verifyActor(accountId, grants);
  assert.equal(result.ok, true, 'expected the actor to be verified');
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** An actor whose verified grants cover every action in one workspace. */
function fullActor(workspaceId: string = workspace): Actor {
  return actorOf('account-1', [{ workspaceId, actions }]);
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
  const actor = actorOf('account-1', [
    { workspaceId: workspace, actions: ['read', 'history'] },
  ]);
  assert.equal(authorize(actor, workspace, 'owner', 'read').ok, true);
  const denied = authorize(actor, workspace, 'owner', 'write');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'forbidden');
});

await test('an actor without any grant is denied', () => {
  const actor = actorOf('account-1', []);
  assert.equal(authorize(actor, workspace, 'owner', 'read').ok, false);
});

await test('a grant for another workspace does not apply', () => {
  const actor = fullActor(other);
  assert.equal(authorize(actor, other, 'owner', 'write').ok, true);
  assert.equal(authorize(actor, workspace, 'owner', 'write').ok, false);
});

await test('a grant cannot widen what the role permits', () => {
  // A stored role outside the union grants nothing, whatever the request
  // scope proved.
  const actor = fullActor();
  const role = stored<Role>('viewer');
  assert.equal(authorize(actor, workspace, role, 'purge').ok, false);
  assert.equal(authorize(actor, workspace, role, 'read').ok, false);
});

await test('a role outside the union denies every action', () => {
  // A stored role can hold an unexpected string. The lookup must deny it
  // instead of failing, so the check states the unchecked value once.
  const role = stored<Role>('superuser');
  for (const action of actions) {
    assert.equal(authorize(fullActor(), workspace, role, action).ok, false);
  }
});

await test('a verified actor copies the grants it was given', () => {
  const grants = [{ workspaceId: workspace, actions: ['read'] as Action[] }];
  const actor = actorOf('account-1', grants);
  grants[0]?.actions.push('purge');
  assert.equal(authorize(actor, workspace, 'owner', 'purge').ok, false);
  assert.equal(actor.accountId, 'account-1');
});

await test('an empty account identifier is rejected', () => {
  const result = verifyActor('', [{ workspaceId: workspace, actions: [] }]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'forbidden');
    assert.deepEqual(result.error.fileIds, []);
  }
});

await test('an empty workspace identifier is rejected', () => {
  const result = verifyActor('account-1', [
    { workspaceId: '', actions: ['read'] },
  ]);
  assert.equal(result.ok, false);
});

await test('an unknown action rejects the whole actor', () => {
  // A stored token scope can hold a string that the union no longer contains.
  const action = stored<Action>('administer');
  const result = verifyActor('account-1', [
    { workspaceId: workspace, actions: ['read', action] },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'forbidden');
});
