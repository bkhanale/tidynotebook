# 0221. Save latency is an advisory target

- Status: Accepted
- Date: 2026-10-13

## Context

The service stress check in `tools/performance/service.ts` uses simultaneous
full note checkpoints. Its Save target has no hardware calibration or
browser latency basis. Local and hosted results differ. The owner asks that
this target stop blocking source preparation without hiding failures.

## Decision

Save latency is an advisory target. The service check keeps its workload,
sample count, percentile and target. Its report states each target miss.
Search latency and the initial JavaScript budget remain blocking.

An execution failure or an invalid or incomplete measurement remains fatal.
`tools/performance/service-policy.ts` decides the service result.
`tools/service-performance-policy.test.mjs` proves both policies and refusals.
No workflow ignores the exit status of the service command.

## Consequences

A Save target miss permits landing while it stays visible in the report.
[Issue 326](https://github.com/tidynotebook/tidynotebook/issues/326) stays open
for hardware and browser calibration. This decision changes no application
Save behavior and claims no passing Save target. Historical failed results
stay intact. The source, image and correctness gates remain mandatory.
