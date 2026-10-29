# Mesh deformation animation (v1.4.4)

Mesh deformation keys add optional artistic corrections to bone-weighted attachments. They do not change bind geometry, UVs, weights, root motion or pelvis animation. There is no simulation.

## Authored schema

Version-1 animation files accept optional `deformationTracks`, keyed by stable mesh attachment ID. A key contains a millisecond `time`, sparse `offsets` keyed by stable vertex ID, and an optional outgoing `curve`. Each offset has finite `x` and `y` values in attachment-local bind units. Keys must have strictly increasing times within the clip. The curve uses the existing linear, stepped or Bézier progress model; the same progress applies to every vertex and both axes.

```json
{
  "deformationTracks": {
    "sleeve": [
      { "time": 0, "offsets": {} },
      { "time": 500, "offsets": { "elbow": { "x": 6, "y": -4 } } },
      { "time": 1000, "offsets": {} }
    ]
  }
}
```

An absent vertex in a shape means zero correction. Neighboring shapes interpolate the union of their vertex IDs, resolving missing endpoints to zero. Empty shapes are explicit neutral keys. Like bone properties, the first and last shapes hold outside their keyed range; one shape holds throughout the clip. Add neutral keys around a temporary correction to return smoothly to skeletal deformation. An animation without tracks produces ordinary weighted skinning.

`sampleMeshDeformation` samples a single shape timeline; `evaluateMeshDeformation` returns an immutable attachment/vertex map. These APIs, schema validators and types are exported through `/core`; authored types are also available through `/data`. Compilation owns immutable correction data, including externally supplied compiled clips. JSON schemas include the optional tracks, and correction keys count toward the existing animation workload limit.

## Evaluation and coordinates

1. Read immutable attachment-local bind vertices.
2. Sample correction offsets at the same raw or playback-quantized time used for bones and IK.
3. Add the offsets in attachment-local bind space.
4. Transform through attachment/slot bind matrices and each bone's inverse bind, then apply final FK/IK bone matrices and normalized weights.
5. Render through existing slot mounts and Puppet/Actor placement, facing, rotation and scale.

The skinning cache stores inverse-bind points plus linear transforms for correction vectors. Each update starts from those original points. Corrections never accumulate, even when seeking backward, changing skins, or reusing the output buffer. Slot-rigid meshes use an equivalent local correction fast path. Puppet/Actor placement and root travel remain separate and apply once.

Existing layer weights and crossfades resolve missing shapes against the underlying layer, or neutral on the base layer. Interrupted fades capture the current correction shape. Overlay mesh tracks leave other attachments unchanged. A bone mask includes a mesh only when all its positive-weight influence bones belong to the mask (all bind slot bones for legacy unweighted vertices); partial mesh masking/retargeting is unavailable. Stop holds the current pose; reset/clearing layers clears correction state with the ordinary pose lifecycle.

## Artist workflow

Open **Feature Guide → Animation Editor → Animating Mesh Deformation** for a nine-step walkthrough. It needs a selected animation and an existing mesh attachment; **Show prerequisite** links to Editing Mesh Geometry. The tour only reveals real controls and preserves editing mode, selection, keys, playback and history.

Open the Animation Editor's initially collapsed **Mesh Deformation** inspector tab. Enable **Edit Mesh Deformation**, choose a mesh, and select a vertex from the dropdown or its square handle. This is explicitly **bind-space correction mode**. The triangle view shows attachment-local geometry; the main textured Phaser preview shows the final posed silhouette. The editor does not invert the weighted posed silhouette, so overlapping bones, reflections or singular weighted mappings cannot silently create incorrect offsets.

Enter X/Y offsets and use **Set vertex correction key**, or drag a square. Shift-click selects multiple vertices; dragging translates that selection together. Numeric offsets set the same requested values for the selected vertices. **Add shape key** captures the sampled shape at the playhead, preserving other vertices. **Set neutral key** authors an empty shape. Drag changes are temporary until release and commit one Undo operation. Escape, pointer cancellation, focus loss, navigation, history and session replacement cancel provisional edits. Playback/scrubbing never authors corrections.

The shared timeline contains a **Mesh Deformation** group with one row per mesh. Select keys, drag horizontally, nudge with existing arrow shortcuts, edit time/interpolation in the inspector, or use Delete, Duplicate and the timeline Copy/Paste controls/shortcuts. A move/duplicate/paste cannot silently overwrite another shape. Copy retains the original mesh/vertex identities across animation selections; incompatible destinations fail validation. Imported Bézier controls are retained until interpolation is explicitly changed in the inspector. Bone and IK handles retain their existing appearance.

## Topology and compatibility

Vertex array order is irrelevant: IDs are the only correction references. Subdivision retains existing IDs and newly added vertices start neutral. Missing/replaced IDs and missing/non-mesh attachments are errors at import, compile, serialization and player registration. Reusing an old ID for a different logical vertex is an authoring error: keep IDs unique and allocate new IDs for replacements.

A working editor document retains incompatible tracks and shows an actionable topology message. Its preview evaluates compatible tracks; it does not substitute vertex array indexes. Export stays blocked until the mesh/IDs are restored or **Remove incompatible tracks** explicitly removes the affected tracks. The removal uses animation history. Undo can restore an incompatible snapshot after its required mesh IDs have been restored. Onion skins are hidden while topology is incompatible.

