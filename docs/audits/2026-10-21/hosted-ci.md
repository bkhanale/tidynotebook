# Hosted CI timing

Measured on 2026-10-21 against commit `abccd3fd337d86920241e180c926b834aa49b96c`.

All jobs used free GitHub-hosted `ubuntu-latest` runners. Branch runs restored
caches but did not save them. Wall time includes job queue and startup time.
Job time is the interval from job start to job completion.

The [first source push](https://github.com/tidynotebook/tidynotebook/actions/runs/39592562556)
finished in 186 seconds. Unit shard 1 failed on a new unsafe JSON assignment.
The fixed [second source push](https://github.com/tidynotebook/tidynotebook/actions/runs/39593123096)
passed in 190 seconds. A [full manual branch run](https://github.com/tidynotebook/tidynotebook/actions/runs/39593609404)
passed in 197 seconds. Both cold image tests passed, in 153 and 138 seconds.
The registry cache cannot be warm until main first exports it.

The [tuned source push](https://github.com/tidynotebook/tidynotebook/actions/runs/39594153870)
passed in 178 seconds. Its job times were:

| Job                    | Seconds            |
| ---------------------- | ------------------ |
| Change scope           | 6                  |
| Static                 | 87                 |
| Unit 1, 2, 3           | 87, 65, 80         |
| Integration 1, 2, 3, 4 | 155, 101, 117, 113 |
| Workflow lint          | 10                 |
| Check                  | 7                  |

Image jobs and nightly checks were correctly skipped on the tuned source
push. Three slow integration files now run on separate shards. Integration
shard 2 fell from 164 to 101 seconds. The longest shard fell to 155 seconds.

A manual run cancelled an earlier push before scope completed. Check refused
the missing scope output. Event-specific concurrency now keeps manual and
push runs separate. A short push diff also needs a passing Check on its
previous head. Errors or missing proof select full checks.

The first document benchmark passed in 64 seconds. Full dependency setup and
whole-tree formatting took most of that time. The short path now installs
only lock-verified Prettier and formats changed inert documents. The full
document check still runs. Guide and development documents require source
checks because tests read them.

The [replacement source push](https://github.com/tidynotebook/tidynotebook/actions/runs/39595695682)
passed on commit `e3a685407c84eebe8b7da45b0200e5d3c2e5bb43`, which includes the
icons change from main and the independent review fixes. Job times were:

| Job                     | Seconds            |
| ----------------------- | ------------------ |
| Change scope            | 7                  |
| Static                  | 62                 |
| Unit 1, 2, 3            | 93, 63, 90         |
| Integration 1, 2, 3, 4  | 148, 106, 137, 113 |
| Image smoke, cold cache | 137                |
| Workflow lint           | 5                  |
| Check                   | 5                  |

The tuned document-only benchmark follows this passed source push. Its result
and the final review state are in [PR 419](https://github.com/tidynotebook/tidynotebook/pull/419).

The [review follow-up source push](https://github.com/tidynotebook/tidynotebook/actions/runs/39596452406)
passed on commit `bf458cdef5c9b05407d94c3284076e3ba7d0a923`. It adds the indirect
notice and workspace build inputs to image scope and uses the PR base first
for document diffs. The earlier [tuned document push](https://github.com/tidynotebook/tidynotebook/actions/runs/39596184816)
passed in 40 seconds: scope took 7 seconds, Static took 16 seconds and Check
took 5 seconds. A final audit-only push repeats that measurement after the
review follow-up passed. PR 419 holds that final result.
