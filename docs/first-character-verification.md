# First character workflow verification

[Creating Your First Character](creating-your-first-character.md) · [Artist workflow](artist-workflow.md)

This implements the v0.6.6.3 workflow plan against the current repository version. Library and authored schema versions remain unchanged. Existing character assets, dependencies and CI workflows are untouched.

## Artist and animation workflow

Use **+ New Character**, enter a name/ID, add bones and slots in **Build skeleton**, position joints, import transparent artwork, create attachments, align artwork and assign the `default` skin. Switch to **Animation Editor**, choose **+ New Animation**, add transform keys and preview playback. Download individual animation JSON if needed, then download the complete character ZIP. Reload or import that ZIP into the runtime preview; extract its contents into another application's served character directory.

The existing New Animation implementation already accepts the minimal new-character rig and an empty clip catalog. Shared-scene topology reconstruction updates the animation rig when artists add bones. Both views retain the same rig state, standalone skins, artwork controller and per-clip animation documents. No alternative creation or playback system was introduced. Rig, skin, artwork, individual clip and package checkpoints retain their independent history and dirty semantics.

## Export and validation

`buildCharacterPackage` captures detached authored snapshots and immutable image blobs. It allocates ordinary relative filenames for new clips, skins and imported images, then emits the existing version-1 manifest, rig, skins and animation formats. Attachments remain in the rig. Character packages include actual image bytes. No new manifest format or editor-specific runtime loading mode is used.

Metadata now passes `CharacterDefinition.fromData` using the actual generated documents and manifest paths before source image fetching. This reports hierarchy, bone/slot/attachment IDs, skin references, missing textures and animation bone errors without unnecessary image requests. Duplicate standalone skin names are explicitly rejected, including newly named skins that would otherwise be overwritten while constructing the manifest map. Final package validation still uses CharacterLoader, local path policies, complete file checks, image headers, budgets and browser image decoding before ZIP download.

`packageDraftWarnings` provides nonblocking guidance for root-only skeletons, absent attached artwork, absent clips and unassigned default slots. Explicitly hidden slots remain intentional. Content guidance does not declare metadata or images valid; the panel says **Ready for export validation** until the existing export validators run. Structurally valid empty/sparse drafts remain compatible runtime packages; invalid production packages fail with named paths/references. Failed exports retain authored sessions and checkpoints.

PackageController reuses authored domain fingerprints to avoid recomputing guidance on playback ticks. It publishes only changes in dirty domains or guidance, and invalidates the assessment on bind, package checkpoint and teardown.

## CharacterLoader and lifecycle

The new automated round trip creates a character from the editor factory, builds bones and a default skin, adds character-owned PNG bytes, creates two clips, exports ZIP bytes and loads the extracted files at a different URL through the ordinary CharacterLoader. Puppet plays both clips and samples the expected transforms. Source definitions, working clips and dirty/history state remain intact; no source-artwork fetch is required. Existing suites cover both demo-puppet and random-paperdoll-sketch.

Runtime previews retain the existing independent Phaser game, cancelable loading and disposable URL lease. Shutdown destroys puppets and consumers before URL release. Animation-free package previews now show a disabled **No animations** option. No new global listener or rendering owner is introduced. Existing shared-scene tests assert stable subscriber counts over repeated structural rebuilds, then shutdown cleanup. New browser coverage repeatedly opens/closes exported and imported fresh-character previews while retaining the authored workspace.

## Files and APIs

| Area                              | Files / APIs                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Early production validation       | `characterPackage.ts`: `buildCharacterPackage`                                                             |
| Draft guidance                    | New `packageDraftWarnings.ts`: `packageDraftWarnings`; `PackageController` snapshot `draftWarnings`        |
| React package UI                  | `PackagePanel.tsx`: readiness guidance and animation-free preview selection                                |
| Automated workflow and validation | New `firstCharacterWorkflow.test.ts`; `characterPackage.test.ts`                                           |
| Local browser workflow            | Extended `browser/rigBuilding.spec.ts` and animation-free preview checks in `browser/newCharacter.spec.ts` |
| Artist documentation              | New `creating-your-first-character.md`, README and artist/rig guide links                                  |

## Verification

| Command                | Result                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | Exit 0                                                                                                                                         |
| `npm run test`         | Exit 0; 154 files passed, 4 skipped; 2,707 tests passed, 44 skipped                                                                            |
| `npm run build`        | Exit 0; demo, library, declarations and Node core checks passed                                                                                |
| `npm run test:package` | Exit 0; packed consumer API/declaration/documentation checks, 2 standalone Node tests and standalone strict TypeScript/production build passed |
| `npm run lint`         | Exit 0                                                                                                                                         |
| `npm run format:check` | Exit 0                                                                                                                                         |
| `git diff --check`     | Exit 0                                                                                                                                         |

The final targeted browser command exited 0: **40 passed**, 20 each against development and production, in 10.5 minutes:

```sh
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/rigBuilding.spec.ts \
  tests/browser/newCharacter.spec.ts \
  tests/browser/newAnimation.spec.ts \
  tests/browser/characterPackage.spec.ts \
  tests/browser/characterWorkspace.spec.ts \
  tests/browser/characterSelection.spec.ts \
  tests/browser/animationRigTweak.spec.ts
```

These seven suites exercise first-character construction, real PNG import/alignment, default assignment, new animation keys, independent exports and dirty states, Undo/Redo, navigation guards, exact ZIP bytes, saved ZIP import, animated canvas output, repeated preview cleanup and both existing characters. The full root browser suite was not run.

The initial browser launch was blocked by sandbox localhost restrictions; local server access allowed testing. An earlier development playback comparison failed during concurrent Vite source edits. A two-worker experiment hit startup timeouts and was stopped. The final passing command uses stable source and the repository's normal single-worker configuration.

Standalone browser verification also exited 0: **3 passed, 1 skipped**, after its strict TypeScript check and production build. The skip is the existing optional release-workflow handoff, which requires `PPE_WORKFLOW_CHARACTER_DIR`; the three standard runtime scenarios all ran. They cover direct playback, events, skins, FIFO/state/action/async controls, disposal and interrupted loading.

The example checkout has the packed engine but no local build-tool binaries. Its initial command failed with `tsc: command not found`; rerunning with the repository's Node 24 and root `node_modules/.bin` on PATH passed. The portable equivalent, starting at the repository root with Node 24 selected, is:

```sh
PPE_TOOLS="$PWD/node_modules/.bin"
cd examples/standalone
PATH="$PPE_TOOLS:$PATH" PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

Builds retain the two existing non-fatal `lucide-react` module-level `use client` warnings. Browser checks use installed Chrome; no browser installation or browser tests were added to CI.

No human manual UI pass has been performed. Playwright exercises the real React controls, Phaser canvas, downloads, CharacterLoader and Puppet locally; it is automated browser verification. Browser tests remain local-only.

## Remaining limitations

Image bytes and Undo/Redo history are session-only. JSON recovery is not durable project storage. ZIP import opens a runtime preview rather than an editable workspace and accepts the editor's stored ZIP subset. Empty rigs and sparse skins may be intentionally valid drafts; content guidance is not an artistic completeness requirement. Texture keys must remain unique in host scenes. Existing restrictions on renaming animation/IK-referenced bones remain. Templates, AI artwork, auto-rigging, meshes, physics and choreography are outside this work.
