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

`npm pack` runs the library build and creates `dist/paper-puppeteer-engine-1.0.5.tgz`, which this project's package manifest installs. Nothing is published. To move the example elsewhere, copy this directory and adjust that tarball dependency to its new location before installing.

The checked-in `public/character/` folder is an extracted character export. It includes an edited idle key, walk and sword events, authored and baked IK reach clips, finite attack/recovery clips and looping run, several skins/attachments, and helmet artwork replacing the default head. The root integration test re-exports its representative editor snapshot through the existing exporter and checks these files. The Node test loads this fixture using the installed `/core` API, checks motion/events and verifies every image exists.

To try your own character, download a character ZIP in either editor, extract it into `public/character/` with `character.json` at that folder's root, and rebuild. This sample expects `idle`, `walk`, `sword`, `reach` and `baked` clip names; controls for absent optional clips are disabled. State, action, FIFO and async controls additionally require `run`, `attack` and `recover`; they are disabled as a group when those clips are absent. Change the initial idle name in `src/main.ts` for a different convention. Skin controls use the loaded definition's actual skin names. Character filenames and runtime texture keys remain those from the export.

The browser demonstrates automatic scene updates, direct playback, queued attack/recover, walking/running states, temporary attack actions, async completion, wait cancellation, crossfades, animation event delivery, skin switching and cleanup. Lifecycle notifications are shown separately from authored markers. **Queue attack + recover** stops the current indefinite base loop before appending finite clips. **Cancel wait** releases the async wait while attack keeps playing. Async continuations check the playback ID before returning to idle. Scene shutdown aborts waits and unsubscribes/disposes the controller before destroying the puppet.

See the [complete API and interaction matrix](../../docs/runtime-controller-readiness.md) for exact precedence and safe result handling. Switching resets the default skin then overlays the selected sparse skin, matching the editor and retaining unlisted body parts; explicit cleared slots remain empty. **Clean up** stops the scene (canceling pending loading and destroying the puppet/subscriptions), then destroys the game and its textures. Reload to start again. It owns the whole game; a shared-game application must retain textures while any other scene/puppet uses them.

Optional local browser verification, after installing a supported Playwright browser:

```sh
npm run test:browser
# Or use installed Chrome:
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

These tests serve the production build under `/consumer/`, exercise clips, events, appearance and disposal, and cancel an unfinished load. Controller scenarios verify FIFO, one-shot return, async completion/cancellation and disposal while waiting. They remain local-only. Root `npm run test:package` runs this example's actual `test` and `build` commands in a temporary directory against the packed library, reusing installed build tools offline. To opt into its local browser suite against that same isolated install, run `PPE_PACKAGE_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome npm run test:package` from the repository root. The default package/CI checks do not run browsers.

The root local `tests/browser/releaseWorkflow.spec.ts` scenario saves `release-character.zip` in its test output. Extract that exact ZIP into a temporary directory, then enable the optional handoff scenario:

```sh
PPE_WORKFLOW_CHARACTER_DIR=/absolute/path/to/extracted-character PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

This additional scenario expects the workflow's `reach` clip, `release-cue` event and `release-alternate` skin. It serves the extracted files to the independently built app, verifies motion before/after sparse skin switching, events and disposal. Without the environment variable, only this optional handoff scenario is skipped; the four standard consumer scenarios still run. No editor source is imported into the consumer.

See the [developer integration guide](../../docs/runtime-integration.md) and [artist workflow](../../docs/artist-workflow.md).

## Two Actor choreography

Open `choreography.html` on the same server. Run Scene loads two instances of the shipped exported package, starts idle, walks them together concurrently, waits for both, faces them toward each other, plays `attack` then `recover`, returns to idle and disposes the scene resources. Run it again to repeat; Cancel Scene settles active actions and Clean Up destroys the game. `src/scriptedScene.ts` is a reusable runtime-only module matching `src/examples/choreography.ts` in the repository; package checks enforce this. Supply two manifest URLs and optional `{ idle, walk, action, response }` animation mappings for other packages. Shared textures remain host-owned.

The local `test:browser` suite covers repeated completion, cancellation during walking and game shutdown, as well as the existing Puppet-only controls. See the repository production guide for coordinate, ownership and interruption contracts.

## Authored scenes and scene ZIPs

Open `scene.html`. The page loads `public/scene.json` through the public `SceneLoader`, resolves the exported character dependencies, constructs independent Actors and advances `SceneRunner` from Phaser's delta clock. Play, Pause, Stop and the time slider use the same runner as the editor. No React or editor code is loaded.

Download a scene package ZIP from Scene Editor and choose **Open scene ZIP** here. The adapter validates the archive and all dependencies, creates temporary artwork URLs with private texture keys, and releases its Actors, URLs and private textures on replacement or shutdown. Hosted character textures remain shared and host-owned. You can also extract a ZIP under `public/my-scene/` and call `SceneLoader.load(scene, 'my-scene/scene.json')`, or load a hosted ZIP with `SceneLoader.loadPackage(scene, zipUrl)`.

The Node tests package and reload the shipped scene using installed `/core` exports. The optional local desktop browser test loads JSON, opens the generated ZIP, seeks, plays through its cue and cleans up. Root `npm run test:package` builds this actual page against the packed library without checkout aliases.

The root local `tests/browser/firstScene.spec.ts` creates a scene through the actual UI using two different character packages and retains `first-scene.zip` in its test output. Pass that exact export to the independent consumer verification (no source rewriting):

```sh
PPE_WORKFLOW_SCENE_ZIP=/absolute/path/to/first-scene.zip PPE_PACKAGE_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome npm run test:package
```

Run this command from the repository root after the browser workflow. It tests the exact exported package through the separately installed runtime’s `scene.html`, including seek suppression, cue delivery, completion and disposal. Without `PPE_WORKFLOW_SCENE_ZIP`, only this additional scene handoff scenario is skipped. See [Making Your First Scene](../../docs/making-your-first-scene.md).
