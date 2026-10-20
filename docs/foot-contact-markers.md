# Foot contact markers (v0.9.8.1)

[All guides](../README.md#guides)

Rigs can store optional `footContactMarkers`: an ordered array of `{ id, name, boneId, localX, localY }`. IDs are stable, nonempty and unique within this collection. Names are nonempty display labels and may repeat. `boneId` must reference an existing rig bone; both local coordinates must be finite numbers. Marker objects reject unsupported fields. Omitted and empty collections are valid; any number of contacts can share a bone. One marker per foot is a useful starting convention, with no humanoid names or left/right pairing requirement.

The optional collection extends rig format version **1**, following the existing additive IK/attachment conventions. No migration runs, IDs and IK configuration are preserved, and old rigs retain an omitted collection through loading and serialization. Earlier engine versions with strict file validation do not understand the new field. Runtime `Rig` owns deeply frozen copies, and `new Rig(existingRig)` shares those immutable definitions. Runtime exports, rig editor JSON, browser recovery and history preserve markers. Referenced bones cannot be deleted or renamed in the editor until the marker reference is removed or changed in rig data.

## Authoring API

`FootContactMarker` is exported through `/data` and `/core` (also the runtime/root entry points). The creation helper and position evaluator are available from `/core` and the runtime/root entry points. `footContactMarkerSchema` is also exported from `/serialization`; generated rig JSON Schema describes the same fields, with duplicate IDs and bone references checked by semantic validation.

```ts
import { createFootContactMarker, Rig } from 'paper-puppeteer-engine/core';

const candidate = createFootContactMarker(rigDefinition, {
  id: 'front-contact',
  name: 'Front sole',
  boneId: selectedBoneId,
});
const rig = new Rig(candidate);
```

The caller supplies the stable ID; creating another marker with that ID fails. The helper returns a validated authored copy without modifying its input. Explicit `localX`/`localY` override the seed. Missing coordinates start at the first child's normalized bind offset; a leaf uses `(0, length)` when length exists, otherwise `(0, 0)`. Explicit bone lengths use the same normalization as `Rig`. This seed is an editing convenience: neither a joint, endpoint nor artwork edge establishes the actual sole. Edit the local numbers in rig data to place the contact precisely. Visual marker editing is outside this foundation.

## Coordinates and evaluated positions

Marker coordinates use the bone's local units and pivot, with X rightward and Y downward in the untransformed basis. Rotations are radians and scales are unitless. Sprite offsets, sprite origins, skins and normalized attachment `groundContacts` do not enter marker evaluation.

For a bone transform, the existing affine convention is `T(x, y) × R(rotation) × diag(scaleX, scaleY)`. The marker point is transformed by its attached bone, then each parent through the root bone, then the full Puppet-container world matrix:

```text
contactWorld = puppetToWorld × rootBone × … × attachedBone × (localX, localY, 1)
```

Composition retains nonuniform scaling, rotations, negative scales, reflections, shear and collapsed axes. The rig root bone's pose and the outer Puppet container are distinct transforms and both apply exactly once. Facing is already encoded in the Puppet container's signed X scale. Actor placement/movement changes that container; any host parent containers are included in its full world matrix. Do not apply another facing flip or Actor translation. Camera pan/zoom and screen coordinates never enter the calculation.

```ts
import { getFootContactWorldPosition } from 'paper-puppeteer-engine/core';

// Query after the host has evaluated/synchronized animation, pose overrides and IK.
const evaluatedPose = new Map(
  puppet.rig.bones.map(({ id }) => [id, { ...puppet.getBone(id).pose }]),
);
const point = getFootContactWorldPosition(
  marker,
  puppet.rig,
  evaluatedPose,
  puppet.container.getWorldTransformMatrix(),
);
```

`evaluatedPose` is a readonly map of bone IDs to local transform values. It accepts final runtime joint poses or isolated IK sampler output. Omitted bones/properties use the normalized rig bind transform. Pass solved values to observe IK; sparse animation keys alone do not include the solver's rotation changes. The pure function does not evaluate a clip, run IK, synchronize rendering, advance a player or mutate data. Omitting the outer matrix returns puppet-local positions, useful for detached tools. Missing/deleted bones and nonfinite calculated positions return `undefined`; there is no fabricated origin fallback. Singular but finite transforms can still project points.

The existing demo sole offsets and Scene Editor ground alignment continue to use their current attachment-based calculations. Markers are independent references: moving one does not change animation keys, an IK target/end offset, ground preferences, Actor placement or physics. This milestone adds no visual tools, snapping, planting, second solver, collision or terrain behavior.

## Verification

`tests/footContactMarkers.test.ts` covers creation and default seeds, multiple contacts on arbitrary bones, duplicate IDs, malformed structure, missing bone references, finite coordinates, nested transforms, rotation/nonuniform scale/reflection, facing and Actor ancestors, post-IK runtime and isolated poses, JSON round trips, omitted/empty legacy collections, immutable snapshots, safe stale queries, export/recovery/history preservation and dependency-safe bone edits.

Implementation files:

- `src/engine/types.ts`, `schemas.ts`, `validation.ts`, `Rig.ts`: optional data, strict shape/reference validation and immutable runtime ownership.
- `src/engine/footContactMarkers.ts`: validated creation and pure position evaluation.
- `src/engine/core.ts`, `data.ts`, `serialization.ts`: public package exports.
- `src/engine/Puppet.ts`: runtime rig export preservation.
- `src/devtools/rig-editor/RigEditorState.ts`, `RigStructureCommands.ts`: snapshot/export retention and bone dependency guards.
- `schemas/rig.schema.json`: regenerated editor schema.
- `tests/footContactMarkers.test.ts`: 20 focused regressions.
- `README.md`, `CHANGELOG.md`, `docs/development.md`, `docs/schema-compatibility.md`, this guide: API, coordinates and compatibility documentation.

Final verification results:

| Command                                           | Result                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                               | Passed strict TypeScript checking; also passed within `check` and `build`.                                                             |
| `npx vitest run tests/footContactMarkers.test.ts` | Passed: 20 marker regressions.                                                                                                         |
| `npm run test`                                    | Passed: 188 files / 3,283 tests; 5 files / 56 tests skipped (193 files / 3,339 tests total).                                           |
| `npm run build`                                   | Passed: demo, library, declarations and plain-Node entry-point checks. Vite emitted the existing nonblocking module-directive notices. |
| `npm run check`                                   | Passed formatting, lint and typecheck.                                                                                                 |
| Built `/core` Node query                          | Passed: created a marker through the built public API and evaluated the expected `(12, 23)` position without a renderer.               |
| `git diff --check`, `git diff --cached --check`   | Passed.                                                                                                                                |
