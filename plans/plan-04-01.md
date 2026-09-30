Continue the existing `paper-puppeteer-engine` TypeScript + Phaser project.

Do NOT rewrite the project from scratch.

This is **v0.4.1**.

The goal of this version is to introduce a safe external-data foundation for future production characters.

Focus ONLY on:

1. JSON-compatible rig definitions
2. JSON-compatible animation definitions
3. data format versioning
4. runtime validation
5. loading/parsing utilities
6. tests for external data

Do NOT implement skins, slots, character manifests, pose editing tools, or visual editors yet.

## Main goal

Currently rigs and animations can be defined in TypeScript.

Keep that capability.

Add support so equivalent data can also come from JSON.

For example:

```json
{
  "version": 1,
  "name": "demo-rig",
  "root": "root",
  "bones": [
    {
      "id": "root",
      "x": 0,
      "y": 0
    },
    {
      "id": "torso",
      "parent": "root",
      "x": 0,
      "y": -50,
      "rotation": 0
    }
  ]
}
```

Use explicit serializable TypeScript interfaces.

External data must not contain:

- Phaser objects
- functions
- Map
- Set
- cyclic references

## Rig JSON

Support the important existing rig properties, including where applicable:

- id
- parent
- x
- y
- rotation
- scaleX
- scaleY
- length
- origin/pivot data
- sprite offset information
- render depth/order

Do not remove existing TypeScript rig construction.

The JSON loader should ultimately produce the same internal rig representation used by the existing engine.

## Animation JSON

Support existing animation features from v0.3:

- name
- duration
- loop
- tracks
- x
- y
- rotation
- scaleX
- scaleY
- events
- smooth playback
- stepped playback
- animation FPS

Example:

```json
{
  "version": 1,
  "name": "idle",
  "duration": 1600,
  "loop": true,
  "playback": {
    "mode": "stepped",
    "fps": 10
  },
  "tracks": {
    "torso": [
      {
        "time": 0,
        "rotation": -0.02
      },
      {
        "time": 800,
        "rotation": 0.02
      },
      {
        "time": 1600,
        "rotation": -0.02
      }
    ]
  }
}
```

Do NOT duplicate animation evaluation logic.

JSON should be parsed into the existing `AnimationClip` representation.

## Versioning

Introduce central format versions such as:

```ts
export const RIG_FORMAT_VERSION = 1;
export const ANIMATION_FORMAT_VERSION = 1;
```

Every external rig or animation file must specify its version.

Unsupported versions should produce clear errors.

Do not implement migrations yet.

## Validation

Implement robust validation.

Rig validation should detect at least:

- duplicate bone IDs
- missing root
- missing parent
- circular hierarchy
- invalid numeric values
- invalid bone lengths
- malformed transform values

Animation validation should detect at least:

- missing name
- invalid duration
- invalid keyframe time
- track references unknown bone
- events outside valid timeline range
- invalid playback FPS

Prefer structured validation:

```ts
interface ValidationIssue {
  severity: "error" | "warning";
  path?: string;
  message: string;
}
```

Where practical, return multiple issues in one validation run rather than stopping at the first error.

Example errors:

```text
Bone "leftForearm" references unknown parent "leftUpperArm2".
```

```text
Animation "walk" references unknown bone "leftShin".
```

## Error types

Introduce useful error types only where they improve clarity.

Potential examples:

```text
RigValidationError
AnimationValidationError
UnsupportedFormatVersionError
```

Do not build a large error hierarchy.

## Loading API

Keep I/O separate from runtime logic.

Support something conceptually like:

```ts
const rigData = parseRigDefinition(json);
const animation = parseAnimationClip(json, rigData);
```

The parsing functions should accept already-loaded JavaScript data.

Optionally provide browser convenience helpers for fetching JSON, but the core engine must not require `fetch`.

## Tests

Add tests covering:

### Rig validation

- valid hierarchy
- duplicate bone
- missing parent
- missing root
- circular hierarchy
- unsupported version

### Animation validation

- valid animation
- unknown bone
- invalid keyframe time
- invalid duration
- invalid FPS
- unsupported version

### Serialization compatibility

Ensure a valid serializable definition can:

```text
TypeScript object
→ JSON.stringify
→ JSON.parse
→ validator/parser
→ valid engine data
```

Keep these tests independent from Phaser rendering where possible.

## Demo

Add at least one rig and one animation JSON file to the demo.

The existing demo should successfully load and run them.

Do not convert every demo asset yet.

The purpose is only to prove that external JSON data works.

## Preserve existing functionality

Verify that:

- TypeScript-defined rigs still work
- TypeScript-defined animations still work
- IK still works
- animation blending still works
- stepped playback still works
- animation events still work
- facing still works

## Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all errors.

## Success criteria

v0.4.1 is complete when:

1. a rig can be represented as JSON
2. an animation can be represented as JSON
3. both are versioned
4. both are validated before runtime use
5. invalid files produce useful errors
6. JSON-loaded animation behaves identically to TypeScript-defined animation
7. existing v0.1–v0.3 features still work

At the end report:

- files added
- files changed
- public API additions
- JSON formats introduced
- validation rules
- backward-compatibility notes
- known limitations
