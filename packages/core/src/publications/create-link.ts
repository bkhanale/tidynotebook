/**
 * The create rule: may the owner make one more link, and over what.
 *
 * This rule writes nothing. The port of this context declares read methods
 * only, which is refusal 3 of decision 0031, so the owner path performs its
 * write in the storage package and asks this rule first. The rule answers the
 * scope in its stored spelling, so the record that the owner path writes holds
 * one spelling of one name.
 *
 * A workspace holds at most `maxPublishedLinksPerWorkspace` links. The bound
 * guards a store of secrets: every link is a door, and a bounded number of
 * doors is a number that an owner can read and revoke. A request past the
 * bound answers `quota`, which the boundary reports as the quota refusal of
 * the contract.
 *
 * The rule takes no instant and it does not check the expiry that the owner
 * asks for. An expiry that has passed makes a link that opens nothing, and the
 * resolve use case already refuses one. The contract states the shape of the
 * instant, and the storage column refuses a text that is not one.
 */
import { fail, type Result } from '../files/model.ts';
import {
  maxPublishedLinksPerWorkspace,
  type PublicationScope,
} from './model.ts';
import { normalizeScope } from './scope.ts';

/** What the owner asks for, and what the workspace holds now. */
export type NewPublishedLink = {
  readonly scope: PublicationScope;
  /** How many links the workspace holds at this moment. */
  readonly currentLinkCount: number;
};

/**
 * Decides whether one more link is admitted, and reads its scope.
 *
 * A count that is not a whole number at or above zero is a defect of the
 * caller, so the rule refuses it as well and the workspace gains no link.
 */
export function planPublishedLink(
  input: NewPublishedLink,
): Result<PublicationScope> {
  const count = input.currentLinkCount;
  if (!Number.isInteger(count) || count < 0) return fail('quota');
  if (count >= maxPublishedLinksPerWorkspace) return fail('quota');
  return normalizeScope(input.scope);
}
