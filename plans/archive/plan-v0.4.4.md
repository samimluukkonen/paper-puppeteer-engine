Continue the existing `paper-puppeteer-engine`.

This is **v0.4.4**, the final v0.4 milestone.

Do NOT rewrite stable runtime systems.

The goal is to improve developer authoring workflow.

Implement:

1. pose presets
2. explicit bind/rest pose handling
3. simple interactive bone inspection
4. manual pose adjustment
5. pose JSON export
6. rig-value inspection/export
7. JSON Schemas if practical
8. documentation

Do NOT build a full animation editor.

## Pose presets

Introduce a serializable static pose format.

Example:

```json
{
  "version": 1,
  "name": "combat-ready",
  "bones": {
    "torso": {
      "rotation": -0.08
    },
    "rightUpperArm": {
      "rotation": 0.7
    },
    "rightForearm": {
      "rotation": -1.1
    }
  }
}
```

This represents a static pose, not an animation.

Runtime:

```ts
puppet.applyPose("combat-ready");
```

Also support:

```ts
puppet.applyPose("combat-ready", {
  mix: 0.5
});
```

Unspecified bones must preserve the existing underlying pose.

## Bind/rest pose

Formalize bind/rest pose behavior if not already explicit.

The engine should conceptually distinguish:

```text
bind/rest pose
↓
animation
↓
animation layers
↓
pose override where appropriate
↓
IK
↓
final pose
```

Document the exact implemented order.

Provide:

```ts
puppet.resetToBindPose();
```

This must not destroy rig definitions.

## Pose loading

Support external JSON pose files using the v0.4 data pipeline.

Include:

```ts
export const POSE_FORMAT_VERSION = 1;
```

Validate:

- unknown bone
- invalid transform value
- unsupported version

## Developer inspector

Create a small development-only inspector.

It does NOT need to be polished.

Allow selecting a bone and displaying:

```text
Selected bone: rightForearm

x: 0
y: 52
rotation: -0.842
scaleX: 1
scaleY: 1
```

Use Phaser text/debug UI or simple DOM development UI if that cleanly fits the project.

Avoid adding a large UI framework.

## Interactive bone adjustment

Allow the developer to:

- select a bone
- rotate it incrementally
- optionally adjust x/y
- reset it
- see changes immediately

Support fine and coarse rotation increments.

Example conceptual controls:

```text
[ / ] = previous / next bone
Left / Right = rotate
Shift + Left / Right = larger rotation step
R = reset pose
```

Choose non-conflicting controls.

## Pose export

This is important.

Allow the current authored pose to be serialized as reusable JSON.

Example:

```json
{
  "version": 1,
  "name": "exported-pose",
  "bones": {
    "torso": {
      "rotation": -0.08
    },
    "rightUpperArm": {
      "rotation": 0.71
    }
  }
}
```

Provide at least one convenient development output:

- copy JSON to clipboard, or
- clearly print JSON to console

If trivial, also support browser JSON download.

Do not require a backend.

## Export only useful differences

Where practical, allow exporting only transforms that differ meaningfully from bind pose.

Avoid producing huge JSON files containing every default zero value.

Use a small epsilon comparison.

## Rig inspection/export

Provide a development utility for inspecting/serializing useful rig setup data:

- local position
- local rotation
- pivot/origin
- logical length
- slot transforms
- sprite offsets

This is for development/debugging.

Do NOT serialize Phaser runtime objects.

## JSON Schema

If practical, create JSON Schema files for:

```text
rig.schema.json
animation.schema.json
skin.schema.json
pose.schema.json
character.schema.json
```

Store them under something like:

```text
schemas/
```

The schemas should improve VSCode editing/autocomplete/validation.

Do not spend excessive complexity generating schemas dynamically.

Handwritten schemas are acceptable.

## Demo

Extend the demo with a developer pose mode.

Example controls:

```text
C = apply combat-ready pose
R = reset bind pose
[ / ] = select bone
Arrow keys = adjust selected bone
X = export current pose
V = slot debug
B = bone debug
I = IK debug
```

Show selected bone information on-screen.

## Interaction with animation

Make behavior deterministic.

If pose adjustment is meant as a developer authoring mode, it is acceptable to pause normal animation while editing.

Document the behavior.

Do not allow animations and manual editing to unpredictably fight over the same transforms.

## Interaction with IK

Allow IK to be disabled while authoring a pure static pose.

If IK remains enabled, make that obvious in debug UI.

The exported pose should contain authored bone transforms, not accidental final IK output unless explicitly requested.

This distinction is important.

## Tests

Add tests for:

- valid pose
- invalid bone reference
- unsupported pose version
- applying partial pose
- mix = 0
- mix = 1
- bind pose reset
- pose serialization
- pose serialize → JSON → parse round trip
- epsilon omission of unchanged properties if implemented

## README

Document:

- pose files
- bind/rest pose
- pose application
- pose blending
- inspector controls
- exporting poses
- recommended workflow for setting up a new character

Recommended workflow:

```text
1. load artist artwork
2. load rig
3. enable bone debug
4. tune pivots/offsets
5. open pose inspector
6. manually create useful pose
7. export pose JSON
8. save it under character poses/
9. use it later in scripted scenes or animation work
```

## Do NOT implement

Do NOT build:

- timeline editor
- keyframe editor
- curve editor
- full rigging GUI
- drag-and-drop asset browser
- animator state machine
- blend tree editor
- Photoshop importer
- automatic sprite segmentation
- mesh deformation editor

Those belong to later versions.

## Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Manually verify:

- bone can be selected
- bone can be rotated
- current values are visible
- bind pose resets correctly
- static pose can be applied
- current pose can be exported
- exported pose can be loaded again
- IK and animation are not accidentally baked into exported authored transforms

## Success criteria

v0.4.4 is complete when I can take artwork from an artist, load the character, visually adjust its pose, and export usable pose JSON without manually guessing rotation numbers.

At the end report:

- files added
- files changed
- public API additions
- pose format
- inspector controls
- export behavior
- schemas added
- known limitations
- recommended v0.5 milestone
