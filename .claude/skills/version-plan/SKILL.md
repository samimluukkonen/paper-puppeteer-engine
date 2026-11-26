---
name: version-plan
description: Write plans/plan-vX.Y.Z[.W].md for a feature milestone in this repository's version-plan format. Use when turning a feature goal and a milestone version into a plan. Writes the plan only; never implements it.
argument-hint: <vX.Y.Z[.W]> <goal>
allowed-tools:
  - Bash(ls *)
  - Bash(git rev-parse *)
  - Bash(git log *)
  - Bash(node -p *)
  - Bash(grep *)
  - Bash(date *)
---

# Write a version plan

Arguments: $ARGUMENTS

## Current state

Existing plans:

!`ls plans plans/archive`

Package version:

!`node -p "require('./package.json').version"`

Latest changelog headings (line numbers in `CHANGELOG.md`):

!`grep -n -m 15 '^## ' CHANGELOG.md`

Current commit:

!`git rev-parse --short HEAD`

Today:

!`date +%F`

## Rules

1. **Version.** The first argument is the milestone, written `vX.Y.Z` or `vX.Y.Z.W` (the `v` is optional). If no version is given, stop and ask for one. Do not guess it.
2. **Filename.** Write `plans/plan-v<milestone>.md`, for example `plans/plan-v1.6.7.md` or `plans/plan-v1.6.2.3.md`. If that file already exists in `plans/` or `plans/archive/`, stop and ask whether to pick another version or to revise the existing plan.
3. **Changelog target.** Map the milestone to its SemVer heading with the table in `.claude/skills/implement-plan/SKILL.md` (`1.6.2.2` → `1.6.2-2`). Say in the plan's Verification or Definition of done that the changelog entry goes under that heading. If the milestone is lower than the package version above, say that the package version stays unchanged.
4. **Inspect first.** Before writing, read the code the goal touches and the most recent version plan. Name the real modules, editors and documents in the "Inspect current systems" section, and check every `path:line` or symbol you cite against the current code.
5. **Shape.** Follow [template.md](template.md) and keep its section order. Copy the preamble (stack, existing systems, product context) from the latest version plan and update it, and set "Current completed version" to the latest completed milestone.
6. **Repository rules.** The plan keeps tests sequential with one worker, browser smoke tests local-only and out of CI, dependency audits manual, and views desktop-only. UI work uses the shared `ViewHeader`, keeps inspector sections collapsed by default and uses the animator editor's visual style.
7. **Verification.** List exact commands that exist in `package.json`, run one at a time: for example `npm run check`, `npm test` and `npm run build:lib`, or `npx vitest run --maxWorkers=1 <file>` for one file. Browser checks are local-only.
8. **Scope.** Write the plan file only. Do not change code, the changelog or the package version. `plans/` is excluded from oxfmt, so do not run the formatter on it.

When the file is written, tell the user its path, the changelog heading it targets, and a one-line summary of each numbered section.
