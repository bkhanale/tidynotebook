# Contributing

Use [AGENTS.md](AGENTS.md) for the development process and commands.
The repository owner selects changes and merges PRs.
Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in project spaces.

## Setup

Use the Node and pnpm versions in `package.json`.
Install Docker with Compose, Bash, and jq.
Create a git worktree for your branch, then install dependencies there:

```sh
pnpm install --frozen-lockfile
```

The optional `test-application` skill gives the fresh local Docker setup.
Unit tests sit beside the code. Integration tests use the services in
`compose.test.yaml`. `pnpm verify` starts those services as needed.

## Review and merge

The author may run `@coderabbitai approve` only after a clean CodeRabbit full
review and a clean independent review on the exact current head. A clean
review has no open findings. A new head requires both reviews again.
The merge workflow does not verify the independent review. The author must
confirm that it is clean before requesting approval.
The owner merges through the unchanged
[fast forward merge gate](docs/development/fast-forward-merge.md).
See [decision 0235](docs/decisions/0235-authors-may-request-approval-after-clean-reviews.md).

## License

tidy notebook uses [AGPL-3.0-only](LICENSE).
Contributions use the same license. There is no contributor license agreement
or required commit sign-off.

## Security

Use [SECURITY.md](SECURITY.md) to report a security problem.
