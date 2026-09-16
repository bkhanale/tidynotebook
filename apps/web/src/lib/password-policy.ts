/**
 * The one password policy of this product.
 *
 * Two screens take a password: first-run setup, which makes the owner
 * account, and the publish dialog, which guards a published link. The
 * contract states one bound for both, because the product keeps one policy,
 * so the two screens read the bound from here and cannot drift apart.
 *
 * The rule is stated under a field from the start, and the refusal names the
 * same rule in the same words, so nobody learns a requirement from a failure.
 */

/** The shortest password that the server accepts. */
export const minPasswordLength = 12;

/**
 * The longest password that the server accepts.
 *
 * A person does not reach this bound by typing, but a paste from a password
 * manager can. The screen states it here rather than letting the server
 * answer a refusal that names no rule.
 */
export const maxPasswordLength = 512;

/** The rule of a password field, stated before anything is submitted. */
export const passwordRule = `Use at least ${String(minPasswordLength)} characters.`;

/**
 * States why a password is refused, or `null` when it is accepted.
 *
 * The caller decides whether an empty value reaches this function. A field
 * that needs a password calls it with every value, and a field that treats an
 * empty value as "no password" calls {@link optionalPasswordProblem}.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < minPasswordLength) return 'This password is too short.';
  if (password.length > maxPasswordLength) return 'This password is too long.';
  return null;
}

/**
 * The same rule for a field where an empty value means no password.
 *
 * The publish dialog offers a link that opens without a password, so an empty
 * field is an answer there and not an omission.
 */
export function optionalPasswordProblem(password: string): string | null {
  return password === '' ? null : passwordProblem(password);
}
