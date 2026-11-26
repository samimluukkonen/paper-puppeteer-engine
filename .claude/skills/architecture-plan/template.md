# Architecture plan template

Copy this skeleton into `plans/architecture-NN-<slug>.md` and replace every placeholder in angle brackets. It is taken from the existing architecture plans, for example `plans/architecture-19-inspector-escaping-and-frame-allocations.md`.

```markdown
# Architecture candidate NN — <title in sentence case>

Continue developing Paper Puppeteer Engine.

Source: <origin> on <YYYY-MM-DD> (measured at `<commit>`). <Optional: These are N independent, small items. Each can land as its own commit.>

## Problem

1. **<One-sentence statement of the defect or duplication.>** `<symbol>` in `<path>:<line>-<line>` <what it does today, with call sites and counts>. <Why it matters: the bug it causes, the rule it breaks, or the cost it adds.>

## What to build

1. **<The change, as an imperative sentence.>** <Concrete API or module shape, the files it touches, and what it replaces.>

   <The test that proves it: what it renders or calls, and what it asserts.>

## Out of scope

- <Something nearby that this plan deliberately leaves alone, and why.>

## Constraints

- <Behaviour-preserving, or the exact behaviour that changes.>
- <Existing contracts that must stay: public API, notification order, `npm run build:lib` (`scripts/check-core.mjs`), lint boundaries.>
- Changelog under Unreleased, as plain bullets matching the existing entries (there are no Fixed/Security subheadings).

## Verification

- `npm run check`, `npm run test` (sequential, one worker), `npm run build:lib`.
- <New or changed tests by file name.>

## Acceptance

- <Observable end state, one bullet per problem.>
- Full test suite passes.

## Recorded decisions

- <Filled in during implementation: what was kept or reverted, why, the date and the commit it was measured at.>
```

Optional sections, used only when they record a real decision:

- `## Rejected approach: <name>`, placed after "What to build", explaining an alternative that was considered and why it lost.
- `## Target semantics`, a table in which each row is a behaviour that gets its own test.
