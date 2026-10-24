# Paper Puppeteer Engine — v1.2.3
## Cinematic Camera Controller

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.2.2**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing features:
- Scene Editor stage and Actors
- Scene backgrounds
- Visual layers and parallax
- Scene timeline and deterministic scrubbing
- SceneDefinition and runtime adapter
- Existing editor camera zoom/pan

Do not rebuild the existing Scene Editor.

## Goal

Introduce an authorable **Cinematic Camera**.

The artist should be able to position a camera, frame characters, adjust zoom and preview exactly what the audience would see.

The editor viewport navigation and the authored cinematic camera MUST remain separate.

## 1. Inspect current camera architecture

Examine:
- Phaser cameras used by Scene Editor
- Preview rendering
- Existing Actor/world transforms
- Background/parallax behavior
- Canvas size and aspect ratio
- Scene playback adapter
- Scene document schema

Reuse existing camera services where appropriate.

## 2. Cinematic camera model

Add optional scene camera configuration.

Conceptually:

```ts
interface CinematicCameraState {
  x: number;
  y: number;
  zoom: number;
}
```

This is illustrative.

Determine whether x/y represent the frame center or Phaser scroll offset.

Choose one documented convention and apply it consistently.

Also define the intended scene output viewport size/aspect ratio using existing project conventions.

Avoid a large multi-camera system.

## 3. Editor camera versus cinematic camera

The Scene Editor must distinguish:

**Editor Viewport Camera**
- Used for navigating the editing canvas
- Supports free pan/zoom
- Not authored cinematic animation data

**Cinematic Camera**
- Defines audience framing
- Has authored position/zoom
- Can be edited deliberately
- Will be animated in v1.2.4

Do not save editor viewport panning as cinematic camera changes.

## 4. Camera framing visualization

Display an adjustable cinematic frame rectangle in Scene Editor.

Show:
- Frame boundaries
- Camera center
- Aspect ratio
- Scene content inside the frame

The artist should be able to select and position the cinematic camera independently of Actors.

Use existing Phaser world/screen transforms.

## 5. Camera controls

Add a compact inspector:

```text
CINEMATIC CAMERA

Center X: [ 400 ]
Center Y: [ 250 ]

Zoom: [ 1.0 ]

[Reset Camera]
[Frame Selected Actor]
[Preview Through Camera]
```

Values are illustrative.

Validate finite positions and positive, bounded zoom.

## 6. Frame Selected Actor

Support an explicit action to position the camera around the selected Actor.

If reliable rendered bounds are available, use them.

Otherwise center on the Actor origin with a clearly documented behavior.

Do not modify the Actor's own transform.

Avoid guessing anatomical head positions.

## 7. Camera preview mode

Provide an explicit mode to see the scene through the cinematic camera.

The preview should reflect:
- Background layers
- Parallax
- Actor positions
- Foreground objects
- Camera zoom and framing

Exiting camera preview must restore the editor navigation state.

Do not change authored camera data merely by switching preview modes.

## 8. Overlay behavior

Keep editor-only controls usable:
- Actor selection handles
- Ground guide
- Layer controls
- Camera frame controls

Ensure overlays are not incorrectly captured as scene artwork or embedded into export assets.

## 9. Runtime support

Provide a small runtime-facing camera state application mechanism using existing Phaser camera infrastructure.

Do not import React into the runtime.

Do not create another world-transform system.

## 10. Persistence

Store initial cinematic camera settings in SceneDefinition or appropriate compatible scene metadata.

Old scenes should use reasonable, backward-compatible defaults.

No timeline camera keyframes yet.

## 11. Tests

Cover:
- Initial camera state
- Coordinate conventions
- Camera framing
- Positive zoom validation
- Editor pan independence
- Camera preview switching
- Parallax
- Actor alignment
- Resize/aspect ratio
- Scene serialization
- Existing scenes
- Runtime/editor separation

## 12. Manual verification

1. Open a scene with backgrounds and Actors.
2. Select Cinematic Camera.
3. Move camera center.
4. Change zoom.
5. Preview through camera.
6. Pan editor viewport separately.
7. Confirm authored camera state is unchanged.
8. Export/reload the scene.
9. Verify camera framing is preserved.

## 13. Out of scope

Do not implement:
- Camera keyframe timeline
- Automatic following
- Camera shake
- Cuts/fades
- Multi-camera blending
- Audio/dialogue

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- Scene Editor has a cinematic camera.
- Camera position/zoom can be authored.
- Editor viewport remains independent.
- Preview through camera works.
- Parallax and actors render correctly.
- Scene persistence works.
- Tests, typecheck and build pass.

## Final report

Describe camera ownership, coordinate conventions, preview implementation, Phaser integration, files changed, tests and exact verification results.
