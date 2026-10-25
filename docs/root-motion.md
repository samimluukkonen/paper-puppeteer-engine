# Authored root motion

[All guides](../README.md#guides)

## Existing transform hierarchy

Inspection for v1.1.7-1 found Environment Preview implemented through v1.1.6-4, alongside later scene camera/layer features. The package is already at 1.2.6 and retains that version.

```text
Scene / optional enclosing Phaser containers
└─ Puppet.container ← Actor.position, placement, rotation, scale and facing
   └─ Rig.root bone container ← ordinary bone-local Joint.pose
      └─ child bone containers (including a pelvis, if the rig has one)
         └─ artwork / attachments / bone-local foot contact markers
```

`Actor` is a facade over a Puppet, without a separate transform or evaluator. `Actor.position` uses the outer container's parent coordinates; `Actor.worldPosition` includes enclosing transforms. The rig explicitly names `Rig.root`; array order does not define it. A pelvis is an ordinary named bone and can itself be the skeleton root in a particular rig, but neither role identifies the Actor origin. Foot contacts are bone-local reference points transformed through the hierarchy, independent of all those origins.

`AnimationClip` is the runtime authored contract; version-1 `AnimationJsonDefinition` adds file version metadata. `tracks` animate sparse bone-local transforms, and `ikTracks` animate Puppet-local targets/mix. The Animation timeline and Graph Editor address those bone/IK channels through the same property sampler. They do not expose root-motion channels in this milestone.

Scene placement, choreography and `ActorMovement` explicitly move the Puppet's outer container. Skeletal pose evaluation does not. Facing-left sets the outer container's X scale negative. Editor pose/selected-key mirroring rewrites skeletal values using symmetry mappings; it is distinct from facing and leaves authored root motion alone.

Environment Preview uses the same Puppet with separate world-pixel preview trajectories and editor camera settings, persisted as project editor preferences. Those values are not authored animation motion and are never converted automatically.

## Data and coordinates

An animation may contain `rootMotion: { translationKeys: [...] }`. Each sparse row has a millisecond `time`, optional finite `x` and `y` (at least one required), and optional outgoing `curves` for keyed X/Y properties. Curves reuse the existing linear default, stepped and bounded cubic Bézier schema and sampler. X and Y may be keyed at different times. An empty array is valid. Rotation and scale are excluded.

Keys use the existing bone/IK identity convention: strictly increasing unique row times, with a channel identified by property and time. A row can hold both channels at one time; separate duplicate-time rows are rejected. There are no new key IDs or editing UI.

Values are absolute animation-local offsets, in the same units as the unscaled Puppet: positive X points right in the canonical right-facing character, positive Y points down. They are independent of pelvis, root-bone and IK coordinates. Displacement is evaluated from an initial placement, never added every frame.

Future explicit application will transform the displacement vector through the Actor's starting linear transform (including scale, rotation and facing) and its parent transform. Translation is added once to the starting origin. Apply facing once through that transform; do not also negate X in the sampler. Bone mirroring does not mirror this track. A future operation that deliberately mirrors root-motion values would author their X signs once, with no additional playback mirror flag. Parent/world conversion remains the responsibility of the future runtime integration.

## Start, end and looping

`sampleRootMotion(clip, time)` returns the raw X/Y offset, holding each channel's first/last value outside its keyed range; an unkeyed channel is zero. Time clamps to `[0, duration]`. It does not quantize or wrap time.

`evaluateRootMotion(clip, time)` returns `sample(time) - sample(0)`. This explicit evaluation-time normalization preserves serialized values and guarantees zero displacement at clip start, including nonzero first keys or a single key. Net displacement is `evaluateRootMotion(clip, clip.duration)`. An absent/empty track has zero initial value, displacement and net travel. A single keyed value is constant and therefore contributes zero normalized travel.

Both functions reject nonfinite sample times. If subtracting two finite extreme offsets produces an unrepresentable displacement, evaluation throws instead of returning infinity.

The duration remains the animation duration; root keys cannot extend it. Like the existing pure pose sampler, these functions consume a sample time chosen by the caller. Exact duration samples retain the endpoint even for looping clips. A playback caller would wrap its clock to zero at a new cycle, resetting displacement; continuous accumulated travel, endpoint handoff and movement ownership are deferred. A future stepped playback integration must pass the same quantized time as the skeleton and retain exact endpoints.

## Compatibility and ownership

The optional extension retains animation file version 1, following the existing curve/IK extension policy. Legacy files retain their omissions. Validation checks strict nested structures, finite coordinates/times, duration bounds, unique ascending times, supported curves, keyed-property ownership and monotonic Bézier time handles. JSON Schema describes shapes; the shared semantic validator checks ordering and duration relationships.

Authored motion belongs to the animation. Compilation retains an independent frozen root-motion snapshot; pure sampling shares the property interpolation infrastructure. Actor, Puppet, skeletal/IK evaluation, scene movement and preview displacement do not consume it automatically. No bone, pelvis, IK or Scene movement is extracted or converted. Preview settings remain separate.

Animation JSON export, character packages and project assets preserve this track deterministically through their existing validation boundaries. Whole-clip variations scale root key times with duration; ordinary bone/IK edits preserve them. There is no React state, camera state or Phaser object in root-motion data.

Runtime movement, root-motion timeline/Graph Editor controls, Environment Preview integration, scene clip ownership, loop accumulation, collision/physics/pathfinding, extraction and foot locking are deferred.

## Implementation and verification

| Files                                                                                              | Change                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/rootMotion.ts`, `core.ts`, `data.ts`                                                   | Root-motion types, property names and pure `sampleRootMotion` / `evaluateRootMotion` exports.                                                                                  |
| `src/engine/AnimationClip.ts`                                                                      | Optional authored/compiled root-motion data and detached frozen compiled ownership.                                                                                            |
| `src/engine/schemas.ts`, `validation.ts`, `jsonWorkloadLimits.ts`, `schemas/animation.schema.json` | Shared shape, scalar, timeline, curve and import-budget validation.                                                                                                            |
| `src/devtools/animation-editor/animationSerialization.ts`, `animationVariation.ts`                 | Deterministic export and whole-clip time scaling. Existing generic character/project serializers retain the new optional branch.                                               |
| `tests/rootMotion.test.ts`                                                                         | 53 regressions covering sampling, invalid input, ownership, mirroring/facing, unchanged runtime placement/poses/IK, editor preservation and character/project ZIP round trips. |

All commands below completed with exit 0. Test runners ran sequentially with one worker.

| Exact command                                                                                                                                                                                  | Result                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                            | Passed; also passed through the final `check` and `build` commands.                                                       |
| `npx vitest run tests/rootMotion.test.ts tests/animationCurves.test.ts tests/animationSerialization.test.ts tests/animationVariation.test.ts tests/schemaCompatibility.test.ts --maxWorkers=1` | 142 tests passed across five files.                                                                                       |
| `npm run test -- --maxWorkers=1`                                                                                                                                                               | 3,625 tests passed, 47 skipped; 208 files passed, six skipped; 142.58 seconds.                                            |
| `npm run check`                                                                                                                                                                                | Formatting, lint and TypeScript passed.                                                                                   |
| `npm run schemas:generate`                                                                                                                                                                     | Generated schemas and formatting completed.                                                                               |
| `npm run check:version`                                                                                                                                                                        | Package, lockfile and changelog agree on 1.2.6.                                                                           |
| `npm run build`                                                                                                                                                                                | Application, ES library, declarations and Node entry checks passed. Existing Lucide `use client` bundler warnings remain. |
| `git diff --check`                                                                                                                                                                             | Passed.                                                                                                                   |
