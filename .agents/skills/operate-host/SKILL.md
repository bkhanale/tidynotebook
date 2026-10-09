---
name: operate-host
description: Checks and backs up one named self-hosted installation. Use for a host health check, backup, or backup verification. It does not restore, upgrade, or retire a host.
---

# Operate host

Start with the named installation, target, protected credential files, and
requested operation. Read [backup and restore](../../../docs/guide/backup-and-restore.md).
Run `tools/ops/check-host.sh` for health. Run `tools/ops/backup.sh` or `tools/ops/verify-backup.sh` with the named
files. The backup tool applies its tested retention policy. Read its result.
Save the target, archive digest, and verification result in private task evidence.
Do not print secrets. End when the requested host check or backup is proved.
