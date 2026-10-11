# Agent lifecycle

Status: complete

A build request gives an agent a problem. It does not give permission to publish
an image or change a live service. Today the agent must join many manual steps.
A missed step can leave a release without its notes or a review without current
proof. Local memory cannot prove that the checked source is the source that lands.

One option keeps the procedures in long skills. It costs little code, but each
agent must repeat the state checks. A second option puts judgment in one large
command. That command must guess scope and interpret review comments. It cannot
make those choices safely. The selected option uses small skills for judgment
and commands for repeated actions. Saved proof ties a result to exact inputs.

The units are prepare, design, build, prove, review, land, release, operate,
recover, and maintain. Each unit has a clear start and an observable result.
A later unit reads current proof. It does not trust a flag that says an agent
reviewed the work. An explicit release request permits the release chain.
A host procedure states its target and its data scope before it changes data.

The public repository owns the product, its operator surface, and public image
metadata. A consumer reads a released asset. A private checkout can add context,
but this repository never requires it. Release locks cover all local worktrees.
An uncertain remote write stops until a read proves what happened.

## Decisions

[Record 0212](../decisions/0212-agent-lifecycle-proof.md) sets these boundaries.
