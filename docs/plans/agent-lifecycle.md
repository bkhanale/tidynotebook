# Agent lifecycle plan

Status: active

The [project board](https://github.com/users/bkhanale/projects/2) owns the work.
See [the design](../design/agent-lifecycle.md).

## Decisions

[Record 0212](../decisions/0212-agent-lifecycle-proof.md).

## Work

| Order | Result                                | Code                      | Board row                                                            |
| ----- | ------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| 1     | Public operator impact and context    | `tools/agent-context.mjs` | [Issue 300](https://github.com/tidynotebook/tidynotebook/issues/300) |
| 2     | Proof, review, and authorized landing | `tools/lifecycle.mjs`     | [Issue 301](https://github.com/tidynotebook/tidynotebook/issues/301) |
| 3     | Locked release and public metadata    | `tools/release.mjs`       | [Issue 302](https://github.com/tidynotebook/tidynotebook/issues/302) |
| 4     | Scoped host procedures and skills     | `.agents/skills/`         | [Issue 303](https://github.com/tidynotebook/tidynotebook/issues/303) |

Each row needs tests of accepted results and refusal paths. The final gate is
`pnpm verify`. The image gate proves the release input. A fixture run does not
publish a real release or change a live service.
