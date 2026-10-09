---
name: design-change
description: Records an architectural choice in the core before code changes. Use when a change moves a boundary, changes a save or migration model, or changes what a verification gate proves. It does not implement the choice.
---

# Design change

Start with the prepared context and the proposed architectural change.
Read `docs/README.md` and the affected code. State the options and their costs.
For a large change, write a design, its decision records, and an ordered plan.
For a small choice, use the decision template only. Link each plan row to its
board issue. Use session authorization for routine choices. Ask only when a
required choice remains open. End when the choice and its scope are recorded.
