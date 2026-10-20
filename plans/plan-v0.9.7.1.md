# Paper Puppeteer Engine — v0.9.7.1
## Ground Reference Foundation

Continue developing my Paper Puppeteer Engine project.

**Current completed version: v0.9.6**

Technology:
- React + TypeScript (strict)
- Phaser for rendering
- Vite, npm, ES modules

The engine already includes:
- Rig Editor
- Animation Editor
- Scene Editor
- Skeletons, bones and IK constraints
- IK target authoring and foot-planting features
- Character and scene import/export
- Actor placement and choreography
- Undo/Redo and working-copy state

This is a private tool for me and my artist friend. Keep the feature practical and lightweight.

## Goal

Implement the shared foundation for an optional **Ground Reference Guide**.

The artist wants to see a horizontal ground line to help position feet and characters consistently.

This is initially a visual authoring aid, NOT a physics ground plane.

## 1. Inspect existing architecture

Review:
- Phaser editor preview rendering
- Camera zoom/pan and coordinate conversion
- Animation Editor preview transforms
- Scene Editor world coordinates
- Existing grid/guide overlays
- Working-copy and persistence systems
- React inspector and toolbar conventions

Reuse existing solutions.

## 2. Ground guide model

Introduce a small typed configuration.

Conceptually:

```ts
interface GroundGuide {
  enabled: boolean;
  y: number;
  snapEnabled: boolean;
}
```

Adapt this to existing conventions.

Define coordinate ownership explicitly:

- Animation Editor: fixed preview-world ground reference associated with a character/rig authoring workspace.
- Scene Editor: scene-world ground Y.

These coordinates are not interchangeable without a transform.

Avoid adding gravity, collision properties or physics fields.

## 3. Persistence architecture

Ground guides should survive reopening their associated document/project.

Prefer existing editor/project metadata or suitable optional document metadata.

Do not place purely visual editor preferences into animation keyframe tracks.

Do not break existing rig or scene JSON formats.

If changing a persistent schema is necessary, make the change backward-compatible and validate it.

## 4. Reusable Phaser rendering

Create a reusable ground reference visualization.

Requirements:
- Horizontal line
- Distinctive appearance
- Optional dashed pattern
- Small Ground label where helpful
- Extends across visible viewport
- Independent of character sprite textures
- Does not appear in exported sprite artwork
- Does not intercept normal editor interactions by default

Use existing editor-overlay rendering architecture.

## 5. Coordinate correctness

The guide's Y position must represent a stable world/reference coordinate, not a fixed screen pixel position.

It must render correctly during:
- Camera zoom
- Camera pan
- Window resize
- Viewport resize
- Character preview scaling
- Scene viewport movement

Moving the camera must not modify stored ground coordinates.

Use existing coordinate conversions.

## 6. Shared controls

Provide reusable React controls supporting:
- Show/hide
- Numeric Ground Y
- Reset to default
- Optional snapping toggle

The ground guide should not modify bones or Actors merely because its position changes.

## 7. Default behavior

Use a reasonable ground reference based on existing preview origin conventions.

Do not assume every character's root bone is at its feet.

The user must be able to adjust the ground position manually.

## 8. Tests

Test:
- Guide configuration
- Invalid numeric values
- Default positions
- Visibility
- Coordinate conversion
- Zoom/pan behavior
- Isolation between workspaces
- Persistence round-trip where implemented
- Existing editor compatibility

## 9. Out of scope

Do not implement yet:
- Animation Editor-specific controls
- IK target snapping
- Scene Actor snapping
- Physics/collision
- Terrain and slopes
- Automatic foot-contact detection

## 10. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures. Use actual available project scripts where necessary.

## Definition of done

A reusable, correctly positioned, configurable ground-line system exists and can be integrated into both editors without modifying authored animation or character data merely by displaying it.

## Final report

Provide:
1. Ground guide architecture
2. Coordinate conventions
3. Persistence strategy
4. Renderer and React controls
5. Files/APIs changed
6. Tests
7. Exact verification results
8. Work deferred to v0.9.7.2

Do not claim completion unless required checks pass.
