# Version plan template

Copy this skeleton into `plans/plan-v<milestone>.md` and replace every placeholder in angle brackets. It is taken from the existing version plans, for example `plans/plan-v1.6.5.md` and `plans/plan-v1.6.2.2.md`.

```markdown
# Paper Puppeteer Engine — v<milestone>
## <Subtitle in title case>

Continue developing Paper Puppeteer Engine.

**Current completed version: v<latest completed milestone>**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing:
- <Systems this milestone builds on, copied from the latest version plan and updated.>

## Goal

<Two to four sentences: what the artist or consumer can do after this milestone, and why.>

## 1. Inspect current systems

Review:
- <Module, editor or document the change touches, with its path.>

Reuse existing <loaders, commands, lifecycle mechanisms> instead of adding parallel ones.

## 2. <First work area>

<What to build, as short imperative sentences or a numbered sequence. Name the behaviour that must not change.>

## <N>. Tests

Cover:
- <One bullet per behaviour that gets a test.>

## <N + 1>. Out of scope

Do not implement:
- <Nearby work this milestone deliberately leaves alone.>

## <N + 2>. Verification

Run, one at a time:
- `npm run check`
- `npm test`
- `npm run build:lib`

<Other exact commands, such as `npm run build` or `npm run check:demo`. Browser checks such as `npm run test:browser` are local-only.>

Write the changelog entry under `## <semver heading>`.

Fix failures.

## Definition of done

<One paragraph or a short list: the observable end state.>

## Final report

Explain <the design decisions to report>, files changed, tests and exact command results.
```

Use `###` subsections inside a work area only when it has distinct steps or scenarios, as the scenes in `plans/plan-v1.6.6.md` do.
