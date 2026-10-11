/**
 * Developer Certificate of Origin check.
 *
 * Record 0188 takes a contribution under AGPL-3.0-only with a sign-off on each
 * commit and no contributor license agreement. A commit signs off when its
 * message holds a `Signed-off-by: Name <address>` line with the address of
 * its author, which `git commit --signoff` writes.
 *
 * Three kinds of commit need no sign-off:
 *
 * - A commit of the owner, because the owner holds the copyright. GitHub must
 *   link it to the account of the owner and verify its signature, so a commit
 *   that only writes the address of the owner is not enough.
 * - A commit of Dependabot that GitHub verified. It changes a version number
 *   that the owner chose to take, and it holds no work of a person.
 * - A merge commit, which brings in commits that this check reads one by one.
 *
 * `.github/workflows/dco.yml` runs this script on each pull request. It pipes
 * the commit list of the pull request from the GitHub API into the standard
 * input.
 *
 * Usage: `gh api --paginate repos/<owner>/<name>/pulls/<number>/commits |
 * node tools/check-dco.mjs`
 */
import { text as readStream } from 'node:stream/consumers';
import process from 'node:process';

/** The GitHub account of the owner, who holds the copyright. */
export const ownerLogin = 'bkhanale';

/** The GitHub accounts whose verified commits need no sign-off. */
export const exemptLogins = [ownerLogin, 'dependabot[bot]'];

/** The trailer of the sign-off. */
export const signOffTrailer = 'Signed-off-by';

/**
 * One commit of a pull request, as this check reads it.
 *
 * `login` is the GitHub account that GitHub links to the author, or `null`
 * when it links none.
 *
 * @typedef {{
 *   sha: string;
 *   login: string | null;
 *   authorName: string;
 *   authorEmail: string;
 *   message: string;
 *   parents: number;
 *   verified: boolean;
 * }} Commit
 */

/**
 * The addresses of every sign-off of a commit message, in lowercase.
 *
 * @param {string} message
 * @returns {string[]}
 */
export function signOffAddresses(message) {
  const pattern = new RegExp(
    `^${signOffTrailer}:[ \\t]*[^<\\n]*\\S[ \\t]*<([^<>\\s]+@[^<>\\s]+)>[ \\t]*$`,
    'gim',
  );
  return [...message.matchAll(pattern)].map((match) =>
    (match[1] ?? '').toLowerCase(),
  );
}

/**
 * Whether a commit needs a sign-off.
 *
 * @param {Commit} commit
 * @returns {boolean}
 */
export function needsSignOff(commit) {
  if (commit.parents > 1) return false;
  return !(
    commit.verified &&
    commit.login !== null &&
    exemptLogins.includes(commit.login)
  );
}

/**
 * Whether the message of a commit holds the sign-off of its author.
 *
 * @param {Commit} commit
 * @returns {boolean}
 */
export function isSignedOff(commit) {
  return signOffAddresses(commit.message).includes(
    commit.authorEmail.toLowerCase(),
  );
}

/**
 * The commits that need a sign-off and have none.
 *
 * @param {readonly Commit[]} commits
 * @returns {Commit[]}
 */
export function unsignedCommits(commits) {
  return commits.filter(
    (commit) => needsSignOff(commit) && !isSignedOff(commit),
  );
}

/**
 * The value of one key of an object, or a loud failure.
 *
 * @param {unknown} value
 * @param {string} key
 * @param {string} where
 * @returns {unknown}
 */
function field(value, key, where) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${where} is not an object.`);
  if (!Object.hasOwn(value, key)) throw new Error(`${where} has no ${key}.`);
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/**
 * The string of one key of an object, or a loud failure.
 *
 * @param {unknown} value
 * @param {string} key
 * @param {string} where
 * @returns {string}
 */
function stringField(value, key, where) {
  const found = field(value, key, where);
  if (typeof found !== 'string')
    throw new Error(`${where}.${key} is not a string.`);
  return found;
}

/**
 * Reads one commit of the commit list of a pull request in the GitHub API.
 *
 * @param {unknown} entry
 * @returns {Commit}
 */
export function commitOf(entry) {
  const sha = stringField(entry, 'sha', 'commit');
  const where = `commit ${sha}`;
  const detail = field(entry, 'commit', where);
  const author = field(detail, 'author', `${where}.commit`);
  const account = field(entry, 'author', where);
  const parents = field(entry, 'parents', where);
  if (!Array.isArray(parents))
    throw new Error(`${where}.parents is not a list.`);
  const verification = field(detail, 'verification', `${where}.commit`);
  const verified = field(verification, 'verified', `${where}.verification`);
  if (typeof verified !== 'boolean')
    throw new Error(`${where}.verification.verified is not a boolean.`);
  return {
    sha,
    login:
      account === null
        ? null
        : stringField(account, 'login', `${where}.author`),
    authorName: stringField(author, 'name', `${where}.commit.author`),
    authorEmail: stringField(author, 'email', `${where}.commit.author`),
    message: stringField(detail, 'message', `${where}.commit`),
    parents: parents.length,
    verified,
  };
}

/**
 * Reads the commit list of a pull request. A list with no commit is refused,
 * because every pull request holds one, so an empty list means a read failed.
 *
 * @param {string} json The answer of the GitHub API.
 * @returns {Commit[]}
 */
export function commitsOf(json) {
  /** @type {unknown} */
  const value = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error('The commit list is not a list.');
  if (value.length === 0) throw new Error('The commit list is empty.');
  return value.map((entry) => commitOf(entry));
}

/**
 * The report of a check, and whether it passed.
 *
 * @param {readonly Commit[]} commits
 * @returns {{ passed: boolean; report: string }}
 */
export function report(commits) {
  const unsigned = unsignedCommits(commits);
  if (unsigned.length === 0)
    return {
      passed: true,
      report: `Each commit that needs a sign-off has one (${commits.length} read).\n`,
    };
  const lines = unsigned.map(
    (commit) =>
      `- ${commit.sha.slice(0, 12)} by ${commit.authorName} <${commit.authorEmail}> has no "${signOffTrailer}: ${commit.authorName} <${commit.authorEmail}>" line.`,
  );
  return {
    passed: false,
    report: [
      'A commit of this pull request has no sign-off of its author.',
      ...lines,
      '',
      'A sign-off states that you agree to the Developer Certificate of Origin, https://developercertificate.org.',
      'To add it to each commit of the branch, run "git rebase --signoff origin/main", then update the branch of the pull request.',
      '',
    ].join('\n'),
  };
}

// The helpers above stay importable, so the script itself runs only when this
// file is the program.
if (import.meta.main) {
  try {
    const result = report(commitsOf(await readStream(process.stdin)));
    (result.passed ? process.stdout : process.stderr).write(result.report);
    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    process.stderr.write(
      `The commit list cannot be read: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
