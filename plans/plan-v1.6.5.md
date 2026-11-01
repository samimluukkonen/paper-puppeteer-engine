# Paper Puppeteer Engine — v1.6.5
## Scene Transitions, Asset Loading & Story Export

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.6.4**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing:
- Linear StoryDefinition
- Story Editor and Story Player
- Dialogue holds and advance input
- Scene runtime
- Camera cuts/fades
- Audio scheduling
- Project asset registry
- Export/import
- CharacterLoader

## Goal

Make scene-to-scene playback reliable and portable.

A story should move automatically from one cinematic scene to the next without missing artwork, stale Actors, broken audio or timing glitches.

## 1. Inspect current systems

Review:
- Scene loading and disposal
- Project/asset manifests
- Shared textures
- Shared audio assets
- Character instances
- Scene transitions
- Runtime scene clock
- Story sequencing
- Existing package exporters

Reuse existing loaders and lifecycle mechanisms.

## 2. Scene handoff

When a scene completes:
1. Determine the next authored story entry.
2. Prepare the next scene.
3. Apply the configured transition.
4. Dispose the previous scene's owned runtime objects.
5. Begin the next scene using its own initial timeline state.

Do not keep old scene cues or Actor movement controllers active.

Do not skip the next scene's time-zero dialogue hold.

## 3. Transitions

Reuse existing camera/fade capabilities where appropriate.

Support a minimal set of story-entry transitions:
- Direct cut
- Fade through black/color

Define which scene owns the fade and when the next scene becomes visible.

Do not implement arbitrary shader effects or a new cinematic transition engine.

## 4. Preloading

Introduce practical preloading of the next scene's required assets.

When appropriate:
- Load required textures.
- Decode or prepare audio.
- Resolve character and animation packages.
- Validate dependencies before activation.

Avoid loading the entire story into GPU memory when it is unnecessary.

Start with current/next-scene preloading rather than sophisticated streaming infrastructure.

## 5. Shared asset lifecycle

A character, background or audio asset may be referenced by multiple scenes.

Use existing asset ownership/refcounting or equivalent lifecycle conventions.

Prevent:
- Premature disposal of shared textures
- Duplicate audio instances
- Stale Actor objects
- Leaked Phaser GameObjects
- Repeated unnecessary asset decoding

## 6. Audio continuity

Define behavior across scene boundaries.

By default:
- Scene-owned effects stop when their scene ends.
- Scene-owned ambience follows its documented lifetime.
- New scene music begins according to its authored timing.

If continuous cross-scene music is supported, use explicit ownership and continuity semantics.

Do not accidentally play two copies of the same music track.

## 7. Loading delays

A slow asset load must not cause the next cinematic scene to skip its beginning.

Do not advance the new scene's clock before the scene is ready.

Provide a simple loading state where necessary.

Avoid visible flashes between scene transitions.

## 8. Story packaging

Extend existing export/import to include:
- StoryDefinition
- Referenced scenes
- Character/rig assets
- Animations
- Mesh textures/data
- Background images
- Audio assets
- Dialogue definitions
- Camera/transition data

Reuse project dependency graph and packaging architecture.

Do not duplicate binary assets unnecessarily.

## 9. Standalone runtime

A standalone consumer should be able to:
- Load exported story data
- Resolve all required references
- Start the Story Player
- Advance dialogue
- Play all scenes in order
- Dispose resources cleanly

The consumer must not require React editor modules.

## 10. Validation

Detect:
- Missing story scene
- Missing character
- Missing animation
- Missing mesh texture
- Missing audio
- Invalid transition data
- Unsupported asset format
- Broken scene dependencies

Provide useful errors rather than blank rendering.

## 11. Tests

Cover:
- Two-scene playback
- Multiple scenes
- Immediate cut
- Fade transition
- Scene-time reset
- Time-zero dialogue
- Shared assets
- Loading delay
- Audio ownership
- Missing dependencies
- Export/import
- Runtime disposal

## 12. Out of scope

Do not implement:
- Branching scene logic
- Gameplay events
- Cloud distribution
- Remote streaming platform
- Complex cross-scene physics
- A general video export system

## 13. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Also run standalone runtime integration checks.

Fix failures.

## Definition of done

The Story Player can reliably play multiple cinematic scenes in order, transition between them, resolve assets and export/import complete stories.

## Final report

Explain scene lifecycle, transition ownership, preloading, audio handling, asset packaging, files changed, tests and exact results.
