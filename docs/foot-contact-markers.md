# Foot contact markers (v0.9.8.2)

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

The caller supplies the stable ID; creating another marker with that ID fails. The helper returns a validated authored copy without modifying its input. Explicit `localX`/`localY` override the seed. Missing coordinates start at the first child's normalized bind offset; a leaf uses `(0, length)` when length exists, otherwise `(0, 0)`. Explicit bone lengths use the same normalization as `Rig`. This seed is an editing convenience: neither a joint, endpoint nor artwork edge establishes the actual sole. Use the visual Rig Editor controls or the local numbers to place the contact precisely.

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

The existing demo sole offsets and Scene Editor ground alignment continue to use their current attachment-based calculations. Markers are independent references: moving one does not change animation keys, an IK target/end offset, ground preferences, Actor placement or physics. Marker editing adds no automatic detection, foot planting, second solver, collision or terrain behavior.

## Visual Rig Editor workflow

1. Select a foot or any other bone in Hierarchy. Open **Foot Contact Markers**, which starts collapsed like the other inspector sections.
2. Check **New contact bone**, then click **+ Add Contact Marker**. The editor generates a unique stable ID and seeds the position using the creation helper above. This works for loaded characters and new single-root drafts, without assuming any leg count.
3. Drag the square crosshair to the desired contact point. The selected handle is orange; other handles are green, outlined in white above the artwork. Each marker also has its own selectable button, even when points overlap or names repeat.
4. Edit **Name**, **Bone**, **Local X** and **Local Y**. Enter or blur commits a field; Escape discards an unfinished field edit. Changing the bone retains local coordinates, so reposition the point if needed. IDs remain stable when display names change.
5. Rotate or scale the bone, change facing, preview a pose, zoom or pan to check placement. Marker dragging stays available in preview poses. **Visibility > Foot contact markers** hides unselected handles when editing other gizmos.
6. Use rig **Undo/Redo** for additions, moves, renames, bone changes and deletions. One completed drag produces one operation; a click produces none. Escape, lost focus, hidden page or editor shutdown cancels a pending drag. Pointer release outside the canvas commits it.
7. Download/reload `rig.json`, or download the character ZIP. Marker data travels with the rig and browser recovery draft. Handles remain editor graphics and never become artwork or animation keys.

Open the collapsed **Ground reference** section to show the existing guide and set **Ground Y** while placing contacts. It shares the per-character preview-world settings with Animation Editor. Drag the amber **↕ Ground** tag to move the line; release commits one guide history operation and Escape cancels it. Only the tag captures ground dragging, so the rest of the line leaves marker and bone handles available. Guide Undo/Redo stays separate from rig history. Marker editing never moves bones or ground settings, and moving the reference never moves markers. Ground preferences stay browser metadata and are excluded from rig/character exports.

Canvas picking uses a fixed pixel radius. Each pointer position first passes through the camera's screen-to-world conversion, then the existing affine inverse of the referenced bone container's full world matrix. Drag deltas are stored as bone-local X/Y, with optional existing grid snapping. This includes root and ancestor transforms, nested rotated/nonuniformly scaled bones, facing reflections, camera pan and zoom. Singular transforms do not invent coordinates; a drag is cancelled if inversion becomes unavailable. Handles project the same local point through the live bone matrix, so evaluated pose changes are reflected without storing world-space coordinates.

`RigEditorState` owns the authoritative marker collection, selection and bounded snapshot history. The React `AttachmentController` adapts creation, selection, updates and deletion; `FootContactMarkersPanel` owns only unfinished field text. `RigEditorInputController` groups drag updates with `beginOperation`/`endOperation` and cancels with `cancelOperation`. `RigEditorOverlay` owns drawing, picking and destruction. The numeric input component is shared with the existing IK panel.

Marker deletion inspects live `RigEditorStateOptions.footContactReferences(id)` dependencies before changing data. Import, reset and history restoration enforce the same rule; referenced IDs cannot silently disappear or be reused. Hosts can supply Scene Editor grounding selections through that hook when such selections exist. The current scene format uses attachment ground contacts and stores no foot-marker IDs. Resolve dependencies before deleting a referenced marker. Bone deletion/renaming retains the existing marker dependency guards.

## Verification

`tests/footContactMarkers.test.ts` covers the renderer-independent foundation: creation defaults, validation, transforms, IK evaluation, serialization and immutable ownership. `tests/footContactMarkerEditor.test.ts` covers editor creation/selection, names, bone reassignment, numeric edits, duplicate IDs and invalid bones, deletion/reference guards, export/recovery, grouped drag history, facing and nested transforms, zoom/pan, cancellation, unchanged animation bytes/dirty state/history, and subscription/Phaser cleanup.

`tests/browser/footContactMarkers.spec.ts` exercises the desktop React/Phaser workflow locally: create two feet contacts, edit numbers/names, drag, cancel, switch facing, rotate a bone, undo/redo, change a referenced bone, delete, show the ground reference and export/reload. Browser checks remain local-only.

Relevant implementation files are `FootContactMarkersPanel.tsx`, `AttachmentController.ts`, `RigEditorState.ts`, `RigEditorInputController.ts`, `RigEditorOverlay.ts`, `RigWorkspaceController.ts`, `ControlsController.ts`, `editorMarkup.tsx`, and shared `InspectorNumberField.tsx`. Engine marker data and public runtime APIs are unchanged from v0.9.8.1.