| Tool                 | Behavior                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Animation Variations | Deep-copy tracks and scale all correction key times with the clip.                                                                                                       |
| Mirroring            | Preserve correction data unchanged. The mirror panel explicitly warns that mesh/vertex mirroring is unavailable.                                                         |
| Pose Library         | Bone poses only; applying/capturing a pose preserves correction tracks.                                                                                                  |
| IK baking            | Preserve correction tracks while replacing bone keys and suppressing the baked constraints. Skinning uses the resulting final pose.                                      |
| Graph Editor         | Bone, IK and root channels only. Use the deformation inspector for shape interpolation and vertex offsets; imported Bézier controls are preserved.                       |
| Motion Diagnostics   | Measure bone motion; correction tracks remain unchanged.                                                                                                                 |
| Copy/paste           | Whole-clip/package serialization retains all corrections; timeline shape copying retains mesh and vertex IDs. Bone/event clipboard edits leave correction tracks intact. |
| Onion skins          | Sample correction shapes at each ghost's playback time, independently of the current shape.                                                                              |

## Implementation files

- Engine: `src/engine/meshDeformation.ts` owns shape sampling, blending and topology diagnostics. `AnimationClip.ts`, `AnimationLayerEvaluator.ts` and `AnimationPlayer.ts` own compilation/playback. `meshSkinning.ts`, `PuppetRenderer.ts` and `Puppet.ts` project corrections. `schemas.ts`, `validation.ts`, `jsonWorkloadLimits.ts`, `core.ts`, `data.ts` and `schemas/animation.schema.json` expose and validate the optional data.
- Editor: `src/devtools/animation-editor/deformationEdits.ts`, `MeshDeformationPanel.tsx` and `MeshDeformationController.ts` add authored commands and bind-space/timeline controls. `AnimationEditorState.ts` coordinates selection, temporary previews and document history. `AnimationEditorPreview.ts`, `AnimationEditorGhostLayer.ts` and `ghostPoseSampling.ts` project main/ghost samples.
- Integration: `TimelineController.ts`, `TimelineTracksController.ts`, `TimelineInputController.ts`, `TimelineKeyboardController.ts`, `TimelineSessionController.ts`, `TimelineClipboard.ts`, `editorMarkup.tsx` and `style.css` connect shared controls. `animationSerialization.ts`, `animationVariation.ts` and `MirrorToolsPanel.tsx` retain data and state compatibility limits.
- Verification/release: `tests/meshDeformation.test.ts`, `tests/browser/animationMeshDeformation.spec.ts`, the generated animation schema, package/lockfile metadata, `CHANGELOG.md` and the development/schema guides cover the milestone.

## Verification

`tests/meshDeformation.test.ts` covers neutral/sparse/multiple-vertex sampling, supported curves, inverse-bind order, reflected/nonuniform transforms, FK/IK, root-motion separation, runtime/editor parity, deterministic direct seeking, stepped endpoints, fades, layers, invalid data, topology changes, history, provisional edits, copying and serialization. `tests/browser/animationMeshDeformation.spec.ts` exercises an animated weighted sleeve, square-handle editing/cancellation, neutral endpoints, interpolation, timeline commands, Undo/Redo and portable reload on desktop.

Browser tests are local-only and use one worker. No browser installation or smoke-test step was added to CI.

Recorded verification results (one test worker, sequential runners):

| Check                                                                                                      | Result                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                            | Passed formatting, lint and strict TypeScript checks.                                                                                                                                                                       |
| `npm run typecheck`                                                                                        | Passed; also run by the final application/library build.                                                                                                                                                                    |
| `npm run test`                                                                                             | 225 test files passed, 7 skipped; 3,951 tests passed, 53 skipped. Includes 14 deformation regressions.                                                                                                                      |
| `npm run build`                                                                                            | Passed application bundles, library bundles/declarations and renderer-independent Node checks. Lucide's existing nonfatal `use client` bundling warnings remain.                                                            |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationMeshDeformation.spec.ts --workers=1` | 2 passed: development and production, 55.7 seconds. Verifies multi-vertex handle editing, key dragging/nudging, focus, cancellation, interpolation, history, clipboard and reload. Captures wait for stable painted frames. |
| `npm run test:package`                                                                                     | Passed isolated packed install, documentation, public declarations, Node/runtime compatibility and browser isolation.                                                                                                       |
| `npm run check:version`                                                                                    | Passed; package and lockfile are `1.4.4`, with a matching changelog heading.                                                                                                                                                |

Feature Guide follow-up verification: the focused animation/registry/rig/launcher suite passed **34 tests**. Formatting, lint, strict TypeScript and both builds passed. The expanded local Chrome deformation suite passed **4 browser scenarios** across development and production in **2.0 minutes**, including every guide spotlight with editing disabled and existing authored corrections, Back/Finish/restart/Escape, focus restoration, zero downloads and unchanged selection, fields, JSON and Undo/Redo. The guide screenshots were visually reviewed. All test runners used one worker and ran sequentially.
