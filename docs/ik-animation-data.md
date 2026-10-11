# IK animation data

[All guides](../README.md#guides)

Milestone v0.5.5.1 adds serializable IK target and influence channels, rig references, validation, and pure keyframe operations. Milestone v0.5.5.2 adds [runtime IK evaluation](ik-animation-runtime.md): authored channels now drive the existing solver during playback and editor scrubbing. Visual authoring remains deferred.

## Rig and animation formats

Both file formats remain **version 1**. These optional fields extend version 1 without changing existing fields, time units, interpolation, or defaults. Existing files need no migration or empty IK field. Earlier engine releases with strict file validators cannot read files containing the new fields. Package milestone `0.5.5-2` is independent of file-format version.

Rig files may include an `ik` array of existing `TwoBoneIKDefinition` objects:

```json
{
  "name": "rightArmIK",
  "rootBone": "rightUpperArm",
  "middleBone": "rightForearm",
  "endBone": "rightHand",
  "mix": 1
}
```

The existing unique `name` is the stable constraint identifier; there is no generated ID or array-index reference. Names must be nonempty and unique within the rig, and all three bone IDs must form a direct chain. `Rig` owns immutable copies of these definitions. Puppet construction registers the rig's definitions by default; supplying `PuppetOptions.ik` retains the existing explicit override behavior. Existing runtime registration remains available, but animation validation requires the referenced definition in the loaded rig's `ik` array. Preview-only definitions do not establish an authored rig reference. Rig editor export and recovery preserve loaded definitions.

Animation clips and JSON files may include an `ikTracks` dictionary keyed by constraint name:

```json
{
  "version": 1,
  "name": "reach",
  "duration": 1000,
  "loop": false,
  "interpolation": "linear",
  "playback": { "mode": "stepped", "fps": 12 },
  "tracks": {},
  "ikTracks": {
    "rightArmIK": [
      { "time": 0, "x": 40, "y": -80, "mix": 0 },
      { "time": 300, "x": 65, "mix": 1 },
      { "time": 800, "y": -100, "mix": 1 },
      { "time": 1000, "mix": 0 }
    ]
  }
}
```

`IKKeyframe` uses ordinary sparse rows: `time` plus optional `x`, `y`, and `mix`. X and Y are independently keyable, and omitted channels do not author any fallback value. `IKAnimationTrack` is a readonly array of these rows. Times are **milliseconds**, matching bone keyframes. `mix` retains the existing solver's influence meaning and finite `[0, 1]` range; it does not introduce a separate influence calculation.

Interpolation remains the existing optional clip-level `linear` declaration. Smooth/stepped are clip playback sampling modes; there are no per-key or per-track interpolation overrides and no new evaluator.

## Target coordinates

Positions are absolute **puppet-local coordinates**: the coordinate frame of the outer puppet container, before scene placement, enclosing containers, facing, rotation, and character scaling. They are independent of bone-parent space, screen coordinates, camera coordinates, sprite origins, and the evaluated IK result. Units match rig offsets; +X points right and +Y down.

Moving a character does not rewrite keys. Facing reflects local X through the puppet container's existing facing transform; character scaling scales the target with the character. Root-bone offsets and animated transforms do not change this authored coordinate frame. Procedural `setIKTarget` still accepts world positions.

The runtime transforms an authored point with the puppet container's full world matrix using the existing `localToWorld` affine utility, then passes the world point through the existing IK `worldToParent` adapter. Authoring tools can use `worldToLocal` with that same outer matrix to recover local points; singular transforms return `undefined`. Runtime conversion is transient and never writes scene coordinates into authored keys.

## Pure keyframe APIs

The main package and renderer-independent `/core` entry point export:

| API                                                                                | Behavior                                                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `createIKAnimationTrack(animation, rig, constraintId)`                             | Create an empty placeholder; retain an existing track.                                   |
| `setIKPropertyKeyframe(animation, rig, constraintId, property, timeMs, value)`     | Insert or update `x`, `y`, or `mix`, merging sparse rows and sorting by time.            |
| `removeIKPropertyKeyframe(animation, rig, constraintId, property, timeMs)`         | Remove one channel; retain siblings and remove the final empty track.                    |
| `moveIKPropertyKeyframe(animation, rig, constraintId, property, fromTime, toTime)` | Move one channel and replace destination collisions; retain siblings at their own times. |
| `getIKPropertyKeyframes(animation, rig, constraintId, property)`                   | Return authored `{ time, value }` copies, including influence keys via `mix`.            |
| `findIKPropertyKeyframe(animation, rig, constraintId, property, timeMs)`           | Query an authored property key with the shared time tolerance.                           |
| `getIKKeyedPropertiesAtTime(animation, rig, constraintId, timeMs)`                 | Return channel names keyed near the requested time.                                      |

Edits return working animation data without mutating or freezing caller sources, rig definitions, bind transforms, or solver results. Unchanged branches can be shared. Inputs and resulting authored data pass the existing strict animation validation. The APIs require JSON-compatible animation data, like existing editor authoring operations.

Bone and IK operations share a `1e-6` millisecond matching tolerance and nearest-row selection. Setters retain an existing matching row's time; movement clamps destinations to the clip and replaces matching destination keys on only the selected channel. A nearby sibling alone does not shift a moved channel's time. Query results are independent copies. The operation preserves interpolation, playback, events, and bone tracks.

## Validation and serialization

`validateAnimationDefinition` returns structured issues with field paths; `parseAnimationClip` throws `AnimationValidationError` with those issues. Strict file validation rejects unknown fields, invalid coordinates, NaN/Infinity, invalid mix, unknown constraints, duplicate/descending/out-of-range times, and rows without an authored channel. Empty known tracks are valid placeholders; empty unknown tracks are rejected. Nearby distinct times remain valid authored data; validation never sorts, merges, or repairs them.

Rig schema validation checks scalar constraints, duplicate names, unknown bones, and disconnected chains. The generated rig and animation JSON schemas include the new optional fields; reference and timeline checks remain semantic engine validation.

Animation import/export retains all IK channels and existing metadata. Deterministic serialization includes IK timestamps in the shared precision-preservation pass, so close distinct keys do not collapse. Old files continue to omit `ikTracks`. Draft identities include authored rig constraints so recovery cannot confuse two rigs with different IK definitions.

Tests in `tests/ikAnimationData.test.ts` cover creation, sparse insertion/update/deletion, tolerant moves and collisions, coordinates/facing/scaling, mix and timeline failures, strict references, empty tracks, deterministic round trips, old files, source ownership, rig editor preservation, and unchanged bone evaluation.

React IK timeline controls, draggable handles, copy/paste UI, mirroring, baking, new solvers, and physics remain deferred.
