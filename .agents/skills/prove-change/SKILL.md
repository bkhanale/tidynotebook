---
name: prove-change
description: Runs and saves exact input proof for a completed core change. Use before PR review or after any fix, rebase, runtime change, or input change. It does not publish or merge.
---

# Prove change

Start with a clean commit. Run the canonical proof command. It saves private
logs and receipts for the exact input. Never edit a receipt to claim a pass.

```sh
pnpm lifecycle prove
```

Use `--image` for image or release inputs. For a changed screen, use
[test-application](../test-application/SKILL.md). Drive its actual paths and read
light and dark screenshots. A pure test and a served result test prove the rule.
End when current proof covers each claim. Fix a failure, then run proof again.
