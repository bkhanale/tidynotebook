/**
 * Orphan component check over the merged contract document.
 *
 * This walk is the only unused-component check of the contract. Redocly's rule
 * is off, because the root document declares every component as a reference to
 * its own file and the rule counts that reference as a use. That rule also
 * never saw the authentication fragment that `auth-contract.ts` adds. A
 * component that nothing reaches is still generated into the shipped client,
 * which is how one schema of a deleted sign-in operation stayed in the public
 * types.
 *
 * The walk starts at the paths and the document security, follows every
 * `$ref`, and reports every component that it never reached. It reads the
 * merged document in source form, which still holds its references, because a
 * dereferenced document has none left to follow.
 *
 * The message contract is a second root (record 0126). Its walk starts at its
 * operations, and a schema that only a message reaches is still in use: the
 * HTTP contract lists it so that Hey API writes its type. A schema that
 * neither walk reaches is an orphan.
 */

type Json = Record<string, unknown>;

/** Component sections that a `$ref` can name. */
const sections = [
  'schemas',
  'parameters',
  'requestBodies',
  'responses',
  'headers',
  'examples',
  'links',
  'callbacks',
  'pathItems',
  'securitySchemes',
] as const;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reports whether the value is a list of OpenAPI security requirements.
 *
 * A security requirement names a scheme and lists its scopes, so the value is
 * a list of objects whose every member is a list. A schema property that
 * happens to be called `security` does not have that shape, so this check
 * keeps the walk from reading one as a scheme name.
 */
function isSecurityRequirements(value: unknown): value is Json[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        Object.values(entry).every((scopes) => Array.isArray(scopes)),
    )
  );
}

/** The value a local JSON pointer names, or undefined when it names nothing. */
function resolvePointer(document: Json, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined;
  let current: unknown = document;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Every component pointer the document declares, as `#/components/...`. */
function declaredComponents(document: Json): string[] {
  const components = document.components;
  if (!isRecord(components)) return [];
  const pointers: string[] = [];
  for (const section of sections) {
    const entries = components[section];
    if (!isRecord(entries)) continue;
    for (const name of Object.keys(entries))
      pointers.push(`#/components/${section}/${name}`);
  }
  return pointers.sort();
}

/** Component pointers that the paths and the document security reach. */
export function reachableComponents(document: Json): Set<string> {
  return walkFrom(document, [
    { paths: document.paths },
    { webhooks: document.webhooks },
    { security: document.security },
  ]);
}

/** Component pointers that the operations of a message contract reach. */
export function reachableMessageComponents(document: Json): Set<string> {
  return walkFrom(document, [{ operations: document.operations }]);
}

/** Every component pointer that a walk from the given nodes reaches. */
function walkFrom(document: Json, start: unknown[]): Set<string> {
  const reachable = new Set<string>();
  const pending: unknown[] = [...start];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isRecord(node)) continue;
    const reference = node.$ref;
    if (typeof reference === 'string') {
      // Every other member of a reference object is an annotation, so the
      // walk follows the pointer and stops here.
      if (!reachable.has(reference)) {
        reachable.add(reference);
        const target = resolvePointer(document, reference);
        if (target === undefined)
          throw new Error(
            `Contract components: the reference ${reference} names nothing.`,
          );
        pending.push(target);
      }
      continue;
    }
    for (const [key, member] of Object.entries(node)) {
      // A security requirement names its scheme by key rather than by `$ref`.
      if (key === 'security' && isSecurityRequirements(member)) {
        for (const requirement of member)
          for (const scheme of Object.keys(requirement))
            reachable.add(`#/components/securitySchemes/${scheme}`);
        continue;
      }
      pending.push(member);
    }
  }
  return reachable;
}

/**
 * Components that nothing reaches, in either contract.
 *
 * `messages` is the bundled message contract, or `null` when a test reads the
 * HTTP contract alone. A schema of the HTTP contract counts as reached when a
 * message reaches the schema of the same name, because both contracts name a
 * shared schema after its one file. A report of the message contract carries
 * the prefix `asyncapi.yaml`.
 */
export function findOrphanComponents(
  document: Json,
  messages: Json | null = null,
): string[] {
  const reachable = reachableComponents(document);
  const byMessages =
    messages === null
      ? new Set<string>()
      : reachableMessageComponents(messages);
  const orphans = declaredComponents(document).filter(
    (pointer) => !reachable.has(pointer) && !byMessages.has(pointer),
  );
  if (messages === null) return orphans;
  // The bundler writes a channel, a message and a security scheme in full
  // where one is named, and keeps a reference to a schema only, so the walk
  // can judge the schemas of the message contract. The message contract check
  // judges its security schemes.
  return [
    ...orphans,
    ...declaredComponents(messages)
      .filter(
        (pointer) =>
          pointer.startsWith('#/components/schemas/') &&
          !byMessages.has(pointer),
      )
      .map((pointer) => `asyncapi.yaml ${pointer}`),
  ];
}

/** Stops generation when either contract declares a component nothing uses. */
export function assertNoOrphanComponents(
  document: Json,
  messages: Json | null = null,
): void {
  const orphans = findOrphanComponents(document, messages);
  if (orphans.length === 0) return;
  throw new Error(
    [
      'Contract components: the merged document declares components that no',
      'operation reaches. Delete each one, or reference it from an operation.',
      'An unreachable component still reaches the generated client.',
      ...orphans.map((pointer) => `  ${pointer}`),
    ].join('\n'),
  );
}
