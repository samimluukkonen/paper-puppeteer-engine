---
name: architecture-plan
description: Write the next plans/architecture-NN-<slug>.md candidate in this repository's house format. Use when turning an architecture review, codebase-design scan or code-review finding into a plan. Writes the plan only; never implements it.
argument-hint: <topic or finding>
allowed-tools:
  - Bash(ls *)
  - Bash(git rev-parse *)
  - Bash(git log *)
  - Bash(date *)
---

# Write an architecture candidate plan

Topic: $ARGUMENTS

## Current state

Existing plans:

!`ls plans`

Current commit:

!`git rev-parse --short HEAD`

Today:

!`date +%F`

## Rules

1. **Number.** Use the highest `architecture-NN` number above plus one, written with two digits. Never reuse a gap left by a removed plan.
2. **Filename.** Write `plans/architecture-NN-<slug>.md`, with a short kebab-case slug naming the change, for example `architecture-19-inspector-escaping-and-frame-allocations.md`.
3. **Source line.** Name where the candidate came from (an architecture review, a codebase-design scan, a code-review skill run on a commit range, or a review of an earlier plan), the date, and "measured at `<current commit>`". Add a sentence if the items are independent and can each land as their own commit.
4. **Check the evidence.** Before writing a `path:line` reference, a member count or a call-site claim, read the current code and confirm it. Cite the code as it is at the current commit.
5. **Shape.** Follow [template.md](template.md). Keep the sections in its order. Add "Out of scope" or "Rejected approach: …" sections only when they record a real decision.
6. **Constraints.** Say whether the change is behaviour-preserving, which checks must stay green, and where the changelog entry goes: under Unreleased as plain bullets matching the existing entries, unless the plan belongs to a versioned milestone.
7. **Verification.** List the exact commands. Tests run sequentially with one worker (`npm test`, or `npx vitest run --maxWorkers=1 <file>` for one file). Browser checks are local-only; do not put them in CI.
8. **Recorded decisions.** Leave the section with a placeholder line. It is filled in when the plan is implemented.
9. **Scope.** Write the plan file only. Do not change code, the changelog or the package version. `plans/` is excluded from oxfmt, so do not run the formatter on it.

When the file is written, tell the user its path and a one-line summary of each numbered problem.
