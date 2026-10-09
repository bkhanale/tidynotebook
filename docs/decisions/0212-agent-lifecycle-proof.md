# 0212. Agent lifecycle uses exact input proof

- Status: Accepted
- Date: 2026-10-09

## Context

The release checks prove individual steps. Local procedures do not save proof
of the inputs, the review state, or a remote write that stops part way through.
See [the design](../design/agent-lifecycle.md).

## Decision

Commands own repeated operations and saved proof. Skills own scope and judgment.
`tools/lifecycle.mjs` binds gates to the commit, inputs, tool, and runtime.
PR review and current checks precede an authorized landing. A non-force fast-forward push uses the exact reviewed head. Unseen main work
refuses that push. The PR and merged tree must confirm the result. No command invents a human review.
This replaces the local landing procedure of the feature workflow prospectively.
`tools/release.mjs` owns the explicit release chain and a shared repository lock.
It publishes `release-manifest.json` with source, image, and operator digests.
The signed tag stays fixed. A consumer uses the published digest and provenance.
The before image gate of record 0204 remains required. Published main must
hold the fixed prepare commit; later main work does not enter that release. Exact valid proof can be
reused. A failed or uncertain write needs a read before another write.
A build request permits no release or live deploy. Recovery permits only its
named target. The public lifecycle has no required private checkout or secret.

## Consequences

The gate refuses stale proof, changed identity, concurrent releases, unresolved
review threads, and missing checks. Tests use real fixture repositories and
command adapters to prove these refusals and resume paths. Host recovery uses
the existing backup tools. Historical records keep their original content.
