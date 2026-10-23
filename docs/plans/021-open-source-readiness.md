# Open source readiness

Status: active

Use [Open issues](https://github.com/tidynotebook/tidynotebook/issues) for
current work, under [decision 0234](../decisions/0234-public-issues-are-the-work-entry-point.md).
Issue list order does not define priority. Milestones, priority labels, and
area labels describe the intended work. This plan applies the existing license
and launch decision to the findings of the
[audit](../audits/2026-10-11/open-source-readiness.md) and the later
[public material review](../audits/2026-10-11/public-material-review.md).
The [control guide](../development/open-source-launch.md) gives the launch
checks and readback commands. The design is
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decisions

- [0188. The repository opens under AGPL-3.0-only](../decisions/0188-the-repository-opens-under-agpl-3-0-only.md)
- [0186. The open core holds no billing](../decisions/0186-the-open-core-holds-no-billing-and-a-private-service-sells-the-cloud.md)
- [0212. Agent lifecycle uses exact input proof](../decisions/0212-agent-lifecycle-proof.md)

- [0223. Core source opens before distribution](../decisions/0223-core-source-opens-before-distribution.md)
- [0234. Public issues are the work entry point](../decisions/0234-public-issues-are-the-work-entry-point.md)

Source opening follows this plan. Image publication and cloud launch remain
separate work. Their rights and risk checks do not become accepted through
source opening.

## Ordered work

Each issue has the launch milestone, a priority label and an area label. A
completed local change still needs proof and landing. A new boundary or gate
policy needs a decision record before its implementation.

| Item | Issue                                                          | Result                                                                                                            | State                                                                                        |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | [315](https://github.com/tidynotebook/tidynotebook/issues/315) | Correct the public setup and current documents. Add community files and configuration tests.                      | Complete. PR 322 lands the proved source and image.                                          |
| 2    | [316](https://github.com/tidynotebook/tidynotebook/issues/316) | Close or resolve each dependency finding under the version policy.                                                | Complete. PR 323 lands the fixes and refusal tests with no dependency advisories.            |
| 3    | [317](https://github.com/tidynotebook/tidynotebook/issues/317) | Retain the required notices in source and shipped output. Prove the actual shipped license graph and source path. | Open.                                                                                        |
| 4    | [318](https://github.com/tidynotebook/tidynotebook/issues/318) | Review history, images, comments, logs, archives and release material for public use.                             | Retained-material review is complete. Its audit and proof still need landing.                |
| 5    | [319](https://github.com/tidynotebook/tidynotebook/issues/319) | Set and read back the public GitHub controls and contributor access path.                                         | CI, alerts and security fixes are enabled and read back. Public controls remain.             |
| 6    | [320](https://github.com/tidynotebook/tidynotebook/issues/320) | Prove a fresh standalone checkout, final source, image and self-hosted setup.                                     | Open for the final candidate.                                                                |
| 7    | Record 0223                                                    | The owner opens the core source.                                                                                  | Complete. The owner opened the source on 2026-10-15. Release and deployment remain separate. |

## Checklist

### Rights and source

- [x] The accepted decision selects AGPL-3.0-only and states existing ownership.
- [x] The root license, manifests and contracts agree.
- [x] The DCO check proves the outside contribution rule.
- [ ] Required copied and bundled notices reach each distributed artifact.
- [ ] The shipped license graph has a recorded compatibility and source review.
- [x] The owner accepts a separate core package for future compliant images.
- [ ] The image policy uses that package and keeps the old package private and intact.
- [x] Old package access is separate from the public core, with required private grants and every fixed version retained.

### Community and setup

- [x] README, contribution guide, changelog and security policy exist.
- [x] The code of conduct, issue templates and PR template are present.
- [x] The maintainer role and a direct private report contact are stated.
- [x] The account, save, key and image descriptions are correct.
- [x] Regression tests prove the quick start and image CI Compose settings.
- [x] The changed guide pages have light and dark evidence in PR 322.
- [x] The contribution and setup changes land.
- [ ] A fresh clone with no private consumer completes the self-hosted setup.

### Security and public material

- [x] An all-ref secret scan is checked against historical source.
- [x] An issue, PR and issue-comment text scan is checked.
- [x] Compatible dependency fixes remove the high-severity findings in this branch.
- [x] The remaining transitive advisories have fixes and refusal tests in PR 323.
- [x] PR review comments, available attachments, screenshots and old logs are reviewed.
- [x] The retained material follows the accepted ownership and intact-history decisions.
- [ ] The final source, image and release assets pass a fresh secret review.
- [ ] The final runner and native library inventory has a primary advisory review, with fix and coverage limits stated. Future image publication needs its own retained-risk disposition.

### GitHub and launch

- [x] Workflow actions use full commit pins and default token access is read-only.
- [x] The DCO target job uses only the base script.
- [ ] Public branch controls fit the accepted landing path and refuse force pushes.
- [ ] Dependency alerts, secret protection and private reporting are enabled and read back where available.
- [x] The issue path and owner administrator access are checked without exposing cloud work.
- [ ] The source and image gates pass for the exact final candidate.
- [ ] GitHub checks pass for that head, including the image and performance jobs.
- [ ] [Issue 326](https://github.com/tidynotebook/tidynotebook/issues/326) calibrates Save latency on supported hardware and in the browser. Save target misses remain visible and advisory under [record 0221](../decisions/0221-save-latency-is-an-advisory-target.md). Search stays blocking.
- [x] The owner opened the core source on 2026-10-15 under record 0223.
- [ ] An unauthenticated reader can get the public source and source guide after the visibility switch.
- [ ] An anonymous old-image pull fails, and every retained version identity matches the saved private readback.

### Future image publication

These checks belong to a separate authorized publication. They do not block
source opening and do not claim that the new core package exists.

- [ ] Each published image maps to accessible corresponding source and build inputs.
- [ ] Current image security review and retained-risk disposition are accepted.
- [ ] An unauthenticated reader can pull the new core package at its fixed digest.

## Close an item

Save proof in the lifecycle context. Name the exact commit, the relevant
tests, the artifact and any remaining input. Keep raw scanner output private.
Update the issue and this plan when its result changes. Do not close an item
because a file exists when its required behavior has not been checked.
