# Paper Puppeteer Engine — v0.5.3.3
## Multi-Ghost Onion Skinning & Artist Controls

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.3.2**

The Animation Editor now supports:
- Read-only ghost pose sampling
- Previous and next ghost rendering
- Translucent ghost visuals
- Ghost synchronization with the working animation
- Onion-skin visibility toggle
- Editor-only rendering and state isolation

Do not rebuild those systems.

Tech stack: TypeScript, Phaser, Vite, strict TypeScript, ES modules, React.

## Goal

Extend the existing onion-skin system into a useful artist-facing tool.

Implement:
1. Multiple previous ghosts
2. Multiple next ghosts
3. Configurable frame spacing
4. Independent previous/next visibility
5. Configurable opacity
6. Configurable ghost tint
7. Compact Animation Editor controls
8. Efficient ghost reuse and updating

## 1. Multiple ghost samples

Support 0–3 ghosts in each direction.

Example:

```text
Previous: 3 ghosts
Next:     2 ghosts

P3  P2  P1  CURRENT  N1  N2
```

Use the existing v0.5.3.1 sampling infrastructure.

Do not duplicate animation evaluation logic.

## 2. Sample spacing

Add an artist-controlled frame spacing value.

Suggested range:

```text
1–5 authored frames
```

For example:

```text
Animation FPS: 10
Current time: 1.0 s
Frame spacing: 2 frames

Previous:
0.4
0.6
0.8

Current:
1.0

Next:
1.2
1.4
```

Keep `currentTime` continuous.

Use the same frame-spacing logic regardless of rendering FPS.

Handle boundaries by omitting out-of-range ghosts rather than duplicating poses at the edge.

## 3. Onion skin settings

Introduce editor-only configuration.

Conceptually:

```ts
interface OnionSkinSettings {
  enabled: boolean;
  previousCount: number;
  nextCount: number;
  frameSpacing: number;
  previousOpacity: number;
  nextOpacity: number;
  previousTint: number;
  nextTint: number;
}
```

Adjust names to the existing architecture.

Settings must NOT be added to AnimationDefinition or animation JSON.

They do not belong to Undo/Redo authored-animation history.

## 4. Editor controls

Add a compact Onion Skinning panel.

Example:

```text
ONION SKINNING

[x] Enable

Previous poses: [ 3 ]
Next poses:     [ 2 ]

Frame spacing:  [ 2 ]

Previous opacity: [slider]
Next opacity:     [slider]

Previous color: [cool tint]
Next color:     [warm tint]
```

Use plain HTML/CSS and existing editor UI conventions.

Do not introduce a UI framework.

## 5. Opacity

Allow opacity adjustment without changing sprite source textures.

Suggested range:

```text
0.05–0.6
```

Choose sensible defaults.

The active puppet must always retain its normal appearance.

Optional: use decreasing opacity for ghosts farther from the current pose.

For example:

```text
P3 faint
P2 medium
P1 stronger
CURRENT fully opaque
N1 stronger
N2 medium
```

If implemented, keep the falloff deterministic and simple.

## 6. Tint

Use different default tints for previous and next ghosts.

Allow the artist to adjust them through simple color controls or a small preset selection.

Do not introduce a complex color-management system.

Tint must not alter the underlying character textures.

## 7. Independent visibility

Allow:
- Only previous poses
- Only next poses
- Both directions
- Neither direction

Zero ghosts should be a valid state.

Do not create unnecessary render objects for invisible ghosts.

## 8. Efficient ghost rendering

Extend the existing renderer to reuse ghost visuals when possible.

Avoid:
- Creating new Phaser sprites every frame
- Reloading textures
- Rebuilding the rig repeatedly
- Allocating uncontrolled temporary GameObjects

A small pooled set of ghost render instances is acceptable.

Maximum required visible ghosts for this phase: six.

## 9. Synchronization

Changes to controls should update visualization immediately.

Examples:
- Changing ghost count
- Changing spacing
- Adjusting opacity
- Changing tint
- Scrubbing
- Editing keyframes
- Undo/Redo
- Changing interpolation
- Switching animations
- Switching skins

No manual reload should be necessary.

## 10. Playback behavior

Onion skinning should continue working during normal playback.

The current puppet must remain the authoritative active preview.

Ghost sampling must not interfere with playback timing.

If updating six ghosts every frame becomes expensive, use a bounded optimization that does not introduce stale poses or change authored animation semantics.

Do not throttle the active Puppet or Phaser render loop to the authored animation FPS.

## 11. Dirty state

These settings must NOT mark animation dirty:
- Enable/disable
- Ghost counts
- Frame spacing
- Opacity
- Tint
- Direction visibility

They are editor preferences.

Do not export them into animation.json.

## 12. Tests

Add tests for:
- Multiple sample-time generation
- Different frame spacing
- Zero ghosts
- Maximum ghost count
- Boundary omission
- Invalid settings handling
- Opacity bounds
- Independent visibility
- Working animation immutability
- Current time unchanged
- No authored dirty-state changes

## 13. Manual verification

Test:
- One previous/one next
- Three previous/three next
- Previous-only
- Next-only
- Spacing 1, 2, and 5 frames
- Low/high opacity
- Tint changes
- Scrubbing
- Playing
- Changing FPS
- Moving keyframes
- Changing interpolation
- Undo/Redo
- Switching animations and skins

Ensure previous/next ghosts appear at the expected times.

## 14. Do NOT implement yet

Do not implement:
- Onion skinning from another animation
- Ghost pose editing
- Direct ghost manipulation
- Ghost keyframe creation
- IK baking
- Motion trails or mesh deformation
- Mirrored pose copying
- Scene choreography

## 15. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

v0.5.3.3 is complete when:
- Multiple ghosts render correctly
- Previous/next counts are independently configurable
- Frame spacing works
- Opacity is configurable
- Tint is configurable
- Editor controls work
- Settings do not dirty animation data
- Ghost rendering remains efficient
- Playback and keyframe editing remain functional
- Tests, typecheck and build pass

## Final report

Report:
1. Implemented features
2. Onion skin settings model
3. Multi-sample behavior
4. Rendering/pooling strategy
5. UI controls
6. Files/APIs changed
7. Tests
8. Manual verification
9. Required command results
10. Deferred to v0.5.3.4

Do not claim completion unless all commands pass.
