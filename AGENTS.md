# Repository preferences

- Follow the [GitHub / Primer UI style guide](docs/style-guide.md) in every view. Use the shared `ViewHeader`; do not create page-specific header implementations.
- When following a plan with a version number, write its changelog entry under that version's heading, not under Unreleased. Follow the changelog's existing SemVer convention (for example, plan `v0.9.8.2` uses heading `0.9.8-2`).
- Use the animator editor's visual style consistently in every view, especially the new scene editor.
- Inspector sections in both editors must start collapsed by default.
- Target desktop views only. Do not add or suggest mobile layout support or mobile-specific verification unless the user explicitly changes this preference.
- Browser smoke tests (Playwright) are local-only. You may run them locally when useful.
- Do not add browser smoke tests or browser installation steps to CI.
- Do not suggest browser smoke tests in CI when reviewing possible improvements. This is an explicit user preference; revisit it only if the user explicitly changes it.
- Do not add or suggest periodic dependency auditing, including scheduled CI audits. Keep dependency audits manual or triggered by pushes and pull requests. Revisit this preference only if the user explicitly changes it.

See [the development guide](docs/development.md#checks-and-profiling) for local browser test commands.
