# v0.6.4 character packaging and runtime integration verification

Historical verification report: the standalone `examples/` application has since been removed. Its commands and results below describe the recorded release, rather than the current checkout. See the [runtime integration guide](runtime-integration.md) for current usage.

[All guides](../README.md#guides) · [Developer guide](runtime-integration.md) · [Artist guide](artist-workflow.md)

Verified locally on 2026-10-15 using Node 24.19.0 and npm 11.17.0. Library version is `0.6.4`; authored manifest, rig, skin, animation and pose formats remain version `1`. Existing export/loading systems, relative paths and identifiers are retained. No npm publication, remote release, new runtime dependency or CI browser step was added.

## Package audit and validation results

The representative extracted export in `examples/standalone/public/character/` contains 33 files: `character.json`, `rig.json`, six animation files, three standalone skin files, one pose file and 21 PNG binaries. Rig JSON contains bones, IK, slots, attachment definitions and embedded skins. Manifest entries resolve relative to the manifest directory; bone/attachment texture references resolve through manifest keys. Existing animation paths remain intact, including `animations/combat-idle.json` for the clip named `sword`. New reach/baked clips use ordinary generated animation paths.

The fixture comes from actual Rig Editor/Animation Editor state snapshots through `buildCharacterPackage`, including an authored idle rotation key, walk/sword event payloads, authored reach IK and a real bake using `sampleIKBake` → `generateBakedBoneKeys` → `commitIKBake`. Helmet artwork replaces the default head while preserving its texture identity. Integration tests compare checked-in JSON semantically and image binaries byte-for-byte with freshly exported data.

| Validation area                               | Result                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Rig, animation, skin, pose and image presence | Every manifest reference resolves; missing files reject                                                                                       |
| Format versions and cross-file compatibility  | Unsupported versions, unknown track bones/slots/attachments and duplicate identities reject                                                   |
| Relative paths                                | Relocation under another application's nested URL works, including existing space/Unicode path coverage                                       |
| Unsafe paths                                  | Absolute paths/URLs, traversal, encoded aliases, backslashes, queries, fragments and ambiguous segments reject                                |
| File layout                                   | Case-insensitive duplicates, metadata/image collisions and file/directory collisions reject before preview/ZIP success                        |
| Images and frames                             | PNG/WebP headers and budgets checked; browser decoding succeeds for valid artwork and rejects corrupt bodies; unsupported atlas frames reject |
| Shared images                                 | Aliases fetch, budget and decode one physical image once; replacing one alias preserves the others                                            |
| Portability                                   | Representative JSON contains no blob URLs, private artwork keys, local development URLs/paths or editor/runtime objects                       |
| Failure/cancellation                          | Existing snapshots/checkpoints stay intact; image decode URLs and runtime preview leases dispose                                              |

The implementation reuses the existing file-layout validator for pre-preview validation, ZIP encoding and ZIP decoding, adding file/directory collisions to that shared boundary. Image alias accounting/fetch reuse is corrected in the existing exporter/validator. Browser export performs actual image decoding; Node checks metadata and headers and does not claim full image decoding.

## Standalone architecture and public APIs

`examples/standalone` is a separate Vite/strict TypeScript project with its own manifest, build/test commands, HTML entry, served export and optional local Playwright checks. It imports Phaser and `paper-puppeteer-engine/runtime` by package name. The packed-package check copies this actual project into a temporary directory, resolves the freshly packed/installed engine, and runs its `npm run test` and `npm run build` commands. The checkout supplies installed build tools through PATH; no engine source alias substitutes for the installed package. Runtime dependency tests enforce editor isolation for the real standalone entry as well as the engine graph.

The browser uses `loadSceneCharacter` to complete metadata and artwork loading, constructs `new Puppet(scene, { definition, x, y })`, subscribes with `onAnimationEvent`, and plays `idle`, `walk`, `sword`, `reach` and `baked` through `play`. Crossfades use `fadeDuration: 150`. Skin controls call `setSkin`; integration tests also exercise `setAttachment`. Default scene updates advance animation automatically. Cleanup aborts DOM handlers, unsubscribes animation events, destroys the puppet on scene shutdown, then destroys the exclusive game/texture manager. It also removes top-level DOM/pagehide handlers. Pending loading cancels on scene stop.

The Node consumer test imports `/core`, loads the extracted export with a file-backed fetcher, evaluates the edited key with floating-point tolerance, advances clips/events and verifies binary presence and disposal. Public entry points and declarations remain unchanged; packed checks cover root, `/runtime`, `/core`, `/data` and `/serialization`, including browser bundle isolation and full core declaration checking.

The [developer guide](runtime-integration.md) contains excerpts from the compiled consumer source and documents loading sequence, scene lifecycle, texture ownership, coordinates, automatic/manual updates, event cleanup and publishing prerequisites. The [artist guide](artist-workflow.md) covers preparation, alignment, rigging, animation, replacements, export and standalone handoff. The standalone README contains actual setup, build, test and local browser commands.

## Files changed

| Files                                                                                                                     | Purpose                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/devtools/shared/package/characterPackage.ts`                                                                         | Complete pre-preview file checks and shared-image fetch/budget/decode accounting                                          |
| `src/devtools/shared/package/packageZip.ts`                                                                               | Shared file-layout validation and file/directory collision rejection                                                      |
| `tests/characterPackage.test.ts`                                                                                          | Collision, alias, supported-version and compatibility regression coverage                                                 |
| `tests/characterRuntimeIntegration.test.ts`, `tests/helpers/consumerCharacter.ts`                                         | Representative editor export, relocated load, authored/loaded motion/events, artwork, skins and lifecycle                 |
| `tests/runtimeBoundaries.test.ts`                                                                                         | Enforce installed public API imports in the standalone entry                                                              |
| `examples/standalone/{package.json,tsconfig.json,vite.config.ts,index.html,README.md}`                                    | Independent consumer configuration and instructions                                                                       |
| `examples/standalone/src/{main.ts,env.d.ts,style.css}`                                                                    | Public runtime app, CSS declaration and presentation                                                                      |
| `examples/standalone/test/{character.test.mjs,runtime.spec.ts}`, `examples/standalone/playwright.config.ts`               | Installed core test and local production browser coverage                                                                 |
| `examples/standalone/public/character/**`                                                                                 | 33 exported metadata and binary fixture files                                                                             |
| `scripts/check-package.mjs`                                                                                               | Run the actual independent consumer commands against the tarball and retain new guides                                    |
| `.oxlintrc.json`                                                                                                          | Exclude the independently installed project from root lint; its own strict types are checked by the packed consumer build |
| `package.json`, `package-lock.json`                                                                                       | Version `0.6.4`                                                                                                           |
| `README.md`, `CHANGELOG.md`, `docs/development.md`, `docs/artist-workflow.md`, `docs/runtime-integration.md`, this report | Workflow, architecture, verification and release documentation                                                            |

The user-provided `plans/archive/plan-v0.6.4.md` is retained unchanged. Build outputs, local installed tarball files and browser artifacts are ignored rather than added as source.

## Exact command results

All final commands below exited `0`:

| Command (from repository root)                                                         | Result                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                    | Passed                                                                                                                                |
| `npm run test`                                                                         | 144 files passed, 3 skipped; 2,431 tests passed, 32 skipped                                                                           |
| `npm run build`                                                                        | Demo and library/declarations built; built Node entry checks passed                                                                   |
| `npm run test:package`                                                                 | Tarball install, documentation links, Node APIs, core/browser declarations, browser isolation and actual standalone test/build passed |
| `npm --prefix examples/standalone run test`                                            | 1 passed                                                                                                                              |
| `npm --prefix examples/standalone run build`                                           | Strict consumer typecheck and Vite production build passed                                                                            |
| `PLAYWRIGHT_CHANNEL=chrome npm --prefix examples/standalone run test:browser`          | 2 passed against production assets under `/consumer/`                                                                                 |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/characterPackage.spec.ts` | 6 passed across development/production editors                                                                                        |
| `npm run lint`                                                                         | Passed                                                                                                                                |
| `npm run format:check`                                                                 | Passed                                                                                                                                |
| `git diff --check`                                                                     | Passed                                                                                                                                |

The demo build emits existing third-party `lucide-react` module-directive warnings; the build succeeds. Local browser startup required running outside the sandbox to bind localhost and launch installed Chrome. No browser installation or browser test step was added to CI.

## Unverified behavior and v0.6.5 release follow-up

A human visual review of artwork/pivots, arbitrary third-party character exports and other browsers/devices was not performed. Automated Chrome coverage verifies the representative export and existing PNG/WebP editor round trips; it does not establish pixel-perfect behavior for every character or GPU. Node validation alone does not decode image bodies. The complete unrelated browser suite was not run.

Before a future v0.6.5 release, complete the desired human visual/browser review, select and include a license, supply repository/author/license package metadata, decide registry/access/provenance and perform an explicit release review. Publication and remote releases remain manual, separately authorized actions. This integration introduces no new choreography, game behavior, physics, mesh deformation or content-generation system.
