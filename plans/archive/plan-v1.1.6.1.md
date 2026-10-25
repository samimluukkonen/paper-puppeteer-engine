# Paper Puppeteer Engine — v1.1.6.1
## Animation Environment Preview Foundation

Continue development of my Paper Puppeteer Engine.

**Current completed version: v1.1.5**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing functionality includes:
- Rig, Animation and Scene Editors
- Project Workspace and asset management
- Animation playback and scrubbing
- IK, foot contact markers and ground reference
- Animation keyframes and Graph Editor
- Scene backgrounds and camera infrastructure if already implemented
- Autosave/recovery and Undo/Redo

The application is a private tool for myself and one artist friend.

## Goal

Create an optional **Environment Preview** in Animation Editor.

This is for previewing ANY animation against a static background, including:
- Walking and running
- Sword cuts with stepping
- Jumping
- Dodging
- Rolling
- Lunging
- Crouching
- Spinning attacks
- Other arbitrary character animations

Do not design this as a walking-specific feature.

The artist should be able to see the existing animation in a meaningful environment without first creating a scene.

## 1. Inspect current architecture

Before implementing, review:
- Animation Editor React components
- Phaser animation preview
- Existing viewport camera
- Ground reference rendering
- Project image asset registry
- Existing Scene Editor image-loading utilities, if present
- Animation and project working-copy ownership
- Texture loading and cleanup

Reuse the actual systems.

Do not implement a second Puppet renderer.

## 2. Environment Preview mode

Add a clearly accessible option in Animation Editor:

**Environment Preview**

The artist should be able to switch between:
- Existing animation preview
- Environment Preview

Both must use the same authoritative animation evaluation.

Switching preview modes must not change authored animation data.

## 3. Static background

Allow the user to:
- Select an image from project assets
- Import a new PNG/WebP image
- Remove the selected background
- Show/hide the background
- Adjust its position
- Adjust its scale
- Reset its transform

The background is an image placed in preview-world space.

It should not be parented to the Puppet or any bone.

The background remains fixed in world coordinates while the character animates.

## 4. Preview UI

Suggested React panel:

```text
ENVIRONMENT PREVIEW

[x] Enable Environment Preview

Background:
[ Forest Background ▼ ]

[Import Image] [Clear]

Background X: [ 0 ]
Background Y: [ 0 ]
Scale:        [ 1.0 ]

[x] Show Ground Reference

[Reset Environment]
```

Use existing React UI components.

All controls should work with existing Animation Editor layout conventions.

## 5. Ground reference

Reuse the existing ground guide from v0.9.7.

Allow the background's visible floor level to be aligned with the guide.

Do not create a second ground-level system.

Changing the background or guide must not modify bones, IK targets or animation keyframes.

## 6. Character rendering

Environment Preview should render the current character using the same evaluated animation pose as the ordinary Animation Editor.

Preserve:
- IK
- Bone transforms
- Sprite attachments
- Skin selection
- Mirroring/facing
- Existing animation interpolation
- Playback behavior

Do not create duplicate character instances unless necessary for isolation.

If a separate preview instance is used, handle initialization and disposal correctly.

## 7. Background asset ownership

Use existing project image asset management.

Do not embed large image binaries inside animation keyframe JSON.

Do not store temporary Blob URLs as persistent asset references.

A background image may be shared by several animations.

## 8. Preview-only state

Environment configuration is not part of the actual skeletal animation.

Keep it separate from:
- RigDefinition
- Animation tracks
- Keyframes
- Runtime Puppet state
- Scene choreography

Define a reusable typed preview-settings model.

Detailed persistence comes in v1.1.6.4.

## 9. Viewport behavior

Ensure background alignment remains correct when:
- Resizing editor panels
- Zooming
- Panning
- Changing character
- Changing animation
- Toggling Environment Preview

Preview viewport navigation must not permanently alter background positioning.

## 10. Tests

Add tests for:
- Enable/disable preview
- Background selection
- Image import
- Background transform
- Ground alignment
- Character rendering continuity
- Viewport zoom/pan
- Missing image
- Multiple animations
- No authored animation changes
- Resource cleanup

## 11. Out of scope

Do not implement yet:
- Simulated Actor movement
- Preview motion paths
- Following camera
- Physics
- Collision
- Foot locking
- Animation retargeting
- Scene choreography
- Audio/dialogue

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Use actual repository scripts where necessary.

Fix all failures.

## Definition of done

The artist can open any animation and preview it against a selected static background, with correct ground alignment, without modifying authored animation data.

## Final report

Provide implementation details, React/Phaser architecture, coordinate conventions, files changed, tests and exact verification results.
