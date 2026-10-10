---
name: maintain-project
description: Updates a named core dependency, rule, guide, or scheduled maintenance item through the normal change units. Use for a specific maintenance request. It does not clean the owner machine or start a release.
---

# Maintain project

Start with the named maintenance scope. Prepare its context. Check the current
source and the upstream primary source when the dependency needs it. Change only
the owned inputs. Use build, prove, and land units under session scope.
End when the maintenance change lands or its stated review result is complete.
Never invoke the owner-only cleanup skill as maintenance.
