# Standalone Phaser consumer

This is a separate Vite/TypeScript application. It imports `paper-puppeteer-engine/runtime` from an installed package and contains no editor imports or checkout aliases. Use Node 24 or newer.

From the repository root:

```sh
npm pack --pack-destination dist
cd examples/standalone
npm install
npm run test
npm run build
npm run dev
```

`npm pack` runs the library build and creates `dist/paper-puppeteer-engine-0.7.2.tgz`, which this project's package manifest installs. Nothing is published. To move the example elsewhere, copy this directory and adjust that tarball dependency to its new location before installing.

The checked-in `public/character/` folder is an extracted character export. It includes an edited idle key, walk and sword events, authored and baked IK reach clips, several skins/attachments, and helmet artwork replacing the default head. The root integration test re-exports its representative editor snapshot through the existing exporter and checks these files. The Node test loads this fixture using the installed `/core` API, checks motion/events and verifies every image exists.

To try your own character, download a character ZIP in either editor, extract it into `public/character/` with `character.json` at that folder's root, and rebuild. This sample expects `idle`, `walk`, `sword`, `reach` and `baked` clip names; controls for absent optional clips are disabled. Change the initial idle name in `src/main.ts` for a different convention. Skin controls use the loaded definition's actual skin names. Character filenames and runtime texture keys remain those from the export.

The browser demonstrates automatic scene updates, crossfades, animation event delivery, skin switching and cleanup. Switching resets the default skin then overlays the selected sparse skin, matching the editor and retaining unlisted body parts; explicit cleared slots remain empty. **Clean up** stops the scene (canceling pending loading and destroying the puppet/subscriptions), then destroys the game and its textures. Reload to start again. It owns the whole game; a shared-game application must retain textures while any other scene/puppet uses them.

Optional local browser verification, after installing a supported Playwright browser:

```sh
npm run test:browser
# Or use installed Chrome:
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

These tests serve the production build under `/consumer/`, exercise clips, events, appearance and disposal, and cancel an unfinished load. They remain local-only. Root `npm run test:package` runs this example's actual `test` and `build` commands in a temporary directory against the packed library, reusing installed build tools offline; it does not run browser tests.

The root local `tests/browser/releaseWorkflow.spec.ts` scenario saves `release-character.zip` in its test output. Extract that exact ZIP into a temporary directory, then enable the optional handoff scenario:

```sh
PPE_WORKFLOW_CHARACTER_DIR=/absolute/path/to/extracted-character PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

This additional scenario expects the workflow's `reach` clip, `release-cue` event and `release-alternate` skin. It serves the extracted files to the independently built app, verifies motion before/after sparse skin switching, events and disposal. Without the environment variable, only this optional handoff scenario is skipped; the two standard consumer scenarios still run. No editor source is imported into the consumer.

See the [developer integration guide](../../docs/runtime-integration.md) and [artist workflow](../../docs/artist-workflow.md).
